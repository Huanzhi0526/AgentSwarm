import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AgentSlot,
  AppThemeId,
  Board,
  BoardPost,
  BoardTask,
  CustomMemberDraft,
  DeliverableMeta,
  EngineDefaultConfig,
  EngineDefaultsMap,
  EngineId,
  LeaderMode,
  OrchestrationPreferences,
  PostKind,
  ReasoningEffort,
  SessionSyncMode,
  TaskStatus,
} from '../src/types.js';
import {
  getDefaultEffortForModel,
  getDefaultModelForEngine,
  getPresetById,
} from './orchestrator/presets.js';
import { getCatalogItem } from './engines/catalog.js';
import { resolveDefaultDataDir } from './mcp/utils.js';

function resolveRepoRoot(): string {
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let cur = startDir;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(cur, 'package.json'))) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = resolveRepoRoot();

export const DATA_DIR = resolveDefaultDataDir(REPO_ROOT);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'cowork-board.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    project_name TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    preset_id TEXT NOT NULL,
    execution_mode TEXT NOT NULL DEFAULT 'live_cli',
    session_sync_mode TEXT NOT NULL DEFAULT 'leader_only',
    status TEXT NOT NULL DEFAULT 'active',
    context_percent INTEGER NOT NULL DEFAULT 8,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    turn_count INTEGER NOT NULL DEFAULT 0,
    hop_count_since_human INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_slots (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role_title TEXT NOT NULL,
    role_brief TEXT NOT NULL,
    is_leader INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL,
    model_hint TEXT NOT NULL DEFAULT '',
    reasoning_effort TEXT NOT NULL DEFAULT 'high',
    state TEXT NOT NULL DEFAULT 'waiting',
    current_activity TEXT NOT NULL DEFAULT '待命',
    native_session_id TEXT,
    persisted_in_native_app INTEGER NOT NULL DEFAULT 0,
    context_percent INTEGER NOT NULL DEFAULT 5,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    turn_count INTEGER NOT NULL DEFAULT 0,
    avatar_color TEXT NOT NULL DEFAULT '#7B6BA8',
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    UNIQUE (board_id, slot_id)
  );

  CREATE TABLE IF NOT EXISTS board_posts (
    seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    board_id TEXT NOT NULL,
    author_type TEXT NOT NULL,
    author_slot_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_engine TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    mentions_json TEXT NOT NULL DEFAULT '[]',
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS board_tasks (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    assignee_slot_id TEXT NOT NULL,
    thread_group TEXT NOT NULL DEFAULT '核心交付',
    blocked_by_json TEXT NOT NULL DEFAULT '[]',
    deliverable_post_id TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usage_ledger (
    id TEXT PRIMARY KEY,
    board_id TEXT,
    engine TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_snapshots (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    label TEXT NOT NULL,
    author_name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'auto_turn',
    status TEXT NOT NULL DEFAULT 'pending',
    file_count INTEGER NOT NULL DEFAULT 0,
    files_changed_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS account_slots (
    id TEXT PRIMARY KEY,
    engine TEXT NOT NULL,
    label TEXT NOT NULL,
    account_hint TEXT NOT NULL DEFAULT '',
    vault_path TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    saved_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Safe migrations if upgrading from earlier schema
try {
  db.exec("ALTER TABLE agent_slots ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'high'");
} catch {
  // Column already exists
}

try {
  db.exec("ALTER TABLE workspace_snapshots ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'");
} catch {
  // Column already exists
}

try {
  const slotCols = (db.prepare('PRAGMA table_info(agent_slots)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  if (!slotCols.includes('role_auto_assigned')) {
    db.exec('ALTER TABLE agent_slots ADD COLUMN role_auto_assigned INTEGER NOT NULL DEFAULT 0');
  }
} catch {
  // ignore
}

// v1.3 Safe incremental migrations on boards table + inbox delivery & wave ledgers
for (const ddl of [
  "ALTER TABLE boards ADD COLUMN leader_mode TEXT NOT NULL DEFAULT 'cli'",
  "ALTER TABLE boards ADD COLUMN host_client TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE boards ADD COLUMN host_session_ref TEXT',
  'ALTER TABLE boards ADD COLUMN host_waiting INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE boards ADD COLUMN host_last_read_seq_id INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE boards ADD COLUMN host_hook_pending_seq_id INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE boards ADD COLUMN host_last_settlement_reason TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE boards ADD COLUMN active_wave_id TEXT',
  'ALTER TABLE boards ADD COLUMN host_cli_fallback INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE boards ADD COLUMN host_auto_standby INTEGER NOT NULL DEFAULT 1',
]) {
  try {
    db.exec(ddl);
  } catch {
    // Column already exists
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS host_inbox_deliveries (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    from_seq_id INTEGER NOT NULL,
    to_seq_id INTEGER NOT NULL,
    post_ids_json TEXT NOT NULL,
    state TEXT NOT NULL,
    lease_until INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_dlv_board ON host_inbox_deliveries(board_id, state);

  CREATE TABLE IF NOT EXISTS mcp_waves (
    wave_id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    dispatch_key TEXT NOT NULL DEFAULT '',
    dispatch_post_id TEXT NOT NULL,
    start_seq_id INTEGER NOT NULL,
    cursor_seq_id INTEGER NOT NULL,
    target_slots_json TEXT NOT NULL,
    status TEXT NOT NULL,
    last_reason TEXT NOT NULL DEFAULT 'dispatched',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_mcp_waves_board ON mcp_waves(board_id, created_at DESC);
`);

function normalizeModelAndEffort(
  engine: EngineId,
  rawModel: string,
  rawEffort: string
): { modelId: string; effort: ReasoningEffort } {
  const cat = getCatalogItem(engine);
  const suffixMatch = rawModel.match(/-(low|medium|high|xhigh|max)$/i);
  let cleanModel = rawModel;
  let extractedEffort = '';
  if (engine === 'antigravity' && suffixMatch) {
    cleanModel = rawModel.slice(0, -suffixMatch[0].length);
    extractedEffort = suffixMatch[1].toLowerCase();
  }

  const finalModel =
    cleanModel && /^[a-z0-9./_-]+$/i.test(cleanModel)
      ? cleanModel
      : cat.defaultModels[0]?.id || getDefaultModelForEngine(engine);

  const modelDef = cat.defaultModels.find((m) => m.id === finalModel);
  const candidateEffort = (rawEffort || extractedEffort || '').trim().toLowerCase();

  let isEffortValid = false;
  if (candidateEffort) {
    if (modelDef?.efforts?.length) {
      isEffortValid = modelDef.efforts.includes(candidateEffort);
    } else {
      isEffortValid = /^[a-z0-9_-]+$/i.test(candidateEffort);
    }
  }

  const finalEffort = isEffortValid
    ? candidateEffort
    : getDefaultEffortForModel(engine, finalModel);

  return { modelId: finalModel, effort: finalEffort };
}

function mapBoard(row: Record<string, unknown>): Board {
  return {
    id: String(row.id),
    title: String(row.title),
    goal: String(row.goal),
    projectName: String(row.project_name),
    workspacePath: String(row.workspace_path),
    presetId: String(row.preset_id),
    executionMode: (row.execution_mode as 'demo' | 'live_cli') || 'live_cli',
    sessionSyncMode: (row.session_sync_mode as SessionSyncMode) || 'leader_only',
    leaderMode: (row.leader_mode as LeaderMode) === 'mcp_host' ? 'mcp_host' : 'cli',
    hostClient: String(row.host_client || ''),
    hostSessionRef: row.host_session_ref ? String(row.host_session_ref) : null,
    hostWaiting: Boolean(row.host_waiting),
    hostLastReadSeqId: Number(row.host_last_read_seq_id || 0),
    hostHookPendingSeqId: Number(row.host_hook_pending_seq_id || 0),
    hostLastSettlementReason: String(row.host_last_settlement_reason || ''),
    activeWaveId: row.active_wave_id ? String(row.active_wave_id) : null,
    hostCliFallback: Boolean(row.host_cli_fallback),
    hostAutoStandby: row.host_auto_standby === undefined ? true : row.host_auto_standby !== 0,
    status: (row.status as Board['status']) || 'active',
    contextPercent: Number(row.context_percent || 0),
    totalTokens: Number(row.total_tokens || 0),
    turnCount: Number(row.turn_count || 0),
    hopCountSinceHuman: Number(row.hop_count_since_human || 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapSlot(row: Record<string, unknown>): AgentSlot {
  const engine = row.engine as EngineId;
  const { modelId, effort } = normalizeModelAndEffort(
    engine,
    String(row.model_hint || ''),
    String(row.reasoning_effort || '')
  );
  return {
    id: String(row.id),
    boardId: String(row.board_id),
    slotId: String(row.slot_id),
    displayName: String(row.display_name),
    roleTitle: String(row.role_title),
    roleBrief: String(row.role_brief),
    roleAutoAssigned: Boolean(row.role_auto_assigned),
    isLeader: Boolean(row.is_leader),
    engine,
    modelId,
    reasoningEffort: effort,
    state: row.state as AgentSlot['state'],
    currentActivity: String(row.current_activity || '待命').replace('待命休眠中 (0 消耗)', '待命'),
    nativeSessionId: row.native_session_id ? String(row.native_session_id) : null,
    persistedInNativeApp: Boolean(row.persisted_in_native_app),
    contextPercent: Number(row.context_percent || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    cachedTokens: Number(row.cached_tokens || 0),
    turnCount: Number(row.turn_count || 0),
    avatarColor: String(row.avatar_color || '#7B6BA8'),
    updatedAt: Number(row.updated_at),
  };
}

function mapPost(row: Record<string, unknown>): BoardPost {
  return {
    id: String(row.id),
    seqId: Number(row.seq_id),
    boardId: String(row.board_id),
    authorType: row.author_type as BoardPost['authorType'],
    authorSlotId: String(row.author_slot_id),
    authorName: String(row.author_name),
    authorEngine: row.author_engine ? (row.author_engine as EngineId) : undefined,
    kind: row.kind as PostKind,
    title: String(row.title || ''),
    content: String(row.content || ''),
    mentions: JSON.parse(String(row.mentions_json || '[]')),
    meta: JSON.parse(String(row.meta_json || '{}')),
    createdAt: Number(row.created_at),
  };
}

function mapTask(row: Record<string, unknown>): BoardTask {
  return {
    id: String(row.id),
    boardId: String(row.board_id),
    title: String(row.title),
    description: String(row.description || ''),
    status: row.status as TaskStatus,
    assigneeSlotId: String(row.assignee_slot_id),
    threadGroup: String(row.thread_group || '核心交付'),
    blockedBy: JSON.parse(String(row.blocked_by_json || '[]')),
    deliverablePostId: row.deliverable_post_id ? String(row.deliverable_post_id) : null,
    updatedAt: Number(row.updated_at),
  };
}

export function listBoards(): Board[] {
  const rows = db.prepare('SELECT * FROM boards ORDER BY updated_at DESC').all() as Record<string, unknown>[];
  return rows.map(mapBoard);
}

export function getBoard(boardId: string): Board | null {
  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as Record<string, unknown> | undefined;
  return row ? mapBoard(row) : null;
}

export function deleteBoard(boardId: string): void {
  db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
}

export function getBoardAgents(boardId: string): AgentSlot[] {
  const rows = db
    .prepare('SELECT * FROM agent_slots WHERE board_id = ? ORDER BY is_leader DESC, rowid ASC')
    .all(boardId) as Record<string, unknown>[];
  return rows.map(mapSlot);
}

export function getBoardPosts(boardId: string, sinceSeqId = 0): BoardPost[] {
  const rows = db
    .prepare('SELECT * FROM board_posts WHERE board_id = ? AND seq_id > ? ORDER BY seq_id ASC')
    .all(boardId, sinceSeqId) as Record<string, unknown>[];
  return rows.map(mapPost);
}

export function getBoardMaxSeqId(boardId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq_id), 0) AS m FROM board_posts WHERE board_id = ?')
    .get(boardId) as { m: number } | undefined;
  return Number(row?.m || 0);
}

export function getPostById(postId: string): BoardPost | null {
  const row = db
    .prepare('SELECT * FROM board_posts WHERE id = ?')
    .get(postId) as Record<string, unknown> | undefined;
  return row ? mapPost(row) : null;
}

export function findPostByClientMessageId(boardId: string, clientMessageId: string): BoardPost | null {
  if (!clientMessageId) return null;
  const rows = db
    .prepare(
      "SELECT * FROM board_posts WHERE board_id = ? AND author_type = 'human' ORDER BY seq_id DESC LIMIT 30"
    )
    .all(boardId) as Record<string, unknown>[];
  for (const r of rows) {
    const p = mapPost(r);
    if (p.meta.clientMessageId === clientMessageId) return p;
  }
  return null;
}

export function getBoardTasks(boardId: string): BoardTask[] {
  const rows = db
    .prepare('SELECT * FROM board_tasks WHERE board_id = ? ORDER BY updated_at ASC')
    .all(boardId) as Record<string, unknown>[];
  return rows.map(mapTask);
}

const MEMBER_AVATAR_PALETTE = [
  '#7B6BA8',
  '#62997A',
  '#6B8EAD',
  '#8B74AD',
  '#B58B63',
  '#B0706A',
  '#5E8A87',
];

function allocateSlotId(existingIds: string[], requested?: string, isLeader = false): string {
  const used = new Set(existingIds.map((x) => x.toLowerCase()));
  if (requested) {
    const clean = requested
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    if (clean && clean !== 'human' && clean !== 'system' && !used.has(clean)) {
      return clean;
    }
  }
  if (isLeader && !used.has('lead')) return 'lead';
  let idx = 1;
  while (used.has(`member_${idx}`)) {
    idx++;
  }
  return `member_${idx}`;
}

function refreshBoardPersistenceFlags(boardId: string, syncMode: SessionSyncMode): void {
  const slots = getBoardAgents(boardId);
  for (const s of slots) {
    const persisted =
      syncMode === 'all_persist' || (syncMode === 'leader_only' && s.isLeader) ? 1 : 0;
    db.prepare('UPDATE agent_slots SET persisted_in_native_app = ? WHERE id = ?').run(persisted, s.id);
  }
}

export interface CreateBoardInput {
  title: string;
  goal: string;
  workspacePath: string;
  presetId: string;
  executionMode?: 'demo' | 'live_cli';
  sessionSyncMode?: SessionSyncMode;
  leaderMode?: LeaderMode;
  hostClient?: string;
  hostSessionRef?: string | null;
  hostCliFallback?: boolean;
  hostAutoStandby?: boolean;
  engineOverrides?: Record<string, EngineId>;
  modelOverrides?: Record<string, string>;
  effortOverrides?: Record<string, ReasoningEffort>;
  customMembers?: CustomMemberDraft[];
}

export function createBoard(input: CreateBoardInput): Board {
  const now = Date.now();
  const id = `brd_${crypto.randomUUID().slice(0, 8)}`;
  const preset = getPresetById(input.presetId);
  const cleanWorkspace = input.workspacePath.trim() || process.cwd();
  const projectName = path.basename(cleanWorkspace) || '默认工作区';
  const execMode = input.executionMode || 'live_cli';
  const syncMode: SessionSyncMode = input.sessionSyncMode || 'leader_only';
  const leaderMode: LeaderMode = input.leaderMode === 'mcp_host' ? 'mcp_host' : 'cli';
  const hostClient = (input.hostClient || '').trim();
  const hostSessionRef = input.hostSessionRef || null;
  const hostCliFallback = input.hostCliFallback ? 1 : 0;
  const hostAutoStandby = input.hostAutoStandby === false ? 0 : 1;

  db.prepare(
    `INSERT INTO boards (
      id, title, goal, project_name, workspace_path, preset_id,
      execution_mode, session_sync_mode, leader_mode, host_client, host_session_ref,
      host_waiting, host_last_read_seq_id, host_cli_fallback, host_auto_standby,
      status, context_percent, total_tokens, turn_count, hop_count_since_human, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'active', 0, 0, 0, 0, ?, ?)`
  ).run(
    id,
    input.title.trim() || `${preset.name}会话`,
    input.goal.trim() || '',
    projectName,
    cleanWorkspace,
    preset.id,
    execMode,
    syncMode,
    leaderMode,
    hostClient,
    hostSessionRef,
    hostCliFallback,
    hostAutoStandby,
    now,
    now
  );

  const insertSlot = db.prepare(
    `INSERT INTO agent_slots (
      id, board_id, slot_id, display_name, role_title, role_brief, role_auto_assigned,
      is_leader, engine, model_hint, reasoning_effort, state, current_activity,
      native_session_id, persisted_in_native_app, context_percent,
      input_tokens, output_tokens, cached_tokens, turn_count, avatar_color, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', '待命', NULL, ?, 0, 0, 0, 0, 0, ?, ?)`
  );

  if (input.customMembers && input.customMembers.length > 0) {
    const rawMembers = input.customMembers;
    const leaderIdx = Math.max(0, rawMembers.findIndex((m) => Boolean(m.isLeader)));
    const allocatedIds: string[] = [];

    rawMembers.forEach((m, index) => {
      const isLeader = index === leaderIdx;
      const slotId = allocateSlotId(allocatedIds, m.slotId, isLeader);
      allocatedIds.push(slotId);

      const chosenEngine = m.engine || 'antigravity';
      const engineDefaults = resolveEffectiveEngineDefaults(chosenEngine);
      const rawModel = m.modelId || engineDefaults.modelId;
      const rawEffort = m.reasoningEffort || (m.modelId ? '' : engineDefaults.effort);
      const { modelId, effort } = normalizeModelAndEffort(
        chosenEngine,
        rawModel,
        rawEffort
      );

      const autoAssigned =
        !isLeader &&
        (m.roleAutoAssigned ?? (!m.roleTitle?.trim() && !m.roleBrief?.trim()));

      const displayName =
        m.displayName?.trim() || (isLeader ? '总控主管' : `协同成员 ${index + (leaderIdx === 0 ? 0 : 1)}`);
      const roleTitle = isLeader
        ? m.roleTitle?.trim() || '统筹拆解与验收'
        : autoAssigned
          ? '待主管分配职责'
          : m.roleTitle?.trim() || '协同执行';
      const roleBrief = isLeader
        ? m.roleBrief?.trim() || '负责需求拆解、为未定岗成员分配职责、按需调度并汇总验收。'
        : autoAssigned
          ? '待主管结合任务目标、模型特长与全局分工偏好自动分配。'
          : m.roleBrief?.trim() || '协同完成当前看板任务。';

      const willPersist =
        syncMode === 'all_persist' ||
        (syncMode === 'leader_only' && isLeader);

      insertSlot.run(
        `agt_${crypto.randomUUID().slice(0, 8)}`,
        id,
        slotId,
        displayName,
        roleTitle,
        roleBrief,
        autoAssigned ? 1 : 0,
        isLeader ? 1 : 0,
        chosenEngine,
        modelId,
        effort,
        willPersist ? 1 : 0,
        m.avatarColor || MEMBER_AVATAR_PALETTE[index % MEMBER_AVATAR_PALETTE.length],
        now
      );
    });
  } else {
    for (const m of preset.members) {
      const chosenEngine = input.engineOverrides?.[m.slotId] ?? m.defaultEngine;
      const engineDefaults = resolveEffectiveEngineDefaults(chosenEngine);
      const rawModel =
        input.modelOverrides?.[m.slotId] ??
        (engineDefaults.hasCustom
          ? engineDefaults.modelId
          : chosenEngine === m.defaultEngine
            ? m.defaultModel
            : engineDefaults.modelId);
      const rawEffort =
        input.effortOverrides?.[m.slotId] ??
        (engineDefaults.hasCustom
          ? engineDefaults.effort
          : chosenEngine === m.defaultEngine
            ? m.defaultEffort
            : engineDefaults.effort);
      const { modelId: chosenModel, effort: chosenEffort } = normalizeModelAndEffort(
        chosenEngine,
        rawModel,
        rawEffort
      );
      const willPersist =
        syncMode === 'all_persist' ||
        (syncMode === 'leader_only' && m.isLeader);

      insertSlot.run(
        `agt_${crypto.randomUUID().slice(0, 8)}`,
        id,
        m.slotId,
        m.displayName,
        m.roleTitle,
        m.roleBrief,
        m.roleAutoAssigned ? 1 : 0,
        m.isLeader ? 1 : 0,
        chosenEngine,
        chosenModel,
        chosenEffort,
        willPersist ? 1 : 0,
        m.avatarColor,
        now
      );
    }
  }

  return getBoard(id)!;
}

export function addAgentSlotToBoard(boardId: string, draft: CustomMemberDraft): AgentSlot {
  const board = getBoard(boardId);
  if (!board) throw new Error('看板不存在');

  const existing = getBoardAgents(boardId);
  const slotId = allocateSlotId(
    existing.map((a) => a.slotId),
    draft.slotId,
    Boolean(draft.isLeader)
  );
  const isLeader = Boolean(draft.isLeader);
  const engine = draft.engine || 'antigravity';
  const engineDefaults = resolveEffectiveEngineDefaults(engine);
  const rawModel = draft.modelId || engineDefaults.modelId;
  const rawEffort = draft.reasoningEffort || (draft.modelId ? '' : engineDefaults.effort);
  const { modelId, effort } = normalizeModelAndEffort(
    engine,
    rawModel,
    rawEffort
  );

  const autoAssigned =
    !isLeader &&
    (draft.roleAutoAssigned ?? (!draft.roleTitle?.trim() && !draft.roleBrief?.trim()));

  const memberCountLabel = existing.filter((a) => !a.isLeader).length + 1;
  const displayName =
    draft.displayName?.trim() || (isLeader ? '新任主管' : `协同成员 ${memberCountLabel}`);
  const roleTitle = isLeader
    ? draft.roleTitle?.trim() || '统筹拆解与验收'
    : autoAssigned
      ? '待主管分配职责'
      : draft.roleTitle?.trim() || '协同执行';
  const roleBrief = isLeader
    ? draft.roleBrief?.trim() || '负责需求拆解、成员分工协调与交付验收。'
    : autoAssigned
      ? '待主管结合任务目标、模型特长与全局分工偏好自动分配。'
      : draft.roleBrief?.trim() || '协助完成看板指派的具体任务。';

  if (isLeader) {
    db.prepare('UPDATE agent_slots SET is_leader = 0 WHERE board_id = ?').run(boardId);
  }

  const now = Date.now();
  const agtId = `agt_${crypto.randomUUID().slice(0, 8)}`;
  const willPersist =
    board.sessionSyncMode === 'all_persist' ||
    (board.sessionSyncMode === 'leader_only' && isLeader);

  db.prepare(
    `INSERT INTO agent_slots (
      id, board_id, slot_id, display_name, role_title, role_brief, role_auto_assigned,
      is_leader, engine, model_hint, reasoning_effort, state, current_activity,
      native_session_id, persisted_in_native_app, context_percent,
      input_tokens, output_tokens, cached_tokens, turn_count, avatar_color, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', '待命', NULL, ?, 0, 0, 0, 0, 0, ?, ?)`
  ).run(
    agtId,
    boardId,
    slotId,
    displayName,
    roleTitle,
    roleBrief,
    autoAssigned ? 1 : 0,
    isLeader ? 1 : 0,
    engine,
    modelId,
    effort,
    willPersist ? 1 : 0,
    draft.avatarColor || MEMBER_AVATAR_PALETTE[existing.length % MEMBER_AVATAR_PALETTE.length],
    now
  );

  if (isLeader) {
    refreshBoardPersistenceFlags(boardId, board.sessionSyncMode);
  }
  db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(now, boardId);

  const row = db.prepare('SELECT * FROM agent_slots WHERE id = ?').get(agtId) as Record<
    string,
    unknown
  >;
  return mapSlot(row);
}

export function removeAgentSlotFromBoard(
  boardId: string,
  slotId: string
): { deleted: boolean; reassignedTasks: BoardTask[] } {
  const agents = getBoardAgents(boardId);
  const target = agents.find((a) => a.slotId === slotId);
  if (!target) {
    throw new Error('未找到该成员');
  }
  if (agents.length <= 1) {
    throw new Error('看板至少保留一位成员');
  }
  if (target.isLeader) {
    throw new Error('请先将其他成员设为主管后再移除');
  }
  if (target.state === 'working') {
    throw new Error('该成员正在执行任务，请等待完成后再移除');
  }

  const fallbackLeader =
    agents.find((a) => a.isLeader && a.slotId !== slotId) ||
    agents.find((a) => a.slotId !== slotId)!;

  const now = Date.now();
  const incompleteRows = db
    .prepare(
      "SELECT id FROM board_tasks WHERE board_id = ? AND assignee_slot_id = ? AND status != 'completed'"
    )
    .all(boardId, slotId) as Array<{ id: string }>;

  const reassignedTasks: BoardTask[] = [];
  if (incompleteRows.length > 0) {
    db.prepare(
      "UPDATE board_tasks SET assignee_slot_id = ?, updated_at = ? WHERE board_id = ? AND assignee_slot_id = ? AND status != 'completed'"
    ).run(fallbackLeader.slotId, now, boardId, slotId);

    for (const r of incompleteRows) {
      const updatedTaskRow = db.prepare('SELECT * FROM board_tasks WHERE id = ?').get(r.id) as
        | Record<string, unknown>
        | undefined;
      if (updatedTaskRow) reassignedTasks.push(mapTask(updatedTaskRow));
    }
  }

  db.prepare('DELETE FROM agent_slots WHERE id = ?').run(target.id);
  db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(now, boardId);

  return { deleted: true, reassignedTasks };
}

export function getOrchestrationPreferences(): OrchestrationPreferences {
  try {
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = 'orchestration_preferences'")
      .get() as { value: string } | undefined;
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<OrchestrationPreferences>;
      return {
        globalDispatchPrompt: String(parsed.globalDispatchPrompt || ''),
        updatedAt: Number(parsed.updatedAt || 0),
      };
    }
  } catch {
    // ignore parse error
  }
  return { globalDispatchPrompt: '', updatedAt: 0 };
}

export function saveOrchestrationPreferences(
  globalDispatchPrompt: string
): OrchestrationPreferences {
  const next: OrchestrationPreferences = {
    globalDispatchPrompt: globalDispatchPrompt.trim().slice(0, 4000),
    updatedAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('orchestration_preferences', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(next));
  return next;
}

export function getEngineDefaultConfigs(): EngineDefaultsMap {
  try {
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = 'engine_default_configs'")
      .get() as { value: string } | undefined;
    if (row?.value) {
      const parsed = JSON.parse(row.value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as EngineDefaultsMap;
      }
    }
  } catch {
    // ignore parse error
  }
  return {};
}

export function resolveEffectiveEngineDefaults(engine: EngineId): {
  modelId: string;
  effort: ReasoningEffort;
  hasCustom: boolean;
} {
  if (engine !== 'demo') {
    const map = getEngineDefaultConfigs();
    const custom = map[engine];
    if (custom?.modelId) {
      const norm = normalizeModelAndEffort(engine, custom.modelId, custom.reasoningEffort || '');
      return { modelId: norm.modelId, effort: norm.effort, hasCustom: true };
    }
  }
  const fallbackModel = getDefaultModelForEngine(engine);
  const fallbackEffort = getDefaultEffortForModel(engine, fallbackModel);
  return { modelId: fallbackModel, effort: fallbackEffort, hasCustom: false };
}

export function saveEngineDefaultConfig(
  engine: Exclude<EngineId, 'demo'>,
  rawModelId: string,
  rawEffort: ReasoningEffort
): EngineDefaultConfig {
  const norm = normalizeModelAndEffort(engine, rawModelId, rawEffort || '');
  const current = getEngineDefaultConfigs();
  const nextEntry: EngineDefaultConfig = {
    modelId: norm.modelId,
    reasoningEffort: norm.effort,
    updatedAt: Date.now(),
  };
  const nextMap: EngineDefaultsMap = {
    ...current,
    [engine]: nextEntry,
  };
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('engine_default_configs', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(nextMap));
  return nextEntry;
}

export function deleteEngineDefaultConfig(engine: Exclude<EngineId, 'demo'>): void {
  const current = getEngineDefaultConfigs();
  if (!(engine in current)) return;
  const nextMap = { ...current };
  delete nextMap[engine];
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('engine_default_configs', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(nextMap));
}

const VALID_UI_THEMES = new Set<AppThemeId>(['purple', 'blue', 'green', 'pink']);

export function getUiTheme(): AppThemeId {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'ui_theme'`).get() as
    | { value: string }
    | undefined;
  const val = String(row?.value || '').trim() as AppThemeId;
  return VALID_UI_THEMES.has(val) ? val : 'purple';
}

export function saveUiTheme(rawTheme: string): AppThemeId {
  const candidate = String(rawTheme || '').trim() as AppThemeId;
  const next: AppThemeId = VALID_UI_THEMES.has(candidate) ? candidate : 'purple';
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('ui_theme', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(next);
  return next;
}

export function updateBoardConfig(
  boardId: string,
  patch: Partial<
    Pick<
      Board,
      | 'executionMode'
      | 'sessionSyncMode'
      | 'leaderMode'
      | 'hostClient'
      | 'hostSessionRef'
      | 'hostWaiting'
      | 'hostLastReadSeqId'
      | 'hostHookPendingSeqId'
      | 'hostLastSettlementReason'
      | 'activeWaveId'
      | 'hostCliFallback'
      | 'hostAutoStandby'
      | 'goal'
      | 'title'
      | 'status'
      | 'hopCountSinceHuman'
      | 'workspacePath'
    >
  >
): Board | null {
  const current = getBoard(boardId);
  if (!current) return null;
  const nextExec = patch.executionMode ?? current.executionMode;
  const nextSync = patch.sessionSyncMode ?? current.sessionSyncMode;
  const nextLeaderMode = patch.leaderMode ?? current.leaderMode;
  const nextHostClient = patch.hostClient ?? current.hostClient;
  const nextHostSessionRef =
    patch.hostSessionRef !== undefined ? patch.hostSessionRef : current.hostSessionRef;
  const nextHostWaiting =
    patch.hostWaiting !== undefined ? (patch.hostWaiting ? 1 : 0) : current.hostWaiting ? 1 : 0;
  const nextHostLastReadSeqId =
    patch.hostLastReadSeqId !== undefined
      ? Math.max(current.hostLastReadSeqId, patch.hostLastReadSeqId)
      : current.hostLastReadSeqId;
  const nextHostHookPendingSeqId =
    patch.hostHookPendingSeqId !== undefined
      ? patch.hostHookPendingSeqId
      : current.hostHookPendingSeqId <= nextHostLastReadSeqId
        ? 0
        : current.hostHookPendingSeqId;
  const nextHostLastSettlementReason =
    patch.hostLastSettlementReason !== undefined
      ? patch.hostLastSettlementReason
      : current.hostLastSettlementReason;
  const nextActiveWaveId =
    patch.activeWaveId !== undefined ? patch.activeWaveId : current.activeWaveId;
  const nextHostCliFallback =
    patch.hostCliFallback !== undefined
      ? patch.hostCliFallback
        ? 1
        : 0
      : current.hostCliFallback
        ? 1
        : 0;
  const nextHostAutoStandby =
    patch.hostAutoStandby !== undefined
      ? patch.hostAutoStandby
        ? 1
        : 0
      : current.hostAutoStandby !== false
        ? 1
        : 0;
  const nextGoal = patch.goal ?? current.goal;
  const nextTitle = patch.title ?? current.title;
  const nextStatus = patch.status ?? current.status;
  const nextHops = patch.hopCountSinceHuman ?? current.hopCountSinceHuman;
  const nextWorkspace = patch.workspacePath?.trim()
    ? path.resolve(patch.workspacePath.trim())
    : current.workspacePath;
  const nextProjectName = path.basename(nextWorkspace) || current.projectName;
  const now = Date.now();

  db.prepare(
    `UPDATE boards
     SET execution_mode = ?, session_sync_mode = ?, leader_mode = ?, host_client = ?, host_session_ref = ?,
         host_waiting = ?, host_last_read_seq_id = ?, host_hook_pending_seq_id = ?,
         host_last_settlement_reason = ?, active_wave_id = ?, host_cli_fallback = ?, host_auto_standby = ?,
         goal = ?, title = ?, status = ?, hop_count_since_human = ?,
         workspace_path = ?, project_name = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    nextExec,
    nextSync,
    nextLeaderMode,
    nextHostClient,
    nextHostSessionRef,
    nextHostWaiting,
    nextHostLastReadSeqId,
    nextHostHookPendingSeqId,
    nextHostLastSettlementReason,
    nextActiveWaveId,
    nextHostCliFallback,
    nextHostAutoStandby,
    nextGoal,
    nextTitle,
    nextStatus,
    nextHops,
    nextWorkspace,
    nextProjectName,
    now,
    boardId
  );

  if (patch.sessionSyncMode) {
    refreshBoardPersistenceFlags(boardId, nextSync);
  }

  return getBoard(boardId);
}

export function updateAgentSlot(
  boardId: string,
  slotId: string,
  patch: Partial<{
    state: AgentSlot['state'];
    currentActivity: string;
    nativeSessionId: string | null;
    displayName: string;
    roleTitle: string;
    roleBrief: string;
    roleAutoAssigned: boolean;
    isLeader: boolean;
    engine: EngineId;
    modelId: string;
    reasoningEffort: ReasoningEffort;
    addInputTokens: number;
    addOutputTokens: number;
    addCachedTokens: number;
    incrementTurn: boolean;
    contextPercent: number;
  }>
): AgentSlot | null {
  const row = db
    .prepare('SELECT * FROM agent_slots WHERE board_id = ? AND slot_id = ?')
    .get(boardId, slotId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const cur = mapSlot(row);
  const nextEngine = patch.engine ?? cur.engine;
  const switchingEngine = Boolean(patch.engine && patch.engine !== cur.engine);
  const nextEngineDefaults = switchingEngine ? resolveEffectiveEngineDefaults(nextEngine) : null;

  const rawModel =
    patch.modelId ?? (nextEngineDefaults ? nextEngineDefaults.modelId : cur.modelId);
  const rawEffort =
    patch.reasoningEffort ??
    (nextEngineDefaults && !patch.modelId
      ? nextEngineDefaults.effort
      : patch.modelId
        ? ''
        : cur.reasoningEffort);

  const normalized = normalizeModelAndEffort(nextEngine, rawModel, rawEffort);
  const nextModel = normalized.modelId;
  const nextEffort = normalized.effort;

  const nextDisplayName =
    patch.displayName !== undefined && patch.displayName.trim()
      ? patch.displayName.trim().slice(0, 32)
      : cur.displayName;
  const nextIsLeader = patch.isLeader !== undefined ? Boolean(patch.isLeader) : cur.isLeader;
  let nextRoleAuto =
    patch.roleAutoAssigned !== undefined ? Boolean(patch.roleAutoAssigned) : cur.roleAutoAssigned;
  let nextRoleTitle =
    patch.roleTitle !== undefined ? patch.roleTitle.trim().slice(0, 48) : cur.roleTitle;
  let nextRoleBrief =
    patch.roleBrief !== undefined ? patch.roleBrief.trim().slice(0, 240) : cur.roleBrief;

  if (patch.roleAutoAssigned === true) {
    nextRoleTitle = '待主管分配职责';
    nextRoleBrief = '待主管结合任务目标、模型特长与全局分工偏好自动分配。';
  } else if (patch.isLeader && nextRoleAuto) {
    nextRoleAuto = false;
    nextRoleTitle = nextRoleTitle === '待主管分配职责' || !nextRoleTitle ? '统筹拆解与验收' : nextRoleTitle;
    nextRoleBrief =
      nextRoleBrief.includes('待主管') || !nextRoleBrief
        ? '负责拆解需求、为未定岗成员分配职责、按需调度并汇总验收。'
        : nextRoleBrief;
  } else {
    if (!nextRoleTitle) nextRoleTitle = cur.roleTitle;
    if (!nextRoleBrief) nextRoleBrief = cur.roleBrief;
  }

  if (patch.isLeader === true && !cur.isLeader) {
    db.prepare('UPDATE agent_slots SET is_leader = 0 WHERE board_id = ?').run(boardId);
  }

  const inTok = cur.inputTokens + (patch.addInputTokens ?? 0);
  const outTok = cur.outputTokens + (patch.addOutputTokens ?? 0);
  const cacheTok = cur.cachedTokens + (patch.addCachedTokens ?? 0);
  const turns = cur.turnCount + (patch.incrementTurn ? 1 : 0);
  const turnTok = (patch.addInputTokens ?? 0) + (patch.addOutputTokens ?? 0);
  const ctxPct =
    patch.contextPercent ??
    (turnTok > 0
      ? Math.min(95, Math.max(1, Math.round((turnTok / 200_000) * 100)))
      : cur.contextPercent);
  const now = Date.now();

  db.prepare(
    `UPDATE agent_slots
     SET state = ?, current_activity = ?, native_session_id = ?, display_name = ?,
         role_title = ?, role_brief = ?, role_auto_assigned = ?, is_leader = ?,
         engine = ?, model_hint = ?, reasoning_effort = ?,
         input_tokens = ?, output_tokens = ?, cached_tokens = ?, turn_count = ?,
         context_percent = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.state ?? cur.state,
    patch.currentActivity ?? cur.currentActivity,
    patch.nativeSessionId !== undefined ? patch.nativeSessionId : cur.nativeSessionId,
    nextDisplayName,
    nextRoleTitle,
    nextRoleBrief,
    nextRoleAuto ? 1 : 0,
    nextIsLeader ? 1 : 0,
    nextEngine,
    nextModel,
    nextEffort,
    inTok,
    outTok,
    cacheTok,
    turns,
    ctxPct,
    now,
    cur.id
  );

  if (patch.isLeader !== undefined) {
    const board = getBoard(boardId);
    if (board) refreshBoardPersistenceFlags(boardId, board.sessionSyncMode);
  }

  const deltaTotal = (patch.addInputTokens ?? 0) + (patch.addOutputTokens ?? 0);
  if (deltaTotal > 0 || patch.incrementTurn) {
    db.prepare(
      `UPDATE boards
       SET total_tokens = total_tokens + ?,
           turn_count = turn_count + ?,
           context_percent = (SELECT COALESCE(MAX(context_percent), 0) FROM agent_slots WHERE board_id = ?),
           updated_at = ?
       WHERE id = ?`
    ).run(deltaTotal, patch.incrementTurn ? 1 : 0, boardId, now, boardId);

    if (deltaTotal > 0) {
      db.prepare(
        `INSERT INTO usage_ledger (id, board_id, engine, input_tokens, output_tokens, cached_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `ulg_${crypto.randomUUID().slice(0, 10)}`,
        boardId,
        nextEngine,
        patch.addInputTokens ?? 0,
        patch.addOutputTokens ?? 0,
        patch.addCachedTokens ?? 0,
        now
      );
    }
  } else {
    db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(now, boardId);
  }

  const updated = db.prepare('SELECT * FROM agent_slots WHERE id = ?').get(cur.id) as Record<string, unknown>;
  return mapSlot(updated);
}

export interface InsertPostInput {
  boardId: string;
  authorType: BoardPost['authorType'];
  authorSlotId: string;
  authorName: string;
  authorEngine?: EngineId;
  kind: PostKind;
  title?: string;
  content: string;
  mentions?: string[];
  meta?: DeliverableMeta;
}

export function insertPost(input: InsertPostInput): BoardPost {
  const id = `pst_${crypto.randomUUID().slice(0, 10)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO board_posts (
      id, board_id, author_type, author_slot_id, author_name, author_engine,
      kind, title, content, mentions_json, meta_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.boardId,
    input.authorType,
    input.authorSlotId,
    input.authorName,
    input.authorEngine ?? null,
    input.kind,
    input.title ?? '',
    input.content,
    JSON.stringify(input.mentions ?? []),
    JSON.stringify(input.meta ?? {}),
    now
  );

  db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(now, input.boardId);
  const row = db.prepare('SELECT * FROM board_posts WHERE id = ?').get(id) as Record<string, unknown>;
  return mapPost(row);
}

export function updatePostMeta(postId: string, metaPatch: Partial<DeliverableMeta>): BoardPost | null {
  const row = db.prepare('SELECT * FROM board_posts WHERE id = ?').get(postId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const post = mapPost(row);
  const merged = { ...post.meta, ...metaPatch };
  db.prepare('UPDATE board_posts SET meta_json = ? WHERE id = ?').run(JSON.stringify(merged), postId);
  const updated = db.prepare('SELECT * FROM board_posts WHERE id = ?').get(postId) as Record<string, unknown>;
  return mapPost(updated);
}

export function updatePostsBySnapshotId(
  snapshotId: string,
  changeStatus: 'adopted' | 'reverted'
): BoardPost[] {
  const rows = db
    .prepare('SELECT * FROM board_posts WHERE meta_json LIKE ?')
    .all(`%${snapshotId}%`) as Record<string, unknown>[];
  const updatedList: BoardPost[] = [];
  for (const r of rows) {
    const p = mapPost(r);
    if (p.meta.snapshotId === snapshotId) {
      const next = updatePostMeta(p.id, { changeStatus });
      if (next) updatedList.push(next);
    }
  }
  return updatedList;
}

export interface UpsertTaskInput {
  id?: string;
  boardId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  assigneeSlotId: string;
  threadGroup?: string;
  blockedBy?: string[];
  deliverablePostId?: string | null;
}

export function upsertTask(input: UpsertTaskInput): BoardTask {
  const now = Date.now();
  const existing = input.id
    ? (db.prepare('SELECT * FROM board_tasks WHERE id = ? AND board_id = ?').get(input.id, input.boardId) as
        | Record<string, unknown>
        | undefined)
    : (db
        .prepare('SELECT * FROM board_tasks WHERE board_id = ? AND title = ?')
        .get(input.boardId, input.title) as Record<string, unknown> | undefined);

  if (existing) {
    const cur = mapTask(existing);
    db.prepare(
      `UPDATE board_tasks
       SET title = ?, description = ?, status = ?, assignee_slot_id = ?,
           thread_group = ?, blocked_by_json = ?, deliverable_post_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.title || cur.title,
      input.description ?? cur.description,
      input.status ?? cur.status,
      input.assigneeSlotId || cur.assigneeSlotId,
      input.threadGroup ?? cur.threadGroup,
      JSON.stringify(input.blockedBy ?? cur.blockedBy),
      input.deliverablePostId !== undefined ? input.deliverablePostId : cur.deliverablePostId,
      now,
      cur.id
    );
    return mapTask(db.prepare('SELECT * FROM board_tasks WHERE id = ?').get(cur.id) as Record<string, unknown>);
  }

  const id = input.id || `tsk_${crypto.randomUUID().slice(0, 6)}`;
  db.prepare(
    `INSERT INTO board_tasks (
      id, board_id, title, description, status, assignee_slot_id,
      thread_group, blocked_by_json, deliverable_post_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.boardId,
    input.title,
    input.description ?? '',
    input.status ?? 'pending',
    input.assigneeSlotId,
    input.threadGroup ?? '核心交付',
    JSON.stringify(input.blockedBy ?? []),
    input.deliverablePostId ?? null,
    now
  );
  return mapTask(db.prepare('SELECT * FROM board_tasks WHERE id = ?').get(id) as Record<string, unknown>);
}

export interface HostInboxDeliveryRecord {
  id: string;
  boardId: string;
  sessionKey: string;
  fromSeqId: number;
  toSeqId: number;
  postIds: string[];
  state: 'claimed' | 'hook_injected' | 'acked' | 'failed';
  leaseUntil: number;
  createdAt: number;
  updatedAt: number;
}

function mapInboxDelivery(row: Record<string, unknown>): HostInboxDeliveryRecord {
  return {
    id: String(row.id),
    boardId: String(row.board_id),
    sessionKey: String(row.session_key),
    fromSeqId: Number(row.from_seq_id),
    toSeqId: Number(row.to_seq_id),
    postIds: JSON.parse(String(row.post_ids_json || '[]')),
    state: row.state as HostInboxDeliveryRecord['state'],
    leaseUntil: Number(row.lease_until),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function getUnreadHostPosts(boardId: string, sinceSeqId?: number): BoardPost[] {
  const board = getBoard(boardId);
  if (!board) return [];
  const roster = getBoardAgents(boardId);
  const leaderSlotId = (roster.find((r) => r.isLeader) || roster[0])?.slotId || 'lead';
  const cursor = sinceSeqId !== undefined ? sinceSeqId : board.hostLastReadSeqId;

  return getBoardPosts(boardId, cursor).filter(
    (p) =>
      (p.authorType === 'human' &&
        p.meta.hostDelivery !== 'cli_fallback' &&
        (p.mentions.length === 0 || p.mentions.includes(leaderSlotId))) ||
      (p.authorType === 'agent' && p.authorSlotId !== leaderSlotId) ||
      (p.kind === 'approval_gate' && p.meta.approvalStatus === 'pending')
  );
}

export function recomputeBoardHookPendingSeq(boardId: string): Board | null {
  const board = getBoard(boardId);
  if (!board) return null;
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(to_seq_id), 0) AS m
       FROM host_inbox_deliveries
       WHERE board_id = ? AND state = 'hook_injected' AND to_seq_id > ?`
    )
    .get(boardId, board.hostLastReadSeqId) as { m: number } | undefined;
  const pendingSeq = Number(row?.m || 0);
  if (pendingSeq !== board.hostHookPendingSeqId) {
    return updateBoardConfig(boardId, { hostHookPendingSeqId: pendingSeq });
  }
  return board;
}

export function claimHostInboxDelivery(params: {
  boardId: string;
  sessionKey: string;
  retryDeliveryId?: string;
  leaseMs?: number;
}):
  | { status: 'empty' }
  | { status: 'busy_claimed' }
  | { status: 'claimed'; delivery: HostInboxDeliveryRecord; posts: BoardPost[] } {
  const board = getBoard(params.boardId);
  if (!board) return { status: 'empty' };

  const now = Date.now();
  const leaseMs = Math.max(1000, params.leaseMs ?? 8000);

  // 1. Expire any stale unconfirmed claims on this board
  db.prepare(
    `UPDATE host_inbox_deliveries
     SET state = 'failed', updated_at = ?
     WHERE board_id = ? AND state = 'claimed' AND lease_until <= ?`
  ).run(now, params.boardId, now);

  // 2. Explicit retry of a specific deliveryId
  if (params.retryDeliveryId) {
    const retryRow = db
      .prepare('SELECT * FROM host_inbox_deliveries WHERE id = ? AND board_id = ?')
      .get(params.retryDeliveryId, params.boardId) as Record<string, unknown> | undefined;
    if (retryRow) {
      const existing = mapInboxDelivery(retryRow);
      if (existing.state !== 'acked') {
        db.prepare(
          `UPDATE host_inbox_deliveries
           SET state = 'claimed', session_key = ?, lease_until = ?, updated_at = ?
           WHERE id = ?`
        ).run(params.sessionKey, now + leaseMs, now, existing.id);
        recomputeBoardHookPendingSeq(params.boardId);
        const posts = existing.postIds
          .map((pid) => getPostById(pid))
          .filter((p): p is BoardPost => Boolean(p));
        if (posts.length > 0) {
          const fresh = mapInboxDelivery(
            db.prepare('SELECT * FROM host_inbox_deliveries WHERE id = ?').get(existing.id) as Record<
              string,
              unknown
            >
          );
          return { status: 'claimed', delivery: fresh, posts };
        }
      }
    }
  }

  // 3. Concurrency guard: prevent two simultaneous Hook invocations from double-claiming
  const inFlight = db
    .prepare(
      `SELECT id FROM host_inbox_deliveries
       WHERE board_id = ? AND state = 'claimed' AND lease_until > ?
       LIMIT 1`
    )
    .get(params.boardId, now) as { id: string } | undefined;
  if (inFlight) {
    return { status: 'busy_claimed' };
  }

  // 4. Skip messages already injected to this session unless explicitly retried/failed
  const injectedRow = db
    .prepare(
      `SELECT COALESCE(MAX(to_seq_id), 0) AS m
       FROM host_inbox_deliveries
       WHERE board_id = ? AND session_key = ? AND state IN ('hook_injected', 'acked')`
    )
    .get(params.boardId, params.sessionKey) as { m: number } | undefined;

  const effectiveSince = Math.max(board.hostLastReadSeqId, Number(injectedRow?.m || 0));
  const unread = getUnreadHostPosts(params.boardId, effectiveSince);
  if (unread.length === 0) {
    return { status: 'empty' };
  }

  const deliveryId = `dlv_${crypto.randomUUID().slice(0, 8)}`;
  const fromSeqId = unread[0].seqId;
  const toSeqId = unread[unread.length - 1].seqId;
  const postIds = unread.map((p) => p.id);

  db.prepare(
    `INSERT INTO host_inbox_deliveries (
      id, board_id, session_key, from_seq_id, to_seq_id, post_ids_json,
      state, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'claimed', ?, ?, ?)`
  ).run(
    deliveryId,
    params.boardId,
    params.sessionKey,
    fromSeqId,
    toSeqId,
    JSON.stringify(postIds),
    now + leaseMs,
    now,
    now
  );

  const delivery = mapInboxDelivery(
    db.prepare('SELECT * FROM host_inbox_deliveries WHERE id = ?').get(deliveryId) as Record<
      string,
      unknown
    >
  );
  return { status: 'claimed', delivery, posts: unread };
}

export function confirmHostInboxDelivery(params: {
  deliveryId?: string;
  boardId?: string;
  stage: 'hook_injected' | 'acked' | 'failed';
  upToSeqId?: number;
  viaWait?: boolean;
  deliveryTag?: DeliverableMeta['hostDelivery'];
}): { board: Board | null; updatedPosts: BoardPost[]; delivery: HostInboxDeliveryRecord | null } {
  const now = Date.now();
  const updatedPosts: BoardPost[] = [];

  let targetDelivery: HostInboxDeliveryRecord | null = null;
  if (params.deliveryId) {
    const r = db
      .prepare('SELECT * FROM host_inbox_deliveries WHERE id = ?')
      .get(params.deliveryId) as Record<string, unknown> | undefined;
    if (r) targetDelivery = mapInboxDelivery(r);
  } else if (params.boardId && params.stage === 'failed') {
    const r = db
      .prepare(
        `SELECT * FROM host_inbox_deliveries
         WHERE board_id = ? AND state IN ('claimed', 'hook_injected')
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(params.boardId) as Record<string, unknown> | undefined;
    if (r) targetDelivery = mapInboxDelivery(r);
  }

  const boardId = targetDelivery?.boardId || params.boardId || '';
  if (!boardId) return { board: null, updatedPosts, delivery: null };

  if (params.stage === 'hook_injected' && targetDelivery) {
    if (targetDelivery.state !== 'acked') {
      db.prepare(
        `UPDATE host_inbox_deliveries SET state = 'hook_injected', updated_at = ? WHERE id = ?`
      ).run(now, targetDelivery.id);
      for (const pid of targetDelivery.postIds) {
        const p = getPostById(pid);
        if (
          p &&
          p.authorType === 'human' &&
          (!p.meta.hostDelivery || p.meta.hostDelivery === 'queued_for_host')
        ) {
          const upd = updatePostMeta(pid, { hostDelivery: 'hook_injected' });
          if (upd) updatedPosts.push(upd);
        }
      }
    }
    const board = recomputeBoardHookPendingSeq(boardId);
    const freshRow = db
      .prepare('SELECT * FROM host_inbox_deliveries WHERE id = ?')
      .get(targetDelivery.id) as Record<string, unknown> | undefined;
    return {
      board,
      updatedPosts,
      delivery: freshRow ? mapInboxDelivery(freshRow) : targetDelivery,
    };
  }

  if (params.stage === 'failed') {
    if (targetDelivery && targetDelivery.state !== 'acked') {
      db.prepare(
        `UPDATE host_inbox_deliveries SET state = 'failed', updated_at = ? WHERE id = ?`
      ).run(now, targetDelivery.id);
      for (const pid of targetDelivery.postIds) {
        const p = getPostById(pid);
        if (p && p.authorType === 'human' && p.meta.hostDelivery === 'hook_injected') {
          const upd = updatePostMeta(pid, { hostDelivery: 'queued_for_host' });
          if (upd) updatedPosts.push(upd);
        }
      }
    }
    const board = recomputeBoardHookPendingSeq(boardId);
    const freshRow = targetDelivery
      ? (db
          .prepare('SELECT * FROM host_inbox_deliveries WHERE id = ?')
          .get(targetDelivery.id) as Record<string, unknown> | undefined)
      : undefined;
    return {
      board,
      updatedPosts,
      delivery: freshRow ? mapInboxDelivery(freshRow) : targetDelivery,
    };
  }

  // stage === 'acked'
  const boardBefore = getBoard(boardId);
  if (!boardBefore) return { board: null, updatedPosts, delivery: targetDelivery };

  const targetSeq =
    params.upToSeqId !== undefined
      ? params.upToSeqId
      : targetDelivery
        ? targetDelivery.toSeqId
        : getBoardMaxSeqId(boardId);

  if (targetSeq > 0) {
    db.prepare(
      `UPDATE host_inbox_deliveries
       SET state = 'acked', updated_at = ?
       WHERE board_id = ? AND to_seq_id <= ? AND state != 'acked'`
    ).run(now, boardId, targetSeq);

    const roster = getBoardAgents(boardId);
    const leaderSlotId = (roster.find((r) => r.isLeader) || roster[0])?.slotId || 'lead';
    const candidatePosts = getBoardPosts(boardId, boardBefore.hostLastReadSeqId).filter(
      (p) =>
        p.seqId <= targetSeq &&
        p.authorType === 'human' &&
        p.meta.hostDelivery !== 'cli_fallback' &&
        (p.mentions.length === 0 || p.mentions.includes(leaderSlotId))
    );
    const nextDeliveryTag: DeliverableMeta['hostDelivery'] =
      params.deliveryTag || (params.viaWait ? 'delivered_to_wait' : 'host_acked');

    for (const p of candidatePosts) {
      if (p.meta.hostDelivery !== 'delivered_to_wait' && p.meta.hostDelivery !== nextDeliveryTag) {
        const upd = updatePostMeta(p.id, { hostDelivery: nextDeliveryTag });
        if (upd) updatedPosts.push(upd);
      }
    }

    updateBoardConfig(boardId, { hostLastReadSeqId: targetSeq });
  }

  const board = recomputeBoardHookPendingSeq(boardId);
  const freshRow = targetDelivery
    ? (db
        .prepare('SELECT * FROM host_inbox_deliveries WHERE id = ?')
        .get(targetDelivery.id) as Record<string, unknown> | undefined)
    : undefined;
  return {
    board,
    updatedPosts,
    delivery: freshRow ? mapInboxDelivery(freshRow) : targetDelivery,
  };
}

export interface McpWaveRecord {
  waveId: string;
  boardId: string;
  dispatchKey: string;
  dispatchPostId: string;
  startSeqId: number;
  cursorSeqId: number;
  targetSlots: string[];
  status: 'running' | 'completed' | 'failed';
  lastReason: string;
  createdAt: number;
  updatedAt: number;
}

function mapMcpWave(row: Record<string, unknown>): McpWaveRecord {
  return {
    waveId: String(row.wave_id),
    boardId: String(row.board_id),
    dispatchKey: String(row.dispatch_key || ''),
    dispatchPostId: String(row.dispatch_post_id),
    startSeqId: Number(row.start_seq_id),
    cursorSeqId: Number(row.cursor_seq_id),
    targetSlots: JSON.parse(String(row.target_slots_json || '[]')),
    status: row.status as McpWaveRecord['status'],
    lastReason: String(row.last_reason || 'dispatched'),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function createMcpWave(params: {
  boardId: string;
  dispatchKey: string;
  dispatchPostId: string;
  startSeqId: number;
  targetSlots: string[];
}): McpWaveRecord {
  const waveId = `wav_${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO mcp_waves (
      wave_id, board_id, dispatch_key, dispatch_post_id, start_seq_id, cursor_seq_id,
      target_slots_json, status, last_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'dispatched', ?, ?)`
  ).run(
    waveId,
    params.boardId,
    params.dispatchKey,
    params.dispatchPostId,
    params.startSeqId,
    params.startSeqId,
    JSON.stringify(params.targetSlots),
    now,
    now
  );
  updateBoardConfig(params.boardId, {
    activeWaveId: waveId,
    hostLastSettlementReason: 'dispatched',
  });
  return getMcpWave(waveId)!;
}

export function getMcpWave(waveId: string): McpWaveRecord | null {
  const row = db
    .prepare('SELECT * FROM mcp_waves WHERE wave_id = ?')
    .get(waveId) as Record<string, unknown> | undefined;
  return row ? mapMcpWave(row) : null;
}

export function getLatestBoardMcpWave(boardId: string): McpWaveRecord | null {
  const row = db
    .prepare('SELECT * FROM mcp_waves WHERE board_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(boardId) as Record<string, unknown> | undefined;
  return row ? mapMcpWave(row) : null;
}

export function findReusableMcpWave(
  boardId: string,
  dispatchKey: string,
  hasExplicitKey: boolean
): McpWaveRecord | null {
  if (!dispatchKey) return null;
  const rows = db
    .prepare(
      'SELECT * FROM mcp_waves WHERE board_id = ? AND dispatch_key = ? ORDER BY created_at DESC LIMIT 3'
    )
    .all(boardId, dispatchKey) as Record<string, unknown>[];
  const now = Date.now();
  for (const r of rows) {
    const wave = mapMcpWave(r);
    // Explicit idempotencyKey deduplicates indefinitely; automatic fingerprint deduplicates while running or within 90s retry window
    if (hasExplicitKey || wave.status === 'running' || now - wave.createdAt <= 90_000) {
      return wave;
    }
  }
  return null;
}

export function updateMcpWaveProgress(
  waveId: string,
  patch: {
    cursorSeqId?: number;
    status?: McpWaveRecord['status'];
    lastReason?: string;
  }
): McpWaveRecord | null {
  const existing = getMcpWave(waveId);
  if (!existing) return null;
  const now = Date.now();
  const nextCursor =
    patch.cursorSeqId !== undefined
      ? Math.max(existing.cursorSeqId, patch.cursorSeqId)
      : existing.cursorSeqId;
  const nextStatus = patch.status ?? existing.status;
  const nextReason = patch.lastReason ?? existing.lastReason;

  db.prepare(
    `UPDATE mcp_waves
     SET cursor_seq_id = ?, status = ?, last_reason = ?, updated_at = ?
     WHERE wave_id = ?`
  ).run(nextCursor, nextStatus, nextReason, now, waveId);

  const board = getBoard(existing.boardId);
  if (board) {
    updateBoardConfig(existing.boardId, {
      hostLastSettlementReason: nextReason,
      activeWaveId:
        nextStatus === 'completed' || nextStatus === 'failed'
          ? board.activeWaveId === waveId
            ? null
            : board.activeWaveId
          : waveId,
    });
  }

  return getMcpWave(waveId);
}
