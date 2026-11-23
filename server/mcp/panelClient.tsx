import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import {
  BookmarkPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crown,
  ExternalLink,
  FileCode2,
  History,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { z } from 'zod/v4';
import type { AppThemeId, EngineId, ModelOption } from '../../src/types.js';
import {
  FALLBACK_MODELS_BY_ENGINE,
  formatModelLabel,
  formatRelativeTime,
  getEffortsForModel,
  getModelsForEngine,
} from '../../src/utils/format.js';

declare const __COWORK_ICON_DATA_MAP__: Record<string, string>;

const ICON_MAP: Record<string, string> =
  typeof __COWORK_ICON_DATA_MAP__ !== 'undefined' ? __COWORK_ICON_DATA_MAP__ : {};

interface PanelAgent {
  slotId: string;
  displayName: string;
  roleTitle: string;
  roleAutoAssigned?: boolean;
  isLeader: boolean;
  engine: EngineId;
  modelId: string;
  reasoningEffort?: string;
  state: string;
  currentActivity: string;
  turnCount: number;
}

interface PanelTask {
  id: string;
  title: string;
  status: string;
  assigneeSlotId: string;
}

interface PanelSnapshot {
  id: string;
  label: string;
  authorName: string;
  kind: string;
  status: string;
  fileCount: number;
  createdAt?: number;
  filesChanged: Array<{ path: string; status: string }>;
}

interface PanelPost {
  id: string;
  seqId: number;
  authorType: 'human' | 'agent' | 'system';
  authorSlotId: string;
  authorName: string;
  authorEngine?: EngineId;
  kind: string;
  title: string;
  content: string;
  mentions: string[];
  meta?: {
    modelId?: string;
    reasoningEffort?: string;
    hostDelivery?: string;
    snapshotId?: string;
    changeStatus?: 'pending' | 'adopted' | 'reverted';
    filesChanged?: string[];
    staffingTable?: Array<{
      slotId: string;
      name: string;
      role: string;
      engine: EngineId;
    }>;
  };
  createdAt: number;
}

interface PanelBoardSummary {
  id: string;
  title: string;
  leaderMode: string;
  hostWaiting: boolean;
  hostPanelBridgeActive?: boolean;
  turnCount: number;
}

interface PanelStatePayload {
  webUrl: string;
  uiTheme?: AppThemeId;
  boards: PanelBoardSummary[];
  modelsByEngine?: Record<string, ModelOption[]>;
  board: {
    id: string;
    title: string;
    goal: string;
    projectName?: string;
    workspacePath: string;
    leaderMode: string;
    hostClient: string;
    hostWaiting: boolean;
    hostLastReadSeqId: number;
    hostHookPendingSeqId?: number;
    hostLastSettlementReason?: string;
    hostCliFallback: boolean;
    hostAutoStandby?: boolean;
    hostPanelBridgeActive?: boolean;
    turnCount: number;
  } | null;
  agents: PanelAgent[];
  tasks: PanelTask[];
  snapshots: PanelSnapshot[];
  posts: PanelPost[];
}

const ToggleAuxPaneResultSchema = z.object({ isError: z.boolean().optional() }).passthrough();

const app = new App({ name: 'AgentSwarm Panel', version: '1.4.0' }, {});

const PANEL_THEME_OPTIONS: Array<{ id: AppThemeId; label: string; dot: string }> = [
  { id: 'purple', label: '薰衣草紫', dot: '#7768A6' },
  { id: 'blue', label: '雾霭蓝', dot: '#4F7CAC' },
  { id: 'green', label: '鼠尾草绿', dot: '#4D8B74' },
  { id: 'pink', label: '樱花粉', dot: '#B06986' },
];

function applyPanelAccent(theme?: AppThemeId) {
  const root = document.documentElement;
  if (!theme || theme === 'purple') {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = theme;
  }
}

const PanelBrandLogo: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 36 36" fill="none" className="cw-app-logo">
    <rect width="36" height="36" rx="10" fill="var(--cw-accent-soft)" />
    <circle cx="18" cy="11.5" r="3.5" fill="var(--cw-human-bg)" />
    <circle cx="11" cy="23.5" r="3.2" fill="var(--cw-accent)" />
    <circle cx="25" cy="23.5" r="3.2" fill="#689F84" />
    <path
      d="M16.2 14.5L12.6 20.6M19.8 14.5L23.4 20.6M14.3 23.5H21.7"
      stroke="var(--cw-accent)"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

function toFileUri(workspacePath: string, relPath: string): string {
  const cleanRel = relPath.replace(/^[/\\]+/, '');
  const joined = `${workspacePath.replace(/[/\\]+$/, '')}/${cleanRel}`.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(joined)) {
    return `file:///${encodeURI(joined)}`;
  }
  return `file://${encodeURI(joined.startsWith('/') ? joined : `/${joined}`)}`;
}

function formatClockTime(ts: number | null): string {
  if (!ts) return '尚未同步';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

const PanelEngineIcon: React.FC<{ engine?: EngineId | string; size?: number }> = ({
  engine,
  size = 18,
}) => {
  const key = engine && ICON_MAP[engine] ? engine : 'app-logo';
  const src = ICON_MAP[key] || '';
  if (!src) return null;
  return (
    <img
      src={src}
      alt={String(engine || 'Agent')}
      width={size}
      height={size}
      className="cw-engine-icon"
      style={{ width: size, height: size }}
    />
  );
};

interface PanelSelectOption {
  value: string;
  label: string;
  badge?: string;
}

const PanelSelectMenu: React.FC<{
  value: string;
  options: PanelSelectOption[];
  align?: 'left' | 'right';
  ariaLabel?: string;
  className?: string;
  onChange: (val: string) => void;
}> = ({ value, options, align = 'left', ariaLabel, className = '', onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const active = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={rootRef} className={`cw-select-wrap ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={`cw-select-trigger ${open ? 'is-open' : ''}`}
      >
        <span className="cw-select-label">{active?.label || value}</span>
        <ChevronDown size={13} className={`cw-select-caret ${open ? 'is-open' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`cw-select-menu ${align === 'right' ? 'is-right' : 'is-left'}`}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`cw-select-opt ${selected ? 'is-selected' : ''}`}
              >
                <span className="cw-truncate">{opt.label}</span>
                <span className="cw-select-opt-right">
                  {opt.badge && <span className="cw-opt-badge">{opt.badge}</span>}
                  {selected && <Check size={13} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const PanelMessageText: React.FC<{ content: string; variant: 'human' | 'agent' }> = ({
  content,
  variant,
}) => {
  // Lightweight safe formatting for headings, bullets, inline code, bold, and @mentions
  const lines = String(content || '').split(/\r?\n/);

  const renderInline = (line: string, lineKey: string) => {
    const tokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*|(?:^|\s)@[a-zA-Z0-9_-]+)/g);
    return tokens.map((tok, i) => {
      if (!tok) return null;
      if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
        return (
          <code key={`${lineKey}-${i}`} className={`cw-inline-code ${variant}`}>
            {tok.slice(1, -1)}
          </code>
        );
      }
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
        return <strong key={`${lineKey}-${i}`}>{tok.slice(2, -2)}</strong>;
      }
      const mMatch = tok.match(/^(\s*)(@[a-zA-Z0-9_-]+)$/);
      if (mMatch) {
        return (
          <React.Fragment key={`${lineKey}-${i}`}>
            {mMatch[1]}
            <span className={`cw-mention ${variant}`}>{mMatch[2]}</span>
          </React.Fragment>
        );
      }
      return <React.Fragment key={`${lineKey}-${i}`}>{tok}</React.Fragment>;
    });
  };

  return (
    <div className="cw-md">
      {lines.map((raw, idx) => {
        const trimmed = raw.trim();
        if (!trimmed) return <div key={idx} className="cw-md-spacer" />;
        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <div key={idx} className="cw-md-li">
              <span className="cw-md-dot">•</span>
              <span>{renderInline(trimmed.replace(/^[-*]\s+/, ''), `l${idx}`)}</span>
            </div>
          );
        }
        return (
          <div key={idx} className="cw-md-p">
            {renderInline(raw, `p${idx}`)}
          </div>
        );
      })}
    </div>
  );
};

const PanelApp: React.FC = () => {
  const [state, setState] = useState<PanelStatePayload | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'team' | 'backups'>('chat');
  const [composerMode, setComposerMode] = useState<'host' | 'board'>('host');
  const [boardTargetSlot, setBoardTargetSlot] = useState('lead');
  const [draft, setDraft] = useState('');
  const [autoForward, setAutoForward] = useState(true);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [statusBanner, setStatusBanner] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshInFlight, setRefreshInFlight] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hostCaps, setHostCaps] = useState<{ message?: unknown; openLinks?: unknown }>({});

  const selectedBoardIdRef = useRef('');
  const autoForwardRef = useRef(true);
  const canMessageRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const forwardInFlightRef = useRef(false);
  const pendingSwitchRef = useRef<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedBoardIdRef.current = selectedBoardId;
  }, [selectedBoardId]);

  useEffect(() => {
    autoForwardRef.current = autoForward;
  }, [autoForward]);

  const canMessage = Boolean(hostCaps.message);
  const canOpenLink = Boolean(hostCaps.openLinks);

  useEffect(() => {
    canMessageRef.current = canMessage;
    if (!canMessage) {
      setComposerMode('board');
    }
  }, [canMessage]);

  const showNotice = useCallback((msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => {
      setStatusBanner((cur) => (cur === msg ? '' : cur));
    }, 3600);
  }, []);

  const maybeAutoForwardUnread = useCallback(
    async (nextState: PanelStatePayload) => {
      const board = nextState.board;
      if (!board || board.leaderMode !== 'mcp_host') return;
      if (!canMessageRef.current || !autoForwardRef.current) return;
      if (board.hostWaiting || board.hostCliFallback) return;
      if (forwardInFlightRef.current) return;

      const leaderSlotId =
        nextState.agents.find((a) => a.isLeader)?.slotId || nextState.agents[0]?.slotId || 'lead';
      const hasQueueCandidate = nextState.posts.some(
        (p) =>
          p.authorType === 'human' &&
          p.seqId > board.hostLastReadSeqId &&
          (!p.meta?.hostDelivery || p.meta.hostDelivery === 'queued_for_host') &&
          (!p.mentions || p.mentions.length === 0 || p.mentions.includes(leaderSlotId))
      );
      if (!hasQueueCandidate) return;

      forwardInFlightRef.current = true;
      try {
        const claimRes = await app.callServerTool({
          name: 'cowork_app_action',
          arguments: {
            boardId: board.id,
            action: 'claim_forward_inbox',
          },
        });
        const claimPayload = (
          claimRes.structuredContent as {
            claimResult?: { claimed?: boolean; deliveryId?: string; promptText?: string };
          } | null
        )?.claimResult;

        if (!claimPayload?.claimed || !claimPayload.deliveryId || !claimPayload.promptText) {
          return;
        }

        let sentOk = false;
        try {
          const sendRes = await app.sendMessage({
            role: 'user',
            content: [{ type: 'text', text: claimPayload.promptText }],
          });
          sentOk = !sendRes.isError;
        } catch {
          sentOk = false;
        }

        const confirmRes = await app.callServerTool({
          name: 'cowork_app_action',
          arguments: {
            boardId: board.id,
            action: 'confirm_forward_inbox',
            deliveryId: claimPayload.deliveryId,
            ok: sentOk,
            bridgeActive: true,
          },
        });

        if (!confirmRes.isError && confirmRes.structuredContent) {
          setState(confirmRes.structuredContent as unknown as PanelStatePayload);
          setLastUpdatedAt(Date.now());
        }
        if (sentOk) {
          showNotice('已将网页/手机新留言自动发入左侧对话');
        }
      } catch {
        // Silent; will safely retry or stay queued for Hook/CLI fallback
      } finally {
        forwardInFlightRef.current = false;
      }
    },
    [showNotice]
  );

  const refreshState = useCallback(
    async (boardIdOverride?: string, bridgeOverride?: boolean) => {
      if (refreshInFlightRef.current) {
        if (boardIdOverride !== undefined) {
          pendingSwitchRef.current = boardIdOverride;
        }
        return;
      }

      refreshInFlightRef.current = true;
      setRefreshInFlight(true);
      const targetBoard = boardIdOverride ?? selectedBoardIdRef.current;
      const bridgeFlag =
        bridgeOverride !== undefined
          ? bridgeOverride
          : canMessageRef.current && autoForwardRef.current;

      try {
        const res = await app.callServerTool({
          name: 'cowork_app_poll_state',
          arguments: {
            boardId: targetBoard || undefined,
            bridgeActive: bridgeFlag,
          },
        });
        if (res.isError) {
          const errText =
            res.content?.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ||
            '看板状态读取失败';
          setLastError(errText);
        } else if (res.structuredContent) {
          const next = res.structuredContent as unknown as PanelStatePayload;
          setState(next);
          applyPanelAccent(next.uiTheme);
          if (next.board?.id) {
            selectedBoardIdRef.current = next.board.id;
            setSelectedBoardId(next.board.id);
          }
          setLastUpdatedAt(Date.now());
          setLastError(null);
          void maybeAutoForwardUnread(next);
        }
      } catch (err) {
        setLastError(`连接后台服务失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        refreshInFlightRef.current = false;
        setRefreshInFlight(false);
        if (pendingSwitchRef.current !== null) {
          const nextId = pendingSwitchRef.current;
          pendingSwitchRef.current = null;
          void refreshState(nextId);
        }
      }
    },
    [maybeAutoForwardUnread]
  );

  useEffect(() => {
    app.ontoolinput = () => {
      // Wait for result; initial render already shows connecting skeleton
    };
    app.ontoolresult = (result) => {
      if (result.structuredContent) {
        const next = result.structuredContent as unknown as PanelStatePayload;
        setState(next);
        applyPanelAccent(next.uiTheme);
        if (next.board?.id) {
          selectedBoardIdRef.current = next.board.id;
          setSelectedBoardId(next.board.id);
        }
        setLastUpdatedAt(Date.now());
        setLastError(null);
        void maybeAutoForwardUnread(next);
      }
    };
    app.onhostcontextchanged = (ctx) => {
      if (ctx.theme) applyDocumentTheme(ctx.theme);
      if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    };
    app.ontoolcancelled = () => {
      showNotice('操作已取消');
    };

    void (async () => {
      await app.connect();
      setConnected(true);
      const caps = app.getHostCapabilities();
      setHostCaps({ message: caps?.message, openLinks: caps?.openLinks });
      canMessageRef.current = Boolean(caps?.message);
      const ctx = app.getHostContext();
      if (ctx?.theme) applyDocumentTheme(ctx.theme);
      if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
      await refreshState();
    })();

    const timer = setInterval(() => {
      if (!document.hidden && !refreshInFlightRef.current) {
        void refreshState();
      }
    }, 2600);

    return () => clearInterval(timer);
  }, [maybeAutoForwardUnread, refreshState, showNotice]);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state?.posts.length, activeTab]);

  const runAction = async (args: Record<string, unknown>, okNotice?: string) => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      const res = await app.callServerTool({
        name: 'cowork_app_action',
        arguments: {
          ...args,
          bridgeActive: canMessage && autoForward,
        },
      });
      if (res.isError) {
        const errText =
          res.content?.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ||
          '操作失败';
        showNotice(errText);
      } else if (res.structuredContent) {
        const next = res.structuredContent as unknown as PanelStatePayload;
        setState(next);
        applyPanelAccent(next.uiTheme);
        setLastUpdatedAt(Date.now());
        setLastError(null);
        if (okNotice) showNotice(okNotice);
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleOpenFileInAuxPane = async (relPath: string) => {
    if (!state?.board?.workspacePath) return;
    const uri = toFileUri(state.board.workspacePath, relPath);
    try {
      await (
        app as unknown as { request: (req: unknown, schema: unknown) => Promise<unknown> }
      ).request(
        {
          method: 'com.google.antigravity/toggle-aux-pane',
          params: { tabType: 'fileView', uri },
        },
        ToggleAuxPaneResultSchema
      );
    } catch {
      showNotice(`工作区文件：${relPath}`);
    }
  };

  const handleSend = async (textOverride?: string) => {
    const clean = (textOverride ?? draft).trim();
    if (!clean) return;
    if (!textOverride) setDraft('');

    if (composerMode === 'host' && canMessage) {
      setBusyAction(true);
      try {
        const res = await app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text: clean }],
        });
        if (res.isError) {
          showNotice('宿主拒绝了消息注入');
          if (!textOverride) setDraft(clean);
        } else {
          showNotice('已发送至左侧 Antigravity 对话');
        }
      } catch (err) {
        showNotice(`发送失败：${err instanceof Error ? err.message : String(err)}`);
        if (!textOverride) setDraft(clean);
      } finally {
        setBusyAction(false);
      }
      return;
    }

    if (!state?.board) return;
    await runAction(
      {
        boardId: state.board.id,
        action: 'send_human_message',
        content: clean,
        assigneeSlotId: boardTargetSlot,
      },
      '已发送到协同看板群聊'
    );
  };

  const modelsByEngine = useMemo(
    () => ({ ...FALLBACK_MODELS_BY_ENGINE, ...(state?.modelsByEngine || {}) }),
    [state?.modelsByEngine]
  );
  const allModelsFlat = useMemo(() => Object.values(modelsByEngine).flat(), [modelsByEngine]);

  const board = state?.board ?? null;
  const boards = state?.boards ?? [];
  const agents = state?.agents ?? [];
  const tasks = state?.tasks ?? [];
  const snapshots = state?.snapshots ?? [];
  const posts = state?.posts ?? [];

  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const progressPct = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const pendingSnaps = snapshots.filter((s) => s.status === 'pending');
  const anyWorking = agents.some((a) => a.state === 'working');
  const leaderSlotId = agents.find((a) => a.isLeader)?.slotId || agents[0]?.slotId || 'lead';
  const hasUnreadHuman = Boolean(
    board &&
      board.leaderMode === 'mcp_host' &&
      !board.hostWaiting &&
      posts.some(
        (p) =>
          p.authorType === 'human' &&
          p.seqId > board.hostLastReadSeqId &&
          p.meta?.hostDelivery !== 'cli_fallback' &&
          (!p.mentions || p.mentions.length === 0 || p.mentions.includes(leaderSlotId))
      )
  );

  const statusPill = useMemo(() => {
    if (!board) return null;
    if (board.leaderMode !== 'mcp_host') {
      return { text: '网页直驱', cls: 'cw-badge-neutral', dot: 'cw-dot-green' };
    }
    if (board.hostWaiting) {
      return { text: '桌面端等待中', cls: 'cw-badge-green', dot: 'cw-dot-pulse' };
    }
    if (anyWorking) {
      return {
        text:
          board.hostLastSettlementReason === 'human_interjection'
            ? '插话已回传 · 队员运行中'
            : '队员运行中',
        cls: 'cw-badge-green',
        dot: 'cw-dot-pulse',
      };
    }
    if (canMessage && autoForward) {
      return { text: '侧栏直通开启', cls: 'cw-badge-green', dot: 'cw-dot-green' };
    }
    if ((board.hostHookPendingSeqId ?? 0) > board.hostLastReadSeqId) {
      return { text: '已带入待响应', cls: 'cw-badge-purple', dot: 'cw-dot-purple' };
    }
    if (hasUnreadHuman) {
      return { text: '留言待同步', cls: 'cw-badge-purple', dot: 'cw-dot-purple' };
    }
    return { text: '桌面端待命', cls: 'cw-badge-neutral', dot: 'cw-dot-muted' };
  }, [board, anyWorking, canMessage, autoForward, hasUnreadHuman]);

  if (!state) {
    return (
      <div className="cw-shell">
        {lastError ? (
          <div className="cw-error-box">
            <span>{lastError}</span>
            <button type="button" className="cw-btn cw-btn-ghost" onClick={() => void refreshState()}>
              立即重试
            </button>
          </div>
        ) : (
          <div className="cw-empty-card">
            <Loader2 size={18} className="cw-spin" />
            <span>{connected ? '正在读取协同看板...' : '正在连接 AgentSwarm...'}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cw-shell">
      {/* Top Brand Header */}
      <header className="cw-header">
        <div className="cw-brand-row">
          <div className="cw-brand-left">
            <PanelBrandLogo />
            <span className="cw-brand-title">AgentSwarm 协同看板</span>
            {statusPill && (
              <span className={`cw-badge ${statusPill.cls}`}>
                <span className={`cw-dot ${statusPill.dot}`} />
                <span>{statusPill.text}</span>
              </span>
            )}
          </div>

          <div className="cw-header-actions">
            {board && (
              <div className="cw-theme-dots" role="group" aria-label="界面主题色">
                {PANEL_THEME_OPTIONS.map((t) => {
                  const active = (state.uiTheme || 'purple') === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      title={`主题：${t.label}`}
                      aria-label={`切换到${t.label}主题`}
                      onClick={() => {
                        applyPanelAccent(t.id);
                        void runAction({
                          boardId: board.id,
                          action: 'set_theme',
                          uiTheme: t.id,
                        });
                      }}
                      className={`cw-theme-dot ${active ? 'is-active' : ''}`}
                      style={{ backgroundColor: t.dot }}
                    />
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() => void refreshState()}
              disabled={refreshInFlight}
              title={`刷新（上次更新 ${formatClockTime(lastUpdatedAt)}）`}
              className="cw-icon-btn"
            >
              <RefreshCw size={14} className={refreshInFlight ? 'cw-spin' : ''} />
            </button>
            {canOpenLink && state.webUrl && (
              <button
                type="button"
                onClick={() => void app.openLink({ url: state.webUrl })}
                className="cw-btn cw-btn-ghost"
              >
                <ExternalLink size={12} />
                <span>网页看板</span>
              </button>
            )}
          </div>
        </div>

        {/* Board Selector & Controls */}
        <div className="cw-toolbar">
          {boards.length > 0 && (
            <PanelSelectMenu
              className="cw-board-select"
              ariaLabel="切换协同看板"
              value={board?.id || boards[0].id}
              options={boards.map((b) => ({
                value: b.id,
                label: b.title,
                badge: b.leaderMode === 'mcp_host' ? '桌面端' : '网页',
              }))}
              onChange={(nextId) => {
                selectedBoardIdRef.current = nextId;
                setSelectedBoardId(nextId);
                void refreshState(nextId);
              }}
            />
          )}

          {board?.leaderMode === 'mcp_host' && (
            <div className="cw-toggles-row">
              {canMessage && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !autoForward;
                    setAutoForward(next);
                    autoForwardRef.current = next;
                    void refreshState(undefined, next);
                    showNotice(
                      next
                        ? '已开启：网页/手机新留言将自动发入左侧 Antigravity 对话'
                        : '已暂停自动转入（仍保留 Hook 与 CLI 代答）'
                    );
                  }}
                  title="开启后，在网页或手机给主管发的留言会在闲置时自动发入左侧对话"
                  className={`cw-pill-toggle ${autoForward ? 'is-green' : ''}`}
                >
                  <Zap size={12} />
                  <span>{autoForward ? '自动唤醒左侧:开' : '自动唤醒左侧:关'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  void runAction(
                    {
                      boardId: board.id,
                      action: 'toggle_auto_standby',
                      hostAutoStandby: board.hostAutoStandby === false,
                    },
                    board.hostAutoStandby === false
                      ? '已开启自动挂起监听'
                      : '已关闭自动挂起监听'
                  )
                }
                title="开启后，CodeX / Claude Code 等客户端在汇报后自动进入 0 消耗待命监听"
                className={`cw-pill-toggle ${board.hostAutoStandby !== false ? 'is-green' : ''}`}
              >
                <span>{board.hostAutoStandby !== false ? '自动监听:开' : '自动监听:关'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void runAction(
                    {
                      boardId: board.id,
                      action: 'toggle_cli_fallback',
                      hostCliFallback: !board.hostCliFallback,
                    },
                    !board.hostCliFallback ? '已开启闲置时 CLI 主管代答' : '已关闭闲置时 CLI 主管代答'
                  )
                }
                className={`cw-pill-toggle ${board.hostCliFallback ? 'is-purple' : ''}`}
              >
                <span>{board.hostCliFallback ? 'CLI代答:开' : 'CLI代答:关'}</span>
              </button>
            </div>
          )}

          <span className="cw-sync-time">同步于 {formatClockTime(lastUpdatedAt)}</span>
        </div>

        {/* Segmented Navigation matching main app */}
        {board && (
          <nav className="cw-tabs" aria-label="看板子视图">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`cw-tab ${activeTab === 'chat' ? 'is-active' : ''}`}
            >
              <MessageSquare size={13} />
              <span>协同对话</span>
              <span className="cw-tab-count">{posts.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('team')}
              className={`cw-tab ${activeTab === 'team' ? 'is-active' : ''}`}
            >
              <Users size={13} />
              <span>成员与任务</span>
              <span className="cw-tab-count">
                {completedTasks}/{tasks.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('backups')}
              className={`cw-tab ${activeTab === 'backups' ? 'is-active' : ''}`}
            >
              <History size={13} />
              <span>改动备份</span>
              <span className="cw-tab-count">{pendingSnaps.length}</span>
            </button>
          </nav>
        )}
      </header>

      {lastError && (
        <div className="cw-error-box">
          <span>{lastError}</span>
          <button type="button" className="cw-btn cw-btn-ghost" onClick={() => void refreshState()}>
            重试
          </button>
        </div>
      )}

      {statusBanner && (
        <div className="cw-notice">
          <Check size={13} />
          <span>{statusBanner}</span>
        </div>
      )}

      {!board ? (
        <div className="cw-empty-card">
          暂无活跃看板，可在左侧对话对主管说“拉起协同看板团队”自动创建。
        </div>
      ) : activeTab === 'chat' ? (
        <div className="cw-main-col">
          {/* Group Chat Message Feed */}
          <div className="cw-feed">
            {posts.length === 0 ? (
              <div className="cw-empty-card">
                看板已就绪（共 {agents.length} 名成员），在左侧发起派工或直接留言即可看到协同进展。
              </div>
            ) : (
              posts.map((post) => {
                if (post.authorType === 'system') {
                  return (
                    <div key={post.id} className="cw-system-pill">
                      {post.title || post.content}
                    </div>
                  );
                }

                if (post.authorType === 'human') {
                  const dlv = post.meta?.hostDelivery;
                  const deliveryLabel =
                    dlv === 'cli_fallback'
                      ? '已交由后台 CLI 主管代答'
                      : dlv === 'delivered_to_wait'
                        ? '已回传桌面端主管'
                        : dlv === 'panel_forwarded'
                          ? '已自动发入桌面端对话'
                          : dlv === 'host_acked' || post.seqId <= board.hostLastReadSeqId
                            ? '已同步至桌面端主管'
                            : dlv === 'hook_injected' ||
                                post.seqId <= (board.hostHookPendingSeqId ?? 0)
                              ? '已带入桌面端下次对话'
                              : '等待同步至桌面端';
                  return (
                    <div key={post.id} className="cw-msg-human-wrap">
                      <div className="cw-msg-human-meta">
                        <span>{formatRelativeTime(post.createdAt)}</span>
                        <strong>我</strong>
                      </div>
                      <div className="cw-msg-human-bubble">
                        <PanelMessageText content={post.content} variant="human" />
                      </div>
                      {board.leaderMode === 'mcp_host' && (
                        <div
                          className={`cw-delivery-note ${
                            dlv === 'panel_forwarded' ||
                            dlv === 'delivered_to_wait' ||
                            dlv === 'host_acked' ||
                            post.seqId <= board.hostLastReadSeqId
                              ? 'is-ok'
                              : ''
                          }`}
                        >
                          {deliveryLabel}
                        </div>
                      )}
                    </div>
                  );
                }

                const slot = agents.find((a) => a.slotId === post.authorSlotId);
                const eng = post.authorEngine || slot?.engine;
                const modLabel = formatModelLabel(
                  post.meta?.modelId || slot?.modelId,
                  allModelsFlat
                );
                const effLabel = post.meta?.reasoningEffort || slot?.reasoningEffort || 'high';
                const filesChanged = post.meta?.filesChanged || [];
                const linkedSnap = post.meta?.snapshotId
                  ? snapshots.find((s) => s.id === post.meta?.snapshotId)
                  : undefined;

                return (
                  <div key={post.id} className="cw-msg-agent-row">
                    <div className="cw-avatar">
                      <PanelEngineIcon engine={eng} size={18} />
                    </div>
                    <div className="cw-msg-agent-col">
                      <div className="cw-msg-agent-meta">
                        <strong>{post.authorName}</strong>
                        {modLabel && (
                          <span className="cw-model-badge">
                            {modLabel} · {effLabel}
                          </span>
                        )}
                        <span className="cw-time">{formatRelativeTime(post.createdAt)}</span>
                      </div>
                      <div className="cw-agent-card">
                        {post.title && <div className="cw-card-heading">{post.title}</div>}
                        <PanelMessageText content={post.content} variant="agent" />

                        {post.meta?.staffingTable && post.meta.staffingTable.length > 0 && (
                          <div className="cw-staff-box">
                            <div className="cw-staff-title">团队分工安排</div>
                            {post.meta.staffingTable.map((st) => (
                              <div key={st.slotId} className="cw-staff-row">
                                <PanelEngineIcon engine={st.engine} size={13} />
                                <strong>{st.name}</strong>
                                <span className="cw-muted">{st.role}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {filesChanged.length > 0 && (
                          <div className="cw-files-row">
                            {filesChanged.slice(0, 6).map((fp) => (
                              <button
                                key={fp}
                                type="button"
                                onClick={() => void handleOpenFileInAuxPane(fp)}
                                className="cw-file-chip"
                              >
                                <FileCode2 size={11} />
                                <span>{fp}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {linkedSnap && (
                          <div className="cw-snap-inline">
                            <span
                              className={`cw-snap-state ${
                                linkedSnap.status === 'adopted'
                                  ? 'is-adopted'
                                  : linkedSnap.status === 'reverted'
                                    ? 'is-reverted'
                                    : ''
                              }`}
                            >
                              {linkedSnap.status === 'adopted'
                                ? '已采纳保留'
                                : linkedSnap.status === 'reverted'
                                  ? '已撤回原状'
                                  : `备份待确认 (${linkedSnap.fileCount} 文件)`}
                            </span>
                            {linkedSnap.status === 'pending' && (
                              <div className="cw-snap-btns">
                                <button
                                  type="button"
                                  disabled={busyAction}
                                  onClick={() =>
                                    void runAction(
                                      {
                                        boardId: board.id,
                                        action: 'revert_snapshot',
                                        snapshotId: linkedSnap.id,
                                      },
                                      '已撤回并恢复原文件'
                                    )
                                  }
                                  className="cw-mini-btn"
                                >
                                  撤回
                                </button>
                                <button
                                  type="button"
                                  disabled={busyAction}
                                  onClick={() =>
                                    void runAction(
                                      {
                                        boardId: board.id,
                                        action: 'adopt_snapshot',
                                        snapshotId: linkedSnap.id,
                                      },
                                      '已采纳保留该次改动'
                                    )
                                  }
                                  className="cw-mini-btn is-primary"
                                >
                                  采纳
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Bottom Unified Composer */}
          <div className="cw-composer">
            <div className="cw-composer-top">
              {canMessage ? (
                <div className="cw-mode-pills">
                  <button
                    type="button"
                    onClick={() => setComposerMode('host')}
                    className={`cw-mode-btn ${composerMode === 'host' ? 'is-active' : ''}`}
                  >
                    <Sparkles size={11} />
                    <span>通知左侧桌面主管</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerMode('board')}
                    className={`cw-mode-btn ${composerMode === 'board' ? 'is-active' : ''}`}
                  >
                    <MessageSquare size={11} />
                    <span>发到看板</span>
                  </button>
                </div>
              ) : (
                <span className="cw-muted">发送留言到协同看板</span>
              )}

              {composerMode === 'board' && agents.length > 0 && (
                <PanelSelectMenu
                  align="right"
                  className="cw-target-select"
                  ariaLabel="选择接收成员"
                  value={boardTargetSlot}
                  options={agents.map((a) => ({ value: a.slotId, label: `@${a.displayName}` }))}
                  onChange={setBoardTargetSlot}
                />
              )}
            </div>

            {canMessage && composerMode === 'host' && (
              <div className="cw-quick-row">
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() =>
                    void handleSend('请汇总当前协同看板最新波次结果与改动文件，并继续下一步。')
                  }
                  className="cw-quick-pill"
                >
                  汇总最新进展
                </button>
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() =>
                    void handleSend('请审阅协同看板中最新的文件快照并给出验收结论。')
                  }
                  className="cw-quick-pill"
                >
                  审阅文件改动
                </button>
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() =>
                    void handleSend(
                      '请调用 cowork_wait_board 保持监听协同看板动态（零消耗等待网页/手机新指示）。'
                    )
                  }
                  className="cw-quick-pill"
                >
                  进入零消耗监听
                </button>
              </div>
            )}

            <div className="cw-input-row">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  composerMode === 'host' && canMessage
                    ? '向左侧 Antigravity 主管发指示（回车发送）...'
                    : '在看板群聊留言（回车发送）...'
                }
              />
              <button
                type="button"
                disabled={busyAction || !draft.trim()}
                onClick={() => void handleSend()}
                className="cw-send-btn"
              >
                <Send size={13} />
                <span>发送</span>
              </button>
            </div>
          </div>
        </div>
      ) : activeTab === 'team' ? (
        <div className="cw-scroll-col">
          {/* Task Checklist Card */}
          <section className="cw-card">
            <div className="cw-card-head">
              <div className="cw-card-title-group">
                <span className="cw-card-title">任务分工进度</span>
                <span className="cw-count-pill">
                  {completedTasks}/{tasks.length} · {progressPct}%
                </span>
              </div>
              <button
                type="button"
                onClick={() => setNewTaskOpen((v) => !v)}
                className="cw-link-btn"
              >
                <Plus size={13} /> 添加
              </button>
            </div>

            <div className="cw-progress-track">
              <div className="cw-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>

            {newTaskOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTaskTitle.trim()) return;
                  const t = newTaskTitle.trim();
                  setNewTaskTitle('');
                  setNewTaskOpen(false);
                  void runAction(
                    {
                      boardId: board.id,
                      action: 'add_task',
                      title: t,
                      assigneeSlotId: leaderSlotId,
                    },
                    '已添加待办任务'
                  );
                }}
                className="cw-inline-form"
              >
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="输入待办任务名称..."
                />
                <button type="submit" className="cw-btn cw-btn-primary">
                  确定
                </button>
              </form>
            )}

            <div className="cw-task-list">
              {tasks.length === 0 ? (
                <div className="cw-muted-center">暂无拆解任务</div>
              ) : (
                tasks.map((t) => {
                  const done = t.status === 'completed';
                  const running = t.status === 'in_progress';
                  const assignee = agents.find((a) => a.slotId === t.assigneeSlotId);
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() =>
                        void runAction({
                          boardId: board.id,
                          action: 'toggle_task',
                          taskId: t.id,
                          nextStatus: done ? 'in_progress' : 'completed',
                        })
                      }
                      className="cw-task-item"
                    >
                      <span className="cw-task-icon">
                        {done ? (
                          <CheckCircle2 size={16} color="#5BA97B" />
                        ) : running ? (
                          <Loader2 size={16} className="cw-spin" color="#7B6BA8" />
                        ) : (
                          <Clock size={16} color="#B0B3BE" />
                        )}
                      </span>
                      <span className={`cw-task-title ${done ? 'is-done' : ''}`}>{t.title}</span>
                      <span className="cw-task-who">
                        {assignee && <PanelEngineIcon engine={assignee.engine} size={13} />}
                        <span>{assignee?.displayName || t.assigneeSlotId}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Team Roster with Inline Model & Reasoning Effort Selectors */}
          <section className="cw-card">
            <div className="cw-card-head">
              <span className="cw-card-title">团队与模型 ({agents.length})</span>
              <span className="cw-muted">可就地切换模型与思考档位</span>
            </div>
            <div className="cw-roster-list">
              {agents.map((ag) => {
                const engModels = getModelsForEngine(ag.engine, modelsByEngine);
                const effs = getEffortsForModel(ag.engine, ag.modelId, modelsByEngine);
                const curEff = ag.reasoningEffort || effs[0] || 'high';
                const working = ag.state === 'working';
                const blocked = ag.state === 'blocked';
                return (
                  <div key={ag.slotId} className={`cw-member-card ${working ? 'is-working' : ''}`}>
                    <div className="cw-member-top">
                      <div className="cw-member-id">
                        <div className="cw-avatar-sm">
                          <PanelEngineIcon engine={ag.engine} size={16} />
                        </div>
                        <div className="cw-member-names">
                          <div className="cw-member-title-line">
                            <strong>{ag.displayName}</strong>
                            {ag.isLeader && (
                              <span className="cw-leader-tag">
                                <Crown size={10} /> 主管
                              </span>
                            )}
                          </div>
                          <div className="cw-muted">{ag.roleTitle}</div>
                        </div>
                      </div>
                      <div className="cw-member-right">
                        <span
                          className={`cw-state-text ${
                            working ? 'is-working' : blocked ? 'is-err' : ''
                          }`}
                        >
                          {working ? '执行中' : blocked ? '异常' : '待命'}
                        </span>
                        <span className="cw-muted">· {ag.turnCount} 轮</span>
                      </div>
                    </div>

                    <div className="cw-member-controls">
                      <PanelSelectMenu
                        className="cw-flex-1"
                        ariaLabel={`${ag.displayName} 模型`}
                        value={ag.modelId}
                        options={engModels.map((m) => ({ value: m.id, label: m.label }))}
                        onChange={(nextModId) => {
                          const targetMod = engModels.find((x) => x.id === nextModId);
                          const nextValidEffs = targetMod?.efforts?.length
                            ? targetMod.efforts
                            : ['low', 'medium', 'high'];
                          const nextEff = nextValidEffs.includes(curEff)
                            ? curEff
                            : targetMod?.defaultEffort || nextValidEffs[0] || 'high';
                          void runAction(
                            {
                              boardId: board.id,
                              action: 'update_agent',
                              slotId: ag.slotId,
                              modelId: nextModId,
                              reasoningEffort: nextEff,
                            },
                            `已切换 ${ag.displayName} 模型`
                          );
                        }}
                      />
                      <PanelSelectMenu
                        align="right"
                        className="cw-effort-select"
                        ariaLabel={`${ag.displayName} 思考强度`}
                        value={curEff}
                        options={effs.map((ef) => ({ value: ef, label: ef }))}
                        onChange={(nextEff) =>
                          void runAction(
                            {
                              boardId: board.id,
                              action: 'update_agent',
                              slotId: ag.slotId,
                              reasoningEffort: nextEff,
                            },
                            `已更新 ${ag.displayName} 思考强度为 ${nextEff}`
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <div className="cw-scroll-col">
          {/* Snapshots / Backups Tab */}
          <div className="cw-backups-head">
            <span className="cw-card-title">文件改动与安全备份 ({snapshots.length})</span>
            <button
              type="button"
              disabled={busyAction}
              onClick={() =>
                void runAction(
                  { boardId: board.id, action: 'checkpoint', label: '侧边栏手动检查点' },
                  '已创建工作区安全检查点'
                )
              }
              className="cw-btn cw-btn-primary"
            >
              <BookmarkPlus size={13} />
              <span>创建检查点</span>
            </button>
          </div>

          {snapshots.length === 0 ? (
            <div className="cw-empty-card">尚无文件改动记录或自动备份。</div>
          ) : (
            snapshots.map((s) => (
              <div key={s.id} className="cw-card">
                <div className="cw-card-head">
                  <strong className="cw-snap-title">{s.label}</strong>
                  <span
                    className={`cw-snap-state ${
                      s.status === 'adopted'
                        ? 'is-adopted'
                        : s.status === 'reverted'
                          ? 'is-reverted'
                          : ''
                    }`}
                  >
                    {s.status === 'adopted'
                      ? '已采纳'
                      : s.status === 'reverted'
                        ? '已撤回'
                        : `${s.fileCount} 个文件`}
                  </span>
                </div>

                {s.filesChanged.length > 0 && (
                  <div className="cw-files-row">
                    {s.filesChanged.slice(0, 8).map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => void handleOpenFileInAuxPane(f.path)}
                        className="cw-file-chip"
                      >
                        <FileCode2 size={11} />
                        <span>
                          {f.status === 'added' ? '+' : f.status === 'deleted' ? '-' : ''} {f.path}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {s.status === 'pending' && (
                  <div className="cw-snap-btns-full">
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() =>
                        void runAction(
                          { boardId: board.id, action: 'revert_snapshot', snapshotId: s.id },
                          '已撤回并恢复原文件'
                        )
                      }
                      className="cw-btn cw-btn-ghost"
                    >
                      <RotateCcw size={12} /> 一键撤回
                    </button>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() =>
                        void runAction(
                          { boardId: board.id, action: 'adopt_snapshot', snapshotId: s.id },
                          '已采纳保留该次改动'
                        )
                      }
                      className="cw-btn cw-btn-primary"
                    >
                      <Check size={12} /> 采纳保留
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const rootEl = document.getElementById('app');
if (rootEl) {
  createRoot(rootEl).render(<PanelApp />);
}
