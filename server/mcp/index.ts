import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { registerPanelApp } from './appPanel.js';
import {
  getBoardApiBaseUrl,
  getBoardApiPort,
  resolveDefaultDataDir,
  resolveMcpRepoRoot,
} from './utils.js';

const REPO_ROOT = resolveMcpRepoRoot();
let serverBootPromise: Promise<void> | null = null;

async function isBoardServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${getBoardApiBaseUrl()}/api/health`, {
      signal: AbortSignal.timeout(1200),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureBoardServerRunning(): Promise<void> {
  if (await isBoardServerHealthy()) return;
  if (serverBootPromise) return serverBootPromise;

  serverBootPromise = (async () => {
    try {
      if (await isBoardServerHealthy()) return;

      const port = getBoardApiPort();
      const dataDir = resolveDefaultDataDir(REPO_ROOT);
      fs.mkdirSync(dataDir, { recursive: true });

      const outLogPath = path.join(dataDir, 'server.out.log');
      const errLogPath = path.join(dataDir, 'server.err.log');
      const outFd = fs.openSync(outLogPath, 'a');
      const errFd = fs.openSync(errLogPath, 'a');

      const distServerEntry = path.join(REPO_ROOT, 'dist-server', 'index.js');
      const tsxCli = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const args = fs.existsSync(distServerEntry)
        ? [distServerEntry]
        : [tsxCli, path.join(REPO_ROOT, 'server', 'index.ts')];

      try {
        const child = spawn(process.execPath, args, {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: String(port),
            AGENT_COWORK_DATA_DIR: dataDir,
          },
          detached: true,
          windowsHide: true,
          stdio: ['ignore', outFd, errFd],
        });
        child.unref();
      } finally {
        fs.closeSync(outFd);
        fs.closeSync(errFd);
      }

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await isBoardServerHealthy()) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`AgentSwarm 后台服务在端口 ${port} 启动超时，请检查 ${errLogPath}`);
    } finally {
      serverBootPromise = null;
    }
  })();

  return serverBootPromise;
}

async function callBoardApi<T>(
  route: string,
  init?: RequestInit & { progressExtra?: { _meta?: { progressToken?: string | number }; sendNotification: (n: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; message?: string } }) => Promise<void>; signal?: AbortSignal } }
): Promise<T> {
  await ensureBoardServerRunning();
  const baseUrl = getBoardApiBaseUrl();
  const progressExtra = init?.progressExtra;
  const progressToken = progressExtra?._meta?.progressToken;

  let progressStep = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (progressToken !== undefined && progressExtra) {
    heartbeatTimer = setInterval(() => {
      progressStep += 1;
      void progressExtra
        .sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: progressStep,
            message: '正在等待协同看板波次执行结果...',
          },
        })
        .catch(() => {});
    }, 15_000);
  }

  try {
    const res = await fetch(`${baseUrl}${route}`, {
      ...init,
      signal: progressExtra?.signal ?? init?.signal,
    });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const errMsg =
        (parsed as { error?: string })?.error || `HTTP ${res.status}: ${text.slice(0, 300)}`;
      throw new Error(errMsg);
    }
    return parsed as T;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

const server = new McpServer(
  {
    name: 'agent-swarm-board',
    version: '1.4.0',
  },
  {
    instructions: [
      'AgentSwarm 多智能体协同看板协作规则：',
      '1. 当用户使用协同看板协作或调用任何 cowork_* 工具后，你即作为该看板团队的桌面端统筹主管。',
      '2. 每轮处理完成后，先调用 cowork_manage_board(action="send_board_message") 将本轮结论、分工安排或答复同步回看板。',
      '3. 若工具返回值包含 autoStandby.shouldStandby === true（即看板处于「自动待命监听」模式），在结束当前回合前请主动调用 cowork_wait_board(boardId, waitForNewActivity=true) 进入 0 Token 挂起监听；后续网页/手机端 @主管 的新指示会在 1 秒内以 human_interjections 返回给你。',
      '4. 仅当用户在留言中明确要求「结束监听 / 停止监听」，或工具返回 reason="standby_released" / stopAutoStandby=true / autoStandby.shouldStandby=false 时，才直接结束回合不再调用 cowork_wait_board。',
    ].join('\n'),
  }
);

server.registerPrompt(
  'cowork_standby_mode',
  {
    title: '开启 AgentSwarm 自动待命监听模式',
    description: '将当前桌面会话绑定为指定协同看板主管，并保持 0 Token 自动挂起监听网页/手机新指示。',
    argsSchema: {
      boardId: z.string().optional().describe('可选：目标看板 ID（留空则自动识别或绑定当前工作区看板）'),
    },
  },
  async ({ boardId }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: boardId?.trim()
            ? `请调用 cowork_wait_board(boardId="${boardId.trim()}", waitForNewActivity=true) 进入协同看板零消耗待命监听；每轮通过 cowork_manage_board(action="send_board_message") 回复后继续按 autoStandby 指引保持挂起监听，直到收到「结束监听」指令或用户关闭自动监听。`
            : '请先调用 cowork_overview / cowork_setup_board 绑定当前工作区协同看板，然后调用 cowork_wait_board(waitForNewActivity=true) 保持零消耗待命监听，并在每轮通过 cowork_manage_board 回复后按 autoStandby 指引继续自动挂起监听。',
        },
      },
    ],
  })
);

server.registerTool(
  'cowork_overview',
  {
    title: '查看团队引擎、额度与看板概况',
    description:
      '获取本机已安装的 20 款智能体引擎可用性、Antigravity/Codex 5h 与周剩余额度、全局分工偏好及现有协同看板列表。',
    inputSchema: {
      refreshQuota: z.boolean().optional().describe('是否强制刷新 Antigravity 实时额度（默认走缓存）'),
    },
  },
  async (args) => {
    const data = await callBoardApi<Record<string, unknown>>(
      `/api/mcp/overview${args?.refreshQuota ? '?refresh=1' : ''}`
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  'cowork_setup_board',
  {
    title: '创建或绑定协同看板团队',
    description:
      '为指定项目工作区自动复用或新建桌面端直驱协同看板（leaderMode=mcp_host），返回看板信息、未读留言与 autoStandby 自动挂起监听指引。',
    inputSchema: {
      workspacePath: z.string().describe('项目工作区绝对路径'),
      title: z.string().optional().describe('看板标题（可选）'),
      goal: z.string().optional().describe('本看板协作目标（可选）'),
      boardId: z.string().optional().describe('若已知看板 ID 可直接指定复用'),
      hostClient: z
        .string()
        .optional()
        .describe('当前桌面端名称，如 antigravity / codex / codebuddy / claude'),
      hostSessionRef: z.string().optional().describe('当前宿主对话 ID（可选，用于精准投递关联）'),
      reuseExisting: z.boolean().optional().describe('默认 true：同工作区优先复用既有桌面端协同看板'),
      forceTakeover: z
        .boolean()
        .optional()
        .describe('若同工作区看板已绑定其他会话，传 true 可显式接管（默认不抢占且绝不吞未读留言）'),
      members: z
        .array(
          z.object({
            slotId: z.string().optional(),
            displayName: z.string().optional(),
            roleTitle: z.string().optional(),
            roleBrief: z.string().optional(),
            isLeader: z.boolean().optional(),
            engine: z.string().optional(),
            modelId: z.string().optional(),
            reasoningEffort: z.string().optional(),
          })
        )
        .optional()
        .describe('可选：自定义团队队员清单；不传则自动配齐核心开发与审查测试队员'),
    },
  },
  async (args) => {
    const data = await callBoardApi<Record<string, unknown>>('/api/mcp/boards/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  'cowork_dispatch_wave',
  {
    title: '派发波次任务并零轮询等待结果',
    description:
      '向指定协同看板发布主管派工指令与任务清单（支持 blockedBy/blockedByTitles 依赖解锁），零轮询阻塞等待整波次完结或人工插话，返回 evidence 证据包与 autoStandby 监听状态。',
    inputSchema: {
      boardId: z.string().describe('目标看板 ID'),
      message: z.string().describe('给队员的波次任务指令（可用 @slot_id 点名）'),
      title: z.string().optional().describe('派工卡片标题（可选）'),
      targetSlots: z.array(z.string()).optional().describe('明确要唤醒的非主管队员 slotId 列表'),
      roles: z
        .array(
          z.object({
            slotId: z.string(),
            displayName: z.string().optional(),
            roleTitle: z.string().optional(),
            roleBrief: z.string().optional(),
          })
        )
        .optional()
        .describe('可选：顺带为队员定岗或更新职责'),
      tasks: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string(),
            description: z.string().optional(),
            assigneeSlotId: z.string(),
            status: z.enum(['pending', 'in_progress', 'review', 'completed']).optional(),
            blockedBy: z.array(z.string()).optional(),
            blockedByTitles: z.array(z.string()).optional(),
          })
        )
        .optional()
        .describe('可选：结构化子任务与依赖关系'),
      hostClient: z.string().optional(),
      hostSessionRef: z.string().optional(),
      idempotencyKey: z
        .string()
        .optional()
        .describe('可选幂等凭据：重连或超时重试时传入相同 key 可确保原波次只执行一次并直接续等'),
      waveId: z
        .string()
        .optional()
        .describe('可选：指定已有 waveId 直接重连查询/续等该波次而不会重复派发'),
      wait: z.boolean().optional().describe('默认 true：服务端挂起等待波次收敛；false 则立即返回'),
      timeoutMs: z
        .number()
        .int()
        .min(500)
        .max(3_540_000)
        .optional()
        .describe('最长等待毫秒数（默认 3000000，约 50 分钟）'),
    },
  },
  async (args, extra) => {
    const data = await callBoardApi<Record<string, unknown>>(
      `/api/mcp/boards/${encodeURIComponent(args.boardId)}/dispatch-wave`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        progressExtra: extra,
      }
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  'cowork_wait_board',
  {
    title: '阻塞等待看板波次完成或用户插话',
    description:
      '零轮询、0 Token 消耗地挂起等待波次完成或在空闲时持续监听用户在网页/手机看板的新指示（human_interjections）；若返回 autoStandby.shouldStandby=true，请在回应后继续调用本工具保持待命监听。',
    inputSchema: {
      boardId: z.string().describe('目标看板 ID'),
      waveId: z
        .string()
        .optional()
        .describe('可选：要续等或查询的波次 ID（由 cowork_dispatch_wave 返回）'),
      sinceSeqId: z.number().int().optional().describe('从哪条帖子序号之后开始监听（默认沿用波次/已读位点）'),
      timeoutMs: z
        .number()
        .int()
        .min(500)
        .max(3_540_000)
        .optional()
        .describe('最长等待毫秒数（默认 3000000）'),
      waitForNewActivity: z
        .boolean()
        .optional()
        .describe('空闲时是否持续阻塞直到出现新留言/动态（默认若无进行中波次则为 true）'),
    },
  },
  async (args, extra) => {
    const qs = new URLSearchParams();
    if (args.waveId) qs.set('waveId', args.waveId);
    if (args.sinceSeqId !== undefined) qs.set('sinceSeqId', String(args.sinceSeqId));
    if (args.timeoutMs !== undefined) qs.set('timeoutMs', String(args.timeoutMs));
    if (args.waitForNewActivity !== undefined) {
      qs.set('waitForNewActivity', args.waitForNewActivity ? '1' : '0');
    }
    const qStr = qs.toString();
    const data = await callBoardApi<Record<string, unknown>>(
      `/api/mcp/boards/${encodeURIComponent(args.boardId)}/wait${qStr ? `?${qStr}` : ''}`,
      {
        method: 'GET',
        progressExtra: extra,
      }
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  'cowork_manage_board',
  {
    title: '管理看板成员、任务、发言与安全快照',
    description:
      '向看板增删改成员、更新任务、创建/采纳/撤回文件快照或回写主管回复（send_board_message）；回写后若响应含 autoStandby.shouldStandby=true，请继续调用 cowork_wait_board 保持待命监听。',
    inputSchema: {
      boardId: z.string().describe('目标看板 ID'),
      action: z.enum([
        'add_agent',
        'update_agent',
        'remove_agent',
        'upsert_task',
        'checkpoint',
        'adopt_snapshot',
        'revert_snapshot',
        'send_board_message',
        'ack_inbox',
        'cli_leader_fallback',
      ]),
      slotId: z.string().optional(),
      displayName: z.string().optional(),
      roleTitle: z.string().optional(),
      roleBrief: z.string().optional(),
      roleAutoAssigned: z.boolean().optional(),
      isLeader: z.boolean().optional(),
      engine: z.string().optional(),
      modelId: z.string().optional(),
      reasoningEffort: z.string().optional(),
      taskId: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['pending', 'in_progress', 'review', 'completed']).optional(),
      assigneeSlotId: z.string().optional(),
      blockedBy: z.array(z.string()).optional(),
      label: z.string().optional(),
      snapshotId: z.string().optional(),
      mode: z.enum(['strict', 'skip_conflicts', 'overwrite_all']).optional(),
      content: z.string().optional(),
      kind: z.enum(['discussion', 'approval_gate']).optional(),
      reason: z.string().optional(),
      deliveryId: z.string().optional(),
      upToSeqId: z.number().int().optional(),
      ackUnread: z.boolean().optional(),
    },
  },
  async (args) => {
    const data = await callBoardApi<Record<string, unknown>>(
      `/api/mcp/boards/${encodeURIComponent(args.boardId)}/manage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      }
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }
);

registerPanelApp(server, ensureBoardServerRunning);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((err) => {
  console.error('[AgentCoWorkBoard MCP] fatal error:', err);
  process.exit(1);
});
