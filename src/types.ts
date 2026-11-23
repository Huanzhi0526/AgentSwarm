export type EngineId =
  | 'antigravity'
  | 'codex'
  | 'codebuddy'
  | 'claude'
  | 'gemini'
  | 'qwen'
  | 'opencode'
  | 'cursor'
  | 'copilot'
  | 'kimi'
  | 'auggie'
  | 'goose'
  | 'droid'
  | 'qoder'
  | 'vibe'
  | 'kiro'
  | 'hermes'
  | 'snow'
  | 'openclaw'
  | 'nanobot'
  | 'demo';

export type ReasoningEffort = string; // Native effort level per model, e.g. 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export type SessionSyncMode = 'leader_only' | 'all_persist' | 'board_isolated';

export type LeaderMode = 'cli' | 'mcp_host';

export type AppThemeId = 'purple' | 'blue' | 'green' | 'pink';

export type DesktopMcpClientId = 'antigravity' | 'codex' | 'codebuddy' | 'claude';

export interface DesktopMcpClientStatus {
  id: DesktopMcpClientId;
  name: string;
  engine: Exclude<EngineId, 'demo'>;
  installed: boolean;
  registered: boolean;
  hookRegistered?: boolean;
  supportsHook?: boolean;
  configPath: string;
  hookPath?: string;
  backupExists: boolean;
  hint: string;
  sessionBindingState?: 'waiting' | 'bound_idle' | 'unbound';
  sessionBindingLabel?: string;
  deliveryModeLabel?: string;
  unreadForClientCount?: number;
}

export interface McpClientDiagnosis {
  clientId: DesktopMcpClientId;
  name: string;
  configReady: boolean;
  toolsReady: boolean;
  hookReady: boolean | null;
  sessionState: 'waiting' | 'bound_idle' | 'unbound';
  sessionLabel: string;
  deliveryLabel: string;
  unreadCount: number;
  ok: boolean;
  actionHint: string;
}

export interface McpSelfTestResult {
  checkedAt: number;
  serverHealth: { ok: boolean; latencyMs: number };
  mcpStdio: {
    ok: boolean;
    latencyMs: number;
    toolsCount: number;
    hasPanelResource: boolean;
    error?: string;
  };
  hookProbe: {
    ok: boolean;
    latencyMs: number;
    scriptExists: boolean;
    error?: string;
  };
  clients: McpClientDiagnosis[];
}

export type AgentState = 'waiting' | 'working' | 'blocked' | 'stopped';

export type PostKind =
  | 'human_directive'
  | 'dispatch_brief'
  | 'deliverable'
  | 'discussion'
  | 'approval_gate'
  | 'system_notice';

export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed';

export interface ModelOption {
  id: string;
  label: string;
  efforts?: string[];
  defaultEffort?: string;
}

export interface Board {
  id: string;
  title: string;
  goal: string;
  projectName: string;
  workspacePath: string;
  presetId: string;
  executionMode: 'demo' | 'live_cli';
  sessionSyncMode: SessionSyncMode;
  leaderMode: LeaderMode;
  hostClient: string;
  hostSessionRef: string | null;
  hostWaiting: boolean;
  hostLastReadSeqId: number;
  hostHookPendingSeqId: number;
  hostLastSettlementReason: string;
  activeWaveId: string | null;
  hostCliFallback: boolean;
  hostAutoStandby?: boolean;
  hostPanelBridgeActive?: boolean;
  status: 'active' | 'paused' | 'completed';
  contextPercent: number;
  totalTokens: number;
  turnCount: number;
  hopCountSinceHuman: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentSlot {
  id: string;
  boardId: string;
  slotId: string;
  displayName: string;
  roleTitle: string;
  roleBrief: string;
  isLeader: boolean;
  engine: EngineId;
  modelId: string;
  reasoningEffort: ReasoningEffort;
  state: AgentState;
  currentActivity: string;
  roleAutoAssigned?: boolean;
  nativeSessionId: string | null;
  persistedInNativeApp: boolean;
  contextPercent: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  turnCount: number;
  avatarColor: string;
  updatedAt: number;
}

export interface FileChangeItem {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface DeliverableMeta {
  title?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  replyToSlotId?: string;
  clientMessageId?: string;
  waveId?: string;
  hostDelivery?:
    | 'delivered_to_wait'
    | 'hook_injected'
    | 'panel_forwarded'
    | 'host_acked'
    | 'queued_for_host'
    | 'cli_fallback';
  pausedWakeup?: {
    slotId: string;
    slotName: string;
    reason: string;
  };
  filesChanged?: string[];
  fileChanges?: FileChangeItem[];
  diffSnippet?: string;
  snapshotId?: string;
  changeStatus?: 'pending' | 'adopted' | 'reverted';
  taskId?: string;
  approvalStatus?: 'pending' | 'approved' | 'changes_requested' | 'stopped';
  staffingTable?: Array<{
    slotId: string;
    name: string;
    role: string;
    engine: EngineId;
    modelId?: string;
  }>;
  durationMs?: number;
  tokensUsed?: number;
  isError?: boolean;
  errorKind?: 'engine_uninstalled' | 'auth_required' | 'execution_failed';
  sourceHumanText?: string;
}

export interface BoardPost {
  id: string;
  seqId: number;
  boardId: string;
  authorType: 'human' | 'agent' | 'system';
  authorSlotId: string;
  authorName: string;
  authorEngine?: EngineId;
  kind: PostKind;
  title: string;
  content: string;
  mentions: string[];
  meta: DeliverableMeta;
  createdAt: number;
}

export interface BoardTask {
  id: string;
  boardId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeSlotId: string;
  threadGroup: string;
  blockedBy: string[];
  deliverablePostId: string | null;
  updatedAt: number;
}

export interface SnapshotRevertOutcome {
  mode: 'strict' | 'skip_conflicts' | 'overwrite_all';
  at: number;
  restoredFiles: string[];
  skippedFiles: string[];
  protectionSnapshotId?: string | null;
}

export interface WorkspaceSnapshot {
  id: string;
  boardId: string;
  label: string;
  authorName: string;
  kind: 'auto_turn' | 'failed_turn' | 'manual_checkpoint' | 'pre_overwrite_backup';
  status: 'pending' | 'adopted' | 'reverted';
  fileCount: number;
  filesChanged: FileChangeItem[];
  skippedCount?: number;
  skippedSummary?: string;
  postCheckpointAddedCount?: number;
  lastRevertOutcome?: SnapshotRevertOutcome | null;
  createdAt: number;
}

export interface SnapshotConflictItem {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  reason: string;
  currentDiskPreview?: string;
  snapshotTargetPreview?: string;
}

export interface SnapshotDiffDetail {
  snapshot: WorkspaceSnapshot;
  totalFiles: number;
  conflicts?: SnapshotConflictItem[];
  diffs: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted';
    beforeText: string;
    afterText: string;
    currentDiskDiverged?: boolean;
    isBinary?: boolean;
  }>;
}

export interface AccountSlot {
  id: string;
  engine: Exclude<EngineId, 'demo'>;
  label: string;
  accountHint: string;
  isActive: boolean;
  savedAt: number;
}

export interface CustomMemberDraft {
  slotId?: string;
  displayName?: string;
  roleTitle?: string;
  roleBrief?: string;
  roleAutoAssigned?: boolean;
  isLeader?: boolean;
  engine: EngineId;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  avatarColor?: string;
}

export interface OrchestrationPreferences {
  globalDispatchPrompt: string;
  updatedAt: number;
}

export interface TeamPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  tags: string[];
  members: Array<{
    slotId: string;
    displayName: string;
    roleTitle: string;
    roleBrief: string;
    roleAutoAssigned?: boolean;
    isLeader: boolean;
    defaultEngine: EngineId;
    defaultModel: string;
    defaultEffort: ReasoningEffort;
    avatarColor: string;
  }>;
}

export interface QuotaWindowBar {
  label: string;
  resetText: string;
  remainingPercent: number;
}

export interface EngineDefaultConfig {
  modelId: string;
  reasoningEffort: ReasoningEffort;
  updatedAt: number;
}

export type EngineDefaultsMap = Record<string, EngineDefaultConfig>;

export interface EngineStatusCard {
  id: Exclude<EngineId, 'demo'>;
  name: string;
  vendorLabel: string;
  iconUrl: string;
  activeAccountLabel: string;
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  stateLabel: string;
  isActivelyWorking?: boolean;
  statusNote?: string;
  localSessionCount: number;
  totalTokensEstimated: number;
  turnCountEstimated: number;
  statsAreEstimated?: boolean;
  supportsAccountSwitch: boolean;
  defaultModel: string;
  defaultEffort: ReasoningEffort;
  hasCustomDefault?: boolean;
  availableModels: ModelOption[];
  quotaBars: QuotaWindowBar[];
}

export interface HeatmapCell {
  date: string;
  count: number;
  tokens: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface NetworkEndpoint {
  label: string;
  kind: 'localhost' | 'lan' | 'tailscale';
  ip: string;
  url: string;
}

export interface WorkbenchOverview {
  todayTokens: number;
  cumulativeTokens: number;
  cacheHitRate: number | null;
  totalTurns: number;
  turnsAreEstimated?: boolean;
  quotaUpdatedAt?: number | null;
  uiTheme?: AppThemeId;
  remoteAccessEnabled?: boolean;
  orchestrationPreferences?: OrchestrationPreferences;
  heatmap: HeatmapCell[];
  engines: EngineStatusCard[];
  presets: TeamPreset[];
  endpoints: NetworkEndpoint[];
}

export interface PairedDeviceSummary {
  id: string;
  label: string;
  ip: string;
  pairedAt: number;
  lastSeenAt: number;
}

export interface PairingConfig {
  remoteAccessEnabled: boolean;
  allowedRemoteHost: string;
  requirePinOnLan: boolean;
  pinCode: string;
  pairToken: string;
  pairedDevices: PairedDeviceSummary[];
}
