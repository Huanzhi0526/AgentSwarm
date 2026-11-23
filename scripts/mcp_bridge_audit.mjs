import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  listDesktopMcpClients,
  registerDesktopMcpClient,
  unregisterDesktopMcpClient,
} from '../server/mcp/registrar.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAL_DATA_DIR = path.join(REPO_ROOT, 'data');

function snapshotDirStats(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    });
}

function sha1(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
}

async function waitForCondition(fn, timeoutMs = 15000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition timed out after ${timeoutMs}ms`);
}

async function allocateFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function isPortOccupied(port) {
  return await new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.setTimeout(400);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function ensurePortAvailableOrFail(port) {
  if (await isPortOccupied(port)) {
    throw new Error(
      `Port ${port} is already occupied! Aborting without terminating existing process (P2-07 guard).`
    );
  }
}

function stopVerifiedAuditServerPid(dataDir) {
  const pidFile = path.join(dataDir, 'server.pid.json');
  if (!fs.existsSync(pidFile)) return;
  try {
    const record = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    const pid = Number(record?.pid);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

    // Verify process is alive and its command line belongs to this repo's server
    if (process.platform === 'win32') {
      const cmdLine = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { Write-Output $p.CommandLine }`,
        ],
        { windowsHide: true, encoding: 'utf8' }
      ).trim();

      if (
        cmdLine &&
        (cmdLine.includes('dist-server') ||
          cmdLine.includes('server\\index.ts') ||
          cmdLine.includes('server/index.ts'))
      ) {
        process.kill(pid);
      }
    } else {
      const cmdLine = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
      }).trim();
      if (cmdLine.includes('dist-server') || cmdLine.includes('server/index.ts')) {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch {
    // Process already exited or inaccessible
  }
}

async function main() {
  const formalBefore = snapshotDirStats(FORMAL_DATA_DIR);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-v13-audit-'));
  const dataDir = path.join(tmpRoot, 'data');
  const homeDir = path.join(tmpRoot, 'home');
  const fakeBin = path.join(tmpRoot, 'bin');
  const workspaceDir = path.join(tmpRoot, 'workspace');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });

  fs.writeFileSync(path.join(workspaceDir, 'src', 'api.ts'), 'export const ver = 1;\n', 'utf8');

  const cliCallsLog = path.join(dataDir, 'cli-calls.log');

  const mockWorkerScript = path.join(tmpRoot, 'mock-cli.mjs');
  fs.writeFileSync(
    mockWorkerScript,
    `
import fs from 'node:fs';
import path from 'node:path';

const engine = process.argv[2];
const args = process.argv.slice(3);
let stdinData = '';
if (!process.stdin.isTTY && (engine === 'codex' || engine === 'codebuddy')) {
  stdinData = await new Promise((resolve) => {
    const chunks = [];
    const timer = setTimeout(() => resolve(Buffer.concat(chunks).toString('utf8')), 150);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
    process.stdin.resume();
  });
}
const promptText = stdinData || args.join(' ');
const tag = promptText.includes('DISCONNECT_ONCE_STEP')
  ? 'DISCONNECT_ONCE_STEP'
  : promptText.includes('SLOW_STEP')
    ? 'SLOW_STEP'
    : 'NORMAL';
fs.appendFileSync(${JSON.stringify(cliCallsLog)}, JSON.stringify({ engine, tag, at: Date.now(), slot: process.env.COWORK_SLOT_ID || '' }) + '\\n');

if (engine === 'codex') {
  if (promptText.includes('DISCONNECT_ONCE_STEP')) {
    await new Promise((r) => setTimeout(r, 1500));
    fs.writeFileSync(path.join(process.cwd(), 'src', 'reconnect.ts'), 'export const reconnected = true;\\n', 'utf8');
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thr_reconn_1' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '重连恢复步骤完成，已写入 src/reconnect.ts。' } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 110, output_tokens: 40, cached_input_tokens: 15 } }));
  } else if (promptText.includes('SLOW_STEP')) {
    await new Promise((r) => setTimeout(r, 2200));
    fs.writeFileSync(path.join(process.cwd(), 'src', 'slow.ts'), 'export const slowDone = true;\\n', 'utf8');
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thr_slow_1' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '慢速重构已完成，生成 src/slow.ts。' } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 120, output_tokens: 45, cached_input_tokens: 20 } }));
  } else if (promptText.includes('LEGACY_WRITE')) {
    fs.writeFileSync(path.join(process.cwd(), 'src', 'api.ts'), 'export const ver = 2;\\n', 'utf8');
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thr_leg_1' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '已更新 src/api.ts。@lead' } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 40, cached_input_tokens: 10 } }));
  } else {
    fs.writeFileSync(path.join(process.cwd(), 'src', 'api.ts'), 'export const ver = 3;\\n', 'utf8');
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thr_codex_1' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '核心接口已修改 src/api.ts。' } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 150, output_tokens: 55, cached_input_tokens: 30 } }));
  }
} else if (engine === 'codebuddy') {
  fs.mkdirSync(path.join(process.cwd(), 'docs'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'docs', 'qa-report.md'), '# QA Report\\nOK\\n', 'utf8');
  console.log(JSON.stringify({
    type: 'result',
    session_id: 'cb_sess_1',
    result: '验收测试完成，已生成 \`docs/qa-report.md\`。',
    usage: { input_tokens: 90, output_tokens: 35, cache_read_input_tokens: 15 }
  }));
} else if (engine === 'agy') {
  const snapUrl = process.env.COWORK_API_URL && process.env.COWORK_BOARD_ID
    ? process.env.COWORK_API_URL + '/api/boards/' + process.env.COWORK_BOARD_ID + '/snapshot'
    : '';
  let snap = null;
  if (snapUrl) {
    try {
      const r = await fetch(snapUrl);
      if (r.ok) snap = await r.json();
    } catch {}
  }

  if (snap?.board?.leaderMode === 'mcp_host' || promptText.includes('先行代答')) {
    console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'agy_fallback_1', response: '我是后台 CLI 主管，已代为回复：目前任务均按计划推进。' } }));
  } else if (snap?.posts?.some((p) => p.authorSlotId === 'backend') || promptText.includes('已汇报') || promptText.includes('已完成当前处理')) {
    console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'agy_lead_1', response: '收到，所有成员成果已验收归档。' } }));
  } else {
    const dispatchObj = {
      roles: [{ slotId: 'backend', displayName: '后端开发', roleTitle: '核心实现', roleBrief: '修改接口' }],
      tasks: [{ title: '写入接口改动', assigneeSlotId: 'backend', status: 'in_progress' }],
    };
    console.log(JSON.stringify({
      event: 'result',
      result: {
        conversation_id: 'agy_lead_1',
        response: '请 @backend 执行 LEGACY_WRITE。\\n\\n\`\`\`cowork-dispatch\\n' + JSON.stringify(dispatchObj) + '\\n\`\`\`'
      }
    }));
  }
}
`,
    'utf8'
  );

  for (const binName of ['codex', 'codebuddy', 'agy']) {
    const cmdPath = path.join(fakeBin, `${binName}.cmd`);
    fs.writeFileSync(
      cmdPath,
      `@echo off\r\n"${process.execPath}" "${mockWorkerScript}" ${binName} %*\r\n`,
      'utf8'
    );
  }

  // P2-07: Start an unrelated bystander HTTP server and verify port-occupied guard & post-cleanup survival
  const bystanderPort = await allocateFreePort();
  const bystanderServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('BYSTANDER_ALIVE');
  });
  await new Promise((resolve) => bystanderServer.listen(bystanderPort, '127.0.0.1', resolve));

  let mcpClient = null;
  let transport = null;

  try {
    await assert.rejects(
      () => ensurePortAvailableOrFail(bystanderPort),
      /already occupied/,
      'Occupied port guard must refuse without killing bystander process'
    );
    const bystanderCheck1 = await (await fetch(`http://127.0.0.1:${bystanderPort}`)).text();
    assert.equal(bystanderCheck1, 'BYSTANDER_ALIVE');

    const TEST_PORT = process.env.AGENT_COWORK_AUDIT_PORT
      ? Number(process.env.AGENT_COWORK_AUDIT_PORT)
      : await allocateFreePort();
    await ensurePortAvailableOrFail(TEST_PORT);

    const isolatedEnv = {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      USERPROFILE: homeDir,
      LOCALAPPDATA: path.join(tmpRoot, 'empty-local'),
      APPDATA: path.join(tmpRoot, 'empty-roaming'),
      NODE_ENV: 'production',
      PORT: String(TEST_PORT),
      AGENT_COWORK_PORT: String(TEST_PORT),
      AGENT_COWORK_DATA_DIR: dataDir,
      AGENT_COWORK_HOME_DIR: homeDir,
      AGENT_COWORK_SKIP_HOST_SCAN: '1',
      AGENT_COWORK_ALLOW_TEST_DELAY: '1',
    };

    // --- CHECK 1: Silent auto-boot via stdio MCP + overview + self-test (P2-04) + MCP App resource ---
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(REPO_ROOT, 'dist-mcp', 'index.js')],
      env: isolatedEnv,
      cwd: REPO_ROOT,
    });
    mcpClient = new Client({ name: 'v13-audit-client', version: '1.3.0' });
    await mcpClient.connect(transport);

    const toolsList = await mcpClient.listTools();
    const toolNames = toolsList.tools.map((t) => t.name);
    for (const required of [
      'cowork_overview',
      'cowork_setup_board',
      'cowork_dispatch_wave',
      'cowork_wait_board',
      'cowork_manage_board',
      'cowork_panel',
    ]) {
      assert.ok(toolNames.includes(required), `Missing MCP tool ${required}`);
    }

    const panelTool = toolsList.tools.find((t) => t.name === 'cowork_panel');
    const agyEntrypoints = panelTool?._meta?.['com.google.antigravity/ui']?.entrypoints || [];
    assert.ok(
      agyEntrypoints.some((e) => e.type === 'aux_pane') &&
        agyEntrypoints.some((e) => e.type === 'global'),
      'cowork_panel must advertise both aux_pane and global entrypoints'
    );

    const resources = await mcpClient.listResources();
    const panelRes = resources.resources.find((r) => r.uri === 'ui://cowork-board/panel.html');
    assert.ok(panelRes && panelRes.mimeType === 'text/html;profile=mcp-app');

    const ovCall = await mcpClient.callTool({ name: 'cowork_overview', arguments: {} });
    const ovJson = JSON.parse(ovCall.content[0].text);
    assert.ok(Array.isArray(ovJson.engines) && ovJson.engines.length === 20, 'Expected 20 engines');

    const pidRecordPath = path.join(dataDir, 'server.pid.json');
    assert.ok(fs.existsSync(pidRecordPath), 'Isolated server must write server.pid.json');

    const selfTestRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/self-test`, {
      method: 'POST',
    });
    assert.equal(selfTestRes.status, 200);
    const selfTestJson = await selfTestRes.json();
    assert.equal(selfTestJson.serverHealth.ok, true);
    assert.equal(selfTestJson.mcpStdio.ok, true);
    assert.equal(selfTestJson.hookProbe.ok, true);
    console.log('[PASS] Check 1: Silent MCP auto-daemon + PID record + self-test + MCP App ui:// verified');

    // --- CHECK 2: cowork_setup_board + cowork_dispatch_wave (blockedByTitles + waveId + evidence) ---
    const setupCall = await mcpClient.callTool({
      name: 'cowork_setup_board',
      arguments: {
        title: 'MCP 测试协同',
        workspacePath: workspaceDir,
        hostClient: 'antigravity',
        hostSessionRef: 'conv_test_123',
        members: [
          { slotId: 'backend', displayName: '后端开发', engine: 'codex', roleTitle: '后端接口' },
          { slotId: 'qa', displayName: '测试验收', engine: 'codebuddy', roleTitle: '文档与测试' },
        ],
      },
    });
    const setupData = JSON.parse(setupCall.content[0].text);
    const boardId = setupData.board.id;
    assert.equal(setupData.board.leaderMode, 'mcp_host');

    const wave1Call = await mcpClient.callTool({
      name: 'cowork_dispatch_wave',
      arguments: {
        boardId,
        message: '请 @backend 先实现核心接口，完成后自动解锁 @qa 写验收文档。',
        targetSlots: ['backend'],
        tasks: [
          { title: '实现核心接口', assigneeSlotId: 'backend', status: 'in_progress' },
          {
            title: '编写验收报告',
            assigneeSlotId: 'qa',
            status: 'pending',
            blockedByTitles: ['实现核心接口'],
          },
        ],
        wait: true,
        timeoutMs: 25000,
      },
    });
    const wave1 = JSON.parse(wave1Call.content[0].text);
    assert.equal(wave1.reason, 'wave_completed');
    assert.ok(wave1.waveId && wave1.waveId.startsWith('wav_'), 'Must return resumable waveId');
    assert.ok(wave1.evidence.snapshots.length >= 2);
    assert.ok(wave1.evidence.fileChangesSummary.modified.includes('src/api.ts'));
    assert.ok(wave1.evidence.fileChangesSummary.added.includes('docs/qa-report.md'));
    assert.equal(wave1.evidence.tasksSummary.completed, 2);

    const callsAfterWave1 = fs
      .readFileSync(cliCallsLog, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l));
    assert.equal(callsAfterWave1.filter((c) => c.engine === 'agy').length, 0);
    console.log('[PASS] Check 2: cowork_setup_board + cowork_dispatch_wave + waveId + evidence verified');

    // --- CHECK 3: Mid-wave interjection status + waveId continuation + disconnect/idempotency (P2-06) ---
    const wave2Promise = mcpClient.callTool({
      name: 'cowork_dispatch_wave',
      arguments: {
        boardId,
        message: '请 @backend 执行 SLOW_STEP 慢速重构',
        targetSlots: ['backend'],
        wait: true,
        timeoutMs: 25000,
      },
    });

    await new Promise((r) => setTimeout(r, 350));
    const interjectAt = Date.now();
    const msgRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@lead 先停一下，补充要求：同时生成 README.txt' }),
    });
    assert.equal(msgRes.status, 201);

    const wave2Call = await wave2Promise;
    const interruptLatencyMs = Date.now() - interjectAt;
    const wave2 = JSON.parse(wave2Call.content[0].text);
    assert.equal(wave2.reason, 'human_interjection');
    assert.ok(interruptLatencyMs < 1500, `Expected <1500ms interrupt latency, got ${interruptLatencyMs}ms`);
    assert.ok(wave2.waveId, 'Interrupted settlement must return waveId');
    assert.equal(wave2.recoveryAction?.tool, 'cowork_wait_board');

    // Check Web board snapshot while worker is still running after interjection (P2-06)
    const midSnap = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/snapshot`)).json();
    assert.equal(midSnap.board.hostLastSettlementReason, 'human_interjection');
    assert.equal(midSnap.board.activeWaveId, wave2.waveId);

    const contCall = await mcpClient.callTool({
      name: 'cowork_wait_board',
      arguments: {
        boardId,
        waveId: wave2.waveId,
        timeoutMs: 15000,
      },
    });
    const cont = JSON.parse(contCall.content[0].text);
    assert.equal(cont.reason, 'wave_completed');
    assert.ok(cont.evidence.fileChangesSummary.added.includes('src/slow.ts'));

    // Disconnect mid-wave + duplicate retry idempotency + reconnect via waveId (P2-06)
    const disconnAc = new AbortController();
    setTimeout(() => disconnAc.abort(), 300);
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/boards/${boardId}/dispatch-wave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '请 @backend 执行 DISCONNECT_ONCE_STEP 写入重连文件',
        targetSlots: ['backend'],
        idempotencyKey: 'reconn-idem-1',
        wait: true,
      }),
      signal: disconnAc.signal,
    }).catch(() => {});

    // Retry exact same dispatch -> must deduplicate without running worker a second time!
    const retryDispCall = await mcpClient.callTool({
      name: 'cowork_dispatch_wave',
      arguments: {
        boardId,
        message: '请 @backend 执行 DISCONNECT_ONCE_STEP 写入重连文件',
        targetSlots: ['backend'],
        idempotencyKey: 'reconn-idem-1',
        wait: true,
        timeoutMs: 15000,
      },
    });
    const retryDisp = JSON.parse(retryDispCall.content[0].text);
    assert.equal(retryDisp.deduplicated, true, 'Retried wave must return deduplicated=true');
    assert.equal(retryDisp.reason, 'wave_completed');
    assert.ok(retryDisp.evidence.fileChangesSummary.added.includes('src/reconnect.ts'));

    const reconnCalls = fs
      .readFileSync(cliCallsLog, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l))
      .filter((c) => c.tag === 'DISCONNECT_ONCE_STEP');
    assert.equal(reconnCalls.length, 1, 'Disconnected + retried wave must execute CLI strictly ONCE');
    console.log(
      `[PASS] Check 3: Interjection (${interruptLatencyMs}ms) + waveId reconnect + disconnect single-run idempotency verified`
    );

    // --- CHECK 4: P1-01 Reuse Never Swallows Unread + P1-05 Three-State Inbox, Drop Retry, Concurrency & Session Isolation ---
    const reuseMsgRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@lead HOOK-AUDIT-REUSE 请勿吞掉未读留言' }),
    });
    assert.equal(reuseMsgRes.status, 201);
    const reusePost = await reuseMsgRes.json();

    // Re-attach same board & rename & switch hostClient -> MUST NOT advance hostLastReadSeqId!
    const reattach1 = JSON.parse(
      (
        await mcpClient.callTool({
          name: 'cowork_setup_board',
          arguments: {
            boardId,
            workspacePath: workspaceDir,
            hostClient: 'antigravity',
            hostSessionRef: 'conv_test_123',
            title: 'MCP 测试协同（重连改名）',
          },
        })
      ).content[0].text
    );
    assert.equal(reattach1.reused, true);
    assert.equal(reattach1.unreadCount, 1, 'Reused board must still report 1 unread message');
    assert.ok(
      reattach1.board.hostLastReadSeqId < reusePost.seqId,
      'cowork_setup_board reuse MUST NOT advance hostLastReadSeqId'
    );

    // P1-05 Session isolation: another conversation in the SAME workspace must NOT steal conv_test_123's inbox or hijack board
    const wrongSessPull = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv_other_session', workspacePaths: [workspaceDir] }),
      })
    ).json();
    assert.equal(wrongSessPull.hasUnread, false, 'Different session in same workspace must not steal bound inbox');

    const secondSessSetup = JSON.parse(
      (
        await mcpClient.callTool({
          name: 'cowork_setup_board',
          arguments: {
            workspacePath: workspaceDir,
            hostClient: 'antigravity',
            hostSessionRef: 'conv_other_session',
          },
        })
      ).content[0].text
    );
    assert.equal(
      secondSessSetup.requiresBoardSelection,
      true,
      'Second session on bound workspace must prompt explicit board selection instead of silent hijack'
    );

    // P1-05 Concurrent pull guard: fire 2 simultaneous pulls -> strictly 1 claims!
    const [conc1, conc2] = await Promise.all([
      fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv_test_123', workspacePaths: [workspaceDir] }),
      }).then((r) => r.json()),
      fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv_test_123', workspacePaths: [workspaceDir] }),
      }).then((r) => r.json()),
    ]);
    assert.equal(
      Number(Boolean(conc1.hasUnread)) + Number(Boolean(conc2.hasUnread)),
      1,
      'Concurrent inbox pulls must allow strictly 1 claim'
    );
    const winnerPull = conc1.hasUnread ? conc1 : conc2;

    // Simulate host processing failure (`stage: 'failed'`) -> message MUST remain unread and retryable!
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryId: winnerPull.deliveryId, stage: 'failed' }),
    });

    const hookInput = JSON.stringify({
      conversationId: 'conv_test_123',
      workspacePaths: [workspaceDir],
    });
    const hookOut1 = JSON.parse(
      execFileSync(process.execPath, [path.join(REPO_ROOT, 'dist-mcp', 'preInvocationHook.js')], {
        input: hookInput,
        env: isolatedEnv,
        encoding: 'utf8',
        windowsHide: true,
      }).trim()
    );
    assert.ok(
      hookOut1.injectSteps?.[0]?.ephemeralMessage?.includes('HOOK-AUDIT-REUSE'),
      'After reuse + failed-delivery retry, Hook must still deliver HOOK-AUDIT-REUSE'
    );

    // Second Hook call for same session is idempotent ({})
    const hookOut2 = JSON.parse(
      execFileSync(process.execPath, [path.join(REPO_ROOT, 'dist-mcp', 'preInvocationHook.js')], {
        input: hookInput,
        env: isolatedEnv,
        encoding: 'utf8',
        windowsHide: true,
      }).trim()
    );
    assert.deepEqual(hookOut2, {}, 'Second PreInvocation Hook call must be idempotent ({})');

    // Before host ack, hostLastReadSeqId is still NOT advanced (CLI fallback stays available!); ack_inbox advances it
    const snapBeforeAck = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/snapshot`)
    ).json();
    assert.ok(snapBeforeAck.board.hostLastReadSeqId < reusePost.seqId);
    assert.equal(snapBeforeAck.board.hostHookPendingSeqId, reusePost.seqId);

    await mcpClient.callTool({
      name: 'cowork_manage_board',
      arguments: { boardId, action: 'ack_inbox' },
    });
    const snapAfterAck = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/snapshot`)
    ).json();
    assert.ok(snapAfterAck.board.hostLastReadSeqId >= reusePost.seqId);
    assert.equal(snapAfterAck.board.hostHookPendingSeqId, 0);

    // Nested & ambiguous unbound workspace boundaries + one-shot CLI fallback
    const nestedWs = path.join(tmpRoot, 'mono', 'pkg-a');
    fs.mkdirSync(nestedWs, { recursive: true });
    for (const idx of [1, 2]) {
      const bSetup = JSON.parse(
        (
          await mcpClient.callTool({
            name: 'cowork_setup_board',
            arguments: {
              title: `嵌套看板 ${idx}`,
              workspacePath: nestedWs,
              reuseExisting: false,
            },
          })
        ).content[0].text
      );
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${bSetup.board.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `@lead 嵌套待选消息 ${idx}` }),
      });
    }
    // Parent dir `tmpRoot/mono` must NOT downward-pull child `pkg-a`
    const parentPull = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePaths: [path.join(tmpRoot, 'mono')] }),
      })
    ).json();
    assert.equal(parentPull.hasUnread, false);
    // Ambiguous dual unbound boards in `nestedWs` must prompt selection without advancing cursors
    const ambigPull = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePaths: [nestedWs] }),
      })
    ).json();
    assert.equal(ambigPull.ambiguous, true);

    // One-shot CLI fallback
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@lead 桌面端暂不在线，先请后台代答' }),
    });
    const fbRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/leader-cli-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(fbRes.status, 200);
    await waitForCondition(async () => {
      const snap = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${boardId}/snapshot`)).json();
      return snap.posts.some((p) => p.authorSlotId === 'lead' && p.content.includes('我是后台 CLI 主管'));
    });
    console.log('[PASS] Check 4: Reuse cursor safety (P1-01) + 3-state inbox/retry/concurrency/boundaries (P1-05) + CLI fallback verified');

    // --- CHECK 5: P1-02 cowork_panel fast direct read even when /api/mcp/overview takes 15 seconds ---
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/test-delay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overviewDelayMs: 15000 }),
    });

    const pStart1 = Date.now();
    const panelSpecified = await mcpClient.callTool({
      name: 'cowork_panel',
      arguments: { boardId },
    });
    const pElapsed1 = Date.now() - pStart1;
    assert.ok(pElapsed1 < 1200, `cowork_panel(boardId) must bypass 15s overview, took ${pElapsed1}ms`);
    assert.equal(panelSpecified.structuredContent?.board?.id, boardId);

    const pStart2 = Date.now();
    const panelAuto = await mcpClient.callTool({
      name: 'cowork_panel',
      arguments: {},
    });
    const pElapsed2 = Date.now() - pStart2;
    assert.ok(pElapsed2 < 1200, `cowork_panel() must bypass 15s overview, took ${pElapsed2}ms`);
    assert.ok(panelAuto.structuredContent?.boards?.length >= 1);

    await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/test-delay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overviewDelayMs: 0 }),
    });
    console.log(
      `[PASS] Check 5: cowork_panel fast direct snapshot under 15s overview delay (${pElapsed1}ms / ${pElapsed2}ms) verified`
    );

    // --- CHECK 6: Registrar lossless backup + Hook mount -> disable -> re-mount -> unregister (P1-03) ---
    const agyDir = path.join(homeDir, '.gemini', 'config');
    const codexDir = path.join(homeDir, '.codex');
    const cbDir = path.join(homeDir, '.codebuddy');
    fs.mkdirSync(agyDir, { recursive: true });
    fs.mkdirSync(codexDir, { recursive: true });
    fs.mkdirSync(cbDir, { recursive: true });

    const agyCfgPath = path.join(agyDir, 'mcp_config.json');
    const agyHooksPath = path.join(agyDir, 'hooks.json');
    const codexCfgPath = path.join(codexDir, 'config.toml');
    const cbCfgPath = path.join(cbDir, 'mcp.json');
    const claudeCfgPath = path.join(homeDir, '.claude.json');

    fs.writeFileSync(
      agyCfgPath,
      '\uFEFF' + JSON.stringify({ mcpServers: { 'colab-mcp': { command: 'colab' } } }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      agyHooksPath,
      JSON.stringify({ 'user-lint-hook': { PreToolUse: [] } }, null, 2),
      'utf8'
    );
    const origCodexToml =
      '# Top comment preserved\r\nmodel = "gpt-6.2-sol"\r\n\r\n[projects.\'D:\\\\中文项目\\\\测试目录\']\r\ntrust_level = "trusted"\r\n\r\n[mcp_servers.node_repl]\r\ncommand = "node"\r\n';
    fs.writeFileSync(codexCfgPath, origCodexToml, 'utf8');
    fs.writeFileSync(
      cbCfgPath,
      JSON.stringify({ mcpServers: { rea: { url: 'http://example' } }, disabledMcpServers: ['agent_cowork_board'] }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      claudeCfgPath,
      JSON.stringify({ numStartups: 42, mcpServers: { 'dsh-baton': { command: 'node' } } }, null, 2),
      'utf8'
    );

    const regOpts = {
      homeDir,
      nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
      repoRoot: REPO_ROOT,
      enableHook: true,
      skipBinaryDetect: true,
    };

    for (const cid of ['antigravity', 'codex', 'codebuddy', 'claude']) {
      const st = registerDesktopMcpClient(cid, regOpts);
      assert.equal(st.registered, true, `${cid} should be registered`);
    }
    assert.equal(
      listDesktopMcpClients(regOpts).find((c) => c.id === 'antigravity')?.hookRegistered,
      true
    );

    // P1-03: Disable Hook only (`enableHook: false`) -> MCP stays registered, third-party hook preserved, our hook removed!
    const agyHookOff = registerDesktopMcpClient('antigravity', { ...regOpts, enableHook: false });
    assert.equal(agyHookOff.registered, true, 'MCP must stay registered when disabling Hook');
    assert.equal(agyHookOff.hookRegistered, false, 'hookRegistered must become false when enableHook=false');
    const hooksAfterDisable = JSON.parse(fs.readFileSync(agyHooksPath, 'utf8'));
    assert.ok(hooksAfterDisable['user-lint-hook'], 'Third-party hook must stay intact');
    assert.equal('agent-cowork-board-inbox' in hooksAfterDisable, false, 'Board hook entry must be removed');
    assert.equal(
      fs.existsSync(
        path.join(
          agyDir,
          process.platform === 'win32' ? 'agent-cowork-board-hook.cmd' : 'agent-cowork-board-hook.sh'
        )
      ),
      false,
      'Hook wrapper script must be removed when Hook disabled'
    );

    // Re-mount Hook (`enableHook: true`) -> hookRegistered becomes true again!
    const agyHookReOn = registerDesktopMcpClient('antigravity', { ...regOpts, enableHook: true });
    assert.equal(agyHookReOn.registered, true);
    assert.equal(agyHookReOn.hookRegistered, true);

    const agyRaw = fs.readFileSync(agyCfgPath, 'utf8');
    assert.equal(agyRaw.charCodeAt(0), 0xfeff, 'BOM must be preserved on mcp_config.json');
    const codexAfterReg = fs.readFileSync(codexCfgPath, 'utf8');
    assert.ok(codexAfterReg.includes('tool_timeout_sec = 3600'));

    for (const cid of ['antigravity', 'codex', 'codebuddy', 'claude']) {
      const st = unregisterDesktopMcpClient(cid, regOpts);
      assert.equal(st.registered, false, `${cid} should be unregistered`);
    }
    assert.equal(listDesktopMcpClients(regOpts).every((c) => !c.registered && !c.hookRegistered), true);
    console.log('[PASS] Check 6: Registrar Hook mount -> disable -> re-mount -> unregister (P1-03) verified');

    // --- CHECK 7: Legacy leaderMode = 'cli' web flow + 3-way snapshot revert SHA-1 ---
    const legacyWs = path.join(tmpRoot, 'legacy-ws');
    fs.mkdirSync(path.join(legacyWs, 'src'), { recursive: true });
    const origContent = 'export const ver = 1;\n';
    fs.writeFileSync(path.join(legacyWs, 'src', 'api.ts'), origContent, 'utf8');

    const createLegRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '网页直驱基线测试',
        workspacePath: legacyWs,
        presetId: 'free-collab',
        customMembers: [
          { slotId: 'lead', displayName: '主管', isLeader: true, engine: 'antigravity' },
          { slotId: 'backend', displayName: '后端', isLeader: false, engine: 'codex' },
        ],
      }),
    });
    assert.equal(createLegRes.status, 201);
    const legBoard = await createLegRes.json();
    assert.equal(legBoard.leaderMode, 'cli');

    await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${legBoard.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '请安排写入 src/api.ts' }),
    });

    const legSnap = await waitForCondition(async () => {
      const snaps = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${legBoard.id}/snapshots`)).json();
      const boardState = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${legBoard.id}/snapshot`)).json();
      const allIdle = boardState.agents.every((a) => a.state === 'waiting');
      return snaps.length > 0 && allIdle && boardState.posts.some((p) => p.authorSlotId === 'lead' && p.content.includes('验收归档'))
        ? snaps[0]
        : null;
    }, 15000);

    fs.writeFileSync(path.join(legacyWs, 'src', 'api.ts'), 'export const ver = 999;\n', 'utf8');
    const strictRev = await fetch(`http://127.0.0.1:${TEST_PORT}/api/snapshots/${legSnap.id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'strict' }),
    });
    assert.equal(strictRev.status, 409, 'Strict revert must detect newer external edit conflict');

    const overRev = await fetch(`http://127.0.0.1:${TEST_PORT}/api/snapshots/${legSnap.id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'overwrite_all' }),
    });
    assert.equal(overRev.status, 200);
    const overJson = await overRev.json();
    assert.ok(overJson.protectionSnapshot?.kind === 'pre_overwrite_backup');
    assert.equal(
      sha1(fs.readFileSync(path.join(legacyWs, 'src', 'api.ts'), 'utf8')),
      sha1(origContent),
      'Reverted file SHA-1 must match original content'
    );
    console.log('[PASS] Check 7: Legacy leaderMode=cli + 3-way snapshot conflict & revert SHA-1 verified');

    // --- CHECK 9: Engine Default Configs + Panel Auto-Forward Claim/Ack Bridge ---
    const putDefRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings/engine-defaults/codex`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'gpt-6.2-astra', reasoningEffort: 'xhigh' }),
    });
    assert.equal(putDefRes.status, 200);
    const getDefJson = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings/engine-defaults`)).json();
    assert.equal(getDefJson.codex?.modelId, 'gpt-6.2-astra');
    assert.equal(getDefJson.codex?.reasoningEffort, 'xhigh');

    const wbAfterDef = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/workbench`)).json();
    const codexCardAfterDef = wbAfterDef.engines.find((e) => e.id === 'codex');
    assert.equal(codexCardAfterDef?.defaultModel, 'gpt-6.2-astra');
    assert.equal(codexCardAfterDef?.defaultEffort, 'xhigh');
    assert.equal(codexCardAfterDef?.hasCustomDefault, true);

    const ovAfterDef = JSON.parse(
      (await mcpClient.callTool({ name: 'cowork_overview', arguments: {} })).content[0].text
    );
    const ovCodex = ovAfterDef.engines.find((e) => e.id === 'codex');
    assert.equal(ovCodex?.defaultModel, 'gpt-6.2-astra');
    assert.equal(ovCodex?.defaultEffort, 'xhigh');

    // Verify new board inherits custom defaults when omitted
    const customDefWs = path.join(tmpRoot, 'engine-def-ws');
    fs.mkdirSync(customDefWs, { recursive: true });
    const defBoardSetup = JSON.parse(
      (
        await mcpClient.callTool({
          name: 'cowork_setup_board',
          arguments: {
            title: '默认模型继承验证',
            workspacePath: customDefWs,
            reuseExisting: false,
            members: [{ slotId: 'dev', displayName: '默认继承队员', engine: 'codex' }],
          },
        })
      ).content[0].text
    );
    const devAgent = defBoardSetup.agents.find((a) => a.slotId === 'dev');
    assert.equal(devAgent?.modelId, 'gpt-6.2-astra');
    assert.equal(devAgent?.reasoningEffort, 'xhigh');

    const delDefRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings/engine-defaults/codex`, {
      method: 'DELETE',
    });
    assert.equal(delDefRes.status, 200);
    const wbAfterReset = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/workbench`)).json();
    const codexAfterReset = wbAfterReset.engines.find((e) => e.id === 'codex');
    assert.equal(codexAfterReset?.hasCustomDefault, false);

    // Panel auto-forward heartbeat + atomic claim + duplicate Hook guard + panel_forwarded ack
    const panelStateRes = await (
      await fetch(
        `http://127.0.0.1:${TEST_PORT}/api/mcp/panel-state?boardId=${encodeURIComponent(
          defBoardSetup.board.id
        )}&bridgeActive=1`
      )
    ).json();
    assert.equal(panelStateRes.board?.hostPanelBridgeActive, true);
    assert.ok(Array.isArray(panelStateRes.modelsByEngine?.codex), 'panel-state must include modelsByEngine');

    const panelForwardMsgRes = await fetch(
      `http://127.0.0.1:${TEST_PORT}/api/boards/${defBoardSetup.board.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '@lead 来自手机的闲置消息：请侧栏自动转入' }),
      }
    );
    assert.equal(panelForwardMsgRes.status, 201);
    const panelForwardPost = await panelForwardMsgRes.json();

    const panelClaim = await (
      await fetch(
        `http://127.0.0.1:${TEST_PORT}/api/mcp/boards/${defBoardSetup.board.id}/panel-claim-inbox`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
    ).json();
    assert.equal(panelClaim.claimed, true);
    assert.ok(panelClaim.promptText.includes('请侧栏自动转入'));

    // Concurrent Hook pull while panel holds lease must NOT double-deliver
    const blockedHookPull = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePaths: [customDefWs] }),
      })
    ).json();
    assert.equal(blockedHookPull.hasUnread, false);
    assert.equal(blockedHookPull.reason, 'claimed_in_flight');

    // Confirm panel_forwarded
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/host-inbox/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliveryId: panelClaim.deliveryId,
        boardId: defBoardSetup.board.id,
        stage: 'acked',
        deliveryTag: 'panel_forwarded',
      }),
    });
    const snapAfterPanelForward = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${defBoardSetup.board.id}/snapshot`)
    ).json();
    const updatedPost = snapAfterPanelForward.posts.find((p) => p.id === panelForwardPost.id);
    assert.equal(updatedPost?.meta?.hostDelivery, 'panel_forwarded');
    assert.ok(snapAfterPanelForward.board.hostLastReadSeqId >= panelForwardPost.seqId);
    console.log(
      '[PASS] Check 9: Engine default config persistence/propagation + Panel bridge claim/ack verified'
    );

    // --- CHECK 10: Auto-Standby Directive, Release on Toggle Off & UI Theme Sync ---
    const standbyWs = path.join(tmpRoot, 'standby-ws');
    fs.mkdirSync(standbyWs, { recursive: true });
    const standbySetup = JSON.parse(
      (
        await mcpClient.callTool({
          name: 'cowork_setup_board',
          arguments: {
            title: '自动待命与主题联调',
            workspacePath: standbyWs,
            hostClient: 'codex',
            reuseExisting: false,
          },
        })
      ).content[0].text
    );
    assert.equal(standbySetup.board?.hostAutoStandby, true);
    assert.equal(standbySetup.autoStandby?.enabled, true);
    assert.equal(standbySetup.autoStandby?.shouldStandby, true);

    const standbyMsgRes = JSON.parse(
      (
        await mcpClient.callTool({
          name: 'cowork_manage_board',
          arguments: {
            boardId: standbySetup.board.id,
            action: 'send_board_message',
            content: '已完成阶段一，等待下一步指示。',
          },
        })
      ).content[0].text
    );
    assert.equal(standbyMsgRes.autoStandby?.shouldStandby, true);
    assert.equal(standbyMsgRes.autoStandby?.nextToolCall?.tool, 'cowork_wait_board');

    // Start standby wait, then toggle hostAutoStandby=false -> must release immediately with standby_released
    const standbyWaitPromise = mcpClient.callTool({
      name: 'cowork_wait_board',
      arguments: {
        boardId: standbySetup.board.id,
        waitForNewActivity: true,
        timeoutMs: 15000,
      },
    });
    await waitForCondition(async () => {
      const s = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${standbySetup.board.id}/snapshot`)).json();
      return s.board.hostWaiting ? true : null;
    }, 4000);

    const tReleaseStart = Date.now();
    const toggleOffRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/boards/${standbySetup.board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostAutoStandby: false }),
    });
    assert.equal(toggleOffRes.status, 200);
    const releasedPayload = JSON.parse((await standbyWaitPromise).content[0].text);
    const releaseMs = Date.now() - tReleaseStart;
    assert.equal(releasedPayload.reason, 'standby_released');
    assert.equal(releasedPayload.autoStandby?.shouldStandby, false);
    assert.ok(releaseMs < 2000, `Standby release took too long: ${releaseMs}ms`);

    // UI theme persistence & panel-state propagation across purple / blue / green / pink
    for (const themeId of ['blue', 'green', 'pink', 'purple']) {
      const putTheme = await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uiTheme: themeId }),
      });
      assert.equal(putTheme.status, 200);
      const themeJson = await putTheme.json();
      assert.equal(themeJson.uiTheme, themeId);
    }
    await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uiTheme: 'green' }),
    });
    const wbTheme = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/workbench`)).json();
    const panelTheme = await (await fetch(`http://127.0.0.1:${TEST_PORT}/api/mcp/panel-state`)).json();
    assert.equal(wbTheme.uiTheme, 'green');
    assert.equal(panelTheme.uiTheme, 'green');
    console.log(
      `[PASS] Check 10: Auto-standby directive, immediate release (${releaseMs}ms) & 4-theme sync verified`
    );

    const formalAfter = snapshotDirStats(FORMAL_DATA_DIR);
    assert.deepEqual(formalAfter, formalBefore, 'Formal data/ directory must remain 100% untouched!');
    console.log('[PASS] Isolation guard: Formal data/ directory verified 100% untouched.');
  } finally {
    try {
      await mcpClient?.close();
    } catch {
      // ignore
    }
    try {
      await transport?.close();
    } catch {
      // ignore
    }
    stopVerifiedAuditServerPid(dataDir);

    // P2-07: Verify unrelated bystander server is STILL alive after audit cleanup!
    const bystanderCheck2 = await (await fetch(`http://127.0.0.1:${bystanderPort}`)).text();
    assert.equal(
      bystanderCheck2,
      'BYSTANDER_ALIVE',
      'Bystander server on candidate port must remain alive after PID-scoped audit cleanup'
    );
    await new Promise((resolve) => bystanderServer.close(() => resolve()));
    console.log('[PASS] Check 8: Scoped PID cleanup verified & unrelated bystander service survived (P2-07)');

    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup errors
    }
  }
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
