import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentSlot, Board } from '../../src/types.js';
import { REPO_ROOT } from '../db.js';
import { detectCliBinary } from '../telemetry/localScanner.js';
import { getCatalogItem } from './catalog.js';
import { resolveAntigravityCliModel } from '../orchestrator/presets.js';

export interface CliTurnCallbacks {
  onActivity: (summary: string) => void;
  onRawLog: (line: string) => void;
}

export interface CliTurnResult {
  finalText: string;
  nativeSessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
}

function getBinaryForEngine(engine: AgentSlot['engine']): string | null {
  if (engine === 'demo') return null;
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const cat = getCatalogItem(engine);
  return detectCliBinary(cat.binaryCandidates(home, localAppData, appData), true).binaryPath;
}

function quoteCmdArg(arg: string): string {
  if (!arg) return '""';
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function buildSanitizedChildEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('ANTIGRAVITY_') || key.startsWith('AGY_')) {
      delete childEnv[key];
    }
  }
  const nodeBinDir = path.dirname(process.execPath);
  const pathKey = Object.keys(childEnv).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const curPath = childEnv[pathKey] || '';
  if (nodeBinDir && !curPath.toLowerCase().includes(nodeBinDir.toLowerCase())) {
    childEnv[pathKey] = curPath ? `${nodeBinDir}${path.delimiter}${curPath}` : nodeBinDir;
  }
  return { ...childEnv, ...extra };
}

function normalizeMatchPath(rawPath: string): string {
  const resolved = path.resolve(rawPath).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function resolveAntigravityProjectId(workspacePath: string): string | null {
  const trimmed = workspacePath?.trim();
  if (!trimmed) return null;

  const projectsDir = path.join(os.homedir(), '.gemini', 'config', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  const normWs = normalizeMatchPath(trimmed);
  let bestId: string | null = null;
  let bestScore = -1;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }

  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(projectsDir, name), 'utf8');
      const proj = JSON.parse(raw) as {
        id?: string;
        sidecar?: unknown;
        projectResources?: {
          resources?: Array<{
            folderUri?: string;
            gitFolder?: { folderUri?: string };
          }>;
        };
      };
      if (
        !proj?.id ||
        proj.id === 'default-cli-project' ||
        proj.sidecar ||
        !/^[a-zA-Z0-9_-]+$/.test(proj.id)
      ) {
        continue;
      }
      const resources = proj.projectResources?.resources;
      if (!Array.isArray(resources)) continue;

      for (const r of resources) {
        const uri = r?.folderUri || r?.gitFolder?.folderUri;
        if (typeof uri !== 'string' || !uri.startsWith('file://')) continue;
        try {
          const fsPath = fileURLToPath(uri);
          const normFolder = normalizeMatchPath(fsPath);
          if (!normFolder) continue;

          let score = -1;
          if (normWs === normFolder) {
            score = 2_000_000 + normFolder.length;
          } else if (normWs.startsWith(normFolder + path.sep)) {
            score = 1_000_000 + normFolder.length;
          }
          if (score > bestScore) {
            bestScore = score;
            bestId = proj.id;
          }
        } catch {
          // ignore malformed file:// URIs
        }
      }
    } catch {
      // ignore malformed project JSON
    }
  }

  return bestId;
}

function buildCliArgs(params: {
  slot: AgentSlot;
  board: Board;
  persistSession: boolean;
  prompt: string;
}): { args: string[]; logArgsPreview: string; sessionId: string | null; passViaStdin: boolean } {
  const { slot, board, persistSession, prompt } = params;
  let sessionId = slot.nativeSessionId;

  switch (slot.engine) {
    case 'codex': {
      const isResume = Boolean(slot.nativeSessionId && persistSession);
      const args: string[] = isResume
        ? ['exec', 'resume', '--json', '--skip-git-repo-check']
        : ['exec', '--json', '--skip-git-repo-check', '-C', board.workspacePath, '-s', 'workspace-write'];

      if (slot.modelId) args.push('-m', slot.modelId);
      if (slot.reasoningEffort) args.push('-c', `model_reasoning_effort="${slot.reasoningEffort}"`);
      if (!persistSession && !isResume) args.push('--ephemeral');
      if (isResume && slot.nativeSessionId) args.push(slot.nativeSessionId);
      args.push('-');
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'antigravity': {
      const agyModel = resolveAntigravityCliModel(slot.modelId, slot.reasoningEffort);
      const args: string[] = [
        '--output-format',
        'stream-json',
        '--dangerously-skip-permissions',
        '--disable-slash-commands',
        '--model',
        agyModel,
      ];
      if (slot.reasoningEffort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(slot.reasoningEffort)) {
        args.push('--effort', slot.reasoningEffort);
      }
      if (slot.nativeSessionId && persistSession) {
        args.push('--conversation', slot.nativeSessionId);
      } else if (persistSession) {
        const agyProjectId = resolveAntigravityProjectId(board.workspacePath);
        if (agyProjectId) {
          args.push('--project', agyProjectId);
        }
      }
      const boundedPrompt = prompt.slice(0, 24_000);
      const logArgsPreview = `${args.join(' ')} -p "<prompt ${boundedPrompt.length} chars>"`;
      args.push('-p', boundedPrompt);
      return { args, logArgsPreview, sessionId, passViaStdin: false };
    }

    case 'codebuddy': {
      const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose', '-y'];
      if (slot.modelId) args.push('--model', slot.modelId);
      if (
        slot.reasoningEffort &&
        ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(slot.reasoningEffort)
      ) {
        args.push('--effort', slot.reasoningEffort);
      }
      if (!persistSession) {
        args.push('--no-session-persistence');
      } else if (slot.nativeSessionId) {
        args.push('-r', slot.nativeSessionId, '--resume-create-missing');
      } else {
        sessionId = crypto.randomUUID();
        args.push('--session-id', sessionId);
      }
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'claude': {
      const args: string[] = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
      ];
      if (slot.modelId) args.push('--model', slot.modelId);
      if (slot.reasoningEffort && ['low', 'medium', 'high', 'max'].includes(slot.reasoningEffort)) {
        args.push('--effort', slot.reasoningEffort);
      }
      if (slot.nativeSessionId && persistSession) {
        args.push('--resume', slot.nativeSessionId);
      }
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'gemini': {
      const args: string[] = ['--output-format', 'stream-json', '--yolo'];
      if (slot.modelId && slot.modelId !== 'default') args.push('-m', slot.modelId);
      if (slot.nativeSessionId && persistSession) args.push('--resume', slot.nativeSessionId);
      args.push('-p', '');
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'qwen': {
      const args: string[] = ['-p', '--output-format', 'stream-json', '--yolo'];
      if (slot.modelId && slot.modelId !== 'default') args.push('-m', slot.modelId);
      if (slot.nativeSessionId && persistSession) args.push('--resume', slot.nativeSessionId);
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'opencode': {
      const args: string[] = ['run', '--format', 'json'];
      if (slot.modelId && slot.modelId !== 'default') args.push('-m', slot.modelId);
      if (slot.nativeSessionId && persistSession) args.push('--session', slot.nativeSessionId);
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'cursor': {
      const args: string[] = ['agent', '--print', '--output-format', 'stream-json', '--force'];
      if (slot.modelId && slot.modelId !== 'auto') args.push('--model', slot.modelId);
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'copilot': {
      const boundedPrompt = prompt.slice(0, 16_000);
      const args: string[] = ['--allow-all-tools'];
      if (slot.modelId) args.push('--model', slot.modelId);
      const logArgsPreview = `${args.join(' ')} -p "<prompt ${boundedPrompt.length} chars>"`;
      args.push('-p', boundedPrompt);
      return { args, logArgsPreview, sessionId, passViaStdin: false };
    }

    case 'kimi': {
      const args: string[] = ['--print', '--output-format', 'stream-json', '--yolo'];
      if (slot.modelId) args.push('--model', slot.modelId);
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'goose': {
      const args = ['run', '-i', '-'];
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'droid': {
      const args: string[] = ['exec', '--auto', 'high', '--output-format', 'stream-json'];
      if (slot.modelId) args.push('-m', slot.modelId);
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }

    case 'auggie':
    case 'qoder':
    case 'vibe':
    case 'kiro':
    case 'hermes':
    case 'snow':
    case 'openclaw':
    case 'nanobot':
    default: {
      const args: string[] = ['--print'];
      if (slot.modelId && !slot.modelId.endsWith('-default')) {
        args.push('--model', slot.modelId);
      }
      return { args, logArgsPreview: args.join(' '), sessionId, passViaStdin: true };
    }
  }
}

export async function runLiveCliTurn(params: {
  board: Board;
  slot: AgentSlot;
  prompt: string;
  apiPort: number;
  callbacks: CliTurnCallbacks;
}): Promise<CliTurnResult> {
  const { board, slot, prompt, apiPort, callbacks } = params;
  const startedAt = Date.now();
  const cat = getCatalogItem(slot.engine);
  const bin = getBinaryForEngine(slot.engine);

  if (!bin) {
    throw new Error(`本机尚未安装 ${cat.name}，请先安装对应 CLI 工具或切换其他已就绪成员引擎。`);
  }

  const persistSession =
    board.sessionSyncMode === 'all_persist' ||
    (board.sessionSyncMode === 'leader_only' && slot.isLeader);

  const helperCliPath = path.resolve(REPO_ROOT, 'scripts', 'cowork-cli.mjs');
  const childEnv = buildSanitizedChildEnv({
    CI: '1',
    NO_COLOR: '1',
    COWORK_API_URL: `http://127.0.0.1:${apiPort}`,
    COWORK_BOARD_ID: board.id,
    COWORK_SLOT_ID: slot.slotId,
    COWORK_CLI_BIN: helperCliPath,
  });

  const built = buildCliArgs({ slot, board, persistSession, prompt });
  let resolvedSessionId: string | null = built.sessionId;

  callbacks.onRawLog(`$ "${bin}" ${built.logArgsPreview}`);
  callbacks.onActivity('思考处理中...');

  const isWinCmdWrapper = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  const spawnExecutable = isWinCmdWrapper ? process.env.ComSpec || 'cmd.exe' : bin;
  const spawnArgs = isWinCmdWrapper
    ? ['/d', '/s', '/c', `"${quoteCmdArg(bin)} ${built.args.map(quoteCmdArg).join(' ')}"`]
    : built.args;

  return await new Promise<CliTurnResult>((resolve, reject) => {
    let settled = false;
    let teardownTimer: ReturnType<typeof setTimeout> | null = null;

    const child = spawn(spawnExecutable, spawnArgs, {
      cwd: board.workspacePath,
      env: childEnv,
      windowsVerbatimArguments: isWinCmdWrapper,
      windowsHide: true,
      stdio: [built.passViaStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    const textChunks: string[] = [];
    const agyStepDeltas: string[] = [];
    let authoritativeResultText = '';
    let reportedErrorText = '';
    const fallbackPlainLines: string[] = [];
    const stderrLines: string[] = [];

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let hasAuthoritativeResultUsage = false;
    let stdoutBuf = '';

    const applyUsage = (usageObj: Record<string, unknown>, authoritative = false) => {
      const inT = Number(usageObj.input_tokens || usageObj.prompt_tokens || 0);
      const outT = Number(usageObj.output_tokens || usageObj.completion_tokens || 0);
      const cacheT = Number(
        usageObj.cached_input_tokens ||
          usageObj.cache_read_input_tokens ||
          usageObj.cache_read_tokens ||
          0
      );
      if (authoritative) {
        inputTokens = inT;
        outputTokens = outT;
        cachedTokens = cacheT;
        hasAuthoritativeResultUsage = true;
      } else if (!hasAuthoritativeResultUsage) {
        inputTokens += inT;
        outputTokens += outT;
        cachedTokens += cacheT;
      }
    };

    const finalizeAndResolve = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (teardownTimer) {
        clearTimeout(teardownTimer);
        teardownTimer = null;
      }

      const combinedText = (
        authoritativeResultText.trim() ||
        textChunks.join('\n\n').trim() ||
        agyStepDeltas.join('').trim() ||
        fallbackPlainLines.join('\n').trim()
      ).slice(0, 12_000);

      if (reportedErrorText && !combinedText) {
        reject(new Error(`${cat.name} 调用失败：${reportedErrorText.slice(0, 200)}`));
        return;
      }

      if (exitCode !== null && exitCode !== 0 && !combinedText) {
        const hint = stderrLines.slice(-2).join(' ').trim();
        reject(
          new Error(
            `${cat.name} 退出异常 (代码 ${exitCode})${hint ? `：${hint.slice(0, 180)}` : ''}`
          )
        );
        return;
      }

      if (inputTokens === 0 && outputTokens === 0) {
        inputTokens = Math.max(800, Math.round(prompt.length / 3.2));
        outputTokens = Math.max(300, Math.round(combinedText.length / 3.2));
      }

      resolve({
        finalText: combinedText || '已完成处理。',
        nativeSessionId: persistSession ? resolvedSessionId : null,
        inputTokens,
        outputTokens,
        cachedTokens,
        durationMs: Date.now() - startedAt,
      });
    };

    const handleJsonEvent = (obj: Record<string, unknown>) => {
      if (typeof obj.thread_id === 'string' && obj.thread_id) {
        resolvedSessionId = obj.thread_id;
      } else if (typeof obj.conversation_id === 'string' && obj.conversation_id) {
        resolvedSessionId = obj.conversation_id;
      } else if (typeof obj.session_id === 'string' && obj.session_id) {
        resolvedSessionId = obj.session_id;
      }

      // 1. Antigravity (`agy --output-format stream-json`) schema: {"event": "init" | "step_update" | "result", ...}
      const agyEvent = typeof obj.event === 'string' ? obj.event : '';
      if (agyEvent === 'step_update' && obj.step_update && typeof obj.step_update === 'object') {
        const su = obj.step_update as Record<string, unknown>;
        if (typeof su.conversation_id === 'string' && su.conversation_id) {
          resolvedSessionId = su.conversation_id;
        }
        const stepType = String(su.step_type || '');
        if (stepType === 'agent_response') {
          callbacks.onActivity('生成回复中...');
          if (typeof su.text_delta === 'string' && su.text_delta) {
            agyStepDeltas.push(su.text_delta);
          }
        } else if (stepType && stepType !== 'user_input') {
          callbacks.onActivity(`执行: ${stepType.slice(0, 36)}`);
        }
        if (su.usage && typeof su.usage === 'object') {
          applyUsage(su.usage as Record<string, unknown>, false);
        }
        return;
      }

      if (agyEvent === 'result' && obj.result && typeof obj.result === 'object') {
        const resObj = obj.result as Record<string, unknown>;
        if (typeof resObj.conversation_id === 'string' && resObj.conversation_id) {
          resolvedSessionId = resObj.conversation_id;
        }
        if (typeof resObj.response === 'string' && resObj.response.trim()) {
          authoritativeResultText = resObj.response;
        }
        if (String(resObj.status || '').toUpperCase() === 'ERROR' && typeof resObj.error === 'string') {
          reportedErrorText = resObj.error;
        }
        if (resObj.usage && typeof resObj.usage === 'object') {
          applyUsage(resObj.usage as Record<string, unknown>, true);
        }
        // Resolve promptly if AGY background sidecar lingers after final result event
        if (!teardownTimer) {
          teardownTimer = setTimeout(() => {
            finalizeAndResolve(0);
            try {
              child.kill();
            } catch {
              // ignore
            }
          }, 1200);
        }
        return;
      }

      if (agyEvent === 'init') {
        return;
      }

      // 2. Codex (`codex exec --json`) schema: {"type": "item.completed" | "turn.completed", ...}
      const evType = String(obj.type || '');
      const item = (obj.item && typeof obj.item === 'object' ? obj.item : null) as Record<
        string,
        unknown
      > | null;

      if (item) {
        const itemType = String(item.type || '');
        if (itemType === 'command_execution' || itemType === 'tool_call') {
          const cmd = String(item.command || item.name || '执行操作');
          callbacks.onActivity(`执行: ${cmd.slice(0, 40)}`);
        } else if (itemType === 'reasoning') {
          callbacks.onActivity('思考中...');
        } else if (itemType === 'agent_message' && typeof item.text === 'string') {
          textChunks.push(item.text);
        }
      }

      // 3. Claude Code / CodeBuddy (`--output-format stream-json --verbose`) schema
      if (evType === 'assistant' && obj.message && typeof obj.message === 'object') {
        const msg = obj.message as Record<string, unknown>;
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part && typeof part === 'object') {
              const p = part as Record<string, unknown>;
              if (p.type === 'text' && typeof p.text === 'string') {
                textChunks.push(p.text);
              } else if (p.type === 'tool_use' && typeof p.name === 'string') {
                callbacks.onActivity(`调用: ${p.name}`);
              }
            }
          }
        }
      } else if (evType === 'result') {
        if (obj.is_error && typeof obj.result === 'string') {
          reportedErrorText = obj.result;
        } else if (typeof obj.result === 'string' && obj.result.trim()) {
          authoritativeResultText = obj.result;
        }
        if (obj.usage && typeof obj.usage === 'object') {
          applyUsage(obj.usage as Record<string, unknown>, true);
        }
        return;
      } else if (typeof obj.content === 'string' && (evType === 'message' || evType === 'text')) {
        textChunks.push(obj.content);
      }

      if (obj.usage && typeof obj.usage === 'object') {
        applyUsage(obj.usage as Record<string, unknown>, evType === 'turn.completed');
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        callbacks.onRawLog(trimmed.slice(0, 500));
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          handleJsonEvent(parsed);
        } catch {
          fallbackPlainLines.push(rawLine);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const errStr = chunk.toString('utf8').trim();
      if (errStr) {
        stderrLines.push(errStr);
        callbacks.onRawLog(`[stderr] ${errStr.slice(0, 400)}`);
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (teardownTimer) clearTimeout(teardownTimer);
      reject(err);
    });

    child.on('close', (code) => {
      if (stdoutBuf.trim()) {
        try {
          handleJsonEvent(JSON.parse(stdoutBuf.trim()) as Record<string, unknown>);
        } catch {
          fallbackPlainLines.push(stdoutBuf.trim());
        }
      }
      finalizeAndResolve(code);
    });

    if (built.passViaStdin && child.stdin) {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    }
  });
}

const INTERACTIVE_RESUME_ARGS: Partial<Record<AgentSlot['engine'], (sid: string) => string[]>> = {
  antigravity: (sid) => ['--conversation', sid],
  codex: (sid) => ['resume', sid],
  codebuddy: (sid) => ['-r', sid],
  claude: (sid) => ['-r', sid],
  gemini: (sid) => ['--resume', sid],
  qwen: (sid) => ['--resume', sid],
  opencode: (sid) => ['--session', sid],
};

/**
 * Opens an interactive terminal window on the local host to resume an agent's native session.
 */
export function openInteractiveAgentSession(params: {
  board: Board;
  slot: AgentSlot;
}): { commandPreview: string } {
  const { board, slot } = params;
  const sid = (slot.nativeSessionId || '').trim();
  if (board.executionMode === 'demo' || !sid || !/^[a-zA-Z0-9._-]+$/.test(sid)) {
    throw new Error('该成员尚未产生可打开的真实对话记录');
  }

  const bin = getBinaryForEngine(slot.engine);
  if (!bin) {
    throw new Error('本机未找到对应智能体命令行工具');
  }

  const buildArgs = INTERACTIVE_RESUME_ARGS[slot.engine];
  if (!buildArgs) {
    throw new Error('当前引擎暂不支持直接唤起对话窗口，请复制命令手动运行');
  }

  const resumeArgs = buildArgs(sid);
  const cmdLine = `${quoteCmdArg(bin)} ${resumeArgs.map(quoteCmdArg).join(' ')}`;

  const cwdValid = (() => {
    try {
      return Boolean(board.workspacePath) && fs.existsSync(board.workspacePath) && fs.statSync(board.workspacePath).isDirectory();
    } catch {
      return false;
    }
  })();
  const workingDir = cwdValid ? board.workspacePath : os.homedir();

  if (process.platform !== 'win32') {
    throw new Error('当前操作系统暂不支持一键唤起外部终端，请点击复制命令手动运行');
  }

  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-Command',
      "Start-Process -FilePath 'cmd.exe' -WorkingDirectory $env:COWORK_OPEN_CWD -WindowStyle Normal -ArgumentList @('/k', $env:COWORK_OPEN_CMD)",
    ],
    {
      env: buildSanitizedChildEnv({
        COWORK_OPEN_CWD: workingDir,
        COWORK_OPEN_CMD: cmdLine,
      }),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    }
  );
  child.unref();

  return { commandPreview: cmdLine };
}
