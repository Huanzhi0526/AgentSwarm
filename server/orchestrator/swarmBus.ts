import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AgentSlot,
  Board,
  BoardPost,
  BoardTask,
  DeliverableMeta,
  FileChangeItem,
  PostKind,
  TaskStatus,
  WorkspaceSnapshot,
} from '../../src/types.js';
import {
  confirmHostInboxDelivery,
  createMcpWave,
  findPostByClientMessageId,
  findReusableMcpWave,
  getBoard,
  getBoardAgents,
  getBoardMaxSeqId,
  getBoardPosts,
  getBoardTasks,
  getLatestBoardMcpWave,
  getMcpWave,
  getOrchestrationPreferences,
  getPostById,
  getUnreadHostPosts,
  insertPost,
  recomputeBoardHookPendingSeq,
  updateAgentSlot,
  updateBoardConfig,
  updateMcpWaveProgress,
  updatePostMeta,
  upsertTask,
} from '../db.js';
import { classifyCliFailure, runLiveCliTurn } from '../engines/cliRunner.js';
import {
  captureWorkspaceBaseline,
  listBoardSnapshots,
  recordTurnSnapshotIfChanged,
} from '../safety/snapshotManager.js';
import { extractMentionedWorkspaceFiles } from '../fs/workspaceExplorer.js';

export type WsBroadcastFn = (event: {
  type:
    | 'post.created'
    | 'agent.updated'
    | 'agent.created'
    | 'agent.deleted'
    | 'task.upserted'
    | 'board.updated'
    | 'agent.raw_log'
    | 'snapshot.updated';
  boardId: string;
  payload: unknown;
}) => void;

const MAX_AUTO_HOPS_WITHOUT_HUMAN = 8;
const rawLogsBySlotKey = new Map<string, string[]>();

export function getAgentRawLogs(boardId: string, slotId: string): string[] {
  return rawLogsBySlotKey.get(`${boardId}:${slotId}`) ?? [];
}

function appendRawLog(boardId: string, slotId: string, line: string, broadcast: WsBroadcastFn) {
  const key = `${boardId}:${slotId}`;
  const list = rawLogsBySlotKey.get(key) ?? [];
  const stamped = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`;
  list.push(stamped);
  if (list.length > 200) list.shift();
  rawLogsBySlotKey.set(key, list);
  broadcast({
    type: 'agent.raw_log',
    boardId,
    payload: { slotId, line: stamped },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getLeaderSlot(roster: AgentSlot[]): AgentSlot | undefined {
  return roster.find((r) => r.isLeader) || roster[0];
}

function extractMentions(text: string, validSlotIds: string[], selfSlotId: string): string[] {
  const found = new Set<string>();
  const regex = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const target = m[1].toLowerCase();
    if (validSlotIds.includes(target) && target !== selfSlotId) {
      found.add(target);
    }
  }
  return Array.from(found);
}

interface DispatchRoleDirective {
  slotId: string;
  displayName?: string;
  roleTitle?: string;
  roleBrief?: string;
}

interface DispatchTaskDirective {
  title: string;
  description?: string;
  assigneeSlotId: string;
  status?: TaskStatus;
  blockedByTitles?: string[];
}

interface CoworkDispatchPayload {
  roles?: DispatchRoleDirective[];
  tasks?: DispatchTaskDirective[];
}

interface CoworkStatusPayload {
  completedTaskTitles?: string[];
}

function extractDirectiveFence<T>(
  rawText: string,
  fenceName: 'cowork-dispatch' | 'cowork-status'
): { cleanText: string; data: T | null } {
  const re = new RegExp('```' + fenceName + '\\s*([\\s\\S]*?)```', 'gi');
  let match: RegExpExecArray | null = null;
  let lastMatch: RegExpExecArray | null = null;
  while ((match = re.exec(rawText)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) return { cleanText: rawText.trim(), data: null };

  const jsonBody = lastMatch[1]?.trim() || '';
  let parsed: T | null = null;
  try {
    parsed = JSON.parse(jsonBody) as T;
  } catch {
    parsed = null;
  }

  const stripped = rawText.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  return {
    cleanText: parsed ? stripped : rawText.trim(),
    data: parsed,
  };
}

function isSlotExclusivelyBlocked(slotId: string, tasks: BoardTask[]): boolean {
  const owned = tasks.filter((t) => t.assigneeSlotId === slotId && t.status !== 'completed');
  if (owned.length === 0) return false;
  const hasReady = owned.some((t) => {
    if (t.blockedBy.length === 0) return true;
    return t.blockedBy.every((depId) => tasks.find((x) => x.id === depId)?.status === 'completed');
  });
  return !hasReady;
}

function buildSwarmPrompt(params: {
  board: Board;
  slot: AgentSlot;
  roster: AgentSlot[];
  tasks: BoardTask[];
  recentPosts: BoardPost[];
  triggerReason: string;
}): string {
  const { board, slot, roster, tasks, recentPosts, triggerReason } = params;
  const leader = getLeaderSlot(roster);
  const prefs = getOrchestrationPreferences();

  const rosterLines = roster
    .map((r) => {
      const roleTag = r.isLeader
        ? '主管'
        : r.roleAutoAssigned
          ? '待主管分配职责'
          : '用户已指定职责';
      return `- @${r.slotId} (${r.displayName} · ${r.engine}/${r.modelId} · 思考强度:${r.reasoningEffort}) [${roleTag}] — ${r.roleTitle}：${r.roleBrief}`;
    })
    .join('\n');

  const taskLines =
    tasks.length > 0
      ? tasks
          .map((t) => {
            const deps =
              t.blockedBy.length > 0
                ? `（前置依赖：${t.blockedBy
                    .map((id) => tasks.find((x) => x.id === id)?.title || id)
                    .join('、')}）`
                : '';
            return `- [${t.status}] ${t.title} (@${t.assigneeSlotId})${deps}`;
          })
          .join('\n')
      : '（暂无子任务）';

  const recentFeed = recentPosts
    .slice(-10)
    .map((p) => `[${p.authorName}(@${p.authorSlotId})]: ${p.content}`)
    .join('\n\n');

  const globalPrefSection =
    slot.isLeader && prefs.globalDispatchPrompt.trim()
      ? `\n## 全局分工偏好（用户全局设定）\n${prefs.globalDispatchPrompt.trim()}\n`
      : '';

  const leaderRules = slot.isLeader
    ? `\n## 主管统筹与动态分工协议
1. **分工优先级**：
   - 若用户本轮指令中明确点名某成员承担某工作，或成员标记为 \`[用户已指定职责]\`，严格按用户要求执行；
   - 对标记为 \`[待主管分配职责]\` 或用户未明确划分的成员，请结合当前目标、「全局分工偏好」及各成员的引擎/模型特长自动分配最合适的职责；
   - 若偏好之间存在冲突或成员人数与偏好不完全对应，由你自主统筹调整，确保每位待岗成员职责清晰、不重叠。
2. **结构化落盘职责与任务（可选但强烈推荐）**：如需在看板同步更新成员职责或任务依赖，请在回复最末尾附加一段 \`cowork-dispatch\` 代码块（用户界面会自动渲染为职责卡片，不会原样显示 JSON）：
\`\`\`cowork-dispatch
{
  "roles": [
    { "slotId": "member_1", "displayName": "核心实现", "roleTitle": "后端与接口开发", "roleBrief": "负责接口实现与自测" }
  ],
  "tasks": [
    { "title": "接口与核心实现", "assigneeSlotId": "member_1", "status": "in_progress" },
    { "title": "联调验收测试", "assigneeSlotId": "member_2", "status": "pending", "blockedByTitles": ["接口与核心实现"] }
  ]
}
\`\`\`
3. **分波次按需唤醒**：需要立即开始工作的成员请在正文中直接 \`@slot_id\`（如 \`@member_1\`）；存在 \`blockedByTitles\` 前置依赖的下游成员**先不要在正文中点名**，看板会在上游完成后自动解锁并唤醒。\n`
    : `\n## 协作交付规范
1. 完成你当前承担的子任务后，如已完成对应任务可在回复末尾附加：
\`\`\`cowork-status
{ "completedTaskTitles": ["任务标题"] }
\`\`\`
2. 完成后请在正文中向 \`@${leader?.slotId || 'lead'}\` 汇报结果，或按主管安排交接下一棒。\n`;

  return `# 团队协同上下文
你的身份: ${slot.displayName} (@${slot.slotId})
职责: ${slot.roleTitle} — ${slot.roleBrief}
思考强度要求: ${slot.reasoningEffort}
工作目录: ${board.workspacePath}
当前目标: ${board.goal}

## 团队成员 (点名请用 @slot_id)
${rosterLines}
${globalPrefSection}
## 任务进度
${taskLines}

## 最近对话记录
${recentFeed}

## 本次触发原因
${triggerReason}
${leaderRules}
## 回复与零轮询守则
1. **严格禁止轮询等待**：绝对不要运行 \`sleep\`、循环查询或其他等待队友完工的命令；做完自己当前一步的工作后直接输出结论并结束退出，系统会通过看板事件自动唤醒协作者或主管（休眠 0 消耗）。
2. 直接输出结构清晰、直白易读的中文进展或结论（看板原生支持 GFM Markdown），不要滥用表情符号。
3. 若创建、修改或交付了工作区内的文件，请用反引号写出相对路径（例如 \`docs/方案.md\` 或 \`src/App.tsx\`），方便用户在看板直接点击预览或打开。`;
}

interface QueuedWakeup {
  slotId: string;
  reasons: string[];
  triggeredBySlotId?: string;
  allowMcpHostCliLeader?: boolean;
}

export interface WaveSettlementResult {
  boardId: string;
  waveId: string | null;
  waveStatus: 'running' | 'completed' | 'failed' | 'idle';
  reason:
    | 'wave_completed'
    | 'human_interjection'
    | 'approval_needed'
    | 'worker_failed'
    | 'timeout'
    | 'standby_released';
  message?: string;
  stopAutoStandby?: boolean;
  latestSeqId: number;
  resumeCursorSeqId: number;
  stillWorkingSlots: string[];
  recoveryAction?: {
    tool: 'cowork_wait_board';
    arguments: { boardId: string; waveId?: string; sinceSeqId: number };
    hint: string;
  };
  posts: Array<{
    id: string;
    seqId: number;
    authorType: BoardPost['authorType'];
    authorSlotId: string;
    authorName: string;
    kind: PostKind;
    title: string;
    content: string;
    mentions: string[];
    snapshotId?: string;
    filesChanged?: string[];
    createdAt: number;
  }>;
  humanInterjections: Array<{
    id: string;
    seqId: number;
    content: string;
    mentions: string[];
    createdAt: number;
  }>;
  evidence: {
    snapshots: Array<{
      id: string;
      label: string;
      authorName: string;
      kind: WorkspaceSnapshot['kind'];
      status: WorkspaceSnapshot['status'];
      fileCount: number;
      filesChanged: FileChangeItem[];
    }>;
    fileChangesSummary: {
      added: string[];
      modified: string[];
      deleted: string[];
    };
    tasksSummary: {
      total: number;
      completed: number;
      inProgress: number;
      pending: number;
      items: Array<{
        id: string;
        title: string;
        status: TaskStatus;
        assigneeSlotId: string;
      }>;
    };
    agentMetrics: Array<{
      slotId: string;
      displayName: string;
      engine: string;
      modelId: string;
      state: AgentSlot['state'];
      turnCount: number;
      totalTokens: number;
    }>;
  };
}

export class SwarmOrchestrator {
  public readonly boardEvents = new EventEmitter();
  private pendingQueues = new Map<string, QueuedWakeup[]>();
  private runningBoards = new Set<string>();
  private activeWorkerSlots = new Map<string, string>();
  private activeHostWaiters = new Map<string, number>();

  constructor(
    private readonly getApiPort: () => number,
    private readonly broadcast: WsBroadcastFn
  ) {
    this.boardEvents.setMaxListeners(120);
  }

  public emitBoardEvent(
    boardId: string,
    event: {
      type:
        | 'human_interjection'
        | 'human_directive'
        | 'post_created'
        | 'approval_needed'
        | 'worker_settled'
        | 'worker_failed'
        | 'snapshot_created'
        | 'queue_drained'
        | 'standby.release';
      slotId?: string;
      post?: BoardPost;
      snapshot?: WorkspaceSnapshot;
      note?: string;
    }
  ): void {
    this.boardEvents.emit(`board:${boardId}`, event);
  }

  public releaseStandbyWaiters(boardId: string, note?: string): void {
    this.emitBoardEvent(boardId, {
      type: 'standby.release',
      note: note || '用户已在看板关闭自动待命监听，请正常结束当前回合。',
    });
  }

  public isBoardWaveBusy(boardId: string): boolean {
    return (
      this.activeWorkerSlots.has(boardId) ||
      (this.pendingQueues.get(boardId)?.length ?? 0) > 0
    );
  }

  public async handleHumanMessage(params: {
    boardId: string;
    content: string;
    targetSlotId?: string;
    targetExplicitlyChosen?: boolean;
    clientMessageId?: string;
  }): Promise<BoardPost> {
    const board = getBoard(params.boardId);
    if (!board) throw new Error('看板不存在');

    if (params.clientMessageId) {
      const existing = findPostByClientMessageId(board.id, params.clientMessageId);
      if (existing) return existing;
    }

    const roster = getBoardAgents(board.id);
    const validSlots = roster.map((r) => r.slotId);
    const leaderSlotId = getLeaderSlot(roster)?.slotId || validSlots[0] || 'lead';
    const firstMentioned = extractMentions(params.content, validSlots, 'human')[0];
    const validManual =
      params.targetSlotId && validSlots.includes(params.targetSlotId)
        ? params.targetSlotId
        : undefined;

    const explicitTarget = params.targetExplicitlyChosen
      ? validManual || firstMentioned || leaderSlotId
      : firstMentioned || validManual || leaderSlotId;

    const updatedBoard = updateBoardConfig(board.id, {
      hopCountSinceHuman: 0,
      goal: !board.goal || board.turnCount === 0 ? params.content.slice(0, 80) : board.goal,
    })!;
    this.broadcast({ type: 'board.updated', boardId: board.id, payload: updatedBoard });

    if (board.leaderMode === 'mcp_host' && explicitTarget === leaderSlotId) {
      const hasActiveWaiter =
        updatedBoard.hostWaiting || (this.activeHostWaiters.get(board.id) ?? 0) > 0;
      const hostDelivery: DeliverableMeta['hostDelivery'] =
        !hasActiveWaiter && updatedBoard.hostCliFallback ? 'cli_fallback' : 'queued_for_host';

      const post = insertPost({
        boardId: board.id,
        authorType: 'human',
        authorSlotId: 'human',
        authorName: '我',
        kind: 'human_directive',
        title: '',
        content: params.content,
        mentions: [explicitTarget],
        meta: {
          ...(params.clientMessageId ? { clientMessageId: params.clientMessageId } : {}),
          hostDelivery,
        },
      });
      this.broadcast({ type: 'post.created', boardId: board.id, payload: post });

      if (hostDelivery === 'cli_fallback') {
        const synced = updateBoardConfig(board.id, { hostLastReadSeqId: post.seqId });
        if (synced) this.broadcast({ type: 'board.updated', boardId: board.id, payload: synced });
        this.enqueueWakeup(board.id, leaderSlotId, `用户发来消息：${params.content}`, 'human', {
          allowMcpHostCliLeader: true,
        });
      } else {
        this.emitBoardEvent(board.id, { type: 'human_interjection', post });
      }
      return post;
    }

    const post = insertPost({
      boardId: board.id,
      authorType: 'human',
      authorSlotId: 'human',
      authorName: '我',
      kind: 'human_directive',
      title: '',
      content: params.content,
      mentions: [explicitTarget],
      meta: params.clientMessageId ? { clientMessageId: params.clientMessageId } : undefined,
    });
    this.broadcast({ type: 'post.created', boardId: board.id, payload: post });
    this.emitBoardEvent(board.id, { type: 'human_directive', post });

    this.enqueueWakeup(board.id, explicitTarget, `用户发来消息：${params.content}`, 'human');
    return post;
  }

  public enqueueWakeup(
    boardId: string,
    slotId: string,
    reason: string,
    triggeredBySlotId?: string,
    options?: { allowMcpHostCliLeader?: boolean }
  ): void {
    const queue = this.pendingQueues.get(boardId) ?? [];
    const existing = queue.find((q) => q.slotId === slotId);
    if (existing) {
      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      if (!existing.triggeredBySlotId && triggeredBySlotId) {
        existing.triggeredBySlotId = triggeredBySlotId;
      }
      if (options?.allowMcpHostCliLeader) {
        existing.allowMcpHostCliLeader = true;
      }
    } else {
      queue.push({
        slotId,
        reasons: [reason],
        triggeredBySlotId,
        allowMcpHostCliLeader: options?.allowMcpHostCliLeader,
      });
      this.pendingQueues.set(boardId, queue);
    }

    if (!this.runningBoards.has(boardId)) {
      void this.drainBoardQueue(boardId);
    }
  }

  private async drainBoardQueue(boardId: string): Promise<void> {
    if (this.runningBoards.has(boardId)) return;
    this.runningBoards.add(boardId);

    try {
      while (true) {
        const queue = this.pendingQueues.get(boardId);
        if (!queue || queue.length === 0) break;

        // Coordinator barrier: always drain ready worker slots before waking Leader so parallel waves coalesce cleanly
        const board = getBoard(boardId);
        const roster = getBoardAgents(boardId);
        const leaderId = getLeaderSlot(roster)?.slotId;
        const workerIdx = queue.findIndex((item) => item.slotId !== leaderId);
        const pickIdx = workerIdx >= 0 ? workerIdx : 0;
        const next = queue.splice(pickIdx, 1)[0];

        if (
          board?.leaderMode === 'mcp_host' &&
          leaderId &&
          next.slotId === leaderId &&
          !next.allowMcpHostCliLeader
        ) {
          continue;
        }

        const combinedReason =
          next.reasons.length === 1
            ? next.reasons[0]
            : `汇总以下协同事项：\n- ${next.reasons.join('\n- ')}`;

        this.activeWorkerSlots.set(boardId, next.slotId);
        try {
          await this.executeAgentWakeup(
            boardId,
            next.slotId,
            combinedReason,
            next.triggeredBySlotId,
            Boolean(next.allowMcpHostCliLeader)
          );
        } catch (err) {
          console.error(`[SwarmOrchestrator] Error in wakeup (${boardId}/${next.slotId}):`, err);
        } finally {
          this.activeWorkerSlots.delete(boardId);
          this.emitBoardEvent(boardId, { type: 'worker_settled', slotId: next.slotId });
        }
      }
    } finally {
      this.runningBoards.delete(boardId);
      const remaining = this.pendingQueues.get(boardId);
      if (remaining && remaining.length > 0) {
        void this.drainBoardQueue(boardId);
      } else {
        this.emitBoardEvent(boardId, { type: 'queue_drained' });
      }
    }
  }

  private async executeAgentWakeup(
    boardId: string,
    slotId: string,
    reason: string,
    triggeredBySlotId?: string,
    allowMcpHostCliLeader = false
  ): Promise<void> {
    const board = getBoard(boardId);
    if (!board) return;

    const roster = getBoardAgents(boardId);
    const slot = roster.find((r) => r.slotId === slotId);
    if (!slot) return;

    if (board.leaderMode === 'mcp_host' && slot.isLeader && !allowMcpHostCliLeader) {
      return;
    }

    if (board.hopCountSinceHuman >= MAX_AUTO_HOPS_WITHOUT_HUMAN) {
      this.pendingQueues.delete(boardId);
      const gatePost = insertPost({
        boardId,
        authorType: 'system',
        authorSlotId: 'system',
        authorName: '系统',
        kind: 'approval_gate',
        title: '已暂停自动接力，等待你确认',
        content: `团队已连续自动协作多轮，下一步原计划由 **@${slot.slotId}（${slot.displayName}）** 继续处理。\n\n请选择 **继续接力** 或 **结束本轮**，也可直接在下方补充新要求。`,
        mentions: [slot.slotId],
        meta: {
          approvalStatus: 'pending',
          pausedWakeup: {
            slotId: slot.slotId,
            slotName: slot.displayName,
            reason,
          },
        },
      });
      this.broadcast({ type: 'post.created', boardId, payload: gatePost });
      this.emitBoardEvent(boardId, { type: 'approval_needed', post: gatePost });
      return;
    }

    updateBoardConfig(boardId, { hopCountSinceHuman: board.hopCountSinceHuman + 1 });

    if (board.executionMode === 'demo' || slot.engine === 'demo') {
      await this.runDemoSimulationTurn(board, slot, roster, reason, triggeredBySlotId);
      return;
    }

    // Capture automatic safety baseline before agent touches workspace files
    const preBaseline = captureWorkspaceBaseline(board.workspacePath);

    const workingSlot = updateAgentSlot(boardId, slotId, {
      state: 'working',
      currentActivity: '处理中...',
    })!;
    this.broadcast({ type: 'agent.updated', boardId, payload: workingSlot });

    try {
      const tasks = getBoardTasks(boardId);
      const recentPosts = getBoardPosts(boardId);
      const prompt = buildSwarmPrompt({
        board,
        slot: workingSlot,
        roster,
        tasks,
        recentPosts,
        triggerReason: reason,
      });

      const result = await runLiveCliTurn({
        board,
        slot: workingSlot,
        prompt,
        apiPort: this.getApiPort(),
        callbacks: {
          onActivity: (summary) => {
            const s = updateAgentSlot(boardId, slotId, { currentActivity: summary });
            if (s) this.broadcast({ type: 'agent.updated', boardId, payload: s });
          },
          onRawLog: (line) => {
            appendRawLog(boardId, slotId, line, this.broadcast);
          },
        },
      });

      // Automatically detect & store file changes for one-click graphical preview / undo
      const autoSnapshot = recordTurnSnapshotIfChanged({
        boardId,
        authorName: slot.displayName,
        label: `${slot.displayName} 完成的改动`,
        baseline: preBaseline,
      });
      if (autoSnapshot) {
        this.broadcast({ type: 'snapshot.updated', boardId, payload: autoSnapshot });
        this.emitBoardEvent(boardId, { type: 'snapshot_created', snapshot: autoSnapshot });
      }

      const { cleanText: textAfterDispatch, data: dispatchData } = extractDirectiveFence<CoworkDispatchPayload>(
        result.finalText,
        'cowork-dispatch'
      );
      const { cleanText: cleanContent, data: statusData } = extractDirectiveFence<CoworkStatusPayload>(
        textAfterDispatch,
        'cowork-status'
      );
      const finalContent =
        cleanContent ||
        (slot.isLeader ? '已完成团队职责划分与任务拆解。' : '已完成当前阶段任务处理。');

      const staffingTable: NonNullable<DeliverableMeta['staffingTable']> = [];
      const newlyAssignedWakeups = new Set<string>();

      if (slot.isLeader && dispatchData) {
        if (Array.isArray(dispatchData.roles)) {
          for (const roleSpec of dispatchData.roles) {
            const targetSlot = roster.find(
              (r) => !r.isLeader && r.slotId.toLowerCase() === String(roleSpec.slotId || '').toLowerCase()
            );
            if (!targetSlot) continue;
            const updatedSlot = updateAgentSlot(boardId, targetSlot.slotId, {
              displayName: roleSpec.displayName?.trim() || undefined,
              roleTitle: roleSpec.roleTitle?.trim() || undefined,
              roleBrief: roleSpec.roleBrief?.trim() || roleSpec.roleTitle?.trim() || undefined,
              roleAutoAssigned: false,
            });
            if (updatedSlot) {
              this.broadcast({ type: 'agent.updated', boardId, payload: updatedSlot });
              staffingTable.push({
                slotId: updatedSlot.slotId,
                name: updatedSlot.displayName,
                role: updatedSlot.roleTitle,
                engine: updatedSlot.engine,
                modelId: updatedSlot.modelId,
              });
            }
          }
        }

        if (Array.isArray(dispatchData.tasks) && dispatchData.tasks.length > 0) {
          const validSlotSet = new Set(roster.map((r) => r.slotId));
          const titleToId = new Map<string, string>();
          for (const existingTask of getBoardTasks(boardId)) {
            titleToId.set(existingTask.title.trim().toLowerCase(), existingTask.id);
          }

          const createdTaskPairs: Array<{ task: BoardTask; spec: DispatchTaskDirective }> = [];
          for (const spec of dispatchData.tasks) {
            const taskTitle = String(spec.title || '').trim();
            if (!taskTitle) continue;
            const assignee = validSlotSet.has(spec.assigneeSlotId)
              ? spec.assigneeSlotId
              : roster.find((r) => !r.isLeader)?.slotId || slot.slotId;

            const saved = upsertTask({
              boardId,
              title: taskTitle,
              description: spec.description || '',
              assigneeSlotId: assignee,
              status: spec.blockedByTitles?.length ? 'pending' : spec.status || 'in_progress',
              blockedBy: [],
            });
            titleToId.set(taskTitle.toLowerCase(), saved.id);
            createdTaskPairs.push({ task: saved, spec });
          }

          const tasksNowSnapshot = getBoardTasks(boardId);
          for (const { task, spec } of createdTaskPairs) {
            const depIds = (spec.blockedByTitles || [])
              .map((bt) => titleToId.get(String(bt || '').trim().toLowerCase()))
              .filter((id): id is string => Boolean(id && id !== task.id));

            const allDepsDone =
              depIds.length === 0 ||
              depIds.every((id) => tasksNowSnapshot.find((t) => t.id === id)?.status === 'completed');

            const finalStatus: TaskStatus =
              depIds.length > 0 && !allDepsDone
                ? 'pending'
                : spec.status === 'completed' || spec.status === 'review'
                  ? spec.status
                  : 'in_progress';

            const finalTask =
              depIds.length > 0 || finalStatus !== task.status
                ? upsertTask({ ...task, blockedBy: depIds, status: finalStatus })
                : task;

            this.broadcast({ type: 'task.upserted', boardId, payload: finalTask });
            if (finalTask.status === 'in_progress' && finalTask.assigneeSlotId !== slot.slotId) {
              newlyAssignedWakeups.add(finalTask.assigneeSlotId);
            }
          }
        }
      }

      const validSlots = roster.map((r) => r.slotId);
      const mentions = extractMentions(finalContent, validSlots, slotId);

      const snapPaths = autoSnapshot?.filesChanged.map((c) => c.path) ?? [];
      const mentionedPaths = extractMentionedWorkspaceFiles(board.workspacePath, finalContent);
      const mergedDeliverableFiles = Array.from(new Set([...snapPaths, ...mentionedPaths]));

      const post = insertPost({
        boardId,
        authorType: 'agent',
        authorSlotId: slot.slotId,
        authorName: slot.displayName,
        authorEngine: slot.engine,
        kind: slot.isLeader ? 'dispatch_brief' : 'deliverable',
        title: '',
        content: finalContent,
        mentions,
        meta: {
          modelId: workingSlot.modelId,
          reasoningEffort: workingSlot.reasoningEffort,
          replyToSlotId: triggeredBySlotId,
          staffingTable: staffingTable.length > 0 ? staffingTable : undefined,
          snapshotId: autoSnapshot?.id,
          changeStatus: autoSnapshot ? 'pending' : undefined,
          fileChanges: autoSnapshot?.filesChanged,
          filesChanged: mergedDeliverableFiles.length > 0 ? mergedDeliverableFiles : undefined,
          durationMs: result.durationMs,
          tokensUsed: result.inputTokens + result.outputTokens,
        },
      });
      this.broadcast({ type: 'post.created', boardId, payload: post });
      this.emitBoardEvent(boardId, { type: 'post_created', post });

      const finishedSlot = updateAgentSlot(boardId, slotId, {
        state: 'waiting',
        currentActivity: '待命',
        nativeSessionId: result.nativeSessionId ?? workingSlot.nativeSessionId,
        addInputTokens: result.inputTokens,
        addOutputTokens: result.outputTokens,
        addCachedTokens: result.cachedTokens,
        incrementTurn: true,
      })!;
      this.broadcast({ type: 'agent.updated', boardId, payload: finishedSlot });
      this.broadcast({ type: 'board.updated', boardId, payload: getBoard(boardId)! });

      let completedAnyTask = false;
      const unlockedTasks: BoardTask[] = [];

      if (!slot.isLeader) {
        const myIncomplete = getBoardTasks(boardId).filter(
          (t) => t.assigneeSlotId === slot.slotId && t.status !== 'completed'
        );
        const requestedTitles = (statusData?.completedTaskTitles || []).map((s) =>
          s.trim().toLowerCase()
        );
        const toComplete =
          requestedTitles.length > 0
            ? myIncomplete.filter((t) =>
                requestedTitles.some(
                  (rt) =>
                    t.title.trim().toLowerCase() === rt || t.title.trim().toLowerCase().includes(rt)
                )
              )
            : myIncomplete.filter((t) => t.status === 'in_progress');

        const finalCompleteList =
          toComplete.length > 0
            ? toComplete
            : requestedTitles.length === 0 && myIncomplete.length > 0
              ? [myIncomplete[0]]
              : [];

        for (const t of finalCompleteList) {
          const doneTask = upsertTask({
            ...t,
            status: 'completed',
            deliverablePostId: post.id,
          });
          this.broadcast({ type: 'task.upserted', boardId, payload: doneTask });
          completedAnyTask = true;
        }

        const tasksNow = getBoardTasks(boardId);
        const readyToUnlock = tasksNow.filter(
          (t) =>
            t.status === 'pending' &&
            t.blockedBy.length > 0 &&
            t.blockedBy.every((depId) => tasksNow.find((x) => x.id === depId)?.status === 'completed')
        );
        for (const nextTask of readyToUnlock) {
          const started = upsertTask({ ...nextTask, status: 'in_progress' });
          this.broadcast({ type: 'task.upserted', boardId, payload: started });
          unlockedTasks.push(started);
        }
      }

      const tasksAfterTurn = getBoardTasks(boardId);
      const leader = getLeaderSlot(getBoardAgents(boardId));
      const candidateTargets = slot.isLeader
        ? Array.from(new Set([...mentions, ...newlyAssignedWakeups]))
        : mentions;

      const unblockedMentions = candidateTargets.filter(
        (t) =>
          (board.leaderMode !== 'mcp_host' || !leader || t !== leader.slotId) &&
          !isSlotExclusivelyBlocked(t, tasksAfterTurn)
      );

      for (const unlocked of unlockedTasks) {
        this.enqueueWakeup(
          boardId,
          unlocked.assigneeSlotId,
          `前置任务已完成，请继续执行「${unlocked.title}」。`,
          slot.slotId
        );
      }

      for (const target of unblockedMentions) {
        this.enqueueWakeup(
          boardId,
          target,
          `${slot.displayName} (@${slot.slotId}) 请你协作处理。`,
          slot.slotId
        );
      }

      if (
        board.leaderMode !== 'mcp_host' &&
        !slot.isLeader &&
        unblockedMentions.length === 0 &&
        unlockedTasks.length === 0 &&
        leader &&
        leader.slotId !== slot.slotId &&
        ((triggeredBySlotId && triggeredBySlotId !== 'human') ||
          completedAnyTask ||
          tasksAfterTurn.some((t) => t.status !== 'completed'))
      ) {
        this.enqueueWakeup(boardId, leader.slotId, `${slot.displayName} 已完成当前处理并向你汇报。`, slot.slotId);
      }
    } catch (err) {
      const rawErrMsg = err instanceof Error ? err.message : String(err);
      const classified = classifyCliFailure(slot.displayName, rawErrMsg);
      const errMsg = classified.summary;

      const latestHumanPost = getBoardPosts(boardId)
        .filter((p) => p.authorType === 'human')
        .slice(-1)[0];
      const sourceHumanText = latestHumanPost?.content || '';

      let failedSnapshot: WorkspaceSnapshot | null = null;
      try {
        failedSnapshot = recordTurnSnapshotIfChanged({
          boardId,
          authorName: slot.displayName,
          label: `${slot.displayName} 执行失败但有文件变化`,
          baseline: preBaseline,
          kind: 'failed_turn',
        });
        if (failedSnapshot) {
          this.broadcast({ type: 'snapshot.updated', boardId, payload: failedSnapshot });
          this.emitBoardEvent(boardId, { type: 'snapshot_created', snapshot: failedSnapshot });
        }
      } catch {
        // ignore snapshot capture error on failure path
      }

      const blockedSlot = updateAgentSlot(boardId, slotId, {
        state: 'blocked',
        currentActivity:
          classified.kind === 'engine_uninstalled'
            ? '引擎未安装'
            : classified.kind === 'auth_required'
              ? '需登录授权'
              : '调用失败',
      })!;
      this.broadcast({ type: 'agent.updated', boardId, payload: blockedSlot });

      const failedPaths = failedSnapshot?.filesChanged.map((c) => c.path) ?? [];
      const extraHint = failedSnapshot
        ? `\n\n> 执行失败但检测到本轮修改了 ${failedSnapshot.fileCount} 个文件，已自动生成保护备份，可直接对比或一键撤回。`
        : '';

      const statusHeading =
        classified.kind === 'engine_uninstalled'
          ? '引擎未安装，无法执行：'
          : classified.kind === 'auth_required'
            ? '需要完成登录或 API 配置：'
            : '调用执行失败：';

      const errPost = insertPost({
        boardId,
        authorType: 'agent',
        authorSlotId: slot.slotId,
        authorName: slot.displayName,
        authorEngine: slot.engine,
        kind: 'discussion',
        content: `${statusHeading}${errMsg}${extraHint}`,
        meta: {
          modelId: workingSlot.modelId,
          reasoningEffort: workingSlot.reasoningEffort,
          replyToSlotId: triggeredBySlotId,
          isError: true,
          errorKind: classified.kind,
          sourceHumanText: sourceHumanText || undefined,
          snapshotId: failedSnapshot?.id,
          changeStatus: failedSnapshot ? 'pending' : undefined,
          fileChanges: failedSnapshot?.filesChanged,
          filesChanged: failedPaths.length > 0 ? failedPaths : undefined,
        },
      });
      this.broadcast({ type: 'post.created', boardId, payload: errPost });
      this.emitBoardEvent(boardId, { type: 'worker_failed', slotId: slot.slotId, post: errPost });
    }
  }

  private async runDemoSimulationTurn(
    board: Board,
    slot: AgentSlot,
    roster: AgentSlot[],
    reason: string,
    triggeredBySlotId?: string
  ): Promise<void> {
    const leader = getLeaderSlot(roster);
    const nonLeaders = roster.filter((r) => r.slotId !== leader?.slotId && !r.isLeader);
    const recent = getBoardPosts(board.id);
    const latestHuman = [...recent].reverse().find((p) => p.authorType === 'human');
    const topic = latestHuman?.content.slice(0, 36) || board.goal;

    const markWorking = (activity: string) => {
      const s = updateAgentSlot(board.id, slot.slotId, { state: 'working', currentActivity: activity })!;
      this.broadcast({ type: 'agent.updated', boardId: board.id, payload: s });
    };

    markWorking('思考中...');
    appendRawLog(board.id, slot.slotId, `处理消息 -> ${reason}`, this.broadcast);
    await sleep(600);

    if (slot.isLeader) {
      const triggeredByWorker = reason.includes('汇报了成果');
      if (triggeredByWorker) {
        markWorking('整理汇总中...');
        await sleep(600);

        const gatePost = insertPost({
          boardId: board.id,
          authorType: 'agent',
          authorSlotId: slot.slotId,
          authorName: slot.displayName,
          authorEngine: slot.engine,
          kind: 'approval_gate',
          title: '阶段任务已完成',
          content: `关于「${topic}」的各项改动均已提交，请确认是否采纳通过，或直接发消息调整。`,
          mentions: [],
          meta: {
            modelId: slot.modelId,
            reasoningEffort: slot.reasoningEffort,
            replyToSlotId: triggeredBySlotId,
            approvalStatus: 'pending',
          },
        });
        this.broadcast({ type: 'post.created', boardId: board.id, payload: gatePost });

        const doneLead = updateAgentSlot(board.id, slot.slotId, {
          state: 'waiting',
          currentActivity: '待命',
          addInputTokens: 3100,
          addOutputTokens: 1100,
          addCachedTokens: 2400,
          incrementTurn: true,
        })!;
        this.broadcast({ type: 'agent.updated', boardId: board.id, payload: doneLead });
        this.broadcast({ type: 'board.updated', boardId: board.id, payload: getBoard(board.id)! });
        return;
      }

      markWorking('拆解任务中...');
      await sleep(650);

      const autoRolesPool = [
        { title: '核心模块实现', brief: '根据主管拆解完成关键逻辑开发与自测。' },
        { title: '质量审查与验收', brief: '核对边界条件、构建健康与功能体验闭环。' },
        { title: '界面交互与文档', brief: '优化呈现细节并整理交付说明文档。' },
      ];
      const staffingTable: NonNullable<DeliverableMeta['staffingTable']> = [];
      const updatedNonLeaders: AgentSlot[] = nonLeaders.map((w, idx) => {
        if (!w.roleAutoAssigned) {
          staffingTable.push({
            slotId: w.slotId,
            name: w.displayName,
            role: w.roleTitle,
            engine: w.engine,
            modelId: w.modelId,
          });
          return w;
        }
        const cue =
          w.engine === 'codex' && idx > 0
            ? autoRolesPool[1]
            : autoRolesPool[idx % autoRolesPool.length];
        const upd = updateAgentSlot(board.id, w.slotId, {
          roleTitle: cue.title,
          roleBrief: cue.brief,
          roleAutoAssigned: false,
        });
        if (upd) {
          this.broadcast({ type: 'agent.updated', boardId: board.id, payload: upd });
          staffingTable.push({
            slotId: upd.slotId,
            name: upd.displayName,
            role: upd.roleTitle,
            engine: upd.engine,
            modelId: upd.modelId,
          });
          return upd;
        }
        return w;
      });

      const w1 = updatedNonLeaders[0];
      const w2 = updatedNonLeaders[1];
      const createdTasks: BoardTask[] = [];

      if (w1) {
        const t1 = upsertTask({
          boardId: board.id,
          title: `处理「${topic.slice(0, 16)}」核心逻辑`,
          assigneeSlotId: w1.slotId,
          status: 'in_progress',
        });
        createdTasks.push(t1);
        this.broadcast({ type: 'task.upserted', boardId: board.id, payload: t1 });
      }

      if (w2 && createdTasks[0]) {
        const t2 = upsertTask({
          boardId: board.id,
          title: '完善界面与联动校验',
          assigneeSlotId: w2.slotId,
          blockedBy: [createdTasks[0].id],
          status: 'pending',
        });
        createdTasks.push(t2);
        this.broadcast({ type: 'task.upserted', boardId: board.id, payload: t2 });
      }

      const dispatchMentions = w1 ? [w1.slotId] : [];
      const briefPost = insertPost({
        boardId: board.id,
        authorType: 'agent',
        authorSlotId: slot.slotId,
        authorName: slot.displayName,
        authorEngine: slot.engine,
        kind: 'dispatch_brief',
        content:
          `收到，我已完成成员分工并按步骤推进：\n` +
          (w1 ? `1. 先由 @${w1.slotId}（${w1.displayName} · ${w1.roleTitle}）完成核心逻辑；\n` : '') +
          (w2 ? `2. 随后由 @${w2.slotId}（${w2.displayName} · ${w2.roleTitle}）跟进界面与检查。` : ''),
        mentions: dispatchMentions,
        meta: {
          modelId: slot.modelId,
          reasoningEffort: slot.reasoningEffort,
          replyToSlotId: triggeredBySlotId,
          staffingTable: staffingTable.length > 0 ? staffingTable : undefined,
        },
      });
      this.broadcast({ type: 'post.created', boardId: board.id, payload: briefPost });

      const idleLead = updateAgentSlot(board.id, slot.slotId, {
        state: 'waiting',
        currentActivity: '待命',
        nativeSessionId: slot.nativeSessionId || `${slot.engine}-lead-${board.id.slice(-4)}`,
        addInputTokens: 4100,
        addOutputTokens: 1300,
        addCachedTokens: 3000,
        incrementTurn: true,
      })!;
      this.broadcast({ type: 'agent.updated', boardId: board.id, payload: idleLead });
      this.broadcast({ type: 'board.updated', boardId: board.id, payload: getBoard(board.id)! });

      if (w1) {
        this.enqueueWakeup(board.id, w1.slotId, `主管指派任务：${createdTasks[0]?.title}`, slot.slotId);
      }
      return;
    }

    markWorking('编写改动中...');
    await sleep(800);

    const tasks = getBoardTasks(board.id);
    const myTask = tasks.find((t) => t.assigneeSlotId === slot.slotId && t.status !== 'completed');
    const leaderId = leader?.slotId || 'lead';

    const delivPost = insertPost({
      boardId: board.id,
      authorType: 'agent',
      authorSlotId: slot.slotId,
      authorName: slot.displayName,
      authorEngine: slot.engine,
      kind: 'deliverable',
      content: `已完成「${topic.slice(0, 24)}」相关修改并自测通过，请 @${leaderId} 确认。`,
      mentions: [leaderId],
      meta: {
        modelId: slot.modelId,
        reasoningEffort: slot.reasoningEffort,
        replyToSlotId: triggeredBySlotId,
        taskId: myTask?.id,
        filesChanged: [`src/${slot.slotId}/index.ts`],
      },
    });
    this.broadcast({ type: 'post.created', boardId: board.id, payload: delivPost });

    if (myTask) {
      const completedTask = upsertTask({
        ...myTask,
        status: 'completed',
        deliverablePostId: delivPost.id,
      });
      this.broadcast({ type: 'task.upserted', boardId: board.id, payload: completedTask });

      const allTasksNow = getBoardTasks(board.id);
      const unlocked = allTasksNow.filter(
        (t) =>
          t.status === 'pending' &&
          t.blockedBy.includes(myTask.id) &&
          t.blockedBy.every((depId) => allTasksNow.find((x) => x.id === depId)?.status === 'completed')
      );

      const doneWorker = updateAgentSlot(board.id, slot.slotId, {
        state: 'waiting',
        currentActivity: '待命',
        addInputTokens: 5100,
        addOutputTokens: 1700,
        addCachedTokens: 3800,
        incrementTurn: true,
      })!;
      this.broadcast({ type: 'agent.updated', boardId: board.id, payload: doneWorker });
      this.broadcast({ type: 'board.updated', boardId: board.id, payload: getBoard(board.id)! });

      if (unlocked.length > 0) {
        for (const nextTask of unlocked) {
          const startedNext = upsertTask({ ...nextTask, status: 'in_progress' });
          this.broadcast({ type: 'task.upserted', boardId: board.id, payload: startedNext });
          this.enqueueWakeup(
            board.id,
            nextTask.assigneeSlotId,
            `上游任务已完成，请继续执行：${nextTask.title}`,
            slot.slotId
          );
        }
        return;
      }
    } else {
      const doneWorker = updateAgentSlot(board.id, slot.slotId, {
        state: 'waiting',
        currentActivity: '待命',
        addInputTokens: 4800,
        addOutputTokens: 1600,
        addCachedTokens: 3400,
        incrementTurn: true,
      })!;
      this.broadcast({ type: 'agent.updated', boardId: board.id, payload: doneWorker });
      this.broadcast({ type: 'board.updated', boardId: board.id, payload: getBoard(board.id)! });
    }

    if (board.leaderMode !== 'mcp_host') {
      this.enqueueWakeup(board.id, leaderId, `${slot.displayName} 汇报了成果。`, slot.slotId);
    }
  }

  public triggerCliLeaderFallbackOnce(
    boardId: string,
    customReason?: string
  ): { ok: boolean; leaderSlotId: string } {
    const board = getBoard(boardId);
    if (!board) throw new Error('看板不存在');
    const roster = getBoardAgents(boardId);
    const leader = getLeaderSlot(roster);
    if (!leader) throw new Error('未找到看板主管成员');

    const unreadHumans = getBoardPosts(boardId, board.hostLastReadSeqId).filter(
      (p) =>
        p.authorType === 'human' &&
        (p.mentions.length === 0 || p.mentions.includes(leader.slotId))
    );
    for (const hp of unreadHumans) {
      const upd = updatePostMeta(hp.id, { hostDelivery: 'cli_fallback' });
      if (upd) this.broadcast({ type: 'post.created', boardId, payload: upd });
    }

    const latestHuman =
      unreadHumans[unreadHumans.length - 1] ||
      [...getBoardPosts(boardId)].reverse().find((p) => p.authorType === 'human');
    const maxSeqId = getBoardMaxSeqId(boardId);
    confirmHostInboxDelivery({ boardId, stage: 'acked', upToSeqId: maxSeqId });
    const updatedBoard = updateBoardConfig(boardId, {
      hostLastReadSeqId: maxSeqId,
      hostHookPendingSeqId: 0,
      hopCountSinceHuman: 0,
    });
    if (updatedBoard) {
      this.broadcast({ type: 'board.updated', boardId, payload: updatedBoard });
    }

    const wakeReason =
      customReason?.trim() ||
      (latestHuman
        ? `桌面端主管当前闲置，用户请求由你先行代答以下留言：${latestHuman.content}`
        : '桌面端主管当前闲置，请结合当前看板进展先行汇总并回复用户。');

    this.enqueueWakeup(boardId, leader.slotId, wakeReason, 'human', {
      allowMcpHostCliLeader: true,
    });

    return { ok: true, leaderSlotId: leader.slotId };
  }

  public dispatchMcpWave(params: {
    boardId: string;
    message: string;
    title?: string;
    targetSlots?: string[];
    roles?: DispatchRoleDirective[];
    tasks?: Array<DispatchTaskDirective & { id?: string; blockedBy?: string[] }>;
    hostClient?: string;
    hostSessionRef?: string;
    idempotencyKey?: string;
    waveId?: string;
  }): {
    post: BoardPost;
    queuedSlots: string[];
    sinceSeqId: number;
    waveId: string;
    deduplicated: boolean;
  } {
    const board = getBoard(params.boardId);
    if (!board) throw new Error('看板不存在');

    const roster = getBoardAgents(board.id);
    const leader = getLeaderSlot(roster) || roster[0];
    if (!leader) throw new Error('看板成员为空');

    // Idempotency / Reconnect Deduplication Check (P2-06)
    const explicitKey = params.idempotencyKey?.trim() || '';
    const dispatchFingerprint = crypto
      .createHash('sha1')
      .update(
        JSON.stringify({
          msg: params.message.trim(),
          targets: [...(params.targetSlots || [])].sort(),
          tasks: (params.tasks || []).map((t) => ({
            title: String(t.title || '').trim(),
            assignee: t.assigneeSlotId,
          })),
        }),
        'utf8'
      )
      .digest('hex')
      .slice(0, 16);
    const dispatchKey = explicitKey ? `key:${explicitKey}` : `fp:${dispatchFingerprint}`;

    const requestedWave = params.waveId ? getMcpWave(params.waveId) : null;
    const reusableWave =
      (requestedWave && requestedWave.boardId === board.id ? requestedWave : null) ||
      findReusableMcpWave(board.id, dispatchKey, Boolean(explicitKey));

    if (reusableWave) {
      const existingPost = getPostById(reusableWave.dispatchPostId);
      if (existingPost) {
        return {
          post: existingPost,
          queuedSlots: reusableWave.targetSlots,
          sinceSeqId: reusableWave.cursorSeqId,
          waveId: reusableWave.waveId,
          deduplicated: true,
        };
      }
    }

    // Acknowledge any Hook-injected deliveries that the host is now acting upon
    if (board.hostHookPendingSeqId > board.hostLastReadSeqId) {
      const ackRes = confirmHostInboxDelivery({
        boardId: board.id,
        stage: 'acked',
        upToSeqId: board.hostHookPendingSeqId,
      });
      for (const p of ackRes.updatedPosts) {
        this.broadcast({ type: 'post.created', boardId: board.id, payload: p });
      }
    }

    const freshBoardBeforePost = getBoard(board.id)!;
    const hadUnpulledUnread = getUnreadHostPosts(board.id).length > 0;

    const updatedBoard = updateBoardConfig(board.id, {
      leaderMode: 'mcp_host',
      hopCountSinceHuman: 0,
      hostClient: params.hostClient?.trim() || freshBoardBeforePost.hostClient,
      hostSessionRef:
        params.hostSessionRef !== undefined
          ? params.hostSessionRef
          : freshBoardBeforePost.hostSessionRef,
      goal: !freshBoardBeforePost.goal ? params.message.slice(0, 80) : freshBoardBeforePost.goal,
    })!;
    this.broadcast({ type: 'board.updated', boardId: board.id, payload: updatedBoard });

    const staffingTable: NonNullable<DeliverableMeta['staffingTable']> = [];
    if (Array.isArray(params.roles)) {
      for (const roleSpec of params.roles) {
        const targetSlot = roster.find(
          (r) =>
            !r.isLeader &&
            r.slotId.toLowerCase() === String(roleSpec.slotId || '').toLowerCase()
        );
        if (!targetSlot) continue;
        const updatedSlot = updateAgentSlot(board.id, targetSlot.slotId, {
          displayName: roleSpec.displayName?.trim() || undefined,
          roleTitle: roleSpec.roleTitle?.trim() || undefined,
          roleBrief: roleSpec.roleBrief?.trim() || roleSpec.roleTitle?.trim() || undefined,
          roleAutoAssigned: false,
        });
        if (updatedSlot) {
          this.broadcast({ type: 'agent.updated', boardId: board.id, payload: updatedSlot });
          staffingTable.push({
            slotId: updatedSlot.slotId,
            name: updatedSlot.displayName,
            role: updatedSlot.roleTitle,
            engine: updatedSlot.engine,
            modelId: updatedSlot.modelId,
          });
        }
      }
    }

    const freshRoster = getBoardAgents(board.id);
    const validSlotSet = new Set(freshRoster.map((r) => r.slotId));
    const newlyAssignedWakeups = new Set<string>();

    if (Array.isArray(params.tasks) && params.tasks.length > 0) {
      const titleToId = new Map<string, string>();
      for (const existingTask of getBoardTasks(board.id)) {
        titleToId.set(existingTask.title.trim().toLowerCase(), existingTask.id);
      }

      const createdTaskPairs: Array<{
        task: BoardTask;
        spec: DispatchTaskDirective & { id?: string; blockedBy?: string[] };
      }> = [];

      for (const spec of params.tasks) {
        const taskTitle = String(spec.title || '').trim();
        if (!taskTitle) continue;
        const assignee = validSlotSet.has(spec.assigneeSlotId)
          ? spec.assigneeSlotId
          : freshRoster.find((r) => !r.isLeader)?.slotId || leader.slotId;

        const hasPendingDeps = Boolean(spec.blockedByTitles?.length || spec.blockedBy?.length);
        const saved = upsertTask({
          id: spec.id,
          boardId: board.id,
          title: taskTitle,
          description: spec.description || '',
          assigneeSlotId: assignee,
          status: hasPendingDeps ? 'pending' : spec.status || 'in_progress',
          blockedBy: spec.blockedBy || [],
        });
        titleToId.set(taskTitle.toLowerCase(), saved.id);
        createdTaskPairs.push({ task: saved, spec });
      }

      const tasksNowSnapshot = getBoardTasks(board.id);
      for (const { task, spec } of createdTaskPairs) {
        const depIdsFromTitles = (spec.blockedByTitles || [])
          .map((bt) => titleToId.get(String(bt || '').trim().toLowerCase()))
          .filter((id): id is string => Boolean(id && id !== task.id));
        const depIds = Array.from(new Set([...(spec.blockedBy || []), ...depIdsFromTitles])).filter(
          (id) => id !== task.id
        );

        const allDepsDone =
          depIds.length === 0 ||
          depIds.every((id) => tasksNowSnapshot.find((t) => t.id === id)?.status === 'completed');

        const finalStatus: TaskStatus =
          depIds.length > 0 && !allDepsDone
            ? 'pending'
            : spec.status === 'completed' || spec.status === 'review'
              ? spec.status
              : 'in_progress';

        const finalTask =
          depIds.length > 0 || finalStatus !== task.status
            ? upsertTask({ ...task, blockedBy: depIds, status: finalStatus })
            : task;

        this.broadcast({ type: 'task.upserted', boardId: board.id, payload: finalTask });
        if (finalTask.status === 'in_progress' && finalTask.assigneeSlotId !== leader.slotId) {
          newlyAssignedWakeups.add(finalTask.assigneeSlotId);
        }
      }
    }

    const validSlots = freshRoster.map((r) => r.slotId);
    const mentionsInMsg = extractMentions(params.message, validSlots, leader.slotId);
    const explicitNonLeaderTargets = (params.targetSlots || []).filter(
      (s) => validSlotSet.has(s) && s !== leader.slotId
    );
    const tasksAfterDispatch = getBoardTasks(board.id);

    const candidateTargets = Array.from(
      new Set([...explicitNonLeaderTargets, ...mentionsInMsg, ...newlyAssignedWakeups])
    ).filter((s) => s !== leader.slotId && !isSlotExclusivelyBlocked(s, tasksAfterDispatch));

    const post = insertPost({
      boardId: board.id,
      authorType: 'agent',
      authorSlotId: leader.slotId,
      authorName: leader.displayName,
      authorEngine: leader.engine,
      kind: 'dispatch_brief',
      title: params.title?.trim() || '桌面端主管派工',
      content: params.message.trim(),
      mentions: candidateTargets,
      meta: {
        modelId: leader.modelId,
        reasoningEffort: leader.reasoningEffort,
        staffingTable: staffingTable.length > 0 ? staffingTable : undefined,
      },
    });

    const wave = createMcpWave({
      boardId: board.id,
      dispatchKey,
      dispatchPostId: post.id,
      startSeqId: post.seqId,
      targetSlots: candidateTargets,
    });
    const postWithWave = updatePostMeta(post.id, { waveId: wave.waveId }) || post;
    this.broadcast({ type: 'post.created', boardId: board.id, payload: postWithWave });

    // Do NOT advance hostLastReadSeqId past unpulled human messages if any existed before dispatch
    const boardAfterWave = !hadUnpulledUnread
      ? updateBoardConfig(board.id, { hostLastReadSeqId: postWithWave.seqId })
      : getBoard(board.id);
    if (boardAfterWave) {
      this.broadcast({ type: 'board.updated', boardId: board.id, payload: boardAfterWave });
    }

    for (const targetSlotId of candidateTargets) {
      this.enqueueWakeup(
        board.id,
        targetSlotId,
        `桌面端主管（${leader.displayName}）派发本波次任务：\n${params.message.trim()}`,
        leader.slotId
      );
    }

    return {
      post: postWithWave,
      queuedSlots: candidateTargets,
      sinceSeqId: hadUnpulledUnread ? updatedBoard.hostLastReadSeqId : postWithWave.seqId,
      waveId: wave.waveId,
      deduplicated: false,
    };
  }

  public resolveWaitContext(
    boardId: string,
    query: {
      waveId?: string;
      sinceSeqId?: number;
      waitForNewActivity?: boolean;
    }
  ): {
    waveId: string | null;
    sinceSeqId: number;
    waitForNewActivity: boolean;
  } {
    const board = getBoard(boardId);
    if (!board) throw new Error('看板不存在');

    const explicitWave = query.waveId ? getMcpWave(query.waveId) : null;
    const latestWave = getLatestBoardMcpWave(boardId);
    const targetWave =
      explicitWave && explicitWave.boardId === boardId
        ? explicitWave
        : latestWave && latestWave.status === 'running'
          ? latestWave
          : null;

    let sinceSeqId: number;
    if (query.sinceSeqId !== undefined && Number.isFinite(query.sinceSeqId)) {
      sinceSeqId = query.sinceSeqId;
    } else if (explicitWave && explicitWave.boardId === boardId) {
      sinceSeqId =
        explicitWave.status === 'running' ? explicitWave.cursorSeqId : explicitWave.startSeqId;
    } else if (targetWave) {
      sinceSeqId = Math.min(
        board.hostLastReadSeqId > 0 ? board.hostLastReadSeqId : targetWave.cursorSeqId,
        targetWave.cursorSeqId
      );
    } else {
      sinceSeqId = board.hostLastReadSeqId;
    }

    const busy = this.isBoardWaveBusy(boardId);
    const hasUnsettledWave = Boolean(targetWave && targetWave.status === 'running');
    const waitForNewActivity =
      query.waitForNewActivity !== undefined
        ? query.waitForNewActivity
        : !busy && !hasUnsettledWave && !(explicitWave && explicitWave.boardId === boardId);

    return {
      waveId: targetWave?.waveId || explicitWave?.waveId || null,
      sinceSeqId,
      waitForNewActivity,
    };
  }

  public commitWaveSettlement(
    boardId: string,
    settlement: WaveSettlementResult
  ): void {
    if (settlement.latestSeqId > 0) {
      const ackRes = confirmHostInboxDelivery({
        boardId,
        stage: 'acked',
        upToSeqId: settlement.latestSeqId,
        viaWait: true,
      });
      for (const p of ackRes.updatedPosts) {
        this.broadcast({ type: 'post.created', boardId, payload: p });
      }
    } else {
      recomputeBoardHookPendingSeq(boardId);
    }

    if (settlement.waveId) {
      const nextStatus =
        settlement.stillWorkingSlots.length > 0
          ? 'running'
          : settlement.reason === 'worker_failed'
            ? 'failed'
            : settlement.reason === 'wave_completed'
              ? 'completed'
              : 'running';
      updateMcpWaveProgress(settlement.waveId, {
        cursorSeqId: settlement.latestSeqId,
        status: nextStatus,
        lastReason: settlement.reason,
      });
    } else {
      updateBoardConfig(boardId, {
        hostLastSettlementReason: settlement.reason,
        activeWaveId: settlement.stillWorkingSlots.length > 0 ? getBoard(boardId)?.activeWaveId ?? null : null,
      });
    }

    const freshBoard = getBoard(boardId);
    if (freshBoard) {
      this.broadcast({ type: 'board.updated', boardId, payload: freshBoard });
    }
  }

  private buildSettlementResult(
    boardId: string,
    sinceSeqId: number,
    reason: WaveSettlementResult['reason'],
    waveId: string | null,
    standbyNote?: string
  ): WaveSettlementResult {
    const newPosts = getBoardPosts(boardId, sinceSeqId);
    const latestSeqId =
      newPosts.length > 0
        ? newPosts[newPosts.length - 1].seqId
        : Math.max(sinceSeqId, getBoardMaxSeqId(boardId));

    const humanInterjections = newPosts
      .filter((p) => p.authorType === 'human')
      .map((p) => ({
        id: p.id,
        seqId: p.seqId,
        content: p.content,
        mentions: p.mentions,
        createdAt: p.createdAt,
      }));
    const requestedStandbyStop = humanInterjections.some((m) =>
      /^(?:@[^\s]+\s*)?(?:结束监听|停止监听|关闭监听)[!！。.\s]*$/i.test(m.content.trim())
    );
    const stopAutoStandby = reason === 'standby_released' || requestedStandbyStop;

    const referencedSnapIds = new Set(
      newPosts.map((p) => p.meta.snapshotId).filter((x): x is string => Boolean(x))
    );
    const minCreatedAt = newPosts.length > 0 ? newPosts[0].createdAt - 500 : Date.now();
    const relevantSnapshots = listBoardSnapshots(boardId).filter(
      (s) => referencedSnapIds.has(s.id) || (newPosts.length > 0 && s.createdAt >= minCreatedAt)
    );

    const added = new Set<string>();
    const modified = new Set<string>();
    const deleted = new Set<string>();
    for (const s of relevantSnapshots) {
      for (const ch of s.filesChanged) {
        if (ch.status === 'added') added.add(ch.path);
        else if (ch.status === 'modified') modified.add(ch.path);
        else if (ch.status === 'deleted') deleted.add(ch.path);
      }
    }

    const tasks = getBoardTasks(boardId);
    const roster = getBoardAgents(boardId);
    const stillWorkingSet = new Set<string>();
    const activeSlot = this.activeWorkerSlots.get(boardId);
    if (activeSlot) stillWorkingSet.add(activeSlot);
    for (const q of this.pendingQueues.get(boardId) ?? []) {
      stillWorkingSet.add(q.slotId);
    }
    const stillWorkingSlots = Array.from(stillWorkingSet);

    const resolvedWaveId = waveId || getBoard(boardId)?.activeWaveId || null;
    const waveStatus: WaveSettlementResult['waveStatus'] =
      stillWorkingSlots.length > 0
        ? 'running'
        : reason === 'worker_failed'
          ? 'failed'
          : resolvedWaveId
            ? 'completed'
            : 'idle';

    let recoveryAction: WaveSettlementResult['recoveryAction'] | undefined;
    if (stillWorkingSlots.length > 0 && (reason === 'human_interjection' || reason === 'timeout')) {
      recoveryAction = {
        tool: 'cowork_wait_board',
        arguments: {
          boardId,
          ...(resolvedWaveId ? { waveId: resolvedWaveId } : {}),
          sinceSeqId: latestSeqId,
        },
        hint:
          reason === 'human_interjection'
            ? '已收到用户实时插话，后台队员仍在继续运行。处理后请调用 cowork_wait_board 无缝续等本波次，无需重复派发原任务。'
            : '单次等待窗口已到期，后台队员仍在执行。默认恢复操作：调用 cowork_wait_board 查看并续等原波次，切勿重复派工。',
      };
    }

    return {
      boardId,
      waveId: resolvedWaveId,
      waveStatus,
      reason,
      ...(standbyNote ? { message: standbyNote } : {}),
      ...(stopAutoStandby ? { stopAutoStandby: true } : {}),
      latestSeqId,
      resumeCursorSeqId: latestSeqId,
      stillWorkingSlots,
      ...(recoveryAction ? { recoveryAction } : {}),
      posts: newPosts.map((p) => ({
        id: p.id,
        seqId: p.seqId,
        authorType: p.authorType,
        authorSlotId: p.authorSlotId,
        authorName: p.authorName,
        kind: p.kind,
        title: p.title,
        content: p.content,
        mentions: p.mentions,
        snapshotId: p.meta.snapshotId,
        filesChanged: p.meta.filesChanged,
        createdAt: p.createdAt,
      })),
      humanInterjections,
      evidence: {
        snapshots: relevantSnapshots.map((s) => ({
          id: s.id,
          label: s.label,
          authorName: s.authorName,
          kind: s.kind,
          status: s.status,
          fileCount: s.fileCount,
          filesChanged: s.filesChanged,
        })),
        fileChangesSummary: {
          added: Array.from(added),
          modified: Array.from(modified),
          deleted: Array.from(deleted),
        },
        tasksSummary: {
          total: tasks.length,
          completed: tasks.filter((t) => t.status === 'completed').length,
          inProgress: tasks.filter((t) => t.status === 'in_progress').length,
          pending: tasks.filter((t) => t.status === 'pending').length,
          items: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            assigneeSlotId: t.assigneeSlotId,
          })),
        },
        agentMetrics: roster.map((a) => ({
          slotId: a.slotId,
          displayName: a.displayName,
          engine: a.engine,
          modelId: a.modelId,
          state: a.state,
          turnCount: a.turnCount,
          totalTokens: a.inputTokens + a.outputTokens,
        })),
      },
    };
  }

  public async waitForWaveSettlement(
    boardId: string,
    options: {
      sinceSeqId: number;
      timeoutMs: number;
      signal?: AbortSignal;
      waitForNewActivity?: boolean;
      waveId?: string | null;
      autoCommit?: boolean;
    }
  ): Promise<WaveSettlementResult> {
    const board = getBoard(boardId);
    if (!board) throw new Error('看板不存在');

    const roster = getBoardAgents(boardId);
    const leaderSlotId = getLeaderSlot(roster)?.slotId || 'lead';
    const safeTimeout = Math.max(500, Math.min(options.timeoutMs || 3_000_000, 3_540_000));
    const waveId = options.waveId ?? board.activeWaveId ?? null;

    const prevCount = this.activeHostWaiters.get(boardId) ?? 0;
    this.activeHostWaiters.set(boardId, prevCount + 1);
    if (prevCount === 0) {
      const waitingBoard = updateBoardConfig(boardId, { hostWaiting: true });
      if (waitingBoard) {
        this.broadcast({ type: 'board.updated', boardId, payload: waitingBoard });
      }
    }

    const evaluateSettlementReason = (): WaveSettlementResult['reason'] | null => {
      const newPosts = getBoardPosts(boardId, options.sinceSeqId);
      const hasHumanInterjection = newPosts.some(
        (p) =>
          p.authorType === 'human' &&
          p.meta.hostDelivery !== 'cli_fallback' &&
          (p.mentions.length === 0 || p.mentions.includes(leaderSlotId))
      );
      if (hasHumanInterjection) return 'human_interjection';

      const hasApprovalGate = newPosts.some(
        (p) => p.kind === 'approval_gate' && p.meta.approvalStatus === 'pending'
      );
      if (hasApprovalGate) return 'approval_needed';

      if (!this.isBoardWaveBusy(boardId)) {
        if (!options.waitForNewActivity || newPosts.length > 0) {
          const hasFailure = newPosts.some(
            (p) => p.authorType === 'agent' && p.content.startsWith('调用出错：')
          );
          return hasFailure ? 'worker_failed' : 'wave_completed';
        }
      }
      return null;
    };

    let aborted = false;
    try {
      const immediateReason = evaluateSettlementReason();
      if (immediateReason) {
        const res = this.buildSettlementResult(boardId, options.sinceSeqId, immediateReason, waveId);
        if (options.autoCommit !== false && !options.signal?.aborted) {
          this.commitWaveSettlement(boardId, res);
        }
        return res;
      }

      if (options.signal?.aborted) {
        aborted = true;
        throw new Error('Wait aborted');
      }

      const settledResult = await new Promise<WaveSettlementResult>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          this.boardEvents.off(`board:${boardId}`, onEvent);
          options.signal?.removeEventListener('abort', onAbort);
          if (timer) clearTimeout(timer);
        };

        const finish = (reason: WaveSettlementResult['reason'], note?: string) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(this.buildSettlementResult(boardId, options.sinceSeqId, reason, waveId, note));
        };

        const onAbort = () => {
          if (settled) return;
          settled = true;
          aborted = true;
          cleanup();
          reject(new Error('Wait aborted'));
        };

        const onEvent = (ev?: { type?: string; note?: string }) => {
          if (ev?.type === 'standby.release' && !this.isBoardWaveBusy(boardId)) {
            finish('standby_released', ev.note);
            return;
          }
          const reason = evaluateSettlementReason();
          if (reason) finish(reason);
        };

        timer = setTimeout(() => {
          finish('timeout');
        }, safeTimeout);

        this.boardEvents.on(`board:${boardId}`, onEvent);
        options.signal?.addEventListener('abort', onAbort, { once: true });

        // Re-check once after listener registration to eliminate any microtask gap
        const postAttachReason = evaluateSettlementReason();
        if (postAttachReason) {
          finish(postAttachReason);
        }
      });

      if (options.autoCommit !== false && !options.signal?.aborted) {
        this.commitWaveSettlement(boardId, settledResult);
      }
      return settledResult;
    } finally {
      const curCount = this.activeHostWaiters.get(boardId) ?? 1;
      const nextCount = Math.max(0, curCount - 1);
      if (nextCount === 0) {
        this.activeHostWaiters.delete(boardId);
        const idleBoard = updateBoardConfig(boardId, {
          hostWaiting: false,
          ...(aborted && this.isBoardWaveBusy(boardId)
            ? { hostLastSettlementReason: 'aborted' }
            : {}),
        });
        if (idleBoard) {
          this.broadcast({ type: 'board.updated', boardId, payload: idleBoard });
        }
      } else {
        this.activeHostWaiters.set(boardId, nextCount);
      }
    }
  }
}
