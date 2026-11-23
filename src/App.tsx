import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutGrid,
  MessageSquare,
  Plus,
  Folder,
  Menu,
  X,
  ChevronDown,
  Trash2,
  AlertTriangle,
  Plug,
} from 'lucide-react';
import type {
  AgentSlot,
  AppThemeId,
  Board,
  BoardPost,
  BoardTask,
  CustomMemberDraft,
  EngineId,
  ModelOption,
  ReasoningEffort,
  SessionSyncMode,
  TaskStatus,
  WorkbenchOverview,
  WorkspaceSnapshot,
} from './types';
import { WorkbenchView } from './components/WorkbenchView';
import { BoardStreamView } from './components/BoardStreamView';
import { LeftTasksPanel, RosterAndTasksPane } from './components/RosterAndTasksPane';
import { MobileConnectModal } from './components/MobileConnectModal';
import { NewBoardModal } from './components/NewBoardModal';
import { GlobalDispatchModal } from './components/GlobalDispatchModal';
import { DesktopMcpModal } from './components/DesktopMcpModal';
import { DiffCompareModal, type RevertClientOutcome } from './components/DiffCompareModal';
import { FilePreviewModal } from './components/FilePreviewModal';
import { BoardQuotaBar } from './components/BoardQuotaBar';
import { PairingLockScreen } from './components/PairingLockScreen';
import { AppBrandLogo } from './components/BrandIcon';
import { FALLBACK_MODELS_BY_ENGINE, formatRelativeTime } from './utils/format';
import { apiFetch, getStoredClientToken, setStoredClientToken } from './utils/api';
import type { SnapshotConflictItem } from './types';

const UI_THEME_OPTIONS: Array<{ id: AppThemeId; label: string; dot: string }> = [
  { id: 'purple', label: '薰衣草紫', dot: '#7768A6' },
  { id: 'blue', label: '雾霭蓝', dot: '#4F7CAC' },
  { id: 'green', label: '鼠尾草绿', dot: '#4D8B74' },
  { id: 'pink', label: '樱花粉', dot: '#B06986' },
];

export const App: React.FC = () => {
  const [authChecking, setAuthChecking] = useState(true);
  const [locked, setLocked] = useState(false);

  const [uiTheme, setUiTheme] = useState<AppThemeId>(() => {
    try {
      const saved = localStorage.getItem('cowork_ui_theme') as AppThemeId | null;
      return saved && ['purple', 'blue', 'green', 'pink'].includes(saved) ? saved : 'purple';
    } catch {
      return 'purple';
    }
  });

  const [activeTab, setActiveTab] = useState<'board' | 'workbench'>('board');
  const [overview, setOverview] = useState<WorkbenchOverview | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);

  const [currentBoard, setCurrentBoard] = useState<Board | null>(null);
  const [agents, setAgents] = useState<AgentSlot[]>([]);
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const [liveLogsBySlot, setLiveLogsBySlot] = useState<Record<string, string[]>>({});
  const [selectedTargetSlot, setSelectedTargetSlot] = useState<string>('lead');
  const [isLocalhost, setIsLocalhost] = useState(true);
  const [isSwitchingBoard, setIsSwitchingBoard] = useState(false);

  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [rightDrawerTab, setRightDrawerTab] = useState<'roster' | 'snapshots'>('roster');
  const [mobileTasksSheetOpen, setMobileTasksSheetOpen] = useState(false);
  const [mobileModalOpen, setMobileModalOpen] = useState(false);
  const [newBoardModalOpen, setNewBoardModalOpen] = useState(false);
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [desktopMcpModalOpen, setDesktopMcpModalOpen] = useState(false);
  const [modalPresetId, setModalPresetId] = useState<string>('fullstack-dev');
  const [diffSnapshotId, setDiffSnapshotId] = useState<string | null>(null);
  const [diffPendingConflicts, setDiffPendingConflicts] = useState<SnapshotConflictItem[] | null>(
    null
  );
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [confirmDeleteBoard, setConfirmDeleteBoard] = useState<Board | null>(null);

  const lastSeqIdRef = useRef(0);
  const snapshotReqIdRef = useRef(0);
  const engineDefaultReqSeqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const root = document.documentElement;
    if (uiTheme === 'purple') {
      delete root.dataset.accent;
    } else {
      root.dataset.accent = uiTheme;
    }
    try {
      localStorage.setItem('cowork_ui_theme', uiTheme);
    } catch {
      // ignore storage errors
    }
  }, [uiTheme]);

  const handleChangeTheme = async (nextTheme: AppThemeId) => {
    setUiTheme(nextTheme);
    try {
      await apiFetch('/api/settings/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiTheme: nextTheme }),
      });
    } catch {
      // ignore sync error
    }
  };

  // Auto-exchange ?pair=<token> from QR scan & check access lock
  useEffect(() => {
    async function initAuth() {
      const params = new URLSearchParams(window.location.search);
      const pairToken = params.get('pair');
      if (pairToken) {
        try {
          const r = await fetch('/api/auth/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairToken }),
          });
          if (r.ok) {
            const d = await r.json();
            setStoredClientToken(d.token);
            window.history.replaceState({}, '', window.location.pathname);
          }
        } catch {
          // ignore
        }
      }

      try {
        const res = await apiFetch('/api/auth/status');
        if (res.ok) {
          const st = await res.json();
          setLocked(!st.authorized);
          setIsLocalhost(Boolean(st.isLocalhost));
        }
      } finally {
        setAuthChecking(false);
      }
    }
    void initAuth();
  }, []);

  useEffect(() => {
    let maxSeq = 0;
    for (const p of posts) {
      if ((p.seqId ?? 0) > maxSeq) maxSeq = p.seqId;
    }
    lastSeqIdRef.current = maxSeq;
  }, [posts]);

  useEffect(() => {
    if (agents.length === 0) return;
    if (!agents.some((a) => a.slotId === selectedTargetSlot)) {
      const leaderId = agents.find((a) => a.isLeader)?.slotId || agents[0].slotId;
      setSelectedTargetSlot(leaderId);
    }
  }, [agents, selectedTargetSlot]);

  const fetchWorkbench = useCallback(async (forceQuota = false) => {
    const res = await apiFetch(forceQuota ? '/api/workbench?refresh=1' : '/api/workbench');
    if (res.status === 401) {
      setLocked(true);
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as WorkbenchOverview;
      setOverview(data);
      if (data.uiTheme) {
        setUiTheme(data.uiTheme);
      }
    }
  }, []);

  const fetchBoards = useCallback(async () => {
    const res = await apiFetch('/api/boards');
    if (!res.ok) return;
    const list = (await res.json()) as Board[];
    setBoards(list);
    setActiveBoardId((prev) => (prev && list.some((x) => x.id === prev) ? prev : list[0]?.id || null));
  }, []);

  const fetchBoardSnapshot = useCallback(async (boardId: string) => {
    const reqId = ++snapshotReqIdRef.current;
    setIsSwitchingBoard(true);
    try {
      const res = await apiFetch(`/api/boards/${boardId}/snapshot`);
      if (!res.ok || reqId !== snapshotReqIdRef.current) return;
      const snap = (await res.json()) as {
        board: Board;
        agents: AgentSlot[];
        posts: BoardPost[];
        tasks: BoardTask[];
        snapshots: WorkspaceSnapshot[];
      };
      if (reqId !== snapshotReqIdRef.current) return;
      setCurrentBoard(snap.board);
      setAgents(snap.agents);
      setPosts(snap.posts);
      setTasks(snap.tasks);
      setSnapshots(snap.snapshots || []);
      const leaderId =
        snap.agents.find((a) => a.isLeader)?.slotId || snap.agents[0]?.slotId || 'lead';
      setSelectedTargetSlot(leaderId);
      setDiffPendingConflicts(null);
    } finally {
      if (reqId === snapshotReqIdRef.current) {
        setIsSwitchingBoard(false);
      }
    }
  }, []);

  useEffect(() => {
    if (authChecking || locked) return;
    void fetchWorkbench();
    void fetchBoards();
  }, [authChecking, locked, fetchWorkbench, fetchBoards]);

  useEffect(() => {
    if (!locked && activeBoardId) {
      void fetchBoardSnapshot(activeBoardId);
    }
  }, [locked, activeBoardId, fetchBoardSnapshot]);

  useEffect(() => {
    if (!confirmDeleteBoard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setConfirmDeleteBoard(null);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [confirmDeleteBoard]);

  useEffect(() => {
    if (!leftDrawerOpen && !rightDrawerOpen && !mobileTasksSheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !confirmDeleteBoard &&
        !diffSnapshotId &&
        !previewFilePath &&
        !newBoardModalOpen &&
        !dispatchModalOpen &&
        !desktopMcpModalOpen &&
        !mobileModalOpen
      ) {
        setLeftDrawerOpen(false);
        setRightDrawerOpen(false);
        setMobileTasksSheetOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    leftDrawerOpen,
    rightDrawerOpen,
    mobileTasksSheetOpen,
    confirmDeleteBoard,
    diffSnapshotId,
    previewFilePath,
    newBoardModalOpen,
    dispatchModalOpen,
    desktopMcpModalOpen,
    mobileModalOpen,
  ]);

  useEffect(() => {
    if (locked) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getStoredClientToken();
    const wsUrl = `${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let hasConnected = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        if (hasConnected && activeBoardId) {
          const since = lastSeqIdRef.current;
          void apiFetch(`/api/boards/${activeBoardId}/snapshot?sinceSeqId=${since}`)
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                delta: {
                  board?: Board;
                  agents?: AgentSlot[];
                  posts?: BoardPost[];
                  tasks?: BoardTask[];
                  snapshots?: WorkspaceSnapshot[];
                } | null
              ) => {
                if (!delta || delta.board?.id !== activeBoardId) return;
                if (delta.board) setCurrentBoard(delta.board);
                if (Array.isArray(delta.agents)) setAgents(delta.agents);
                if (Array.isArray(delta.tasks)) setTasks(delta.tasks);
                if (Array.isArray(delta.snapshots)) setSnapshots(delta.snapshots);
                if (Array.isArray(delta.posts) && delta.posts.length > 0) {
                  setPosts((prev) => {
                    const byId = new Map(prev.map((p) => [p.id, p]));
                    for (const p of delta.posts!) {
                      byId.set(p.id, p);
                    }
                    return Array.from(byId.values()).sort(
                      (a, b) => (a.seqId ?? 0) - (b.seqId ?? 0)
                    );
                  });
                }
              }
            )
            .catch(() => {});
          void fetchBoards();
          void fetchWorkbench(false);
        }
        hasConnected = true;
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as {
            type: string;
            boardId: string;
            payload: unknown;
          };

          if (msg.type === 'theme.updated') {
            const nextTheme = (msg.payload as { uiTheme?: AppThemeId })?.uiTheme;
            if (nextTheme && ['purple', 'blue', 'green', 'pink'].includes(nextTheme)) {
              setUiTheme(nextTheme);
            }
          } else if (msg.type === 'board.updated') {
            const updated = msg.payload as Board;
            setBoards((prev) => {
              const exists = prev.some((b) => b.id === updated.id);
              return exists ? prev.map((b) => (b.id === updated.id ? updated : b)) : [updated, ...prev];
            });
            setCurrentBoard((cur) => (cur?.id === updated.id ? updated : cur));
            void fetchWorkbench(false);
          } else if (msg.boardId === activeBoardId) {
            if (msg.type === 'post.created') {
              const post = msg.payload as BoardPost;
              setPosts((prev) => {
                const idx = prev.findIndex((p) => p.id === post.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = post;
                  return copy;
                }
                return [...prev, post];
              });
            } else if (msg.type === 'agent.updated') {
              const slot = msg.payload as AgentSlot;
              setAgents((prev) => {
                const updated = prev.some((a) => a.id === slot.id)
                  ? prev.map((a) => (a.id === slot.id ? slot : a))
                  : [...prev, slot];
                return [...updated].sort((a, b) => Number(b.isLeader) - Number(a.isLeader));
              });
            } else if (msg.type === 'agent.created') {
              const slot = msg.payload as AgentSlot;
              setAgents((prev) => {
                if (prev.some((a) => a.id === slot.id || a.slotId === slot.slotId)) {
                  return prev.map((a) => (a.id === slot.id ? slot : a));
                }
                return [...prev, slot].sort((a, b) => Number(b.isLeader) - Number(a.isLeader));
              });
            } else if (msg.type === 'agent.deleted') {
              const { slotId } = msg.payload as { slotId: string };
              setAgents((prev) => prev.filter((a) => a.slotId !== slotId));
            } else if (msg.type === 'task.upserted') {
              const task = msg.payload as BoardTask;
              setTasks((prev) => {
                const idx = prev.findIndex((t) => t.id === task.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = task;
                  return copy;
                }
                return [...prev, task];
              });
            } else if (msg.type === 'snapshot.updated') {
              const snap = msg.payload as WorkspaceSnapshot;
              setSnapshots((prev) => {
                const idx = prev.findIndex((s) => s.id === snap.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = snap;
                  return copy;
                }
                return [snap, ...prev];
              });
            } else if (msg.type === 'agent.raw_log') {
              const { slotId, line } = msg.payload as { slotId: string; line: string };
              setLiveLogsBySlot((prev) => {
                const cur = prev[slotId] ?? [];
                return { ...prev, [slotId]: [...cur.slice(-199), line] };
              });
            }
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = (ev) => {
        if (disposed) return;
        if (ev.code === 1008 || ev.code === 4001) {
          setStoredClientToken('');
          setLocked(true);
          return;
        }
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [activeBoardId, locked, fetchBoards, fetchWorkbench]);

  const modelsByEngine = useMemo(() => {
    const map: Record<string, ModelOption[]> = {
      ...FALLBACK_MODELS_BY_ENGINE,
    };
    if (overview?.engines) {
      for (const eng of overview.engines) {
        if (eng.availableModels?.length) {
          map[eng.id] = eng.availableModels;
        }
      }
    }
    return map;
  }, [overview]);

  const allModelsFlat = useMemo(
    () => Object.values(modelsByEngine).flat(),
    [modelsByEngine]
  );

  const boardsByProject = useMemo(() => {
    const groups = new Map<string, Board[]>();
    for (const b of boards) {
      const list = groups.get(b.projectName) ?? [];
      list.push(b);
      groups.set(b.projectName, list);
    }
    return Array.from(groups.entries());
  }, [boards]);

  const recentWorkspaces = useMemo(
    () =>
      Array.from(
        new Set(
          boards
            .filter((b) => b.executionMode !== 'demo' && b.workspacePath)
            .map((b) => b.workspacePath)
        )
      ),
    [boards]
  );

  if (authChecking) {
    return <div className="flex h-screen items-center justify-center bg-[#F6F6F9] text-[14px] text-[#8A8D98]" />;
  }

  if (locked) {
    return (
      <PairingLockScreen
        onUnlocked={() => {
          setLocked(false);
          void fetchWorkbench();
          void fetchBoards();
        }}
      />
    );
  }

  const handleCreateBoard = async (payload: {
    title: string;
    workspacePath: string;
    presetId: string;
    sessionSyncMode?: SessionSyncMode;
    engineOverrides: Record<string, EngineId>;
    modelOverrides: Record<string, string>;
    effortOverrides: Record<string, ReasoningEffort>;
    customMembers?: CustomMemberDraft[];
    initialDirective: string;
  }) => {
    const res = await apiFetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const created = (await res.json()) as Board;
      await fetchBoards();
      setActiveBoardId(created.id);
      setActiveTab('board');
      setLeftDrawerOpen(false);
    }
  };

  const handleDeleteBoard = (e: React.MouseEvent, board: Board) => {
    e.stopPropagation();
    if (boards.length <= 1) return;
    setConfirmDeleteBoard(board);
  };

  const executeDeleteBoard = async () => {
    if (!confirmDeleteBoard || boards.length <= 1) return;
    const boardId = confirmDeleteBoard.id;
    setConfirmDeleteBoard(null);
    await apiFetch(`/api/boards/${boardId}`, { method: 'DELETE' });
    await fetchBoards();
  };

  const handleSendMessage = async (
    content: string,
    targetSlotId: string,
    options?: { targetExplicitlyChosen?: boolean; clientMessageId?: string }
  ) => {
    if (!currentBoard) throw new Error('当前没有选中的看板');
    const res = await apiFetch(`/api/boards/${currentBoard.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        targetSlotId,
        targetExplicitlyChosen: options?.targetExplicitlyChosen,
        clientMessageId: options?.clientMessageId,
      }),
    });
    if (!res.ok) {
      let errMsg = '消息发送失败';
      try {
        const d = (await res.json()) as { error?: string };
        if (d?.error) errMsg = d.error;
      } catch {
        // ignore
      }
      throw new Error(errMsg);
    }
  };

  const handleApprovePost = async (
    postId: string,
    decision: 'approved' | 'changes_requested' | 'stopped',
    feedback?: string
  ) => {
    if (!currentBoard) return;
    await apiFetch(`/api/boards/${currentBoard.id}/posts/${postId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, feedback }),
    });
  };

  const handleUpdateBoard = async (
    patch: Partial<
      Pick<
        Board,
        'executionMode' | 'sessionSyncMode' | 'hostCliFallback' | 'hostAutoStandby' | 'workspacePath'
      >
    >
  ) => {
    if (!currentBoard) return;
    await apiFetch(`/api/boards/${currentBoard.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  };

  const handleTriggerCliLeaderReply = async () => {
    if (!currentBoard) return;
    await apiFetch(`/api/boards/${currentBoard.id}/leader-cli-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  };

  const handleUpdateAgent = async (
    slotId: string,
    patch: {
      displayName?: string;
      roleTitle?: string;
      roleBrief?: string;
      roleAutoAssigned?: boolean;
      isLeader?: boolean;
      engine?: EngineId;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
    }
  ) => {
    if (!currentBoard) return;
    await apiFetch(`/api/boards/${currentBoard.id}/agents/${slotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  };

  const handleAddAgent = async (draft: CustomMemberDraft & { assignImmediately?: boolean }) => {
    if (!currentBoard) return;
    const res = await apiFetch(`/api/boards/${currentBoard.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || '新增成员失败');
    }
  };

  const handleRemoveAgent = async (slotId: string) => {
    if (!currentBoard) return;
    const res = await apiFetch(`/api/boards/${currentBoard.id}/agents/${slotId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || '移除成员失败');
    }
  };

  const handleAddTask = async (title: string) => {
    if (!currentBoard) return;
    await apiFetch(`/api/boards/${currentBoard.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, assigneeSlotId: selectedTargetSlot }),
    });
  };

  const handleToggleTask = async (taskId: string, nextStatus: TaskStatus) => {
    if (!currentBoard) return;
    await apiFetch(`/api/boards/${currentBoard.id}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
  };

  const handleSaveEngineDefault = async (
    engineId: Exclude<EngineId, 'demo'>,
    modelId: string,
    reasoningEffort: ReasoningEffort
  ) => {
    const seq = (engineDefaultReqSeqRef.current[engineId] || 0) + 1;
    engineDefaultReqSeqRef.current[engineId] = seq;

    // Optimistic update so back-to-back model/effort edits immediately read fresh props
    setOverview((prev) =>
      prev
        ? {
            ...prev,
            engines: prev.engines.map((eng) =>
              eng.id === engineId
                ? {
                    ...eng,
                    defaultModel: modelId,
                    defaultEffort: reasoningEffort,
                    hasCustomDefault: true,
                  }
                : eng
            ),
          }
        : prev
    );

    try {
      const res = await apiFetch(`/api/settings/engine-defaults/${engineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, reasoningEffort }),
      });
      if (engineDefaultReqSeqRef.current[engineId] !== seq) return;
      if (!res.ok) {
        void fetchWorkbench(false);
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        config?: { modelId?: string; reasoningEffort?: ReasoningEffort };
      };
      if (engineDefaultReqSeqRef.current[engineId] !== seq) return;
      if (data?.config?.modelId) {
        setOverview((prev) =>
          prev
            ? {
                ...prev,
                engines: prev.engines.map((eng) =>
                  eng.id === engineId
                    ? {
                        ...eng,
                        defaultModel: data.config?.modelId || modelId,
                        defaultEffort: (data.config?.reasoningEffort || reasoningEffort) as ReasoningEffort,
                        hasCustomDefault: true,
                      }
                    : eng
                ),
              }
            : prev
        );
      }
    } catch {
      if (engineDefaultReqSeqRef.current[engineId] === seq) {
        void fetchWorkbench(false);
      }
    }
  };

  const handleResetEngineDefault = async (engineId: Exclude<EngineId, 'demo'>) => {
    const seq = (engineDefaultReqSeqRef.current[engineId] || 0) + 1;
    engineDefaultReqSeqRef.current[engineId] = seq;

    setOverview((prev) =>
      prev
        ? {
            ...prev,
            engines: prev.engines.map((eng) => {
              if (eng.id !== engineId) return eng;
              const fallbackMod = eng.availableModels[0];
              const fallbackEffs = fallbackMod?.efforts?.length
                ? fallbackMod.efforts
                : ['low', 'medium', 'high'];
              return {
                ...eng,
                defaultModel: fallbackMod?.id || 'default',
                defaultEffort: (fallbackMod?.defaultEffort || fallbackEffs[0] || 'high') as ReasoningEffort,
                hasCustomDefault: false,
              };
            }),
          }
        : prev
    );

    try {
      const res = await apiFetch(`/api/settings/engine-defaults/${engineId}`, {
        method: 'DELETE',
      });
      if (engineDefaultReqSeqRef.current[engineId] !== seq) return;
      if (!res.ok) {
        void fetchWorkbench(false);
      }
    } catch {
      if (engineDefaultReqSeqRef.current[engineId] === seq) {
        void fetchWorkbench(false);
      }
    }
  };

  const handleCreateCheckpoint = async () => {
    if (!currentBoard) return;
    await apiFetch(`/api/boards/${currentBoard.id}/snapshots/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  };

  const handleAdoptSnapshot = async (snapshotId: string) => {
    await apiFetch(`/api/snapshots/${snapshotId}/adopt`, { method: 'POST' });
  };

  const handleRevertSnapshot = async (
    snapshotId: string,
    mode: 'strict' | 'skip_conflicts' | 'overwrite_all' = 'strict'
  ): Promise<RevertClientOutcome> => {
    const res = await apiFetch(`/api/snapshots/${snapshotId}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { conflicts?: SnapshotConflictItem[] };
      const conflicts = data.conflicts ?? [];
      if (mode === 'strict') {
        setDiffPendingConflicts(conflicts);
        setDiffSnapshotId(snapshotId);
      }
      return { ok: false, hasConflicts: true, conflicts };
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error || '撤回还原失败' };
    }
    const data = (await res.json().catch(() => ({}))) as {
      restoredCount?: number;
      skippedConflicts?: number;
    };
    setDiffPendingConflicts(null);
    return {
      ok: true,
      restoredCount: data.restoredCount,
      skippedConflicts: data.skippedConflicts,
    };
  };

  const eps = overview?.endpoints ?? [];
  const networkBadgeLabel = eps.some((e) => e.kind === 'lan')
    ? '局域网'
    : eps.some((e) => e.kind === 'tailscale')
      ? '异地组网'
      : '本机';

  const SidebarContent = (
    <div className="flex h-full flex-col bg-white border-r border-[#EAEAEF]">
      {/* Brand Header */}
      <div className="p-4 border-b border-[#F1F1F5]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AppBrandLogo size={36} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-bold text-[#1F2024]">AgentSwarm</span>
                <span className="rounded-full bg-[var(--ac-soft)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ac-deep)]">
                  {boards.length} 会话
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[12.5px] text-[#529471] mt-0.5">
                <span className="h-2 w-2 rounded-full bg-[#5BA97B]" /> 运行中
              </div>
            </div>
          </div>

          <button
            onClick={() => setLeftDrawerOpen(false)}
            className="lg:hidden rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          onClick={() => {
            setModalPresetId('fullstack-dev');
            setNewBoardModalOpen(true);
          }}
          className="mt-4 flex h-11 w-full items-center justify-between rounded-2xl border border-[var(--ac-border-soft)] bg-[#FAFAFC] px-3.5 text-[14px] font-semibold text-[#232429] hover:border-[var(--ac-mid)] hover:bg-[var(--ac-tint)] transition cursor-pointer"
        >
          <span className="inline-flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--ac-primary)] text-white">
              <Plus className="h-4 w-4" />
            </span>
            新建看板
          </span>
          <Plus className="h-4 w-4 text-[#9A9DA8]" />
        </button>

        <button
          type="button"
          onClick={() => {
            setDesktopMcpModalOpen(true);
            setLeftDrawerOpen(false);
          }}
          className="mt-2 flex h-9.5 w-full items-center justify-between rounded-xl border border-[var(--ac-border-soft)] bg-white px-3 text-[12.5px] font-medium text-[#555866] hover:border-[var(--ac-border-strong)] hover:bg-[var(--ac-tint)] hover:text-[var(--ac-text)] transition cursor-pointer"
        >
          <span className="inline-flex items-center gap-2">
            <Plug className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
            <span>桌面端 MCP 接入</span>
          </span>
          <span className="rounded-md bg-[var(--ac-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--ac-deep)]">
            双模
          </span>
        </button>

        {/* Mobile Theme Switcher inside Left Drawer (shown when header theme pill hides on narrow board view) */}
        <div className="sm:hidden mt-2 flex h-9 items-center justify-between rounded-xl border border-[var(--ac-border-soft)] bg-white px-3 text-[12.5px] font-medium text-[#555866]">
          <span>界面主题</span>
          <div className="flex items-center gap-1.5" role="group" aria-label="移动端界面主题色">
            {UI_THEME_OPTIONS.map((t) => {
              const selected = uiTheme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={`主题色：${t.label}`}
                  aria-label={`切换到${t.label}主题`}
                  aria-pressed={selected}
                  onClick={() => void handleChangeTheme(t.id)}
                  className={`h-4 w-4 rounded-full transition cursor-pointer ${
                    selected
                      ? 'ring-2 ring-offset-1 ring-[#3C3E47] scale-110'
                      : 'opacity-75 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: t.dot }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* View Switch */}
      <div className="px-3.5 py-3 border-b border-[#F1F1F5]">
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[#F4F3F8] p-1">
          <button
            onClick={() => {
              setActiveTab('workbench');
              setLeftDrawerOpen(false);
            }}
            className={`flex h-9 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold transition cursor-pointer ${
              activeTab === 'workbench'
                ? 'bg-white text-[#1F2024] shadow-2xs'
                : 'text-[#6E717C] hover:text-[#232429]'
            }`}
          >
            <LayoutGrid className="h-4 w-4" /> 工作台
          </button>
          <button
            onClick={() => {
              setActiveTab('board');
              setLeftDrawerOpen(false);
            }}
            className={`flex h-9 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold transition cursor-pointer ${
              activeTab === 'board'
                ? 'bg-white text-[#1F2024] shadow-2xs'
                : 'text-[#6E717C] hover:text-[#232429]'
            }`}
          >
            <MessageSquare className="h-4 w-4" /> 协同看板
          </button>
        </div>
      </div>

      {/* Project Sessions List */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {boardsByProject.map(([projectName, groupBoards]) => (
          <div key={projectName}>
            <div className="flex items-center justify-between px-2 py-1 text-[13px] font-semibold text-[#6E717C]">
              <span className="inline-flex items-center gap-2 truncate">
                <Folder className="h-4 w-4 text-[#8E919C]" />
                {projectName}
              </span>
            </div>

            <div className="mt-1.5 space-y-1">
              {groupBoards.map((b) => {
                const isSelected = b.id === activeBoardId && activeTab === 'board';
                return (
                  <div
                    key={b.id}
                    onClick={() => {
                      setActiveBoardId(b.id);
                      setActiveTab('board');
                      setLeftDrawerOpen(false);
                    }}
                    className={`group flex items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--ac-soft)] text-[#232429]'
                        : 'text-[#3C3E47] hover:bg-[#F7F7FA]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          isSelected ? 'bg-[var(--ac-primary)]' : 'bg-[var(--ac-border-strong)]'
                        }`}
                      />
                      <span className="truncate text-[14px] font-medium">{b.title}</span>
                      {b.leaderMode === 'mcp_host' && (
                        <span className="flex-shrink-0 rounded-md bg-[#EAF5EE] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#3B7A57]">
                          桌面端
                        </span>
                      )}
                      {b.executionMode === 'demo' && (
                        <span className="flex-shrink-0 rounded-md bg-[var(--ac-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--ac-primary)]">
                          导览
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span
                        title="累计协作对话轮次"
                        className="rounded-lg bg-[#EFEFF4] px-2 py-0.5 text-[11.5px] font-medium text-[#6E717C]"
                      >
                        {b.turnCount > 0 ? `${b.turnCount} 轮` : '新会话'}
                      </span>
                      <span className="text-[12px] text-[#9A9DA8] lg:group-hover:hidden">
                        {formatRelativeTime(b.updatedAt)}
                      </span>
                      {boards.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteBoard(e, b)}
                          title="删除此会话"
                          aria-label={`删除会话 ${b.title}`}
                          className="inline-flex lg:hidden lg:group-hover:inline-flex rounded-lg p-1 text-[#9A9DA8] hover:text-[#A65850] cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom-Left Task Progress Panel on Desktop */}
      {activeTab === 'board' && currentBoard && (
        <div className="hidden lg:contents">
          <LeftTasksPanel
            tasks={tasks}
            agents={agents}
            onAddTask={handleAddTask}
            onToggleTask={handleToggleTask}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#F6F6F9]">
      {/* Global Top Header */}
      <header className="flex h-14 items-center justify-between gap-1.5 sm:gap-2 border-b border-[#EAEAEF] bg-white px-2.5 sm:px-6 flex-shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
          <button
            onClick={() => setLeftDrawerOpen(true)}
            className="lg:hidden rounded-xl p-1.5 sm:p-2 text-[#4B4D57] hover:bg-[#F3F2F7] flex-shrink-0"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Mobile Primary View Segmented Pill */}
          <div className="flex lg:hidden rounded-full bg-[#F2F2F6] p-0.5 min-[390px]:p-1 text-[12px] min-[390px]:text-[12.5px] sm:text-[13px] whitespace-nowrap flex-shrink-0">
            <button
              onClick={() => setActiveTab('workbench')}
              className={`rounded-full px-2 min-[390px]:px-2.5 sm:px-3.5 py-1 font-semibold transition ${
                activeTab === 'workbench' ? 'bg-white text-[#1F2024] shadow-2xs' : 'text-[#7A7D89]'
              }`}
            >
              工作台
            </button>
            <button
              onClick={() => setActiveTab('board')}
              className={`rounded-full px-2 min-[390px]:px-2.5 sm:px-3.5 py-1 font-semibold transition ${
                activeTab === 'board' ? 'bg-white text-[#1F2024] shadow-2xs' : 'text-[#7A7D89]'
              }`}
            >
              协同看板
            </button>
          </div>

          <h1 className="hidden lg:block text-[18px] font-bold tracking-tight text-[#1F2024] whitespace-nowrap">
            {activeTab === 'workbench' ? '工作台' : '协同看板'}
          </h1>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
          {activeTab === 'board' && overview?.engines && (
            <BoardQuotaBar
              engines={overview.engines}
              quotaUpdatedAt={overview.quotaUpdatedAt}
              onRefreshQuota={(force) => fetchWorkbench(force)}
            />
          )}

          {/* Subtle Theme Switcher (Purple / Blue / Green / Pink) */}
          <div
            role="group"
            aria-label="界面主题色"
            className={`${
              activeTab === 'workbench' ? 'flex' : 'hidden sm:flex'
            } items-center gap-1 rounded-full border border-[#E6E6EC] bg-[#FAFAFC] px-1.5 py-1 flex-shrink-0`}
          >
            {UI_THEME_OPTIONS.map((t) => {
              const selected = uiTheme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={`主题色：${t.label}`}
                  aria-label={`切换到${t.label}主题`}
                  aria-pressed={selected}
                  onClick={() => void handleChangeTheme(t.id)}
                  className={`h-3.5 w-3.5 rounded-full transition cursor-pointer ${
                    selected
                      ? 'ring-2 ring-offset-1 ring-[#3C3E47] scale-110'
                      : 'opacity-70 hover:opacity-100 hover:scale-105'
                  }`}
                  style={{ backgroundColor: t.dot }}
                />
              );
            })}
          </div>

          <button
            onClick={() => setMobileModalOpen(true)}
            className="inline-flex h-7.5 min-[390px]:h-8.5 items-center gap-1 sm:gap-2 whitespace-nowrap rounded-full border border-[#E6E6EC] bg-[#FAFAFC] px-2 min-[390px]:px-3 sm:px-3.5 text-[11.5px] min-[390px]:text-[12.5px] sm:text-[13px] font-medium text-[#3C3E47] hover:bg-[#F3F2F7] transition cursor-pointer"
          >
            <span className="h-2 w-2 rounded-full bg-[#5BA97B] flex-shrink-0" />
            <span>{networkBadgeLabel}</span>
            <ChevronDown className="hidden min-[380px]:block h-3.5 w-3.5 text-[#8E919C] flex-shrink-0" />
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Balanced Left Column (316px) */}
        <div className="hidden lg:block lg:w-[316px] flex-shrink-0 h-full">{SidebarContent}</div>

        {/* Mobile Left Slide Drawer */}
        {leftDrawerOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="w-[84%] max-w-[310px] h-full shadow-2xl">{SidebarContent}</div>
            <div
              className="flex-1 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setLeftDrawerOpen(false)}
            />
          </div>
        )}

        {activeTab === 'workbench' ? (
          <WorkbenchView
            overview={overview}
            onRefresh={(force) => void fetchWorkbench(force)}
            onStartPreset={(presetId) => {
              setModalPresetId(presetId);
              setNewBoardModalOpen(true);
            }}
            onOpenDispatchSettings={() => setDispatchModalOpen(true)}
            onOpenDesktopMcp={() => setDesktopMcpModalOpen(true)}
            onSaveEngineDefault={handleSaveEngineDefault}
            onResetEngineDefault={handleResetEngineDefault}
          />
        ) : currentBoard ? (
          <div className="flex flex-1 min-w-0 h-full overflow-hidden">
            <BoardStreamView
              board={currentBoard}
              agents={agents}
              posts={posts}
              tasks={tasks}
              snapshots={snapshots}
              availableEngines={overview?.engines}
              allModels={allModelsFlat}
              modelsByEngine={modelsByEngine}
              selectedTargetSlot={selectedTargetSlot}
              isLocalhost={isLocalhost}
              isSwitchingBoard={isSwitchingBoard}
              onSelectTargetSlot={setSelectedTargetSlot}
              onSendMessage={handleSendMessage}
              onApprovePost={handleApprovePost}
              onUpdateBoard={handleUpdateBoard}
              onTriggerCliLeaderReply={handleTriggerCliLeaderReply}
              onUpdateTargetEffort={(slotId, effort) =>
                void handleUpdateAgent(slotId, { reasoningEffort: effort })
              }
              onOpenMobileTasks={() => setMobileTasksSheetOpen(true)}
              onOpenMobileRightSheet={(tab) => {
                setRightDrawerTab(tab);
                setRightDrawerOpen(true);
              }}
              onOpenSnapshotDiff={(sid, conflicts) => {
                setDiffPendingConflicts(conflicts ?? null);
                setDiffSnapshotId(sid);
              }}
              onAdoptSnapshot={handleAdoptSnapshot}
              onRevertSnapshot={handleRevertSnapshot}
              onCreateCheckpoint={handleCreateCheckpoint}
              onPreviewFile={(rel) => setPreviewFilePath(rel)}
            />

            {/* Balanced Spacious Right Column (376px) */}
            <div className="hidden xl:block xl:w-[376px] flex-shrink-0 h-full">
              <RosterAndTasksPane
                board={currentBoard}
                agents={agents}
                snapshots={snapshots}
                availableEngines={overview?.engines}
                modelsByEngine={modelsByEngine}
                liveLogsBySlot={liveLogsBySlot}
                isLocalhost={isLocalhost}
                onUpdateAgent={(s, p) => void handleUpdateAgent(s, p)}
                onAddAgent={handleAddAgent}
                onRemoveAgent={handleRemoveAgent}
                onOpenDispatchSettings={() => setDispatchModalOpen(true)}
                onSelectTargetSlot={setSelectedTargetSlot}
                onCreateCheckpoint={handleCreateCheckpoint}
                onOpenSnapshotDiff={(sid) => {
                  setDiffPendingConflicts(null);
                  setDiffSnapshotId(sid);
                }}
                onRevertSnapshot={async (sid) => {
                  await handleRevertSnapshot(sid);
                }}
                onPreviewFile={(rel) => setPreviewFilePath(rel)}
              />
            </div>

            {/* Mobile/Tablet Right Slide Sheet */}
            {rightDrawerOpen && (
              <div className="fixed inset-0 z-40 flex justify-end xl:hidden">
                <div
                  className="flex-1 bg-black/30 backdrop-blur-[1px]"
                  onClick={() => setRightDrawerOpen(false)}
                />
                <div className="relative w-[90%] max-w-[368px] h-full bg-white shadow-2xl">
                  <RosterAndTasksPane
                    board={currentBoard}
                    agents={agents}
                    snapshots={snapshots}
                    initialTab={rightDrawerTab}
                    availableEngines={overview?.engines}
                    modelsByEngine={modelsByEngine}
                    liveLogsBySlot={liveLogsBySlot}
                    isLocalhost={isLocalhost}
                    onUpdateAgent={(s, p) => void handleUpdateAgent(s, p)}
                    onAddAgent={handleAddAgent}
                    onRemoveAgent={handleRemoveAgent}
                    onOpenDispatchSettings={() => setDispatchModalOpen(true)}
                    onSelectTargetSlot={(s) => {
                      setSelectedTargetSlot(s);
                      setRightDrawerOpen(false);
                    }}
                    onCreateCheckpoint={handleCreateCheckpoint}
                    onOpenSnapshotDiff={(sid) => {
                      setDiffPendingConflicts(null);
                      setDiffSnapshotId(sid);
                    }}
                    onRevertSnapshot={async (sid) => {
                      await handleRevertSnapshot(sid);
                    }}
                    onPreviewFile={(rel) => {
                      setRightDrawerOpen(false);
                      setPreviewFilePath(rel);
                    }}
                    onCloseDrawer={() => setRightDrawerOpen(false)}
                  />
                </div>
              </div>
            )}

            {/* Mobile Tasks Bottom Sheet */}
            {mobileTasksSheetOpen && (
              <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
                <div
                  className="flex-1 bg-black/30 backdrop-blur-[1px]"
                  onClick={() => setMobileTasksSheetOpen(false)}
                />
                <div className="rounded-t-3xl bg-white shadow-2xl overflow-hidden max-h-[70vh] flex flex-col">
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#F1F1F5]">
                    <span className="text-[15px] font-bold text-[#1F2024]">任务分工进度</span>
                    <button
                      type="button"
                      onClick={() => setMobileTasksSheetOpen(false)}
                      aria-label="关闭任务进度"
                      className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7]"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto [&>div]:h-auto [&>div]:max-h-none [&>div]:border-t-0">
                    <LeftTasksPanel
                      tasks={tasks}
                      agents={agents}
                      onAddTask={handleAddTask}
                      onToggleTask={handleToggleTask}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[15px] text-[#8A8D98]">
            加载看板中...
          </div>
        )}
      </div>

      {/* Modals */}
      <MobileConnectModal
        open={mobileModalOpen}
        onClose={() => setMobileModalOpen(false)}
        endpoints={overview?.endpoints ?? []}
        canManageSecurity={isLocalhost}
      />

      <NewBoardModal
        open={newBoardModalOpen}
        presets={overview?.presets ?? []}
        availableEngines={overview?.engines}
        modelsByEngine={modelsByEngine}
        recentWorkspaces={recentWorkspaces}
        defaultPresetId={modalPresetId}
        onClose={() => setNewBoardModalOpen(false)}
        onOpenDispatchSettings={() => setDispatchModalOpen(true)}
        onOpenDesktopMcpModal={() => setDesktopMcpModalOpen(true)}
        onCreate={handleCreateBoard}
      />

      <DesktopMcpModal
        open={desktopMcpModalOpen}
        isLocalhost={isLocalhost}
        onClose={() => setDesktopMcpModalOpen(false)}
      />

      <GlobalDispatchModal
        open={dispatchModalOpen}
        initialPrompt={overview?.orchestrationPreferences?.globalDispatchPrompt || ''}
        onClose={() => setDispatchModalOpen(false)}
        onSaved={() => void fetchWorkbench(false)}
      />

      <DiffCompareModal
        snapshotId={diffSnapshotId}
        pendingConflicts={diffPendingConflicts}
        onClose={() => {
          setDiffSnapshotId(null);
          setDiffPendingConflicts(null);
        }}
        onAdopt={handleAdoptSnapshot}
        onRevert={handleRevertSnapshot}
      />

      <FilePreviewModal
        boardId={currentBoard?.id ?? null}
        filePath={previewFilePath}
        onClose={() => setPreviewFilePath(null)}
        onNavigateFile={(next) => setPreviewFilePath(next)}
      />

      {confirmDeleteBoard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
          onClick={() => setConfirmDeleteBoard(null)}
        >
          <div
            className="w-full max-w-[380px] rounded-3xl border border-[#EAEAEF] bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[#FAEDEC] text-[#B0615A]">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15.5px] font-bold text-[#1F2024]">确认删除此会话？</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6E717C]">
                  即将从协同看板列表中移除「{confirmDeleteBoard.title}」的对话记录与任务清单。你本地文件夹中的代码与文件不会被删除。
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteBoard(null)}
                className="rounded-xl border border-[#E6E6EE] bg-white px-3.5 py-2 text-[13px] font-medium text-[#5A5D68] hover:bg-[#F5F5F9] transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void executeDeleteBoard()}
                className="rounded-xl bg-[#B0615A] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#9C524B] transition cursor-pointer"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
