import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  FileText,
  Folder,
  FolderOpen,
  ExternalLink,
  ArrowUp,
  ChevronRight,
  Check,
  List,
  Users,
  Loader2,
  Paperclip,
  BookmarkPlus,
  Eye,
  RotateCcw,
  Sparkles,
  CheckSquare,
  History,
  X,
  AlertTriangle,
  PauseCircle,
  MessageSquarePlus,
} from 'lucide-react';
import type {
  AgentSlot,
  Board,
  BoardPost,
  BoardTask,
  EngineId,
  EngineStatusCard,
  ModelOption,
  ReasoningEffort,
  SnapshotConflictItem,
  WorkspaceSnapshot,
} from '../types';
import type { RevertClientOutcome } from './DiffCompareModal';
import {
  formatEffortLabel,
  formatModelLabel,
  formatRelativeTime,
  getEffortsForModel,
} from '../utils/format';
import { EngineIcon, UserAvatarIcon } from './BrandIcon';
import { MarkdownContent, type MentionableSlot } from './MarkdownContent';
import { FolderPickerModal } from './FolderPickerModal';
import { PairwiseDialogueModal } from './PairwiseDialogueModal';
import { apiFetch } from '../utils/api';

interface BoardDraftRecord {
  text: string;
  attachedFiles: string[];
  targetSlot: string;
  manualTarget: boolean;
  pendingClientMsgId: string;
}

const DRAFTS_STORAGE_KEY = 'cowork_board_drafts_v1';

function newClientMsgId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadDraftsFromSession(): Record<string, BoardDraftRecord> {
  try {
    const raw = sessionStorage.getItem(DRAFTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, BoardDraftRecord>) : {};
  } catch {
    return {};
  }
}

function saveDraftsToSession(map: Record<string, BoardDraftRecord>): void {
  try {
    sessionStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

function findFirstValidMention(text: string, validSlots: string[]): string | null {
  const re = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1].toLowerCase();
    if (validSlots.includes(candidate)) return candidate;
  }
  return null;
}

interface BoardStreamViewProps {
  board: Board;
  agents: AgentSlot[];
  posts: BoardPost[];
  tasks: BoardTask[];
  snapshots: WorkspaceSnapshot[];
  availableEngines?: EngineStatusCard[];
  allModels: ModelOption[];
  modelsByEngine: Record<string, ModelOption[]>;
  selectedTargetSlot: string;
  isLocalhost?: boolean;
  isSwitchingBoard?: boolean;
  onSelectTargetSlot: (slotId: string) => void;
  onSendMessage: (
    content: string,
    targetSlotId: string,
    options?: { targetExplicitlyChosen?: boolean; clientMessageId?: string }
  ) => Promise<void>;
  onApprovePost: (
    postId: string,
    decision: 'approved' | 'changes_requested' | 'stopped',
    feedback?: string
  ) => Promise<void>;
  onUpdateBoard: (
    patch: Partial<
      Pick<
        Board,
        'executionMode' | 'sessionSyncMode' | 'hostCliFallback' | 'hostAutoStandby' | 'workspacePath'
      >
    >
  ) => Promise<void>;
  onTriggerCliLeaderReply?: () => Promise<void>;
  onUpdateTargetEffort: (slotId: string, effort: ReasoningEffort) => void;
  onOpenMobileTasks: () => void;
  onOpenMobileRightSheet: (tab: 'roster' | 'snapshots') => void;
  onOpenSnapshotDiff: (snapshotId: string, conflicts?: SnapshotConflictItem[]) => void;
  onAdoptSnapshot: (snapshotId: string) => Promise<void>;
  onRevertSnapshot: (
    snapshotId: string,
    mode?: 'strict' | 'skip_conflicts' | 'overwrite_all'
  ) => Promise<RevertClientOutcome | void>;
  onCreateCheckpoint: () => Promise<void>;
  onPreviewFile: (relPath: string) => void;
  onOpenNewBoardModal?: () => void;
  onOpenDesktopMcpModal?: () => void;
  onSwitchAgentEngine?: (
    slotId: string,
    engine: EngineId,
    modelId: string,
    reasoningEffort: ReasoningEffort
  ) => void;
}

const QUICK_INTENTS = [
  { label: '拆解步骤', text: '请先把这件事拆成清晰的几步分工，安排给对应成员推进。' },
  { label: '检查问题', text: '请帮我检查目前项目里有没有报错或体验不顺的地方，并给出修复结果。' },
  { label: '汇总进度', text: '请汇总一下目前各位成员完成了哪些内容，还有什么待收尾。' },
];

export const BoardStreamView: React.FC<BoardStreamViewProps> = ({
  board,
  agents,
  posts,
  tasks,
  snapshots,
  availableEngines,
  allModels,
  modelsByEngine,
  selectedTargetSlot,
  isLocalhost = true,
  isSwitchingBoard = false,
  onSelectTargetSlot,
  onSendMessage,
  onApprovePost,
  onUpdateBoard,
  onTriggerCliLeaderReply,
  onUpdateTargetEffort,
  onOpenMobileTasks,
  onOpenMobileRightSheet,
  onOpenSnapshotDiff,
  onAdoptSnapshot,
  onRevertSnapshot,
  onCreateCheckpoint,
  onPreviewFile,
  onOpenNewBoardModal,
  onOpenDesktopMcpModal,
  onSwitchAgentEngine,
}) => {
  const [draftsByBoard, setDraftsByBoard] = useState<Record<string, BoardDraftRecord>>(
    loadDraftsFromSession
  );
  const [manualTarget, setManualTarget] = useState(false);
  const [pendingClientMsgId, setPendingClientMsgId] = useState<string>(newClientMsgId);

  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [treeRelDir, setTreeRelDir] = useState('');
  const [treeParentRelDir, setTreeParentRelDir] = useState<string | null>(null);
  const [treeEntries, setTreeEntries] = useState<
    Array<{ name: string; relPath: string; kind: 'dir' | 'file' }>
  >([]);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{
    message: string;
    canRetry: boolean;
    uninstalledSlot?: boolean;
  } | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [dialoguePair, setDialoguePair] = useState<{ slotA: string; slotB: string } | null>(null);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null);
  const [feedbackPostId, setFeedbackPostId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [expandedPostFiles, setExpandedPostFiles] = useState<Record<string, boolean>>({});
  const [triggeringFallback, setTriggeringFallback] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeDraft: BoardDraftRecord = draftsByBoard[board.id] ?? {
    text: '',
    attachedFiles: [],
    targetSlot: 'lead',
    manualTarget: false,
    pendingClientMsgId: pendingClientMsgId,
  };

  const inputText = activeDraft.text;
  const attachedFiles = activeDraft.attachedFiles;

  const updateCurrentDraft = (patch: Partial<BoardDraftRecord>) => {
    setDraftsByBoard((prev) => {
      const current = prev[board.id] ?? {
        text: '',
        attachedFiles: [],
        targetSlot: selectedTargetSlot || 'lead',
        manualTarget: false,
        pendingClientMsgId: newClientMsgId(),
      };
      const nextMap = { ...prev, [board.id]: { ...current, ...patch } };
      saveDraftsToSession(nextMap);
      return nextMap;
    });
  };

  // Strict per-board isolation when switching between boards
  useEffect(() => {
    setFilePickerOpen(false);
    setQuickOpen(false);
    setTocOpen(false);
    setWorkspaceMenuOpen(false);
    setSendError(null);
    setFeedbackPostId(null);
    setFeedbackText('');
    setTreeRelDir('');

    const freshMap = loadDraftsFromSession();
    setDraftsByBoard(freshMap);
    const saved = freshMap[board.id];
    if (saved) {
      setManualTarget(saved.manualTarget);
      setPendingClientMsgId(saved.pendingClientMsgId || newClientMsgId());
      if (saved.targetSlot) {
        onSelectTargetSlot(saved.targetSlot);
      }
    } else {
      setManualTarget(false);
      setPendingClientMsgId(newClientMsgId());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

  // Escape closes composer popovers
  useEffect(() => {
    if (!filePickerOpen && !quickOpen && !tocOpen && !workspaceMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFilePickerOpen(false);
        setQuickOpen(false);
        setTocOpen(false);
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [filePickerOpen, quickOpen, tocOpen, workspaceMenuOpen]);

  const validSlotIds = useMemo(() => agents.map((a) => a.slotId.toLowerCase()), [agents]);
  const firstMentionInInput = useMemo(
    () => findFirstValidMention(inputText, validSlotIds),
    [inputText, validSlotIds]
  );

  // Synchronize automatic @mention recipient if user hasn't manually pinned another target
  useEffect(() => {
    if (manualTarget) return;
    const autoSlot = firstMentionInInput || 'lead';
    if (autoSlot !== selectedTargetSlot && validSlotIds.includes(autoSlot)) {
      onSelectTargetSlot(autoSlot);
      updateCurrentDraft({ targetSlot: autoSlot });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMentionInInput, manualTarget, validSlotIds.join(',')]);

  const knownSlots: MentionableSlot[] = useMemo(
    () => [
      { slotId: 'human', displayName: '我' },
      ...agents.map((a) => ({ slotId: a.slotId, displayName: a.displayName })),
    ],
    [agents]
  );

  const workingAgents = useMemo(() => agents.filter((a) => a.state === 'working'), [agents]);
  const completedTaskCount = useMemo(
    () => tasks.filter((t) => t.status === 'completed').length,
    [tasks]
  );
  const milestonePosts = useMemo(
    () => posts.filter((p) => p.authorType === 'agent' && (p.title || p.kind === 'deliverable')),
    [posts]
  );

  const leaderSlotId = useMemo(
    () => agents.find((a) => a.isLeader)?.slotId || agents[0]?.slotId || 'lead',
    [agents]
  );

  const hasUnreadForHost = useMemo(
    () =>
      board.leaderMode === 'mcp_host' &&
      !board.hostWaiting &&
      posts.some(
        (p) =>
          p.authorType === 'human' &&
          p.seqId > board.hostLastReadSeqId &&
          p.meta.hostDelivery !== 'cli_fallback' &&
          (p.mentions.length === 0 || p.mentions.includes(leaderSlotId))
      ),
    [board.leaderMode, board.hostWaiting, board.hostLastReadSeqId, posts, leaderSlotId]
  );

  const hostStatusBadge = useMemo(() => {
    const isWaveRunningWithoutWaiter = !board.hostWaiting && workingAgents.length > 0;
    const isHookPendingAck =
      !board.hostWaiting && (board.hostHookPendingSeqId ?? 0) > board.hostLastReadSeqId;

    if (board.hostWaiting) {
      return {
        label: '桌面端等待结果中',
        title: '桌面端主管正挂起等待本波次结果，发给主管的消息将 1 秒内直达桌面端',
        cls: 'border-[#CBE6D5] bg-[#EAF5EE] text-[#3B7A57]',
        dot: 'bg-[#4CA873] animate-pulse',
      };
    }
    if (isWaveRunningWithoutWaiter) {
      const viaInterjection = board.hostLastSettlementReason === 'human_interjection';
      return {
        label: viaInterjection ? '插话已回传 · 队员继续运行' : '队员继续运行 · 等待主管续接',
        title: viaInterjection
          ? '你的插话已送达桌面端主管，当前队员仍在后台继续运行，主管处理后可无缝续等本波次'
          : '队员仍在后台继续执行当前波次，桌面端主管可随时调用 cowork_wait_board 续接',
        cls: 'border-[#CFE5D6] bg-[#EFF8F2] text-[#3B7A57]',
        dot: 'bg-[#5BA97B] animate-pulse',
      };
    }
    if (isHookPendingAck) {
      return {
        label: '已带入下次对话 · 待主管响应',
        title: 'Hook 已将留言注入桌面端对话上下文，待主管操作看板确认后即完成闭环',
        cls: 'border-[var(--ac-border)] bg-[var(--ac-soft)] text-[var(--ac-text)]',
        dot: 'bg-[var(--ac-primary)]',
      };
    }
    if (hasUnreadForHost) {
      return {
        label: '桌面端待命（留言待同步）',
        title: '桌面端当前闲置，留言已暂存待同步（开启 Hook 时将在下次发话自动带入）',
        cls: 'border-[var(--ac-border)] bg-[var(--ac-soft)] text-[var(--ac-text)]',
        dot: 'bg-[var(--ac-bar)]',
      };
    }
    if (board.hostPanelBridgeActive) {
      return {
        label: '侧栏直通已连接（留言自动转入）',
        title: 'Antigravity 右侧分栏已开启自动转接，闲置期在网页发给主管的消息会自动发入桌面对话唤醒响应',
        cls: 'border-[#CBE6D5] bg-[#EAF5EE] text-[#3B7A57]',
        dot: 'bg-[#4CA873]',
      };
    }
    return {
      label: '桌面端待命',
      title: '当前由桌面端主管通过 MCP 直驱调度',
      cls: 'border-[#E6E6EE] bg-[#FAFAFC] text-[#4B4D57]',
      dot: 'bg-[#9FA3B0]',
    };
  }, [
    board.hostWaiting,
    board.hostHookPendingSeqId,
    board.hostLastReadSeqId,
    board.hostLastSettlementReason,
    board.hostPanelBridgeActive,
    workingAgents.length,
    hasUnreadForHost,
  ]);

  const latestUnreadHostHumanPostId = useMemo(() => {
    if (board.leaderMode !== 'mcp_host' || board.hostWaiting || board.hostCliFallback) return null;
    for (let i = posts.length - 1; i >= 0; i--) {
      const p = posts[i];
      if (
        p.authorType === 'human' &&
        p.seqId > board.hostLastReadSeqId &&
        p.meta.hostDelivery !== 'cli_fallback' &&
        (p.mentions.length === 0 || p.mentions.includes(leaderSlotId))
      ) {
        return p.id;
      }
    }
    return null;
  }, [board.leaderMode, board.hostWaiting, board.hostCliFallback, board.hostLastReadSeqId, posts, leaderSlotId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [posts.length, workingAgents.length]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2400);
  };

  const loadWorkspaceTree = (relDir: string) => {
    apiFetch(`/api/boards/${board.id}/fs/tree?dir=${encodeURIComponent(relDir)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setTreeRelDir(d.currentRelDir || '');
        setTreeParentRelDir(d.parentRelDir ?? null);
        setTreeEntries(d.entries || []);
      })
      .catch(() => {});
  };

  const openFilePicker = () => {
    if (!filePickerOpen) {
      loadWorkspaceTree('');
    }
    setFilePickerOpen((o) => !o);
  };

  const handleOpenFileOnHost = async (relPath?: string, reveal = false) => {
    const res = await apiFetch(`/api/boards/${board.id}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, reveal }),
    });
    if (res.ok) {
      showToast(!relPath ? '已打开项目文件夹' : '已调用系统默认程序打开');
    }
  };

  const toggleAttachFile = (relPath: string) => {
    const nextFiles = attachedFiles.includes(relPath)
      ? attachedFiles.filter((x) => x !== relPath)
      : [...attachedFiles, relPath];
    updateCurrentDraft({ attachedFiles: nextFiles });
  };

  const targetAgent = agents.find((a) => a.slotId === selectedTargetSlot) || agents[0];
  const targetEngineCard = availableEngines?.find((e) => e.id === targetAgent?.engine);
  const isTargetEngineUninstalled = Boolean(
    board.executionMode !== 'demo' &&
      targetAgent &&
      targetAgent.engine !== 'demo' &&
      targetEngineCard &&
      !targetEngineCard.installed
  );

  const handleSelectTargetManual = (slotId: string) => {
    setManualTarget(true);
    setSendError(null);
    onSelectTargetSlot(slotId);
    updateCurrentDraft({ targetSlot: slotId, manualTarget: true });
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = inputText.trim();
    if ((!trimmed && attachedFiles.length === 0) || sending || isSwitchingBoard) return;

    if (isTargetEngineUninstalled) {
      setSendError({
        message: `${targetAgent?.displayName} 当前使用的「${targetEngineCard?.name}」尚未在本机安装，无法直接执行。请切换到其他已安装成员或更换引擎。`,
        canRetry: false,
        uninstalledSlot: true,
      });
      return;
    }

    const filePrefix =
      attachedFiles.length > 0 ? `参考项目文件：${attachedFiles.join('、')}\n` : '';
    const finalContent = `${filePrefix}${trimmed || '请查看上述文件并处理。'}`;
    const targetBoardId = board.id;
    const msgIdToUse = activeDraft.pendingClientMsgId || pendingClientMsgId;

    setSending(true);
    setSendError(null);
    setFilePickerOpen(false);
    setQuickOpen(false);

    try {
      await onSendMessage(finalContent, selectedTargetSlot, {
        targetExplicitlyChosen: manualTarget,
        clientMessageId: msgIdToUse,
      });

      // Clear draft ONLY after server acknowledges receipt
      const freshId = newClientMsgId();
      setPendingClientMsgId(freshId);
      setManualTarget(false);
      setDraftsByBoard((prev) => {
        const nextMap = { ...prev };
        delete nextMap[targetBoardId];
        saveDraftsToSession(nextMap);
        return nextMap;
      });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isNetworkDown = /failed to fetch|networkerror|load failed|connection/i.test(rawMsg);
      setSendError({
        message: isNetworkDown
          ? '与本地服务连接断开，草稿与附件已为你保留，恢复服务后点击「重试发送」即可。'
          : `发送失败：${rawMsg}（草稿已保留）`,
        canRetry: true,
      });
    } finally {
      setSending(false);
    }
  };

  const scrollToPost = (postId: string) => {
    const el = document.getElementById(`post-${postId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTocOpen(false);
      setHighlightedPostId(postId);
      setTimeout(() => setHighlightedPostId((cur) => (cur === postId ? null : cur)), 2000);
    }
  };

  const cycleTargetEffort = () => {
    if (!targetAgent) return;
    const validEfforts = getEffortsForModel(
      targetAgent.engine,
      targetAgent.modelId,
      modelsByEngine
    );
    const idx = validEfforts.indexOf(targetAgent.reasoningEffort);
    const next = validEfforts[(idx + 1) % validEfforts.length] || 'high';
    onUpdateTargetEffort(targetAgent.slotId, next);
  };

  const mentionConflictAgent =
    manualTarget && firstMentionInInput && firstMentionInInput !== selectedTargetSlot
      ? agents.find((a) => a.slotId.toLowerCase() === firstMentionInInput)
      : undefined;

  return (
    <div className="relative flex flex-1 flex-col h-full min-w-0 overflow-hidden bg-[#F6F6F9]">
      {/* Board Header */}
      <div className="flex h-14 items-center justify-between gap-3 border-b border-[#EAEAEF] bg-white px-4 sm:px-6 flex-shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <h2 className="text-[15.5px] sm:text-[16px] font-bold text-[#1F2024] truncate">
            {board.title}
          </h2>
          {board.executionMode === 'demo' && (
            <span className="rounded-md bg-[var(--ac-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ac-deep)] flex-shrink-0">
              快速导览
            </span>
          )}
          <span
            title="当前看板任务完成进度与协作人数"
            className="rounded-lg bg-[var(--ac-soft)] px-2 py-0.5 text-[12px] font-medium text-[var(--ac-deep)] flex-shrink-0"
          >
            {tasks.length > 0
              ? `任务 ${tasks.filter((t) => t.status === 'completed').length}/${tasks.length}`
              : `${agents.length} 人协作`}
          </span>

          {/* Graphical Workspace Folder Pill */}
          <div className="relative hidden sm:block flex-shrink-0">
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((o) => !o)}
              title={`项目目录：${board.workspacePath}`}
              className="inline-flex h-7.5 items-center gap-1.5 rounded-xl border border-[#E6E6EE] bg-[#FAFAFC] px-2.5 text-[12px] font-medium text-[#4B4D57] hover:border-[var(--ac-border-strong)] hover:bg-[var(--ac-soft)] transition cursor-pointer"
            >
              <FolderOpen className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
              <span className="max-w-[105px] 2xl:max-w-[145px] truncate">{board.projectName}</span>
            </button>
            {workspaceMenuOpen && (
              <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-52 rounded-2xl border border-[#E6E6EE] bg-white p-1.5 shadow-xl">
                {isLocalhost && (
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      void handleOpenFileOnHost(undefined, false);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] text-[#3C3E47] hover:bg-[var(--ac-soft)] cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
                    <span>打开此项目文件夹</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    setWorkspacePickerOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] text-[#3C3E47] hover:bg-[var(--ac-soft)] cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
                  <span>更换项目文件夹...</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          {/* Desktop Team Avatar Status Strip (hidden at xl where right 376px roster pane is already visible) */}
          <div className="hidden md:flex xl:hidden 2xl:flex items-center -space-x-1.5 mr-0.5">
            {agents.map((a) => (
              <div
                key={a.id}
                title={`${a.displayName} · ${formatModelLabel(a.modelId, allModels)} (${formatEffortLabel(a.reasoningEffort)})`}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full bg-white border-2 ${
                  a.state === 'working' ? 'border-[var(--ac-primary)] z-10' : 'border-[#EFEFF4]'
                }`}
              >
                <EngineIcon engine={a.engine} size={16} />
              </div>
            ))}
          </div>

          {milestonePosts.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setTocOpen((o) => !o)}
                aria-label="消息节点导航"
                title="消息节点导航"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E4E4EC] bg-white text-[#4B4D57] hover:border-[#CFCFD9] transition cursor-pointer"
              >
                <List className="h-4 w-4" />
              </button>
              {tocOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 max-h-64 overflow-y-auto rounded-2xl border border-[#E6E6EC] bg-white p-1.5 shadow-xl">
                  {milestonePosts.map((mp, idx) => (
                    <button
                      type="button"
                      key={mp.id}
                      onClick={() => scrollToPost(mp.id)}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] hover:bg-[var(--ac-soft)] text-[#3C3E47] cursor-pointer"
                    >
                      <span className="text-[#8E919C]">{idx + 1}.</span>
                      <span className="truncate">{mp.title || `${mp.authorName}发言`}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {board.leaderMode === 'mcp_host' ? (
            <div className="hidden sm:flex items-center gap-1.5">
              <span
                title={hostStatusBadge.title}
                className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] font-semibold whitespace-nowrap ${hostStatusBadge.cls}`}
              >
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${hostStatusBadge.dot}`} />
                <span>{hostStatusBadge.label}</span>
              </span>

              <button
                type="button"
                onClick={() =>
                  void onUpdateBoard({ hostAutoStandby: board.hostAutoStandby === false })
                }
                title="开启后，CodeX / Claude Code 等桌面主管在每次向看板汇报后会自动 0 消耗挂起监听你的新留言"
                className={`hidden md:inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] font-medium transition whitespace-nowrap cursor-pointer ${
                  board.hostAutoStandby !== false
                    ? 'border-[#CBE6D5] bg-[#EAF5EE] text-[#3B7A57]'
                    : 'border-[#E6E6EE] bg-white text-[#5E616D] hover:bg-[#F7F7FA]'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full flex-shrink-0 ${
                    board.hostAutoStandby !== false ? 'bg-[#4CA873]' : 'bg-[#C8C9D2]'
                  }`}
                />
                <span>{board.hostAutoStandby !== false ? '自动监听：开' : '自动监听：关'}</span>
              </button>

              <button
                type="button"
                onClick={() => void onUpdateBoard({ hostCliFallback: !board.hostCliFallback })}
                title="开启后，当桌面端未挂起等待时，网页端发给主管的消息将由后台 CLI 主管代答"
                className={`hidden md:inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] font-medium transition whitespace-nowrap cursor-pointer ${
                  board.hostCliFallback
                    ? 'border-[var(--ac-border-strong)] bg-[var(--ac-soft)] text-[var(--ac-text)]'
                    : 'border-[#E6E6EE] bg-white text-[#5E616D] hover:bg-[#F7F7FA]'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full flex-shrink-0 ${
                    board.hostCliFallback ? 'bg-[var(--ac-primary)]' : 'bg-[#C8C9D2]'
                  }`}
                />
                <span>{board.hostCliFallback ? 'CLI 代答：开' : 'CLI 代答：关'}</span>
              </button>
            </div>
          ) : (
            board.executionMode !== 'demo' && (
              <span className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#EAEAEF] bg-[#FAFAFC] px-2.5 text-[12px] font-medium text-[#6E717C] whitespace-nowrap">
                <span className="h-2 w-2 rounded-full bg-[#5BA97B]" />
                <span>网页直驱协同</span>
              </span>
            )
          )}
        </div>
      </div>

      {/* Mobile / Compact Quick Access Strip (< xl) */}
      <div className="flex xl:hidden items-center justify-between gap-2 border-b border-[#EAEAEF] bg-[#FAFAFC] px-3.5 py-2 flex-shrink-0 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenMobileTasks}
            className="lg:hidden inline-flex h-8 items-center gap-1.5 rounded-xl bg-white border border-[#E6E6EE] px-3 text-[12.5px] font-medium text-[#3C3E47] whitespace-nowrap"
          >
            <CheckSquare className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
            任务 {completedTaskCount}/{tasks.length}
          </button>

          <button
            type="button"
            onClick={() => onOpenMobileRightSheet('roster')}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-white border border-[#E6E6EE] px-3 text-[12.5px] font-medium text-[#3C3E47] whitespace-nowrap"
          >
            <Users className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
            成员与模型 ({agents.length})
          </button>

          <button
            type="button"
            onClick={() => onOpenMobileRightSheet('snapshots')}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-white border border-[#E6E6EE] px-3 text-[12.5px] font-medium text-[#3C3E47] whitespace-nowrap"
          >
            <History className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
            改动备份 ({snapshots.length})
          </button>

          {board.leaderMode === 'mcp_host' && (
            <>
              <span
                title={hostStatusBadge.title}
                className={`sm:hidden inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] font-medium whitespace-nowrap ${hostStatusBadge.cls}`}
              >
                <span className={`h-2 w-2 rounded-full ${hostStatusBadge.dot}`} />
                {hostStatusBadge.label}
              </span>
              <button
                type="button"
                onClick={() =>
                  void onUpdateBoard({ hostAutoStandby: board.hostAutoStandby === false })
                }
                className={`md:hidden inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  board.hostAutoStandby !== false
                    ? 'border-[#CBE6D5] bg-[#EAF5EE] text-[#3B7A57]'
                    : 'border-[#E6E6EE] bg-white text-[#5E616D]'
                }`}
              >
                {board.hostAutoStandby !== false ? '自动监听：开' : '自动监听：关'}
              </button>
              <button
                type="button"
                onClick={() => void onUpdateBoard({ hostCliFallback: !board.hostCliFallback })}
                className={`md:hidden inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[12px] font-medium whitespace-nowrap cursor-pointer ${
                  board.hostCliFallback
                    ? 'border-[var(--ac-border-strong)] bg-[var(--ac-soft)] text-[var(--ac-text)]'
                    : 'border-[#E6E6EE] bg-white text-[#5E616D]'
                }`}
              >
                {board.hostCliFallback ? 'CLI 代答：开' : 'CLI 代答：关'}
              </button>
            </>
          )}
        </div>
      </div>

      {toastMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 rounded-full bg-[#2C2E35] px-4 py-2 text-[13px] font-medium text-white shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Group Chat Canvas */}
      <div className="flex-1 overflow-y-auto px-3.5 py-5 sm:px-6 sm:py-6 space-y-5 sm:space-y-6">
        {board.executionMode === 'demo' && (
          <div className="mx-auto w-full max-w-3xl rounded-2xl border border-[var(--ac-border)] bg-white p-4 sm:p-5 shadow-[0_2px_10px_rgba(20,20,35,0.03)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[var(--ac-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ac-deep)]">
                  内置离线导览
                </span>
                <span className="text-[14px] font-bold text-[#1F2024]">
                  快速体验协同流程（不调用真实 CLI，不改动你的个人项目目录）
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
              <div className="rounded-xl bg-[#F8F8FB] border border-[#EFEFF4] px-3 py-2">
                <div className="font-semibold text-[var(--ac-text)]">1. 选定项目目录</div>
                <div className="text-[#7A7D89] mt-0.5">指向你想让 AI 协作的文件夹</div>
              </div>
              <div className="rounded-xl bg-[#F8F8FB] border border-[#EFEFF4] px-3 py-2">
                <div className="font-semibold text-[var(--ac-text)]">2. 检查引擎就绪</div>
                <div className="text-[#7A7D89] mt-0.5">在右栏或工作台确认可用工具</div>
              </div>
              <div className="rounded-xl bg-[#F8F8FB] border border-[#EFEFF4] px-3 py-2">
                <div className="font-semibold text-[var(--ac-text)]">3. 发送首条需求</div>
                <div className="text-[#7A7D89] mt-0.5">由主管拆解任务并调度成员</div>
              </div>
              <div className="rounded-xl bg-[#F8F8FB] border border-[#EFEFF4] px-3 py-2">
                <div className="font-semibold text-[var(--ac-text)]">4. 预览与对比撤回</div>
                <div className="text-[#7A7D89] mt-0.5">下方成果卡可直接体验对比与撤回</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  updateCurrentDraft({
                    text: '请演示如何整理接口与检查清单，并展示文件改动预览。',
                  });
                }}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-tint)] px-3.5 text-[12.5px] font-semibold text-[var(--ac-text)] hover:bg-[var(--ac-soft)] cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" /> 试用导览对话
              </button>
              {onOpenNewBoardModal && (
                <button
                  type="button"
                  onClick={onOpenNewBoardModal}
                  className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[var(--ac-hover)] cursor-pointer"
                >
                  创建我的第一个真实看板
                </button>
              )}
              {onOpenDesktopMcpModal && (
                <button
                  type="button"
                  onClick={onOpenDesktopMcpModal}
                  className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-[#E4E4EC] bg-white px-3.5 text-[12.5px] font-medium text-[#4B4D57] hover:bg-[#F7F7FA] cursor-pointer"
                >
                  接入桌面 AI 客户端 (MCP)
                </button>
              )}
            </div>
          </div>
        )}
        {posts.map((post) => {
          const isHuman = post.authorType === 'human';
          const isSystem = post.authorType === 'system';
          const isGate = post.kind === 'approval_gate';

          // Actionable System Pause Gate (P1-07) MUST render BEFORE generic system notice
          if (isSystem && isGate && post.meta.pausedWakeup) {
            const pw = post.meta.pausedWakeup;
            const status = post.meta.approvalStatus || 'pending';

            return (
              <div
                id={`post-${post.id}`}
                key={post.id}
                className="mx-auto w-full max-w-2xl rounded-2xl border border-[#D8CFE8] bg-white p-4 sm:p-5 shadow-[0_2px_10px_rgba(119,104,166,0.08)]"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--ac-soft)] text-[var(--ac-deep)]">
                    <PauseCircle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold text-[#1F2024]">
                      {post.title || '已暂停自动接力，等待你确认'}
                    </div>
                    <div className="mt-1 text-[13.5px] text-[#3C3E47]">
                      <MarkdownContent
                        content={post.content}
                        variant="agent"
                        knownSlots={knownSlots}
                        onClickMention={(targetSlot) =>
                          setDialoguePair({ slotA: 'lead', slotB: targetSlot })
                        }
                      />
                    </div>

                    <div className="mt-3 pt-3 border-t border-[#F1F1F5] flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] text-[#8A8D98]">
                        待继续成员：{pw.slotName} (@{pw.slotId})
                      </span>

                      {status === 'approved' ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#458964]">
                          <Check className="h-4 w-4" /> 已确认继续接力
                        </span>
                      ) : status === 'stopped' ? (
                        <span className="text-[13px] font-medium text-[#8A8D98]">
                          已结束本轮接力
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void onApprovePost(post.id, 'stopped')}
                            className="inline-flex h-8.5 items-center rounded-xl border border-[#E4E4EC] bg-white px-3.5 text-[12.5px] font-medium text-[#555866] hover:bg-[#F7F7FA] cursor-pointer"
                          >
                            结束本轮
                          </button>
                          <button
                            type="button"
                            onClick={() => void onApprovePost(post.id, 'approved')}
                            className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-4 text-[12.5px] font-semibold text-white hover:bg-[var(--ac-hover)] transition cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" /> 继续接力
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          if (isSystem) {
            return (
              <div key={post.id} className="flex justify-center">
                <div className="rounded-full bg-[#ECECEF] px-4 py-1.5 text-[12.5px] text-[#6E717C]">
                  {post.title || post.content}
                </div>
              </div>
            );
          }

          const matchedSlot = agents.find((a) => a.slotId === post.authorSlotId);
          const engineToUse = post.authorEngine || matchedSlot?.engine;
          const modelLabel = formatModelLabel(
            post.meta.modelId || matchedSlot?.modelId,
            allModels
          );
          const effortLabel = formatEffortLabel(
            post.meta.reasoningEffort || matchedSlot?.reasoningEffort
          );

          // User Message -> Right Side
          if (isHuman) {
            const firstMention = post.mentions[0];
            const mentionedAgent = firstMention
              ? agents.find((x) => x.slotId.toLowerCase() === firstMention.toLowerCase())
              : undefined;

            return (
              <div
                id={`post-${post.id}`}
                key={post.id}
                className={`flex items-start justify-end gap-2.5 sm:gap-3 rounded-2xl transition ${
                  highlightedPostId === post.id ? 'ring-2 ring-[#B8ACE0] bg-[var(--ac-soft)]/60 p-1.5 -m-1.5' : ''
                }`}
              >
                <div className="flex flex-col items-end max-w-[84%] sm:max-w-[74%]">
                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[12px] text-[#8E919C]">
                    <span>{formatRelativeTime(post.createdAt)}</span>
                    <span className="font-medium text-[#4B4D57]">我</span>
                    {firstMention && (
                      <button
                        type="button"
                        onClick={() =>
                          setDialoguePair({ slotA: 'human', slotB: firstMention })
                        }
                        title="点击查看双人往来对话记录"
                        className="rounded-md bg-[var(--ac-soft-hover)] px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--ac-hover)] hover:bg-[#E4DCF4] transition cursor-pointer"
                      >
                        @{mentionedAgent?.displayName || firstMention}
                      </button>
                    )}
                  </div>
                  <div className="rounded-2xl rounded-tr-sm bg-[var(--ac-bubble)] px-4 py-3 sm:px-5 sm:py-3.5 text-white shadow-[0_2px_8px_rgba(123,107,168,0.14)]">
                    <MarkdownContent
                      content={post.content}
                      variant="human"
                      knownSlots={knownSlots}
                      onClickMention={(targetSlot) =>
                        setDialoguePair({ slotA: 'human', slotB: targetSlot })
                      }
                    />
                  </div>
                  {board.leaderMode === 'mcp_host' &&
                    (!firstMention || firstMention === leaderSlotId) && (
                      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2 px-1 text-[11.5px]">
                        {post.meta.hostDelivery === 'cli_fallback' ? (
                          <span className="text-[var(--ac-deep)]">已交由后台 CLI 主管代答</span>
                        ) : post.meta.hostDelivery === 'delivered_to_wait' ? (
                          <span className="text-[#458964]">已回传桌面端主管</span>
                        ) : post.meta.hostDelivery === 'panel_forwarded' ? (
                          <span className="text-[#458964]">已自动发入桌面端对话</span>
                        ) : post.meta.hostDelivery === 'host_acked' ||
                          post.seqId <= board.hostLastReadSeqId ? (
                          <span className="text-[#458964]">已同步至桌面端主管</span>
                        ) : latestUnreadHostHumanPostId === post.id && onTriggerCliLeaderReply ? (
                          <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-[var(--ac-border-soft)] bg-[var(--ac-tint)] px-2.5 py-1.5 text-[#555866]">
                            <span>
                              {post.meta.hostDelivery === 'hook_injected' ||
                              post.seqId <= (board.hostHookPendingSeqId ?? 0)
                                ? '已带入桌面端下次对话，待主管响应'
                                : '桌面端当前闲置，留言已暂存'}
                            </span>
                            <button
                              type="button"
                              disabled={triggeringFallback}
                              onClick={async () => {
                                setTriggeringFallback(true);
                                try {
                                  await onTriggerCliLeaderReply();
                                } finally {
                                  setTriggeringFallback(false);
                                }
                              }}
                              className="rounded-lg bg-[var(--ac-primary)] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-50 cursor-pointer"
                            >
                              {triggeringFallback ? '唤醒中...' : '本轮改由后台 CLI 主管立即代答'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[#8E919C]">
                            {post.meta.hostDelivery === 'hook_injected' ||
                            post.seqId <= (board.hostHookPendingSeqId ?? 0)
                              ? '已带入桌面端下次对话，待主管确认'
                              : '留言已暂存，等待桌面端同步'}
                          </span>
                        )}
                      </div>
                    )}
                </div>
                <UserAvatarIcon size={36} />
              </div>
            );
          }

          // Agent Message -> Left Side
          const snapshotId = post.meta.snapshotId;
          const changeStatus = post.meta.changeStatus;
          const filesList = post.meta.filesChanged ?? [];
          const isPostFilesExpanded = Boolean(expandedPostFiles[post.id]);
          const shownFilesList = isPostFilesExpanded ? filesList : filesList.slice(0, 6);

          return (
            <div
              id={`post-${post.id}`}
              key={post.id}
              className={`flex items-start justify-start gap-2.5 sm:gap-3.5 rounded-2xl transition ${
                highlightedPostId === post.id ? 'ring-2 ring-[#B8ACE0] bg-[var(--ac-soft)]/60 p-1.5 -m-1.5' : ''
              }`}
            >
              <div className="flex h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white border border-[#EAEAEF] shadow-2xs mt-0.5">
                <EngineIcon engine={engineToUse} size={21} />
              </div>

              <div className="flex flex-col items-start min-w-0 flex-1 max-w-[88%] sm:max-w-[84%]">
                {/* Sender Name + Role + Model & Effort Badge */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1.5 px-0.5">
                  <span className="text-[14px] font-bold text-[#232429]">{post.authorName}</span>
                  {matchedSlot?.roleTitle && (
                    <span className="hidden sm:inline text-[12.5px] text-[#8A8D98]">
                      {matchedSlot.roleTitle}
                    </span>
                  )}
                  {modelLabel && (
                    <span className="rounded-md bg-[#EFEFF4] px-2 py-0.5 text-[11.5px] text-[#5E616D]">
                      {modelLabel} · {effortLabel}
                    </span>
                  )}
                  <span className="text-[12px] text-[#A0A3AD]">
                    {formatRelativeTime(post.createdAt)}
                  </span>
                </div>

                {/* Chat Card */}
                <div
                  className={`w-full rounded-2xl rounded-tl-sm bg-white px-4 py-3.5 sm:px-5 sm:py-4 shadow-[0_2px_10px_rgba(20,20,35,0.025)] border ${
                    isGate ? 'border-[#D9CEEC]' : 'border-[#EAEAEF]'
                  }`}
                >
                  {post.title && (
                    <div className="mb-1.5 text-[14.5px] sm:text-[15px] font-bold text-[#1F2024]">
                      {post.title}
                    </div>
                  )}

                  <MarkdownContent
                    content={post.content}
                    variant="agent"
                    knownSlots={knownSlots}
                    onOpenFilePath={onPreviewFile}
                    onClickMention={(targetSlot) =>
                      setDialoguePair({ slotA: post.authorSlotId, slotB: targetSlot })
                    }
                  />

                  {post.meta.isError && post.meta.sourceHumanText && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-2 border-t border-[#F3E6E4]">
                      <button
                        type="button"
                        onClick={() => {
                          updateCurrentDraft({ text: post.meta.sourceHumanText! });
                          showToast('已把原消息放回下方输入框，可直接切换引擎或编辑后重发');
                        }}
                        className="inline-flex h-7.5 items-center gap-1.5 rounded-lg border border-[#E4D5D3] bg-[#FDF8F7] px-3 text-[12px] font-medium text-[#943F37] hover:bg-[#F9ECEA] cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" /> 重新编辑发送原消息
                      </button>
                    </div>
                  )}

                  {post.meta.staffingTable && post.meta.staffingTable.length > 0 && (
                    <div className="mt-3 rounded-2xl border border-[#EAE8F3] bg-[#F8F7FC] p-3">
                      <div className="mb-2 text-[12px] font-semibold text-[var(--ac-text)]">团队分工安排</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {post.meta.staffingTable.map((st) => {
                          const matched = agents.find((a) => a.slotId === st.slotId);
                          return (
                            <button
                              type="button"
                              key={st.slotId}
                              onClick={() =>
                                setDialoguePair({ slotA: post.authorSlotId, slotB: st.slotId })
                              }
                              className="flex items-center gap-2 rounded-xl border border-[#E7E5F2] bg-white px-2.5 py-1.5 text-left hover:border-[#C5BBE3] transition cursor-pointer"
                            >
                              <EngineIcon engine={matched?.engine || st.engine} size={15} />
                              <span className="text-[12.5px] font-semibold text-[#232429] whitespace-nowrap">
                                {matched?.displayName || st.name}
                              </span>
                              <span className="text-[12px] text-[#7A7D89] truncate">{st.role}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Harmonious Balanced Deliverable & Safety Change Card */}
                  {(filesList.length > 0 || snapshotId) && (
                    <div className="mt-3.5 rounded-2xl border border-[#EAE9F2] bg-[#F9F9FC] p-3 space-y-2.5">
                      {filesList.length > 0 && (
                        <div className="space-y-1.5">
                          {shownFilesList.map((file) => {
                            const normalized = file.replace(/\\/g, '/');
                            const slashIdx = normalized.lastIndexOf('/');
                            const fileName =
                              slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
                            const dirPrefix =
                              slashIdx >= 0 ? normalized.slice(0, slashIdx + 1) : '项目根目录';

                            return (
                              <div
                                key={file}
                                className="flex items-center justify-between gap-3 rounded-xl border border-[#E7E6F0] bg-white px-3 py-2 hover:border-[var(--ac-border-strong)] transition"
                              >
                                <button
                                  type="button"
                                  onClick={() => onPreviewFile(file)}
                                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                                >
                                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--ac-soft)] text-[var(--ac-primary)]">
                                    <FileText className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-[13px] font-semibold text-[#232429]">
                                      {fileName}
                                    </span>
                                    <span className="block truncate font-mono text-[11.5px] text-[#8E919C]">
                                      {dirPrefix}
                                    </span>
                                  </span>
                                </button>

                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => onPreviewFile(file)}
                                    className="inline-flex h-7.5 items-center gap-1 rounded-lg bg-[var(--ac-soft)] px-2.5 text-[12px] font-medium text-[var(--ac-text)] hover:bg-[#E9E2F8] transition cursor-pointer"
                                  >
                                    <Eye className="h-3.5 w-3.5" /> 预览
                                  </button>
                                  {isLocalhost && (
                                    <button
                                      type="button"
                                      onClick={() => void handleOpenFileOnHost(file, false)}
                                      title="用电脑默认程序打开"
                                      className="inline-flex h-7.5 items-center gap-1 rounded-lg border border-[#E6E6EE] bg-white px-2.5 text-[12px] font-medium text-[#4B4D57] hover:bg-[#F7F7FA] transition cursor-pointer"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5 text-[var(--ac-primary)]" /> 打开
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {filesList.length > 6 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedPostFiles((prev) => ({
                                  ...prev,
                                  [post.id]: !prev[post.id],
                                }))
                              }
                              className="px-1 text-[12px] font-medium text-[var(--ac-deep)] hover:underline cursor-pointer"
                            >
                              {isPostFilesExpanded
                                ? '收起文件列表'
                                : `展开其余 ${filesList.length - 6} 个文件（共 ${filesList.length} 个）`}
                            </button>
                          )}
                        </div>
                      )}

                      {snapshotId && (() => {
                        const linkedSnap = snapshots.find((s) => s.id === snapshotId);
                        const outcome = linkedSnap?.lastRevertOutcome;
                        const keptNewerOnly =
                          changeStatus !== 'reverted' &&
                          changeStatus !== 'adopted' &&
                          Boolean(outcome && outcome.skippedFiles.length > 0 && outcome.restoredFiles.length === 0);

                        return (
                          <div
                            className={`flex flex-wrap items-center justify-between gap-2.5 ${
                              filesList.length > 0 ? 'pt-2.5 border-t border-[#ECECF3]' : ''
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-[12px]">
                              {changeStatus === 'adopted' ? (
                                <>
                                  <span className="h-2 w-2 rounded-full bg-[#5BA97B] flex-shrink-0" />
                                  <span className="font-semibold text-[#458964]">已采纳保留此改动</span>
                                </>
                              ) : changeStatus === 'reverted' ? (
                                <>
                                  <span className="h-2 w-2 rounded-full bg-[#C97A72] flex-shrink-0" />
                                  <span className="font-semibold text-[#A65850]">
                                    {outcome && outcome.skippedFiles.length > 0
                                      ? `已还原 ${outcome.restoredFiles.length} 个文件 · 保留 ${outcome.skippedFiles.length} 个较新修改`
                                      : '已撤回并恢复原文件'}
                                  </span>
                                </>
                              ) : keptNewerOnly ? (
                                <>
                                  <span className="h-2 w-2 rounded-full bg-[#5BA97B] flex-shrink-0" />
                                  <span className="font-semibold text-[#3B7A57]">
                                    已保留较新修改（撤回 0 个，跳过 {outcome?.skippedFiles.length} 个文件）
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="h-2 w-2 rounded-full bg-[var(--ac-bar)] flex-shrink-0" />
                                  <span className="text-[#6E717C]">原文件已自动备份，可随时对比或撤回</span>
                                </>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onOpenSnapshotDiff(snapshotId)}
                                className="inline-flex h-7.5 items-center gap-1 rounded-lg border border-[#E4E4EC] bg-white px-2.5 text-[12px] font-medium text-[#3C3E47] hover:bg-[var(--ac-soft)] cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5 text-[var(--ac-primary)]" />{' '}
                                {keptNewerOnly ? '查看处理结果' : '对比改动'}
                              </button>

                              {changeStatus !== 'reverted' && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const outcomeRes = await onRevertSnapshot(snapshotId, 'strict');
                                    if (outcomeRes?.hasConflicts) {
                                      return;
                                    }
                                    if (outcomeRes && !outcomeRes.ok) {
                                      showToast(outcomeRes.error || '撤回失败，请查看详情');
                                      return;
                                    }
                                    showToast(
                                      outcomeRes?.restoredCount
                                        ? `已撤回 ${outcomeRes.restoredCount} 个文件并恢复原内容`
                                        : '已完成撤回处理'
                                    );
                                  }}
                                  className="inline-flex h-7.5 items-center gap-1 rounded-lg border border-[#E5D7D5] bg-[#FDF8F7] px-2.5 text-[12px] font-medium text-[#A65850] hover:bg-[#F9ECEA] cursor-pointer"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" /> 一键撤回
                                </button>
                              )}

                              {changeStatus !== 'adopted' && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await onAdoptSnapshot(snapshotId);
                                    showToast('已采纳保留该次改动');
                                  }}
                                  className="inline-flex h-7.5 items-center gap-1 rounded-lg bg-[var(--ac-primary)] px-3 text-[12px] font-semibold text-white hover:bg-[var(--ac-hover)] cursor-pointer"
                                >
                                  <Check className="h-3.5 w-3.5" /> 采纳保留
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Agent Approval Gate with Approve & Changes Requested */}
                  {isGate && (
                    <div className="mt-3.5 pt-3 border-t border-[#F1F1F5] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {post.meta.approvalStatus === 'approved' ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#529471]">
                            <Check className="h-4 w-4" /> 已确认通过
                          </span>
                        ) : post.meta.approvalStatus === 'changes_requested' ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#9C6A29]">
                            <MessageSquarePlus className="h-4 w-4" /> 已提出修改意见
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setFeedbackPostId((cur) => (cur === post.id ? null : post.id));
                                setFeedbackText('');
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#E4E4EC] bg-white px-3.5 text-[13px] font-medium text-[#4B4D57] hover:bg-[#F7F7FA] cursor-pointer"
                            >
                              <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--ac-primary)]" /> 退回修改
                            </button>
                            <button
                              type="button"
                              onClick={() => void onApprovePost(post.id, 'approved')}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--ac-hover)] transition cursor-pointer"
                            >
                              <Check className="h-4 w-4" /> 确认通过
                            </button>
                          </>
                        )}
                      </div>

                      {feedbackPostId === post.id && (
                        <div className="flex items-center gap-2 rounded-2xl bg-[#F8F8FB] p-2 border border-[#ECECF2]">
                          <input
                            type="text"
                            autoFocus
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            placeholder="说明希望如何调整..."
                            className="h-8.5 flex-1 rounded-xl border border-[#DFDFE8] bg-white px-3 text-[13px] focus:border-[var(--ac-mid)] focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={!feedbackText.trim()}
                            onClick={async () => {
                              await onApprovePost(post.id, 'changes_requested', feedbackText.trim());
                              setFeedbackPostId(null);
                              setFeedbackText('');
                            }}
                            className="h-8.5 rounded-xl bg-[var(--ac-primary)] px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-40 cursor-pointer"
                          >
                            提交意见
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Working Agents Indicator */}
        {workingAgents.map((w) => (
          <div key={w.id} className="flex items-center gap-3">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white border border-[#EAEAEF]">
              <EngineIcon engine={w.engine} size={20} />
            </div>
            <div className="inline-flex items-center gap-2.5 rounded-2xl bg-white border border-[#EAEAEF] px-4 py-2.5 text-[14px] text-[#4B4D57]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ac-primary)]" />
              <span className="font-semibold text-[#232429]">{w.displayName}</span>
              <span className="text-[#7A7D89]">{w.currentActivity}</span>
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Elevated Multi-Row Rich Composer Card */}
      <div className="px-3 pb-3 pt-1.5 sm:px-6 sm:pb-5 bg-[#F6F6F9] flex-shrink-0">
        <form
          onSubmit={handleSend}
          className="relative rounded-3xl border border-[#DFDFE8] bg-white p-3 sm:p-4 shadow-[0_6px_24px_rgba(20,20,35,0.05)] focus-within:border-[#A89BCE] transition"
        >
          {/* Graphical Folder-Navigable Workspace File/Folder Picker Popover */}
          {filePickerOpen && (
            <div className="absolute left-3 bottom-[calc(100%+8px)] z-30 w-84 sm:w-92 rounded-2xl border border-[#E4E4EC] bg-white p-3 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-bold text-[#1F2024]">选择要引用的文件或文件夹</span>
                <button
                  type="button"
                  onClick={() => setFilePickerOpen(false)}
                  aria-label="关闭引用文件弹窗"
                  className="rounded-lg p-1 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-[#F7F7FA] px-2.5 py-1.5 border border-[#EFEFF4]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    disabled={treeParentRelDir === null}
                    onClick={() => treeParentRelDir !== null && loadWorkspaceTree(treeParentRelDir)}
                    className="inline-flex h-6.5 items-center gap-1 rounded-lg border border-[#E4E4EC] bg-white px-2 text-[11.5px] font-medium text-[#3C3E47] disabled:opacity-35 cursor-pointer flex-shrink-0"
                  >
                    <ArrowUp className="h-3 w-3" /> 上级
                  </button>
                  <span className="truncate font-mono text-[11.5px] text-[#666975]">
                    /{treeRelDir}
                  </span>
                </div>
                {treeRelDir && (
                  <button
                    type="button"
                    onClick={() => toggleAttachFile(`${treeRelDir}/`)}
                    className="rounded-lg bg-[var(--ac-soft-hover)] px-2 py-1 text-[11.5px] font-semibold text-[var(--ac-text)] hover:bg-[#E4DCF4] flex-shrink-0 cursor-pointer"
                  >
                    {attachedFiles.includes(`${treeRelDir}/`) ? '已选此目录' : '选此目录'}
                  </button>
                )}
              </div>

              <div className="max-h-56 overflow-y-auto space-y-1">
                {treeEntries.length === 0 ? (
                  <div className="py-5 text-center text-[12.5px] text-[#9A9DA8]">此目录为空</div>
                ) : (
                  treeEntries.map((entry) => {
                    if (entry.kind === 'dir') {
                      const folderTag = `${entry.relPath}/`;
                      const folderChecked = attachedFiles.includes(folderTag);
                      return (
                        <div
                          key={entry.relPath}
                          className="flex items-center justify-between gap-1 rounded-xl px-2 py-1.5 hover:bg-[#F7F7FA]"
                        >
                          <button
                            type="button"
                            onClick={() => loadWorkspaceTree(entry.relPath)}
                            className="flex flex-1 items-center gap-2 min-w-0 text-left text-[12.5px] font-medium text-[#2C2E35] cursor-pointer"
                          >
                            <Folder className="h-4 w-4 text-[var(--ac-bar)] flex-shrink-0" />
                            <span className="truncate">{entry.name}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-[#B0B3BE] flex-shrink-0" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleAttachFile(folderTag)}
                            className={`rounded-lg px-2 py-0.5 text-[11px] font-medium cursor-pointer flex-shrink-0 ${
                              folderChecked
                                ? 'bg-[var(--ac-primary)] text-white'
                                : 'text-[#7A7D89] hover:bg-[var(--ac-soft-hover)] hover:text-[var(--ac-text)]'
                            }`}
                          >
                            {folderChecked ? '已选' : '引用目录'}
                          </button>
                        </div>
                      );
                    }

                    const checked = attachedFiles.includes(entry.relPath);
                    return (
                      <button
                        type="button"
                        key={entry.relPath}
                        onClick={() => toggleAttachFile(entry.relPath)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] cursor-pointer ${
                          checked
                            ? 'bg-[var(--ac-soft)] font-semibold text-[var(--ac-text)]'
                            : 'text-[#3C3E47] hover:bg-[#F7F7FA]'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-[#8E919C] flex-shrink-0" />
                          <span className="truncate font-mono">{entry.name}</span>
                        </span>
                        {checked && <Check className="h-3.5 w-3.5 text-[var(--ac-primary)] flex-shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Top Bar inside Composer: Spacious Target Member Pills */}
          <div className="flex items-center gap-2 pb-2.5 border-b border-[#F3F3F7] overflow-x-auto">
            <span className="text-[12.5px] text-[#8E919C] flex-shrink-0">发送给</span>
            {agents.map((a) => {
              const active = a.slotId === selectedTargetSlot;
              return (
                <button
                  type="button"
                  key={a.slotId}
                  onClick={() => handleSelectTargetManual(a.slotId)}
                  className={`inline-flex h-7.5 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition flex-shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[var(--ac-primary)] text-white'
                      : 'bg-[#F4F3F8] text-[#4B4D57] hover:bg-[#EAE7F3]'
                  }`}
                >
                  <EngineIcon engine={a.engine} size={13} />
                  <span>{a.displayName}</span>
                </button>
              );
            })}
          </div>

          {/* Live @mention Conflict Helper Strip (P1-08) */}
          {mentionConflictAgent && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--ac-tint)] border border-[var(--ac-border)] px-3 py-1.5 text-[12px] text-[#4B4D57]">
              <span>
                你在正文中点名了 <strong className="text-[var(--ac-text)]">{mentionConflictAgent.displayName}</strong>
                ，当前选定的收件人是「{targetAgent?.displayName}」
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setManualTarget(false);
                    onSelectTargetSlot(mentionConflictAgent.slotId);
                    updateCurrentDraft({
                      targetSlot: mentionConflictAgent.slotId,
                      manualTarget: false,
                    });
                  }}
                  className="rounded-lg bg-[var(--ac-primary)] px-2.5 py-0.5 text-[11.5px] font-semibold text-white cursor-pointer"
                >
                  改发给 {mentionConflictAgent.displayName}
                </button>
              </div>
            </div>
          )}

          {/* Send Failure / Uninstalled Engine Alert with Retry & Quick Engine Switch */}
          {(sendError || isTargetEngineUninstalled) && (() => {
            const firstInstalledEngine = availableEngines?.find((e) => e.installed);
            return (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EED7D4] bg-[#FDF5F4] px-3 py-2 text-[12.5px] text-[#943F37]">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[#B65B50]" />
                  <span>
                    {sendError?.message ||
                      `${targetAgent?.displayName} 当前配置的「${targetEngineCard?.name}」尚未在本机安装，草稿已保留；请切换为可用引擎后再发送。`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {sendError?.canRetry && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void handleSend()}
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--ac-primary)] px-3 text-[12px] font-semibold text-white hover:bg-[var(--ac-hover)] cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" /> 重试发送
                    </button>
                  )}
                  {isTargetEngineUninstalled && targetAgent && firstInstalledEngine && onSwitchAgentEngine && (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitchAgentEngine(
                          targetAgent.slotId,
                          firstInstalledEngine.id,
                          firstInstalledEngine.defaultModel,
                          firstInstalledEngine.defaultEffort
                        );
                        setSendError(null);
                        showToast(`已将 ${targetAgent.displayName} 切换为 ${firstInstalledEngine.name}`);
                      }}
                      className="inline-flex h-7 items-center rounded-lg bg-[var(--ac-primary)] px-2.5 text-[11.5px] font-semibold text-white hover:bg-[var(--ac-hover)] cursor-pointer"
                    >
                      切换至 {firstInstalledEngine.name}
                    </button>
                  )}
                  {isTargetEngineUninstalled && (
                    <button
                      type="button"
                      onClick={() => onOpenMobileRightSheet('roster')}
                      className="xl:hidden rounded-lg border border-[#E4C9C5] bg-white px-2.5 py-1 text-[11.5px] font-medium text-[#7A352E] cursor-pointer"
                    >
                      调整成员
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Attached File Chips */}
          {attachedFiles.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {attachedFiles.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ac-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--ac-text)]"
                >
                  <FileText className="h-3 w-3" />
                  {f}
                  <button
                    type="button"
                    onClick={() => toggleAttachFile(f)}
                    aria-label={`移除引用文件 ${f}`}
                    className="hover:text-[#1F2024] cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Spacious Multi-Line Textarea */}
          <textarea
            rows={2}
            value={inputText}
            onChange={(e) => {
              setSendError(null);
              updateCurrentDraft({ text: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={`向${targetAgent?.displayName || '主管'}交代接下来的工作（Enter 发送，Shift+Enter 换行）...`}
            className="mt-2.5 max-h-40 min-h-[46px] sm:min-h-[58px] w-full resize-none bg-transparent text-[14.5px] sm:text-[15px] leading-relaxed text-[#1F2024] placeholder:text-[#9A9DA8] focus:outline-none"
          />

          {/* Bottom Action Toolbar inside Composer */}
          <div className="mt-2 flex items-center justify-between gap-2 pt-2 border-t border-[#F3F3F7]">
            <div className="relative flex items-center gap-1">
              <button
                type="button"
                onClick={openFilePicker}
                title="引用项目文件"
                aria-label="引用项目文件"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2 sm:px-2.5 text-[12.5px] font-medium text-[#5E616D] hover:bg-[#F4F3F8] transition cursor-pointer whitespace-nowrap"
              >
                <Paperclip className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-[var(--ac-primary)]" />
                <span className="hidden sm:inline">引用文件</span>
              </button>

              <button
                type="button"
                onClick={() => setQuickOpen((o) => !o)}
                title="常用指令模板"
                aria-label="常用指令模板"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2 sm:px-2.5 text-[12.5px] font-medium text-[#5E616D] hover:bg-[#F4F3F8] transition cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-[var(--ac-primary)]" />
                <span className="hidden sm:inline">常用指令</span>
              </button>

              {quickOpen && (
                <div className="absolute left-20 bottom-[calc(100%+8px)] z-30 w-56 rounded-2xl border border-[#E4E4EC] bg-white p-1.5 shadow-xl">
                  {QUICK_INTENTS.map((qi) => (
                    <button
                      type="button"
                      key={qi.label}
                      onClick={() => {
                        updateCurrentDraft({ text: qi.text });
                        setQuickOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] text-[#3C3E47] hover:bg-[var(--ac-soft)] cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[var(--ac-bar)] flex-shrink-0" />
                      <span>{qi.label}</span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={async () => {
                  await onCreateCheckpoint();
                  showToast('已保存当前工作区安全备份点');
                }}
                className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium text-[#5E616D] hover:bg-[#F4F3F8] transition cursor-pointer"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
                <span>保存备份</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {targetAgent && (
                <button
                  type="button"
                  onClick={cycleTargetEffort}
                  title="点击快速切换思考强度"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ac-soft)] px-3 text-[12px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-border-soft)] transition cursor-pointer"
                >
                  <span className="hidden sm:inline truncate max-w-[130px]">
                    {formatModelLabel(targetAgent.modelId, allModels)} ·
                  </span>
                  <span className="font-semibold">
                    {formatEffortLabel(targetAgent.reasoningEffort)}
                  </span>
                </button>
              )}

              <button
                type="submit"
                disabled={
                  (!inputText.trim() && attachedFiles.length === 0) ||
                  sending ||
                  isSwitchingBoard ||
                  isTargetEngineUninstalled
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-4 text-[13.5px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-40 transition cursor-pointer"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span>
                  {sending ? '发送中' : isTargetEngineUninstalled ? '需切换引擎' : '发送'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>

      <FolderPickerModal
        open={workspacePickerOpen}
        initialPath={board.workspacePath}
        title="更换当前看板项目文件夹"
        onClose={() => setWorkspacePickerOpen(false)}
        onSelect={(chosen) => {
          void onUpdateBoard({ workspacePath: chosen });
          showToast('已切换项目文件夹');
        }}
      />

      <PairwiseDialogueModal
        pair={dialoguePair}
        agents={agents}
        posts={posts}
        allModels={allModels}
        onChangePair={(next) => setDialoguePair(next)}
        onJumpToPost={scrollToPost}
        onPreviewFile={onPreviewFile}
        onClose={() => setDialoguePair(null)}
      />
    </div>
  );
};
