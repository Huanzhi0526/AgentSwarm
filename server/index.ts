import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  DATA_DIR,
  REPO_ROOT,
  addAgentSlotToBoard,
  claimHostInboxDelivery,
  confirmHostInboxDelivery,
  createBoard,
  db,
  deleteBoard,
  deleteEngineDefaultConfig,
  getBoard,
  getBoardAgents,
  getBoardMaxSeqId,
  getBoardPosts,
  getBoardTasks,
  getEngineDefaultConfigs,
  getOrchestrationPreferences,
  getPostById,
  getUiTheme,
  getUnreadHostPosts,
  insertPost,
  listBoards,
  removeAgentSlotFromBoard,
  saveEngineDefaultConfig,
  saveOrchestrationPreferences,
  saveUiTheme,
  updateAgentSlot,
  updateBoardConfig,
  updatePostMeta,
  updatePostsBySnapshotId,
  upsertTask,
} from './db.js';
import {
  buildWorkbenchOverview,
  detectNetworkEndpoints,
  getAllEngineModelsMap,
} from './telemetry/localScanner.js';
import { getAgentRawLogs, SwarmOrchestrator } from './orchestrator/swarmBus.js';
import { TEAM_PRESETS } from './orchestrator/presets.js';
import { openInteractiveAgentSession } from './engines/cliRunner.js';
import {
  listDesktopMcpClients,
  registerDesktopMcpClient,
  unregisterDesktopMcpClient,
} from './mcp/registrar.js';
import {
  adoptSnapshot,
  createManualCheckpoint,
  createSeedSnapshotForDemo,
  getSnapshotDiffDetail,
  listBoardSnapshots,
  listWorkspaceRelativePaths,
  revertSnapshotToDisk,
} from './safety/snapshotManager.js';
import {
  deleteAccountSlot,
  ensureDefaultAccountSlots,
  listAccountSlots,
  saveCurrentAccountAsSlot,
  switchActiveAccountSlot,
} from './telemetry/accountManager.js';
import {
  apiAuthMiddleware,
  getPairingConfig,
  isLocalRequest,
  isLocalSocketAddress,
  issueClientToken,
  updatePairingConfig,
  verifyClientAccess,
  verifyWsAccess,
} from './auth/pairingGuard.js';
import {
  browseDirectories,
  buildWorkspaceFilePreview,
  createSubDirectory,
  getMimeTypeForExt,
  listWorkspaceDirectoryEntries,
  openPathOnHost,
  pickNativeWindowsFolder,
  resolveSafeWorkspacePath,
} from './fs/workspaceExplorer.js';
import type {
  Board,
  CustomMemberDraft,
  DeliverableMeta,
  DesktopMcpClientId,
  DesktopMcpClientStatus,
  EngineId,
  LeaderMode,
  McpClientDiagnosis,
  McpSelfTestResult,
  ReasoningEffort,
  SessionSyncMode,
  TaskStatus,
} from '../src/types.js';
import { ENGINE_CATALOG } from './engines/catalog.js';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 25880);

if (process.env.AGENT_COWORK_SKIP_HOST_SCAN !== '1') {
  ensureDefaultAccountSlots();
}
db.prepare("UPDATE agent_slots SET state = 'waiting', current_activity = '待命' WHERE state IN ('working', 'blocked')").run();
db.prepare('UPDATE boards SET host_waiting = 0 WHERE host_waiting != 0').run();

function ensureShowcaseBoardSeeded() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM boards').get() as { c: number }).c;
  if (count > 0) return;

  const demoWorkspace = path.join(DATA_DIR, 'demo-workspace');
  fs.mkdirSync(path.join(demoWorkspace, 'src'), { recursive: true });
  fs.mkdirSync(path.join(demoWorkspace, 'docs'), { recursive: true });

  const demoSyncBefore = `export function syncRoom(roomId: string) {\n  return { roomId, connected: true };\n}\n`;
  const demoSyncAfter = `export function syncRoom(roomId: string, modelId?: string) {\n  // 按智能体独立切换模型并支持增量同步\n  return { roomId, modelId: modelId || 'default', connected: true };\n}\n`;
  const demoGuideBefore = `# 协同看板使用指南\n\n基础使用说明。\n`;
  const demoGuideAfter = `# 快速上手指南\n\n本工作区为**离线功能导览**，所有文件均保存在独立目录中，不会改动你的真实项目：\n\n- 点击消息中的 \`@成员\` 可查看双人往来对话\n- 点击下方交付卡的 **预览 / 打开 / 对比改动 / 一键撤回** 体验安全改稿闭环\n- 需要为真实项目组建团队时，点击左上角 **「新建看板」** 并选择目标文件夹\n`;

  fs.writeFileSync(path.join(demoWorkspace, 'src', 'realtimeHub.ts'), demoSyncAfter, 'utf8');
  fs.writeFileSync(path.join(demoWorkspace, 'docs', '快速上手指南.md'), demoGuideAfter, 'utf8');

  const board = createBoard({
    title: '快速上手：多智能体协同导览',
    goal: '直观了解团队分工、产物预览与三向防误覆盖还原流程（不改动本地真实目录）',
    workspacePath: demoWorkspace,
    presetId: 'fullstack-dev',
    executionMode: 'demo',
    sessionSyncMode: 'board_isolated',
  });

  insertPost({
    boardId: board.id,
    authorType: 'human',
    authorSlotId: 'human',
    authorName: '我',
    kind: 'human_directive',
    content: '介绍一下团队成员如何协同分工、交付产物以及自动备份改动的。',
    mentions: ['lead'],
  });

  const t1 = upsertTask({
    boardId: board.id,
    title: '更新同步模块逻辑',
    assigneeSlotId: 'backend',
    status: 'completed',
  });

  const t2 = upsertTask({
    boardId: board.id,
    title: '编写快速上手指南文档',
    assigneeSlotId: 'frontend',
    blockedBy: [t1.id],
    status: 'completed',
  });

  upsertTask({
    boardId: board.id,
    title: '验收交付产物与对比撤回功能',
    assigneeSlotId: 'qa',
    blockedBy: [t2.id],
    status: 'in_progress',
  });

  insertPost({
    boardId: board.id,
    authorType: 'agent',
    authorSlotId: 'lead',
    authorName: '技术主管',
    authorEngine: 'antigravity',
    kind: 'dispatch_brief',
    title: '团队分工安排',
    content:
      '欢迎使用 **AgentSwarm** 协同看板，以下为本轮导览分工：\n1. @backend 负责更新 `src/realtimeHub.ts` 模块；\n2. @frontend 负责撰写 `docs/快速上手指南.md` 文档；\n3. 完成后由 @qa 汇总交付卡，支持预览、对比与一键撤回。',
    mentions: ['backend', 'frontend'],
    meta: { modelId: 'gemini-4-carbon', reasoningEffort: 'high', replyToSlotId: 'human' },
  });

  const snap1 = createSeedSnapshotForDemo({
    boardId: board.id,
    workspacePath: demoWorkspace,
    authorName: '后端开发',
    label: '后端开发：更新同步模块',
    sampleFiles: [
      {
        path: 'src/realtimeHub.ts',
        before: demoSyncBefore,
        after: demoSyncAfter,
      },
    ],
  });

  insertPost({
    boardId: board.id,
    authorType: 'agent',
    authorSlotId: 'backend',
    authorName: '后端开发',
    authorEngine: 'codex',
    kind: 'deliverable',
    title: '同步模块已更新',
    content:
      '已在独立工作区更新 `src/realtimeHub.ts`，可点击下方 **预览** 或 **对比改动** 查看前后差异。@frontend @lead',
    mentions: ['frontend', 'lead'],
    meta: {
      modelId: 'gpt-6.2-sol',
      reasoningEffort: 'high',
      replyToSlotId: 'lead',
      snapshotId: snap1.id,
      changeStatus: 'pending',
      fileChanges: snap1.filesChanged,
      filesChanged: snap1.filesChanged.map((c) => c.path),
    },
  });

  const snap2 = createSeedSnapshotForDemo({
    boardId: board.id,
    workspacePath: demoWorkspace,
    authorName: '前端界面',
    label: '前端界面：编写快速上手指南',
    sampleFiles: [
      {
        path: 'docs/快速上手指南.md',
        before: demoGuideBefore,
        after: demoGuideAfter,
      },
    ],
  });

  insertPost({
    boardId: board.id,
    authorType: 'agent',
    authorSlotId: 'frontend',
    authorName: '前端界面',
    authorEngine: 'codebuddy',
    kind: 'deliverable',
    title: '快速上手指南已就绪',
    content:
      '已生成 `docs/快速上手指南.md`，点击任意 `@成员` 可单独查看双人对话，或直接体验下方改动对比与安全撤回。@qa @lead',
    mentions: ['qa', 'lead'],
    meta: {
      modelId: 'glm-5.3',
      reasoningEffort: 'medium',
      replyToSlotId: 'lead',
      snapshotId: snap2.id,
      changeStatus: 'pending',
      fileChanges: snap2.filesChanged,
      filesChanged: snap2.filesChanged.map((c) => c.path),
    },
  });
}

ensureShowcaseBoardSeeded();

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use('/api', apiAuthMiddleware);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Set<WebSocket>();
const wsIsLocal = new WeakMap<WebSocket, boolean>();
const panelBridgeHeartbeatByBoard = new Map<string, number>();

function isPanelBridgeActive(boardId: string): boolean {
  const ts = panelBridgeHeartbeatByBoard.get(boardId) ?? 0;
  return ts > Date.now() - 10_000;
}

function withLiveBoardFlags(board: Board): Board {
  return {
    ...board,
    hostPanelBridgeActive: isPanelBridgeActive(board.id),
  };
}

function buildAutoStandbyDirective(board: Board, suppressed = false) {
  const enabled = board.leaderMode === 'mcp_host' && board.hostAutoStandby !== false;
  const panelBridge = isPanelBridgeActive(board.id);
  const shouldStandby = enabled && !panelBridge && !suppressed;
  return {
    enabled,
    shouldStandby,
    panelBridgeActive: panelBridge,
    nextToolCall: {
      tool: 'cowork_wait_board',
      arguments: {
        boardId: board.id,
        waitForNewActivity: true,
      },
    },
    directive: shouldStandby
      ? '本看板已开启自动待命监听：向看板同步本轮结论（send_board_message）后，在结束回合前请立即调用 cowork_wait_board(waitForNewActivity=true) 进入 0 Token 挂起监听，以便用户在网页或手机发消息时秒级唤醒你；仅当用户明确要求停止监听或返回 standby_released 时直接结束回合。'
      : panelBridge
        ? 'Antigravity 右侧看板分栏直通已连接：网页或手机留言将自动送入左侧对话，无需额外挂起阻塞。'
        : '自动待命监听已关闭或本轮已释放，请正常结束当前回合。',
  };
}

function broadcastWs(event: {
  type:
    | 'post.created'
    | 'agent.updated'
    | 'agent.created'
    | 'agent.deleted'
    | 'task.upserted'
    | 'board.updated'
    | 'agent.raw_log'
    | 'snapshot.updated'
    | 'theme.updated';
  boardId: string;
  payload: unknown;
}) {
  const payload =
    event.type === 'board.updated' &&
    event.payload &&
    typeof event.payload === 'object' &&
    'id' in event.payload
      ? withLiveBoardFlags(event.payload as Board)
      : event.payload;
  const raw = JSON.stringify({ ...event, payload });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

wss.on('connection', (socket, req) => {
  if (!verifyWsAccess(req)) {
    socket.close(1008, 'Unauthorized');
    return;
  }
  wsClients.add(socket);
  wsIsLocal.set(socket, isLocalSocketAddress(req.socket.remoteAddress));
  socket.on('close', () => wsClients.delete(socket));
});

const previewSandboxSessions = new Map<string, { workspacePath: string; expiresAt: number }>();

function issuePreviewSandboxToken(workspacePath: string): string {
  const now = Date.now();
  for (const [k, v] of previewSandboxSessions.entries()) {
    if (v.expiresAt <= now) previewSandboxSessions.delete(k);
  }
  const token = crypto.randomBytes(16).toString('hex');
  previewSandboxSessions.set(token, { workspacePath, expiresAt: now + 30 * 60_000 });
  return token;
}

const orchestrator = new SwarmOrchestrator(() => PORT, broadcastWs);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

// --- Phase 4: Auth & Mobile Pairing Endpoints ---
app.get('/api/auth/status', (req, res) => {
  const isLocal = isLocalRequest(req);
  const authorized = verifyClientAccess(req);
  const cfg = getPairingConfig();
  res.json({
    authorized,
    isLocalhost: isLocal,
    requirePinOnLan: cfg.requirePinOnLan,
    pinCode: isLocal ? cfg.pinCode : undefined,
  });
});

app.post('/api/auth/unlock', (req, res) => {
  const { pairToken, pinCode } = req.body as { pairToken?: string; pinCode?: string };
  const token = issueClientToken({ pairToken, pinCode });
  if (!token) {
    res.status(401).json({ error: '连接码不正确' });
    return;
  }
  res.json({ ok: true, token });
});

app.patch('/api/auth/config', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: '仅允许在电脑本机修改连接安全设置' });
    return;
  }
  const body = req.body as {
    requirePinOnLan?: boolean;
    regeneratePin?: boolean;
    revokeDevices?: boolean;
  };
  const updated = updatePairingConfig(body);
  if (body.revokeDevices) {
    for (const client of wsClients) {
      if (!wsIsLocal.get(client)) {
        try {
          client.close(1008, 'Device pairing revoked');
        } catch {
          // ignore
        }
      }
    }
  }
  res.json(updated);
});

// --- Workbench & Mobile QR ---
app.get('/api/workbench', async (req, res) => {
  const webPort = process.env.NODE_ENV === 'production' ? PORT : 5173;
  const forceRefresh = req.query.refresh === '1';
  const overview = await buildWorkbenchOverview(webPort, forceRefresh);
  res.json({
    ...overview,
    uiTheme: getUiTheme(),
  });
});

app.get('/api/mobile-qr', async (req, res) => {
  const targetBase = String(req.query.url || '');
  const webPort = process.env.NODE_ENV === 'production' ? PORT : 5173;
  const endpoints = detectNetworkEndpoints(webPort);
  const chosenBase =
    targetBase ||
    endpoints.find((e) => e.kind === 'lan')?.url ||
    endpoints.find((e) => e.kind === 'tailscale')?.url ||
    endpoints[0].url;

  const cfg = getPairingConfig();
  const fullPairUrl = `${chosenBase.replace(/\/$/, '')}/?pair=${cfg.pairToken}`;
  const dataUrl = await QRCode.toDataURL(fullPairUrl, {
    margin: 1,
    width: 260,
    color: { dark: '#252330', light: '#ffffff' },
  });
  res.json({
    url: chosenBase,
    pairUrl: fullPairUrl,
    qrDataUrl: dataUrl,
    endpoints,
    requirePinOnLan: cfg.requirePinOnLan,
    pinCode: isLocalRequest(req) ? cfg.pinCode : undefined,
  });
});

app.get('/api/presets', (_req, res) => {
  res.json(TEAM_PRESETS);
});

app.get('/api/settings/orchestration', (_req, res) => {
  res.json(getOrchestrationPreferences());
});

app.put('/api/settings/orchestration', (req, res) => {
  const { globalDispatchPrompt } = req.body as { globalDispatchPrompt?: string };
  const saved = saveOrchestrationPreferences(String(globalDispatchPrompt ?? ''));
  res.json(saved);
});

app.get('/api/settings/theme', (_req, res) => {
  res.json({ uiTheme: getUiTheme() });
});

app.put('/api/settings/theme', (req, res) => {
  const saved = saveUiTheme(String((req.body as { uiTheme?: string })?.uiTheme || 'purple'));
  broadcastWs({ type: 'theme.updated', boardId: '*', payload: { uiTheme: saved } });
  res.json({ uiTheme: saved });
});

const VALID_ENGINE_IDS = new Set(ENGINE_CATALOG.map((c) => c.id));

app.get('/api/settings/engine-defaults', (_req, res) => {
  res.json(getEngineDefaultConfigs());
});

app.put('/api/settings/engine-defaults/:engineId', (req, res) => {
  const rawEngineId = String(req.params.engineId || '').trim() as Exclude<EngineId, 'demo'>;
  if (!VALID_ENGINE_IDS.has(rawEngineId)) {
    res.status(400).json({ error: `不支持的智能体引擎：${rawEngineId}` });
    return;
  }
  const { modelId, reasoningEffort } = (req.body || {}) as {
    modelId?: string;
    reasoningEffort?: ReasoningEffort;
  };
  if (!modelId?.trim()) {
    res.status(400).json({ error: 'modelId 不能为空' });
    return;
  }
  const saved = saveEngineDefaultConfig(rawEngineId, modelId.trim(), String(reasoningEffort || ''));
  res.json({ ok: true, engineId: rawEngineId, config: saved, all: getEngineDefaultConfigs() });
});

app.delete('/api/settings/engine-defaults/:engineId', (req, res) => {
  const rawEngineId = String(req.params.engineId || '').trim() as Exclude<EngineId, 'demo'>;
  if (!VALID_ENGINE_IDS.has(rawEngineId)) {
    res.status(400).json({ error: `不支持的智能体引擎：${rawEngineId}` });
    return;
  }
  deleteEngineDefaultConfig(rawEngineId);
  res.json({ ok: true, engineId: rawEngineId, all: getEngineDefaultConfigs() });
});

// --- Phase 3: Multi-Account Slot Switcher ---
app.get('/api/accounts', (req, res) => {
  const engine = req.query.engine ? (String(req.query.engine) as Exclude<EngineId, 'demo'>) : undefined;
  res.json(listAccountSlots(engine));
});

app.post('/api/accounts', (req, res) => {
  const { engine, label, accountHint } = req.body as {
    engine: Exclude<EngineId, 'demo'>;
    label: string;
    accountHint?: string;
  };
  try {
    const slot = saveCurrentAccountAsSlot(engine, label, accountHint);
    res.status(201).json(slot);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/accounts/:slotId/switch', (req, res) => {
  try {
    const active = switchActiveAccountSlot(req.params.slotId);
    res.json(active);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/accounts/:slotId', (req, res) => {
  deleteAccountSlot(req.params.slotId);
  res.json({ ok: true });
});

// --- Boards & Agents ---
app.get('/api/boards', (_req, res) => {
  res.json(listBoards().map(withLiveBoardFlags));
});

app.post('/api/boards', (req, res) => {
  const body = req.body as {
    title?: string;
    goal?: string;
    workspacePath?: string;
    presetId?: string;
    executionMode?: 'demo' | 'live_cli';
    sessionSyncMode?: SessionSyncMode;
    engineOverrides?: Record<string, EngineId>;
    modelOverrides?: Record<string, string>;
    effortOverrides?: Record<string, ReasoningEffort>;
    customMembers?: CustomMemberDraft[];
    initialDirective?: string;
  };

  const board = createBoard({
    title: body.title || '新建团队看板',
    goal: body.goal || body.initialDirective || '',
    workspacePath: body.workspacePath || process.cwd(),
    presetId: body.presetId || 'fullstack-dev',
    executionMode: body.executionMode || 'live_cli',
    sessionSyncMode: body.sessionSyncMode || 'leader_only',
    engineOverrides: body.engineOverrides,
    modelOverrides: body.modelOverrides,
    effortOverrides: body.effortOverrides,
    customMembers: body.customMembers,
  });

  if (body.initialDirective?.trim()) {
    void orchestrator.handleHumanMessage({
      boardId: board.id,
      content: body.initialDirective.trim(),
    });
  }

  res.status(201).json(board);
});

app.delete('/api/boards/:boardId', (req, res) => {
  deleteBoard(req.params.boardId);
  res.json({ ok: true });
});

app.get('/api/boards/:boardId/snapshot', (req, res) => {
  const { boardId } = req.params;
  const sinceSeqId = Number(req.query.sinceSeqId || 0);
  const board = getBoard(boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }

  res.json({
    board: withLiveBoardFlags(board),
    agents: getBoardAgents(boardId),
    posts: getBoardPosts(boardId, sinceSeqId),
    tasks: getBoardTasks(boardId),
    snapshots: listBoardSnapshots(boardId),
  });
});

app.get('/api/fs/browse', (req, res) => {
  const requestedPath = req.query.path ? String(req.query.path) : undefined;
  const filterQuery = req.query.q ? String(req.query.q) : undefined;
  const strict = req.query.strict === '1';

  if (strict && requestedPath?.trim()) {
    try {
      const abs = path.resolve(requestedPath.trim());
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        res.status(404).json({ error: '未找到该文件夹路径' });
        return;
      }
    } catch {
      res.status(404).json({ error: '未找到该文件夹路径' });
      return;
    }
  }

  const result = browseDirectories(requestedPath, filterQuery);
  res.json({
    ...result,
    canPickNativeDialog: isLocalRequest(req) && process.platform === 'win32',
  });
});

app.post('/api/fs/mkdir', (req, res) => {
  const { parentPath, name } = req.body as { parentPath?: string; name?: string };
  if (!parentPath || !name) {
    res.status(400).json({ error: '缺少目录路径或新建文件夹名称' });
    return;
  }
  try {
    const createdPath = createSubDirectory(parentPath, name);
    res.status(201).json({ path: createdPath });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/fs/pick-native-folder', async (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: '系统窗口仅支持在电脑本机打开，请直接使用当前网页目录列表选择' });
    return;
  }
  const { initialPath } = req.body as { initialPath?: string };
  const selected = await pickNativeWindowsFolder(initialPath);
  res.json({ cancelled: !selected, path: selected });
});

app.get('/api/boards/:boardId/files', (req, res) => {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  res.json({ files: listWorkspaceRelativePaths(board.workspacePath, 80) });
});

app.get('/api/boards/:boardId/fs/tree', (req, res) => {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  const relDir = req.query.dir ? String(req.query.dir) : '';
  res.json({
    workspacePath: board.workspacePath,
    ...listWorkspaceDirectoryEntries(board.workspacePath, relDir),
  });
});

app.get('/api/boards/:boardId/files/preview', (req, res) => {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  const filePath = String(req.query.path || '');
  const preview = buildWorkspaceFilePreview(board.workspacePath, filePath);
  if (!preview) {
    res.status(404).json({ error: '未找到该文件，可能已被移动或尚未生成' });
    return;
  }

  let sandboxUrl: string | undefined;
  if (preview.kind === 'html') {
    const token = issuePreviewSandboxToken(board.workspacePath);
    const encodedPath = preview.relPath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    sandboxUrl = `/api/preview-sandbox/${token}/${encodedPath}`;
  }

  res.json({
    ...preview,
    sandboxUrl,
    canOpenOnHost: isLocalRequest(req),
  });
});

app.get('/api/preview-sandbox/:previewToken/{*relPath}', (req, res) => {
  const token = String(req.params.previewToken || '');
  const session = previewSandboxSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    res.status(403).send('Preview session expired');
    return;
  }

  const rawParam = req.params.relPath as unknown;
  const joined = Array.isArray(rawParam) ? rawParam.join('/') : String(rawParam || '');
  let decodedRel = joined;
  try {
    decodedRel = decodeURIComponent(joined);
  } catch {
    // keep raw path if partially encoded
  }

  const resolved = resolveSafeWorkspacePath(session.workspacePath, decodedRel);
  if (!resolved || !fs.statSync(resolved.fullPath).isFile()) {
    res.status(404).send('Asset not found in sandbox workspace');
    return;
  }

  const ext = path.extname(resolved.fullPath);
  const hostHeader = req.get('host') || `127.0.0.1:${PORT}`;
  const sandboxScope = `${req.protocol}://${hostHeader}/api/preview-sandbox/${token}/`;

  res.setHeader('Content-Type', getMimeTypeForExt(ext));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; img-src ${sandboxScope} data: blob:; media-src ${sandboxScope} data: blob:; font-src ${sandboxScope} data:; style-src ${sandboxScope} 'unsafe-inline'; script-src ${sandboxScope} 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'`
  );

  fs.createReadStream(resolved.fullPath).pipe(res);
});

app.get('/api/boards/:boardId/files/raw', (req, res) => {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  const filePath = String(req.query.path || '');
  const resolved = resolveSafeWorkspacePath(board.workspacePath, filePath);
  if (!resolved || !fs.statSync(resolved.fullPath).isFile()) {
    res.status(404).send('File not found');
    return;
  }
  const ext = path.extname(resolved.fullPath);
  res.setHeader('Content-Type', getMimeTypeForExt(ext));
  if (req.query.download === '1') {
    const encodedName = encodeURIComponent(path.basename(resolved.fullPath));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
  }
  fs.createReadStream(resolved.fullPath).pipe(res);
});

app.post('/api/boards/:boardId/files/open', (req, res) => {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  const { path: relPath, reveal } = req.body as { path?: string; reveal?: boolean };
  try {
    if (!relPath) {
      openPathOnHost(board.workspacePath, false);
      res.json({ ok: true });
      return;
    }
    const resolved = resolveSafeWorkspacePath(board.workspacePath, relPath);
    if (!resolved) {
      res.status(404).json({ error: '目标路径不在当前工作区内或不存在' });
      return;
    }
    openPathOnHost(resolved.fullPath, Boolean(reveal));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch('/api/boards/:boardId', (req, res) => {
  const { boardId } = req.params;
  const prevBoard = getBoard(boardId);
  const updated = updateBoardConfig(boardId, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  if (
    prevBoard &&
    prevBoard.hostAutoStandby !== false &&
    (req.body as { hostAutoStandby?: boolean })?.hostAutoStandby === false
  ) {
    orchestrator.releaseStandbyWaiters(
      boardId,
      '用户已在看板关闭自动待命监听，请正常结束当前回合。'
    );
  }
  broadcastWs({ type: 'board.updated', boardId, payload: updated });
  for (const agent of getBoardAgents(boardId)) {
    broadcastWs({ type: 'agent.updated', boardId, payload: agent });
  }
  res.json(withLiveBoardFlags(updated));
});

app.post('/api/boards/:boardId/agents', (req, res) => {
  const { boardId } = req.params;
  const board = getBoard(boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }

  const body = req.body as CustomMemberDraft & { assignImmediately?: boolean };
  try {
    const created = addAgentSlotToBoard(boardId, body);
    broadcastWs({ type: 'agent.created', boardId, payload: created });
    if (created.isLeader) {
      for (const a of getBoardAgents(boardId)) {
        if (a.id !== created.id) {
          broadcastWs({ type: 'agent.updated', boardId, payload: a });
        }
      }
    }
    const freshBoard = getBoard(boardId);
    if (freshBoard) {
      broadcastWs({ type: 'board.updated', boardId, payload: freshBoard });
    }

    const notice = insertPost({
      boardId,
      authorType: 'system',
      authorSlotId: 'system',
      authorName: '系统',
      kind: 'system_notice',
      title: '',
      content: `已新增团队成员：${created.displayName} (@${created.slotId}) · ${created.roleTitle}`,
      mentions: [created.slotId],
    });
    broadcastWs({ type: 'post.created', boardId, payload: notice });

    if (
      body.assignImmediately &&
      !created.isLeader &&
      (board.goal.trim().length > 0 ||
        getBoardPosts(boardId).some((p) => p.authorType !== 'system'))
    ) {
      const roster = getBoardAgents(boardId);
      const leader = roster.find((a) => a.isLeader) || roster[0];
      if (leader && leader.slotId !== created.slotId) {
        orchestrator.enqueueWakeup(
          boardId,
          leader.slotId,
          `团队新加入了成员 @${created.slotId}（${created.displayName} · 引擎 ${created.engine}/${created.modelId}，当前职责状态：${created.roleAutoAssigned ? '待主管自动分配' : created.roleTitle}）。请结合当前目标与全局分工偏好为该成员明确职责或调整分工，并按需唤醒协作。`,
          'system'
        );
      }
    }

    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch('/api/boards/:boardId/agents/:slotId', (req, res) => {
  const { boardId, slotId } = req.params;
  const {
    displayName,
    roleTitle,
    roleBrief,
    roleAutoAssigned,
    isLeader,
    engine,
    modelId,
    reasoningEffort,
  } = req.body as {
    displayName?: string;
    roleTitle?: string;
    roleBrief?: string;
    roleAutoAssigned?: boolean;
    isLeader?: boolean;
    engine?: EngineId;
    modelId?: string;
    reasoningEffort?: ReasoningEffort;
  };
  const updated = updateAgentSlot(boardId, slotId, {
    displayName,
    roleTitle,
    roleBrief,
    roleAutoAssigned,
    isLeader,
    engine,
    modelId,
    reasoningEffort,
  });
  if (!updated) {
    res.status(404).json({ error: 'Agent slot not found' });
    return;
  }
  if (isLeader !== undefined) {
    for (const a of getBoardAgents(boardId)) {
      broadcastWs({ type: 'agent.updated', boardId, payload: a });
    }
  } else {
    broadcastWs({ type: 'agent.updated', boardId, payload: updated });
  }
  const freshBoard = getBoard(boardId);
  if (freshBoard) {
    broadcastWs({ type: 'board.updated', boardId, payload: freshBoard });
  }
  res.json(updated);
});

app.delete('/api/boards/:boardId/agents/:slotId', (req, res) => {
  const { boardId, slotId } = req.params;
  try {
    const result = removeAgentSlotFromBoard(boardId, slotId);
    broadcastWs({ type: 'agent.deleted', boardId, payload: { slotId } });
    for (const t of result.reassignedTasks) {
      broadcastWs({ type: 'task.upserted', boardId, payload: t });
    }
    const freshBoard = getBoard(boardId);
    if (freshBoard) {
      broadcastWs({ type: 'board.updated', boardId, payload: freshBoard });
    }
    res.json({ ok: true, slotId, reassignedTasks: result.reassignedTasks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('未找到') ? 404 : 400).json({ error: msg });
  }
});

app.get('/api/boards/:boardId/agents/:slotId/logs', (req, res) => {
  const { boardId, slotId } = req.params;
  res.json({ logs: getAgentRawLogs(boardId, slotId) });
});

app.post('/api/boards/:boardId/agents/:slotId/open-session', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: '仅支持在运行看板的电脑本机打开对话窗口' });
    return;
  }
  const { boardId, slotId } = req.params;
  const board = getBoard(boardId);
  if (!board) {
    res.status(404).json({ error: '未找到该看板' });
    return;
  }
  const slot = getBoardAgents(boardId).find((a) => a.slotId === slotId);
  if (!slot) {
    res.status(404).json({ error: '未找到该成员' });
    return;
  }
  try {
    const result = openInteractiveAgentSession({ board, slot });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Graphical Task Checklist Endpoints ---
app.post('/api/boards/:boardId/tasks', (req, res) => {
  const { boardId } = req.params;
  const { title, assigneeSlotId } = req.body as { title?: string; assigneeSlotId?: string };
  if (!title?.trim()) {
    res.status(400).json({ error: '任务名称不能为空' });
    return;
  }
  const task = upsertTask({
    boardId,
    title: title.trim(),
    assigneeSlotId: assigneeSlotId || 'lead',
    status: 'pending',
  });
  broadcastWs({ type: 'task.upserted', boardId, payload: task });
  res.status(201).json(task);
});

app.patch('/api/boards/:boardId/tasks/:taskId', (req, res) => {
  const { boardId, taskId } = req.params;
  const { status, title, assigneeSlotId } = req.body as {
    status?: TaskStatus;
    title?: string;
    assigneeSlotId?: string;
  };
  const existing = getBoardTasks(boardId).find((t) => t.id === taskId);
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const updated = upsertTask({
    ...existing,
    status: status ?? existing.status,
    title: title ?? existing.title,
    assigneeSlotId: assigneeSlotId ?? existing.assigneeSlotId,
  });
  broadcastWs({ type: 'task.upserted', boardId, payload: updated });
  res.json(updated);
});

// --- Phase 2: Graphical Safety Checkpoints, Diff Preview, Adopt & One-Click Revert ---
app.get('/api/boards/:boardId/snapshots', (req, res) => {
  res.json(listBoardSnapshots(req.params.boardId));
});

app.post('/api/boards/:boardId/snapshots/checkpoint', (req, res) => {
  const board = getBoard(req.params.boardId);
  if (!board) {
    res.status(404).json({ error: 'Board not found' });
    return;
  }
  const { label } = req.body as { label?: string };
  const snap = createManualCheckpoint({
    boardId: board.id,
    workspacePath: board.workspacePath,
    label,
  });
  broadcastWs({ type: 'snapshot.updated', boardId: board.id, payload: snap });
  res.status(201).json(snap);
});

app.get('/api/snapshots/:snapshotId/diff', (req, res) => {
  const detail = getSnapshotDiffDetail(req.params.snapshotId);
  if (!detail) {
    res.status(404).json({ error: '未找到改动详情' });
    return;
  }
  res.json(detail);
});

app.post('/api/snapshots/:snapshotId/adopt', (req, res) => {
  const snap = adoptSnapshot(req.params.snapshotId);
  if (!snap) {
    res.status(404).json({ error: '未找到改动记录' });
    return;
  }
  const affectedPosts = updatePostsBySnapshotId(snap.id, 'adopted');
  broadcastWs({ type: 'snapshot.updated', boardId: snap.boardId, payload: snap });
  for (const p of affectedPosts) {
    broadcastWs({ type: 'post.created', boardId: snap.boardId, payload: p });
  }
  res.json({ ok: true, snapshot: snap });
});

app.post('/api/snapshots/:snapshotId/revert', (req, res) => {
  const mode = (req.body as { mode?: 'strict' | 'skip_conflicts' | 'overwrite_all' } | undefined)?.mode;
  try {
    const result = revertSnapshotToDisk(req.params.snapshotId, { mode });
    if (!result) {
      res.status(404).json({ error: '未找到备份记录' });
      return;
    }

    if (result.hasConflicts) {
      res.status(409).json(result);
      return;
    }

    if (result.protectionSnapshot) {
      broadcastWs({
        type: 'snapshot.updated',
        boardId: result.protectionSnapshot.boardId,
        payload: result.protectionSnapshot,
      });
    }

    broadcastWs({
      type: 'snapshot.updated',
      boardId: result.snapshot.boardId,
      payload: result.snapshot,
    });

    if (result.snapshot.status === 'reverted') {
      const affectedPosts = updatePostsBySnapshotId(result.snapshot.id, 'reverted');
      for (const p of affectedPosts) {
        broadcastWs({ type: 'post.created', boardId: result.snapshot.boardId, payload: p });
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Messages & Approvals ---
app.post('/api/boards/:boardId/messages', async (req, res) => {
  const { boardId } = req.params;
  const { content, targetSlotId, targetExplicitlyChosen, clientMessageId } = req.body as {
    content?: string;
    targetSlotId?: string;
    targetExplicitlyChosen?: boolean;
    clientMessageId?: string;
  };
  if (!content?.trim()) {
    res.status(400).json({ error: '内容不能为空' });
    return;
  }
  try {
    const post = await orchestrator.handleHumanMessage({
      boardId,
      content: content.trim(),
      targetSlotId,
      targetExplicitlyChosen,
      clientMessageId,
    });
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/boards/:boardId/posts/:postId/approve', async (req, res) => {
  const { boardId, postId } = req.params;
  const { decision, feedback } = req.body as {
    decision: 'approved' | 'changes_requested' | 'stopped';
    feedback?: string;
  };

  const existing = getPostById(postId);
  if (!existing) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  // Idempotent guard: dual tabs or double-click must only handle an approval gate once
  if (existing.meta.approvalStatus && existing.meta.approvalStatus !== 'pending') {
    res.json({ ok: true, post: existing, alreadyHandled: true });
    return;
  }

  const updatedPost = updatePostMeta(postId, { approvalStatus: decision });
  if (!updatedPost) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  broadcastWs({ type: 'post.created', boardId, payload: updatedPost });

  const updatedBoard = updateBoardConfig(boardId, { hopCountSinceHuman: 0 });
  if (updatedBoard) {
    broadcastWs({ type: 'board.updated', boardId, payload: updatedBoard });
  }

  if (existing.meta.pausedWakeup) {
    if (decision === 'approved') {
      const sys = insertPost({
        boardId,
        authorType: 'human',
        authorSlotId: 'human',
        authorName: '我',
        kind: 'human_directive',
        content: `同意继续接力，请 @${existing.meta.pausedWakeup.slotId} 继续处理。`,
        mentions: [existing.meta.pausedWakeup.slotId],
      });
      broadcastWs({ type: 'post.created', boardId, payload: sys });
      orchestrator.enqueueWakeup(
        boardId,
        existing.meta.pausedWakeup.slotId,
        existing.meta.pausedWakeup.reason,
        'human'
      );
    } else {
      const stopNotice = insertPost({
        boardId,
        authorType: 'human',
        authorSlotId: 'human',
        authorName: '我',
        kind: 'human_directive',
        content: feedback?.trim() || '本轮先到此为止，等待后续安排。',
        mentions: [],
      });
      broadcastWs({ type: 'post.created', boardId, payload: stopNotice });
    }
    res.json({ ok: true, post: updatedPost });
    return;
  }

  if (decision === 'approved') {
    const sys = insertPost({
      boardId,
      authorType: 'human',
      authorSlotId: 'human',
      authorName: '我',
      kind: 'human_directive',
      content: feedback?.trim() || '已确认，按此推进。',
      mentions: [],
    });
    broadcastWs({ type: 'post.created', boardId, payload: sys });
  } else if (feedback?.trim()) {
    await orchestrator.handleHumanMessage({
      boardId,
      content: feedback.trim(),
      targetSlotId: existing.authorSlotId && existing.authorSlotId !== 'system' ? existing.authorSlotId : 'lead',
      targetExplicitlyChosen: true,
    });
  } else if (decision === 'stopped') {
    const sys = insertPost({
      boardId,
      authorType: 'human',
      authorSlotId: 'human',
      authorName: '我',
      kind: 'human_directive',
      content: '先暂停当前确认事项。',
      mentions: [],
    });
    broadcastWs({ type: 'post.created', boardId, payload: sys });
  }

  res.json({ ok: true, post: updatedPost });
});

app.post('/api/boards/:boardId/agent-callback', (req, res) => {
  const { boardId } = req.params;
  const body = req.body as {
    slotId: string;
    action: 'task-upsert' | 'submit-deliverable' | 'ask-approval';
    taskId?: string;
    title?: string;
    description?: string;
    content?: string;
    assigneeSlotId?: string;
    status?: TaskStatus;
    blockedBy?: string[];
    filesChanged?: string[];
    diffSnippet?: string;
    mentions?: string[];
  };

  const agents = getBoardAgents(boardId);
  const caller = agents.find((a) => a.slotId === body.slotId);
  const authorName = caller?.displayName || body.slotId;

  if (body.action === 'task-upsert') {
    const task = upsertTask({
      id: body.taskId,
      boardId,
      title: body.title || '子任务',
      description: body.description || '',
      assigneeSlotId: body.assigneeSlotId || body.slotId,
      status: body.status || 'pending',
      blockedBy: body.blockedBy,
    });
    broadcastWs({ type: 'task.upserted', boardId, payload: task });
    res.json({ ok: true, task });
    return;
  }

  if (body.action === 'submit-deliverable') {
    const post = insertPost({
      boardId,
      authorType: 'agent',
      authorSlotId: body.slotId,
      authorName,
      authorEngine: caller?.engine,
      kind: 'deliverable',
      title: body.title || '',
      content: body.content || '已提交成果。',
      mentions: body.mentions ?? ['lead'],
      meta: {
        modelId: caller?.modelId,
        reasoningEffort: caller?.reasoningEffort,
        taskId: body.taskId,
        filesChanged: body.filesChanged ?? [],
        diffSnippet: body.diffSnippet ?? '',
      },
    });
    broadcastWs({ type: 'post.created', boardId, payload: post });
    res.json({ ok: true, post });
    return;
  }

  if (body.action === 'ask-approval') {
    const post = insertPost({
      boardId,
      authorType: 'agent',
      authorSlotId: body.slotId,
      authorName,
      authorEngine: caller?.engine,
      kind: 'approval_gate',
      title: body.title || '请确认',
      content: body.content || '',
      mentions: [],
      meta: {
        modelId: caller?.modelId,
        reasoningEffort: caller?.reasoningEffort,
        approvalStatus: 'pending',
      },
    });
    broadcastWs({ type: 'post.created', boardId, payload: post });
    res.json({ ok: true, post });
    return;
  }

  res.status(400).json({ error: 'Unknown callback action' });
});

app.post('/api/boards/:boardId/leader-cli-reply', (req, res) => {
  const { boardId } = req.params;
  const { reason } = (req.body || {}) as { reason?: string };
  try {
    const out = orchestrator.triggerCliLeaderFallbackOnce(boardId, reason);
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- v1.3 Local-Only MCP Host Bridge & Registrar Endpoints ---
function normalizeFsMatchPath(rawPath: string): string {
  const cleaned = path.resolve(rawPath).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
}

const VALID_DESKTOP_CLIENT_IDS = new Set<DesktopMcpClientId>([
  'antigravity',
  'codex',
  'codebuddy',
  'claude',
]);

function buildEnrichedDesktopClients(homeDir?: string): DesktopMcpClientStatus[] {
  const baseClients = listDesktopMcpClients(homeDir ? { homeDir } : undefined);
  const activeMcpBoards = listBoards().filter(
    (b) => b.leaderMode === 'mcp_host' && b.status === 'active'
  );

  return baseClients.map((client) => {
    const matchingBoards = activeMcpBoards.filter(
      (b) => (b.hostClient || 'antigravity').toLowerCase() === client.id
    );
    const isWaiting = matchingBoards.some((b) => b.hostWaiting);
    const hasBoundSession = matchingBoards.some((b) => Boolean(b.hostSessionRef));
    const unreadCount = matchingBoards.reduce(
      (sum, b) => sum + getUnreadHostPosts(b.id).length,
      0
    );

    const sessionBindingState: DesktopMcpClientStatus['sessionBindingState'] = isWaiting
      ? 'waiting'
      : hasBoundSession
        ? 'bound_idle'
        : 'unbound';

    const sessionBindingLabel = isWaiting
      ? '正在等待（网页插话实时直达）'
      : hasBoundSession
        ? '当前会话已绑定'
        : matchingBoards.length > 0
          ? '已有看板（待绑定对话）'
          : '尚未建立桌面端看板';

    const deliveryModeLabel = client.supportsHook
      ? client.hookRegistered
        ? '闲置留言：下次发起对话时带入'
        : '闲置留言：Hook 已停用（需开启或手动续接）'
      : '闲置留言：当前客户端需手动续接';

    return {
      ...client,
      sessionBindingState,
      sessionBindingLabel,
      deliveryModeLabel,
      unreadForClientCount: unreadCount,
    };
  });
}

app.get('/api/mcp/clients', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: '仅允许在本机查看桌面端接入状态' });
    return;
  }
  res.json({ clients: buildEnrichedDesktopClients() });
});

app.post('/api/mcp/clients/:clientId/register', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: '仅允许在本机修改桌面端 MCP 配置' });
    return;
  }
  const clientId = req.params.clientId as DesktopMcpClientId;
  if (!VALID_DESKTOP_CLIENT_IDS.has(clientId)) {
    res.status(400).json({ error: '不支持的桌面客户端类型' });
    return;
  }
  const enableHook = (req.body as { enableHook?: boolean } | undefined)?.enableHook;
  try {
    registerDesktopMcpClient(clientId, { enableHook });
    const clients = buildEnrichedDesktopClients();
    const status = clients.find((c) => c.id === clientId)!;
    res.json({ ok: true, client: status, clients });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/mcp/clients/:clientId/unregister', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: '仅允许在本机修改桌面端 MCP 配置' });
    return;
  }
  const clientId = req.params.clientId as DesktopMcpClientId;
  if (!VALID_DESKTOP_CLIENT_IDS.has(clientId)) {
    res.status(400).json({ error: '不支持的桌面客户端类型' });
    return;
  }
  try {
    unregisterDesktopMcpClient(clientId);
    const clients = buildEnrichedDesktopClients();
    const status = clients.find((c) => c.id === clientId)!;
    res.json({ ok: true, client: status, clients });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/mcp/self-test', async (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: '仅允许在本机执行 MCP 自检' });
    return;
  }

  const healthStart = Date.now();
  let serverHealth = { ok: false, latencyMs: 0 };
  try {
    const hr = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    serverHealth = { ok: hr.ok, latencyMs: Date.now() - healthStart };
  } catch {
    serverHealth = { ok: false, latencyMs: Date.now() - healthStart };
  }

  const stdioStart = Date.now();
  let mcpStdio: McpSelfTestResult['mcpStdio'] = {
    ok: false,
    latencyMs: 0,
    toolsCount: 0,
    hasPanelResource: false,
  };
  const mcpIndexJs = path.join(REPO_ROOT, 'dist-mcp', 'index.js');
  const tsxCli = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const stdioArgs = fs.existsSync(mcpIndexJs)
    ? [mcpIndexJs]
    : [tsxCli, path.join(REPO_ROOT, 'server', 'mcp', 'index.ts')];

  let testClient: Client | null = null;
  let testTransport: StdioClientTransport | null = null;
  try {
    testTransport = new StdioClientTransport({
      command: process.execPath,
      args: stdioArgs,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        AGENT_COWORK_PORT: String(PORT),
        AGENT_COWORK_DATA_DIR: DATA_DIR,
      } as Record<string, string>,
    });
    testClient = new Client({ name: 'cowork-self-test', version: '1.3.0' });
    await Promise.race([
      (async () => {
        await testClient!.connect(testTransport!);
        const tl = await testClient!.listTools();
        const rl = await testClient!.listResources();
        const hasPanel = rl.resources.some((r) => r.uri === 'ui://cowork-board/panel.html');
        mcpStdio = {
          ok: tl.tools.length >= 6 && hasPanel,
          latencyMs: Date.now() - stdioStart,
          toolsCount: tl.tools.length,
          hasPanelResource: hasPanel,
        };
      })(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('MCP stdio 握手探活超时 (4.5s)')), 4500)
      ),
    ]);
  } catch (err) {
    mcpStdio = {
      ok: false,
      latencyMs: Date.now() - stdioStart,
      toolsCount: 0,
      hasPanelResource: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await testClient?.close().catch(() => {});
    await testTransport?.close().catch(() => {});
  }

  const hookStart = Date.now();
  const hookJsPath = path.join(REPO_ROOT, 'dist-mcp', 'preInvocationHook.js');
  const hookScriptExists = fs.existsSync(hookJsPath);
  let hookProbe: McpSelfTestResult['hookProbe'] = {
    ok: false,
    latencyMs: 0,
    scriptExists: hookScriptExists,
  };
  if (hookScriptExists) {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [hookJsPath],
          {
            cwd: REPO_ROOT,
            env: {
              ...process.env,
              PORT: String(PORT),
              AGENT_COWORK_PORT: String(PORT),
            },
            timeout: 1500,
            windowsHide: true,
          },
          (err, out) => {
            if (err) reject(err);
            else resolve(out);
          }
        );
        child.stdin?.end(JSON.stringify({ dryRun: true }));
      });
      hookProbe = {
        ok: stdout.includes('"dryRunOk":true'),
        latencyMs: Date.now() - hookStart,
        scriptExists: true,
      };
    } catch (err) {
      hookProbe = {
        ok: false,
        latencyMs: Date.now() - hookStart,
        scriptExists: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    hookProbe.error = '未找到 dist-mcp/preInvocationHook.js，请先执行 pnpm build';
  }
  void execFileAsync;

  const enrichedClients = buildEnrichedDesktopClients();
  const diagnoses: McpClientDiagnosis[] = enrichedClients.map((c) => {
    const hookReady = c.supportsHook ? Boolean(c.hookRegistered && hookProbe.ok) : null;
    const sessionState = c.sessionBindingState || 'unbound';
    const unreadCount = c.unreadForClientCount || 0;
    const ok = c.registered && serverHealth.ok && mcpStdio.ok;

    let actionHint = '';
    if (!c.installed) {
      actionHint = '本机暂未检测到该客户端目录或命令；若实际已安装，仍可直接点击「一键接入」写入配置。';
    } else if (!c.registered) {
      actionHint = '尚未写入配置：请点击右侧「一键接入」，完成后在客户端刷新 MCP 或新开对话即可。';
    } else if (!mcpStdio.ok) {
      actionHint = `MCP 工具探活异常（${mcpStdio.error || '构建产物缺失'}）：请运行 pnpm build 后点击「更新」，并在客户端刷新 MCP。`;
    } else if (c.supportsHook && !c.hookRegistered) {
      actionHint =
        unreadCount > 0
          ? `当前有 ${unreadCount} 条待同步留言，但 Hook 已停用：请点击「启用 Hook」后在客户端发送下一句话带入，或在网页点击 CLI 代答。`
          : 'MCP 工具正常，Hook 当前未开启：等待期插话可实时直达；如需闲置留言自动带入下次对话，请开启 Hook。';
    } else if (sessionState === 'waiting') {
      actionHint = '当前桌面会话正在挂起等待波次：网页端发给 @主管 的消息将在 1 秒内直达桌面端。';
    } else if (c.supportsHook && unreadCount > 0) {
      actionHint = `检测到 ${unreadCount} 条待同步留言：Hook 探活正常（${hookProbe.latencyMs}ms），请在 Antigravity 发送下一句话即可自动带入；若刚接入尚未生效，请先在客户端刷新 MCP Servers。`;
    } else if (!c.supportsHook && unreadCount > 0) {
      actionHint = `当前有 ${unreadCount} 条待同步留言：${c.name} 闲置时不会后台自唤醒，请在客户端对主管说「继续查看协同看板」，或在网页使用 CLI 代答。`;
    } else if (c.supportsHook) {
      actionHint = '配置、工具与 Hook 均就绪：等待期实时唤醒，闲置留言将在你下次发起对话时自动带入（首次接入后请确认已在客户端开启/刷新 MCP）。';
    } else {
      actionHint = '配置与工具均就绪：新开对话即可调度看板团队，等待期支持网页实时插话，闲置时请在客户端手动续接。';
    }

    return {
      clientId: c.id,
      name: c.name,
      configReady: c.registered,
      toolsReady: mcpStdio.ok,
      hookReady,
      sessionState,
      sessionLabel: c.sessionBindingLabel || '尚未建立桌面端看板',
      deliveryLabel: c.deliveryModeLabel || '',
      unreadCount,
      ok,
      actionHint,
    };
  });

  const payload: McpSelfTestResult = {
    checkedAt: Date.now(),
    serverHealth,
    mcpStdio,
    hookProbe,
    clients: diagnoses,
  };
  res.json(payload);
});

app.get('/api/mcp/panel-state', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const requestedBoardId = typeof req.query.boardId === 'string' ? req.query.boardId.trim() : '';
  const allBoards = listBoards();
  const boardSummaries = allBoards.map((b) => ({
    id: b.id,
    title: b.title,
    leaderMode: b.leaderMode,
    hostWaiting: b.hostWaiting,
    hostPanelBridgeActive: isPanelBridgeActive(b.id),
    turnCount: b.turnCount,
  }));

  const targetBoard =
    (requestedBoardId ? getBoard(requestedBoardId) : null) ||
    allBoards.find((b) => b.leaderMode === 'mcp_host') ||
    allBoards[0] ||
    null;

  const modelsByEngine = getAllEngineModelsMap();

  if (!targetBoard) {
    res.json({
      webUrl: `http://127.0.0.1:${PORT}`,
      uiTheme: getUiTheme(),
      boards: boardSummaries,
      modelsByEngine,
      board: null,
      agents: [],
      tasks: [],
      snapshots: [],
      posts: [],
    });
    return;
  }

  const bridgeParam = req.query.bridgeActive;
  if (bridgeParam === '1' || bridgeParam === '0') {
    const wasActive = isPanelBridgeActive(targetBoard.id);
    if (bridgeParam === '1') {
      panelBridgeHeartbeatByBoard.set(targetBoard.id, Date.now());
    } else {
      panelBridgeHeartbeatByBoard.delete(targetBoard.id);
    }
    const nowActive = isPanelBridgeActive(targetBoard.id);
    if (nowActive !== wasActive) {
      broadcastWs({ type: 'board.updated', boardId: targetBoard.id, payload: targetBoard });
    }
  }

  res.json({
    webUrl: `http://127.0.0.1:${PORT}`,
    uiTheme: getUiTheme(),
    boards: boardSummaries.map((bs) =>
      bs.id === targetBoard.id
        ? { ...bs, hostPanelBridgeActive: isPanelBridgeActive(targetBoard.id) }
        : bs
    ),
    modelsByEngine,
    board: withLiveBoardFlags(targetBoard),
    agents: getBoardAgents(targetBoard.id),
    tasks: getBoardTasks(targetBoard.id),
    snapshots: listBoardSnapshots(targetBoard.id),
    posts: getBoardPosts(targetBoard.id),
  });
});

app.post('/api/mcp/boards/:boardId/panel-claim-inbox', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const { boardId } = req.params;
  const board = getBoard(boardId);
  if (!board || board.leaderMode !== 'mcp_host') {
    res.json({ claimed: false });
    return;
  }

  panelBridgeHeartbeatByBoard.set(board.id, Date.now());

  if (board.hostWaiting || board.hostCliFallback) {
    res.json({ claimed: false });
    return;
  }

  // Filter strictly to unread human messages queued for the host leader (excluding agent replies already initiated by host)
  const roster = getBoardAgents(board.id);
  const leaderSlotId = (roster.find((r) => r.isLeader) || roster[0])?.slotId || 'lead';
  const candidateHumanUnread = getBoardPosts(board.id, board.hostLastReadSeqId).filter(
    (p) =>
      p.authorType === 'human' &&
      (!p.meta.hostDelivery || p.meta.hostDelivery === 'queued_for_host') &&
      (p.mentions.length === 0 || p.mentions.includes(leaderSlotId))
  );
  if (candidateHumanUnread.length === 0) {
    res.json({ claimed: false });
    return;
  }

  const claimed = claimHostInboxDelivery({
    boardId: board.id,
    sessionKey: `panel:${board.id}`,
    leaseMs: 15_000,
  });

  if (claimed.status !== 'claimed') {
    res.json({
      claimed: false,
      reason: claimed.status === 'busy_claimed' ? 'claimed_in_flight' : 'empty',
    });
    return;
  }

  const unreadPosts = claimed.posts;
  const lines = unreadPosts.map((p) => {
    const sender = p.authorType === 'human' ? '用户在看板留言' : `${p.authorName}(@${p.authorSlotId})`;
    return `- [${sender}]: ${p.content}`;
  });
  const promptText = `[AgentCoWorkBoard 协同看板留言 · 看板「${board.title}」(${board.id}) · 投递单 ${claimed.delivery.id}]\n用户在网页/手机端发来新指示：\n${lines.join('\n')}\n请直接响应上述留言（如需派工可调用 cowork_dispatch_wave，处理或回复后请调用 cowork_manage_board 写回看板）。`;

  res.json({
    claimed: true,
    deliveryId: claimed.delivery.id,
    boardId: board.id,
    latestSeqId: claimed.delivery.toSeqId,
    messages: unreadPosts.map((p) => ({
      id: p.id,
      seqId: p.seqId,
      authorType: p.authorType,
      authorName: p.authorName,
      content: p.content,
      createdAt: p.createdAt,
    })),
    promptText,
  });
});

let runtimeTestOverviewDelayMs = 0;

app.post('/api/mcp/test-delay', (req, res) => {
  if (!isLocalRequest(req) || process.env.AGENT_COWORK_ALLOW_TEST_DELAY !== '1') {
    res.status(403).json({ error: 'Test delay disabled' });
    return;
  }
  const ms = Math.min(20_000, Math.max(0, Number((req.body as { overviewDelayMs?: number })?.overviewDelayMs) || 0));
  runtimeTestOverviewDelayMs = ms;
  res.json({ ok: true, overviewDelayMs: runtimeTestOverviewDelayMs });
});

app.get('/api/mcp/overview', async (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  if (process.env.AGENT_COWORK_ALLOW_TEST_DELAY === '1') {
    const queryDelay =
      typeof req.query.simulateSlowMs === 'string'
        ? Math.min(20_000, Math.max(0, Number(req.query.simulateSlowMs) || 0))
        : 0;
    const effectiveDelay = Math.max(runtimeTestOverviewDelayMs, queryDelay);
    if (effectiveDelay > 0) {
      await new Promise((r) => setTimeout(r, effectiveDelay));
    }
  }
  const forceRefresh = req.query.refresh === '1';
  const overview = await buildWorkbenchOverview(PORT, forceRefresh);
  const boards = listBoards().map((b) => ({
    id: b.id,
    title: b.title,
    goal: b.goal,
    workspacePath: b.workspacePath,
    leaderMode: b.leaderMode,
    hostClient: b.hostClient,
    hostWaiting: b.hostWaiting,
    activeWaveId: b.activeWaveId,
    unreadForHostCount: b.leaderMode === 'mcp_host' ? getUnreadHostPosts(b.id).length : 0,
    executionMode: b.executionMode,
    turnCount: b.turnCount,
    updatedAt: b.updatedAt,
    agentsCount: getBoardAgents(b.id).length,
  }));

  res.json({
    engines: overview.engines.map((e) => ({
      id: e.id,
      name: e.name,
      installed: e.installed,
      stateLabel: e.stateLabel,
      defaultModel: e.defaultModel,
      defaultEffort: e.defaultEffort,
      hasCustomDefault: Boolean(e.hasCustomDefault),
      availableModels: e.availableModels,
      quotaBars: e.quotaBars,
      statusNote: e.statusNote,
    })),
    orchestrationPreferences: overview.orchestrationPreferences,
    boards,
    desktopClients: buildEnrichedDesktopClients(),
    webUrl: `http://127.0.0.1:${PORT}`,
  });
});

app.post('/api/mcp/boards/setup', async (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const body = (req.body || {}) as {
    boardId?: string;
    title?: string;
    goal?: string;
    workspacePath?: string;
    hostClient?: string;
    hostSessionRef?: string;
    reuseExisting?: boolean;
    forceTakeover?: boolean;
    members?: Array<{
      slotId?: string;
      displayName?: string;
      roleTitle?: string;
      roleBrief?: string;
      isLeader?: boolean;
      engine?: EngineId;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
    }>;
  };

  try {
    const cleanWs = path.resolve((body.workspacePath || '').trim() || process.cwd());
    const normWs = normalizeFsMatchPath(cleanWs);
    const hostClient = (body.hostClient || 'antigravity').trim().toLowerCase();

    let targetBoard = body.boardId ? getBoard(body.boardId) : null;
    if (body.boardId && !targetBoard) {
      res.status(404).json({ error: `未找到指定看板：${body.boardId}` });
      return;
    }

    if (!targetBoard && body.reuseExisting !== false) {
      const candidates = listBoards().filter(
        (b) =>
          b.leaderMode === 'mcp_host' &&
          b.status === 'active' &&
          normalizeFsMatchPath(b.workspacePath) === normWs
      );

      if (body.hostSessionRef) {
        const exactSession = candidates.find((b) => b.hostSessionRef === body.hostSessionRef);
        if (exactSession) {
          targetBoard = exactSession;
        } else if (candidates.length > 1 && !body.forceTakeover) {
          res.json({
            reused: false,
            requiresBoardSelection: true,
            message:
              '当前工作区存在多个桌面端协同看板，请传入 boardId 指定要接手的看板，或传 reuseExisting: false 新建看板。',
            candidateBoards: candidates.map((b) => ({
              id: b.id,
              title: b.title,
              hostClient: b.hostClient,
              hostSessionBound: Boolean(b.hostSessionRef),
              unreadCount: getUnreadHostPosts(b.id).length,
              updatedAt: b.updatedAt,
            })),
          });
          return;
        } else if (
          candidates.length === 1 &&
          candidates[0].hostSessionRef &&
          candidates[0].hostSessionRef !== body.hostSessionRef &&
          !body.forceTakeover
        ) {
          res.json({
            reused: false,
            requiresBoardSelection: true,
            message:
              '该工作区看板已绑定另一桌面会话；如需接管请显式传入 boardId（或 forceTakeover: true），如需隔离并行请传 reuseExisting: false。',
            candidateBoards: candidates.map((b) => ({
              id: b.id,
              title: b.title,
              hostClient: b.hostClient,
              hostSessionBound: true,
              unreadCount: getUnreadHostPosts(b.id).length,
              updatedAt: b.updatedAt,
            })),
          });
          return;
        } else {
          targetBoard = candidates[0] || null;
        }
      } else if (candidates.length > 1 && !body.forceTakeover) {
        res.json({
          reused: false,
          requiresBoardSelection: true,
          message:
            '当前工作区存在多个桌面端协同看板，请传入 boardId 明确选择，或传 reuseExisting: false 新建看板。',
          candidateBoards: candidates.map((b) => ({
            id: b.id,
            title: b.title,
            hostClient: b.hostClient,
            hostSessionBound: Boolean(b.hostSessionRef),
            unreadCount: getUnreadHostPosts(b.id).length,
            updatedAt: b.updatedAt,
          })),
        });
        return;
      } else {
        targetBoard = candidates[0] || null;
      }
    }

    if (targetBoard) {
      // P1-01: Reusing/rebinding/renaming a board MUST NEVER implicitly advance hostLastReadSeqId!
      const maxSeq = getBoardMaxSeqId(targetBoard.id);
      const updated = updateBoardConfig(targetBoard.id, {
        leaderMode: 'mcp_host' as LeaderMode,
        hostClient: hostClient || targetBoard.hostClient,
        hostSessionRef: body.hostSessionRef ?? targetBoard.hostSessionRef,
        title: body.title?.trim() || targetBoard.title,
        goal: body.goal?.trim() || targetBoard.goal,
      })!;
      broadcastWs({ type: 'board.updated', boardId: updated.id, payload: updated });
      const unreadPosts = getUnreadHostPosts(updated.id);
      res.json({
        reused: true,
        board: withLiveBoardFlags(updated),
        agents: getBoardAgents(updated.id),
        tasks: getBoardTasks(updated.id),
        latestSeqId: maxSeq,
        hostLastReadSeqId: updated.hostLastReadSeqId,
        unreadCount: unreadPosts.length,
        unreadMessages: unreadPosts.map((p) => ({
          id: p.id,
          seqId: p.seqId,
          authorType: p.authorType,
          authorName: p.authorName,
          content: p.content,
          createdAt: p.createdAt,
        })),
        autoStandby: buildAutoStandbyDirective(updated),
      });
      return;
    }

    const overview = await buildWorkbenchOverview(PORT, false);
    const installedEngines = overview.engines.filter((e) => e.installed);
    const scoreEngine = (e: (typeof installedEngines)[number]) => {
      if (e.quotaBars.length > 0) {
        return e.quotaBars.reduce((acc, b) => acc + b.remainingPercent, 0) / e.quotaBars.length;
      }
      return e.id === 'codebuddy' ? 85 : 70;
    };
    const rankedInstalled = [...installedEngines].sort((a, b) => scoreEngine(b) - scoreEngine(a));
    const fallbackWorkerEngine: EngineId = rankedInstalled[0]?.id || 'codex';
    const validEngineIds = new Set(overview.engines.map((e) => e.id));
    const leaderEngine: EngineId = validEngineIds.has(hostClient as Exclude<EngineId, 'demo'>)
      ? (hostClient as EngineId)
      : 'antigravity';
    const leaderLabel =
      hostClient === 'codex'
        ? 'CodeX 桌面主管'
        : hostClient === 'codebuddy'
          ? 'CodeBuddy 桌面主管'
          : hostClient === 'claude'
            ? 'Claude 桌面主管'
            : 'Antigravity 桌面主管';

    const customMembers: CustomMemberDraft[] = [];
    const reqMembers = Array.isArray(body.members) ? body.members : [];
    const hasExplicitLeader = reqMembers.some((m) => Boolean(m.isLeader));

    if (!hasExplicitLeader) {
      customMembers.push({
        slotId: 'lead',
        displayName: leaderLabel,
        roleTitle: '桌面端统筹主管',
        roleBrief: '在桌面客户端内与用户直接对话，拆解波次任务并调度团队执行。',
        isLeader: true,
        engine: leaderEngine,
      });
    }

    if (reqMembers.length > 0) {
      reqMembers.forEach((m, idx) => {
        const chosenEngine =
          m.engine ||
          rankedInstalled[idx % Math.max(1, rankedInstalled.length)]?.id ||
          fallbackWorkerEngine;
        customMembers.push({
          slotId: m.slotId,
          displayName: m.displayName,
          roleTitle: m.roleTitle,
          roleBrief: m.roleBrief,
          isLeader: Boolean(m.isLeader),
          engine: chosenEngine,
          modelId: m.modelId,
          reasoningEffort: m.reasoningEffort,
        });
      });
    } else {
      const worker1Engine = rankedInstalled[0]?.id || 'codex';
      const worker2Engine =
        rankedInstalled.find((e) => e.id !== worker1Engine)?.id ||
        rankedInstalled[0]?.id ||
        'codebuddy';
      customMembers.push(
        {
          slotId: 'member_1',
          displayName: '核心开发',
          roleTitle: '主实现与代码修改',
          roleBrief: '负责核心代码修改、脚本开发与基础验证。',
          isLeader: false,
          engine: worker1Engine,
        },
        {
          slotId: 'member_2',
          displayName: '审查测试',
          roleTitle: '构建审查与边界核验',
          roleBrief: '负责检查改动边界、运行验证与质量把关。',
          isLeader: false,
          engine: worker2Engine,
        }
      );
    }

    const projectName = path.basename(cleanWs) || '协同项目';
    const created = createBoard({
      title: body.title?.trim() || `${projectName} · 桌面端协同`,
      goal: body.goal?.trim() || '',
      workspacePath: cleanWs,
      presetId: 'free-collab',
      executionMode: 'live_cli',
      sessionSyncMode: 'leader_only',
      leaderMode: 'mcp_host',
      hostClient,
      hostSessionRef: body.hostSessionRef || null,
      customMembers,
    });
    broadcastWs({ type: 'board.updated', boardId: created.id, payload: created });

    res.status(201).json({
      reused: false,
      board: withLiveBoardFlags(created),
      agents: getBoardAgents(created.id),
      tasks: getBoardTasks(created.id),
      latestSeqId: 0,
      autoStandby: buildAutoStandbyDirective(created),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/mcp/boards/:boardId/dispatch-wave', async (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const { boardId } = req.params;
  const body = (req.body || {}) as {
    message?: string;
    title?: string;
    targetSlots?: string[];
    roles?: Array<{ slotId: string; displayName?: string; roleTitle?: string; roleBrief?: string }>;
    tasks?: Array<{
      id?: string;
      title: string;
      description?: string;
      assigneeSlotId: string;
      status?: TaskStatus;
      blockedBy?: string[];
      blockedByTitles?: string[];
    }>;
    hostClient?: string;
    hostSessionRef?: string;
    idempotencyKey?: string;
    waveId?: string;
    wait?: boolean;
    timeoutMs?: number;
  };

  if (!body.message?.trim()) {
    res.status(400).json({ error: 'dispatch message 不能为空' });
    return;
  }

  try {
    const dispatched = orchestrator.dispatchMcpWave({
      boardId,
      message: body.message.trim(),
      title: body.title,
      targetSlots: body.targetSlots,
      roles: body.roles,
      tasks: body.tasks,
      hostClient: body.hostClient,
      hostSessionRef: body.hostSessionRef,
      idempotencyKey: body.idempotencyKey,
      waveId: body.waveId,
    });

    if (body.wait === false) {
      res.json({
        dispatched: true,
        deduplicated: dispatched.deduplicated,
        waveId: dispatched.waveId,
        postId: dispatched.post.id,
        sinceSeqId: dispatched.sinceSeqId,
        queuedSlots: dispatched.queuedSlots,
      });
      return;
    }

    const ac = new AbortController();
    // Node 24 POST bodies close `req` immediately after parsing; listen on `res` for client disconnect!
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    const settlement = await orchestrator.waitForWaveSettlement(boardId, {
      sinceSeqId: dispatched.sinceSeqId,
      timeoutMs: Number(body.timeoutMs || 3_000_000),
      signal: ac.signal,
      waitForNewActivity: false,
      waveId: dispatched.waveId,
      autoCommit: false,
    });

    if (!res.writableEnded && !ac.signal.aborted) {
      orchestrator.commitWaveSettlement(boardId, settlement);
      const liveBoard = getBoard(boardId);
      res.json({
        dispatched: true,
        deduplicated: dispatched.deduplicated,
        queuedSlots: dispatched.queuedSlots,
        ...settlement,
        ...(liveBoard
          ? {
              autoStandby: buildAutoStandbyDirective(
                liveBoard,
                Boolean(settlement.stopAutoStandby || settlement.reason === 'standby_released')
              ),
            }
          : {}),
      });
    }
  } catch (err) {
    if (!res.writableEnded) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg === 'Wait aborted' ? 499 : 400).json({ error: msg });
    }
  }
});

app.get('/api/mcp/boards/:boardId/wait', async (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const { boardId } = req.params;
  const board = getBoard(boardId);
  if (!board) {
    res.status(404).json({ error: '看板不存在' });
    return;
  }

  const rawSince =
    req.query.sinceSeqId !== undefined ? Number(req.query.sinceSeqId) : undefined;
  const rawWaitNew =
    req.query.waitForNewActivity === '1'
      ? true
      : req.query.waitForNewActivity === '0'
        ? false
        : undefined;
  const waveIdParam = typeof req.query.waveId === 'string' ? req.query.waveId.trim() : undefined;
  const timeoutMs = Number(req.query.timeoutMs || 3_000_000);

  const ctx = orchestrator.resolveWaitContext(boardId, {
    waveId: waveIdParam,
    sinceSeqId: rawSince,
    waitForNewActivity: rawWaitNew,
  });

  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  try {
    const settlement = await orchestrator.waitForWaveSettlement(boardId, {
      sinceSeqId: ctx.sinceSeqId,
      timeoutMs,
      signal: ac.signal,
      waitForNewActivity: ctx.waitForNewActivity,
      waveId: ctx.waveId,
      autoCommit: false,
    });
    if (!res.writableEnded && !ac.signal.aborted) {
      orchestrator.commitWaveSettlement(boardId, settlement);
      const liveBoard = getBoard(boardId);
      res.json({
        ...settlement,
        ...(liveBoard
          ? {
              autoStandby: buildAutoStandbyDirective(
                liveBoard,
                Boolean(settlement.stopAutoStandby || settlement.reason === 'standby_released')
              ),
            }
          : {}),
      });
    }
  } catch (err) {
    if (!res.writableEnded) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg === 'Wait aborted' ? 499 : 400).json({ error: msg });
    }
  }
});

app.post('/api/mcp/boards/:boardId/manage', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const { boardId } = req.params;
  const board = getBoard(boardId);
  if (!board) {
    res.status(404).json({ error: '看板不存在' });
    return;
  }

  const body = (req.body || {}) as {
    action?: string;
    slotId?: string;
    displayName?: string;
    roleTitle?: string;
    roleBrief?: string;
    roleAutoAssigned?: boolean;
    isLeader?: boolean;
    engine?: EngineId;
    modelId?: string;
    reasoningEffort?: ReasoningEffort;
    taskId?: string;
    title?: string;
    description?: string;
    status?: TaskStatus;
    assigneeSlotId?: string;
    blockedBy?: string[];
    label?: string;
    snapshotId?: string;
    mode?: 'strict' | 'skip_conflicts' | 'overwrite_all';
    content?: string;
    kind?: 'discussion' | 'approval_gate';
    reason?: string;
    deliveryId?: string;
    upToSeqId?: number;
    ackUnread?: boolean;
  };

  try {
    switch (body.action) {
      case 'add_agent': {
        const created = addAgentSlotToBoard(boardId, {
          slotId: body.slotId,
          displayName: body.displayName,
          roleTitle: body.roleTitle,
          roleBrief: body.roleBrief,
          roleAutoAssigned: body.roleAutoAssigned,
          isLeader: body.isLeader,
          engine: body.engine || 'codex',
          modelId: body.modelId,
          reasoningEffort: body.reasoningEffort,
        });
        broadcastWs({ type: 'agent.created', boardId, payload: created });
        const fresh = getBoard(boardId);
        if (fresh) broadcastWs({ type: 'board.updated', boardId, payload: fresh });
        res.status(201).json({ ok: true, agent: created });
        return;
      }

      case 'update_agent': {
        if (!body.slotId) {
          res.status(400).json({ error: '缺少 slotId' });
          return;
        }
        const updated = updateAgentSlot(boardId, body.slotId, {
          displayName: body.displayName,
          roleTitle: body.roleTitle,
          roleBrief: body.roleBrief,
          roleAutoAssigned: body.roleAutoAssigned,
          isLeader: body.isLeader,
          engine: body.engine,
          modelId: body.modelId,
          reasoningEffort: body.reasoningEffort,
        });
        if (!updated) {
          res.status(404).json({ error: '成员不存在' });
          return;
        }
        for (const a of getBoardAgents(boardId)) {
          broadcastWs({ type: 'agent.updated', boardId, payload: a });
        }
        res.json({ ok: true, agent: updated });
        return;
      }

      case 'remove_agent': {
        if (!body.slotId) {
          res.status(400).json({ error: '缺少 slotId' });
          return;
        }
        const result = removeAgentSlotFromBoard(boardId, body.slotId);
        broadcastWs({ type: 'agent.deleted', boardId, payload: { slotId: body.slotId } });
        for (const t of result.reassignedTasks) {
          broadcastWs({ type: 'task.upserted', boardId, payload: t });
        }
        res.json({ ok: true, ...result });
        return;
      }

      case 'upsert_task': {
        if (!body.title?.trim() && !body.taskId) {
          res.status(400).json({ error: '任务标题不能为空' });
          return;
        }
        const existingTask = body.taskId
          ? getBoardTasks(boardId).find((t) => t.id === body.taskId)
          : undefined;
        const task = upsertTask({
          id: body.taskId,
          boardId,
          title: body.title?.trim() || existingTask?.title || '任务',
          description: body.description ?? existingTask?.description,
          status: body.status ?? existingTask?.status ?? 'pending',
          assigneeSlotId: body.assigneeSlotId || existingTask?.assigneeSlotId || 'lead',
          blockedBy: body.blockedBy ?? existingTask?.blockedBy,
        });
        broadcastWs({ type: 'task.upserted', boardId, payload: task });
        res.json({ ok: true, task });
        return;
      }

      case 'checkpoint': {
        const snap = createManualCheckpoint({
          boardId,
          workspacePath: board.workspacePath,
          label: body.label,
        });
        broadcastWs({ type: 'snapshot.updated', boardId, payload: snap });
        res.status(201).json({ ok: true, snapshot: snap });
        return;
      }

      case 'adopt_snapshot': {
        if (!body.snapshotId) {
          res.status(400).json({ error: '缺少 snapshotId' });
          return;
        }
        const snap = adoptSnapshot(body.snapshotId);
        if (!snap) {
          res.status(404).json({ error: '未找到快照' });
          return;
        }
        const affected = updatePostsBySnapshotId(snap.id, 'adopted');
        broadcastWs({ type: 'snapshot.updated', boardId: snap.boardId, payload: snap });
        for (const p of affected) {
          broadcastWs({ type: 'post.created', boardId: snap.boardId, payload: p });
        }
        res.json({ ok: true, snapshot: snap });
        return;
      }

      case 'revert_snapshot': {
        if (!body.snapshotId) {
          res.status(400).json({ error: '缺少 snapshotId' });
          return;
        }
        const rev = revertSnapshotToDisk(body.snapshotId, { mode: body.mode || 'strict' });
        if (!rev) {
          res.status(404).json({ error: '未找到快照' });
          return;
        }
        if (rev.hasConflicts) {
          res.status(409).json(rev);
          return;
        }
        if (rev.protectionSnapshot) {
          broadcastWs({
            type: 'snapshot.updated',
            boardId: rev.protectionSnapshot.boardId,
            payload: rev.protectionSnapshot,
          });
        }
        broadcastWs({ type: 'snapshot.updated', boardId: rev.snapshot.boardId, payload: rev.snapshot });
        if (rev.snapshot.status === 'reverted') {
          const affected = updatePostsBySnapshotId(rev.snapshot.id, 'reverted');
          for (const p of affected) {
            broadcastWs({ type: 'post.created', boardId: rev.snapshot.boardId, payload: p });
          }
        }
        res.json(rev);
        return;
      }

      case 'send_board_message': {
        if (!body.content?.trim()) {
          res.status(400).json({ error: '消息内容不能为空' });
          return;
        }
        const curBoard = getBoard(boardId)!;
        if (body.ackUnread === true || curBoard.hostHookPendingSeqId > curBoard.hostLastReadSeqId) {
          const ackRes = confirmHostInboxDelivery({
            boardId,
            stage: 'acked',
            upToSeqId:
              body.ackUnread === true ? getBoardMaxSeqId(boardId) : curBoard.hostHookPendingSeqId,
          });
          for (const p of ackRes.updatedPosts) {
            broadcastWs({ type: 'post.created', boardId, payload: p });
          }
        }
        const hadUnpulledUnread = getUnreadHostPosts(boardId).length > 0;
        const roster = getBoardAgents(boardId);
        const leader = roster.find((r) => r.isLeader) || roster[0];
        const post = insertPost({
          boardId,
          authorType: 'agent',
          authorSlotId: leader?.slotId || 'lead',
          authorName: leader?.displayName || '主管',
          authorEngine: leader?.engine,
          kind: body.kind === 'approval_gate' ? 'approval_gate' : 'discussion',
          title: body.title?.trim() || '',
          content: body.content.trim(),
          mentions: [],
          meta: {
            modelId: leader?.modelId,
            reasoningEffort: leader?.reasoningEffort,
            approvalStatus: body.kind === 'approval_gate' ? 'pending' : undefined,
          },
        });
        broadcastWs({ type: 'post.created', boardId, payload: post });
        const synced = !hadUnpulledUnread
          ? updateBoardConfig(boardId, { hostLastReadSeqId: post.seqId })
          : getBoard(boardId);
        if (synced) broadcastWs({ type: 'board.updated', boardId, payload: synced });
        const latestBoard = synced || curBoard;
        const recentStandbyStop =
          latestBoard.hostLastSettlementReason === 'standby_released' ||
          getBoardPosts(boardId, Math.max(0, post.seqId - 6)).some(
            (p) =>
              p.authorType === 'human' &&
              /^(?:@[^\s]+\s*)?(?:结束监听|停止监听|关闭监听)[!！。.\s]*$/i.test(p.content.trim())
          );
        res.status(201).json({
          ok: true,
          post,
          autoStandby: buildAutoStandbyDirective(latestBoard, recentStandbyStop),
        });
        return;
      }

      case 'ack_inbox': {
        const ackRes = confirmHostInboxDelivery({
          boardId,
          deliveryId: body.deliveryId,
          upToSeqId: body.upToSeqId,
          stage: 'acked',
        });
        for (const p of ackRes.updatedPosts) {
          broadcastWs({ type: 'post.created', boardId, payload: p });
        }
        if (ackRes.board) {
          broadcastWs({ type: 'board.updated', boardId, payload: ackRes.board });
        }
        res.json({ ok: true, board: ackRes.board });
        return;
      }

      case 'cli_leader_fallback': {
        const out = orchestrator.triggerCliLeaderFallbackOnce(boardId, body.reason);
        res.json(out);
        return;
      }

      default:
        res.status(400).json({ error: `未知操作类型：${body.action || ''}` });
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/mcp/host-inbox/pull', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const { conversationId, workspacePaths, cwd, boardId, dryRun, retryDeliveryId } = (req.body ||
    {}) as {
    conversationId?: string;
    workspacePaths?: string[];
    cwd?: string;
    boardId?: string;
    dryRun?: boolean;
    retryDeliveryId?: string;
  };

  if (dryRun) {
    res.json({ dryRun: true, hasUnread: false });
    return;
  }

  const candidates = listBoards().filter(
    (b) => b.leaderMode === 'mcp_host' && b.status === 'active'
  );
  if (candidates.length === 0) {
    res.json({ hasUnread: false });
    return;
  }

  const cleanConvId = (conversationId || '').trim();
  let matchedBoard: ReturnType<typeof getBoard> = null;

  // 1. Explicit boardId or exact bound conversationId wins unconditionally
  if (boardId) {
    const explicit = candidates.find((b) => b.id === boardId);
    if (
      explicit &&
      (!explicit.hostSessionRef || !cleanConvId || explicit.hostSessionRef === cleanConvId)
    ) {
      matchedBoard = explicit;
    }
  }
  if (!matchedBoard && cleanConvId) {
    matchedBoard =
      candidates.find((b) => b.hostSessionRef && b.hostSessionRef === cleanConvId) || null;
  }

  // 2. Workspace fallback ONLY inspects unbound boards (never leaks a session-bound board into a different conversation!)
  if (!matchedBoard) {
    const unboundCandidates = candidates.filter((b) => !b.hostSessionRef);
    const rawPaths = [
      ...(Array.isArray(workspacePaths) ? workspacePaths : []),
      ...(cwd ? [cwd] : []),
    ]
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .map(normalizeFsMatchPath);

    if (rawPaths.length > 0 && unboundCandidates.length > 0) {
      // Priority 2a: Exact workspace match
      const exactMatches = unboundCandidates.filter((b) =>
        rawPaths.includes(normalizeFsMatchPath(b.workspacePath))
      );

      let tiedBoards = exactMatches;

      // Priority 2b: Deepest ancestor workspace match (only when user works inside a subdir of a board workspace; NEVER match downward!)
      if (tiedBoards.length === 0) {
        let bestDepth = -1;
        for (const b of unboundCandidates) {
          const normBoardWs = normalizeFsMatchPath(b.workspacePath);
          const isAncestor = rawPaths.some((wp) => wp.startsWith(normBoardWs + path.sep));
          if (isAncestor) {
            if (normBoardWs.length > bestDepth) {
              bestDepth = normBoardWs.length;
              tiedBoards = [b];
            } else if (normBoardWs.length === bestDepth) {
              tiedBoards.push(b);
            }
          }
        }
      }

      if (tiedBoards.length === 1) {
        matchedBoard = tiedBoards[0];
      } else if (tiedBoards.length > 1) {
        const boardsWithUnread = tiedBoards.filter((b) => getUnreadHostPosts(b.id).length > 0);
        if (boardsWithUnread.length >= 1) {
          const summaryLines = tiedBoards
            .map(
              (b) =>
                `- ${b.title} (${b.id}) · 待同步 ${getUnreadHostPosts(b.id).length} 条`
            )
            .join('\n');
          res.json({
            hasUnread: false,
            ambiguous: true,
            candidateBoards: tiedBoards.map((b) => ({ id: b.id, title: b.title })),
            ephemeralText: `[AgentCoWorkBoard 选板提示]\n当前目录存在多个未绑定特定对话的协同看板，为避免串台未自动拉取留言：\n${summaryLines}\n请调用 cowork_setup_board(boardId, hostSessionRef) 明确绑定本对话负责的看板后再处理。`,
          });
          return;
        }
      }
    }
  }

  if (!matchedBoard || matchedBoard.hostWaiting) {
    res.json({ hasUnread: false });
    return;
  }

  const sessionKey = cleanConvId
    ? `session:${cleanConvId}`
    : `ws:${normalizeFsMatchPath(matchedBoard.workspacePath)}`;

  const claimed = claimHostInboxDelivery({
    boardId: matchedBoard.id,
    sessionKey,
    retryDeliveryId,
  });

  if (claimed.status !== 'claimed') {
    res.json({
      hasUnread: false,
      ...(claimed.status === 'busy_claimed' ? { reason: 'claimed_in_flight' } : {}),
    });
    return;
  }

  const unreadPosts = claimed.posts;
  const maxUnreadSeq = claimed.delivery.toSeqId;
  const lines = unreadPosts.map((p) => {
    const sender = p.authorType === 'human' ? '用户在看板留言' : `${p.authorName}(@${p.authorSlotId})`;
    return `- [${sender}]: ${p.content}`;
  });
  const ephemeralText = `[AgentCoWorkBoard 协同看板未读消息 · 看板「${matchedBoard.title}」(${matchedBoard.id}) · 投递单 ${claimed.delivery.id}]\n${lines.join('\n')}\n请响应上述看板动态（调用 cowork_manage_board / cowork_dispatch_wave / cowork_wait_board 后网页端会自动更新为已确认）。`;

  res.json({
    hasUnread: true,
    deliveryId: claimed.delivery.id,
    deliveryState: claimed.delivery.state,
    boardId: matchedBoard.id,
    boardTitle: matchedBoard.title,
    latestSeqId: maxUnreadSeq,
    messages: unreadPosts.map((p) => ({
      id: p.id,
      seqId: p.seqId,
      authorType: p.authorType,
      authorName: p.authorName,
      content: p.content,
      createdAt: p.createdAt,
    })),
    ephemeralText,
  });
});

app.post('/api/mcp/host-inbox/ack', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const { deliveryId, boardId, stage, upToSeqId, deliveryTag } = (req.body || {}) as {
    deliveryId?: string;
    boardId?: string;
    stage?: 'hook_injected' | 'acked' | 'failed';
    upToSeqId?: number;
    deliveryTag?: DeliverableMeta['hostDelivery'];
  };

  const targetStage =
    stage === 'failed' || stage === 'acked' ? stage : 'hook_injected';
  const result = confirmHostInboxDelivery({
    deliveryId,
    boardId,
    stage: targetStage,
    upToSeqId,
    deliveryTag,
  });

  if (result.board) {
    for (const p of result.updatedPosts) {
      broadcastWs({ type: 'post.created', boardId: result.board.id, payload: p });
    }
    broadcastWs({ type: 'board.updated', boardId: result.board.id, payload: result.board });
  }

  res.json({
    ok: true,
    delivery: result.delivery,
    board: result.board,
  });
});

const distDir = path.resolve(REPO_ROOT, 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const pidRecordPath = path.join(DATA_DIR, 'server.pid.json');
function cleanupPidRecord() {
  try {
    if (fs.existsSync(pidRecordPath)) {
      const parsed = JSON.parse(fs.readFileSync(pidRecordPath, 'utf8')) as { pid?: number };
      if (parsed.pid === process.pid) {
        fs.unlinkSync(pidRecordPath);
      }
    }
  } catch {
    // ignore cleanup error
  }
}
process.on('exit', cleanupPidRecord);
process.on('SIGINT', () => {
  cleanupPidRecord();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupPidRecord();
  process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
  try {
    fs.writeFileSync(
      pidRecordPath,
      JSON.stringify(
        {
          pid: process.pid,
          port: PORT,
          dataDir: DATA_DIR,
          startedAt: Date.now(),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // ignore pid record write failure
  }
  const endpoints = detectNetworkEndpoints(PORT);
  console.log(`\nAgentCoWorkBoard Server running on port ${PORT}`);
  for (const ep of endpoints) {
    console.log(`  -> ${ep.label}: ${ep.url}`);
  }
});
