import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DesktopMcpClientId, DesktopMcpClientStatus } from '../../src/types.js';
import { REPO_ROOT } from '../db.js';
import { getCatalogItem } from '../engines/catalog.js';
import { detectCliBinary } from '../telemetry/localScanner.js';

export const MCP_SERVER_KEY = 'agent_cowork_board';
export const ANTIGRAVITY_HOOK_KEY = 'agent-cowork-board-inbox';

export interface RegistrarOptions {
  homeDir?: string;
  nodeExecPath?: string;
  repoRoot?: string;
  enableHook?: boolean;
  skipBinaryDetect?: boolean;
}

function resolveOptions(options?: RegistrarOptions) {
  const homeDir = path.resolve(
    options?.homeDir || process.env.AGENT_COWORK_HOME_DIR || os.homedir()
  );
  const nodeExecPath = options?.nodeExecPath || process.execPath;
  const repoRoot = path.resolve(options?.repoRoot || REPO_ROOT);
  const mcpIndexJsPath = path.join(repoRoot, 'dist-mcp', 'index.js');
  const hookJsPath = path.join(repoRoot, 'dist-mcp', 'preInvocationHook.js');
  return {
    homeDir,
    nodeExecPath,
    repoRoot,
    mcpIndexJsPath,
    hookJsPath,
    enableHook: options?.enableHook !== false,
    skipBinaryDetect: Boolean(options?.skipBinaryDetect || options?.homeDir || process.env.AGENT_COWORK_HOME_DIR),
  };
}

function ensureBackupOnce(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const bakPath = `${filePath}.bak-cowork`;
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(filePath, bakPath);
  }
}

function readJsonFilePreservingBom(filePath: string): {
  exists: boolean;
  hasBom: boolean;
  data: Record<string, unknown>;
} {
  if (!fs.existsSync(filePath)) {
    return { exists: false, hasBom: false, data: {} };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const clean = (hasBom ? raw.slice(1) : raw).trim();
  if (!clean) {
    return { exists: true, hasBom, data: {} };
  }
  const parsed = JSON.parse(clean) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`配置文件格式不是有效 JSON 对象：${filePath}`);
  }
  return { exists: true, hasBom, data: parsed as Record<string, unknown> };
}

function writeJsonFilePreservingBom(
  filePath: string,
  data: Record<string, unknown>,
  hasBom: boolean
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  ensureBackupOnce(filePath);
  const jsonText = `${JSON.stringify(data, null, 2)}\n`;
  const finalContent = hasBom ? `\uFEFF${jsonText}` : jsonText;
  fs.writeFileSync(filePath, finalContent, 'utf8');
}

function parseTomlSections(raw: string): Array<{
  headerName: string | null;
  lines: string[];
}> {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  const sections: Array<{ headerName: string | null; lines: string[] }> = [];
  let current: { headerName: string | null; lines: string[] } = { headerName: null, lines: [] };

  for (const line of lines) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (m) {
      sections.push(current);
      current = { headerName: m[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  void eol;
  return sections;
}

function isTargetCodexMcpSection(headerName: string | null): boolean {
  if (!headerName) return false;
  return (
    headerName === `mcp_servers.${MCP_SERVER_KEY}` ||
    headerName.startsWith(`mcp_servers.${MCP_SERVER_KEY}.`)
  );
}

function serializeTomlSections(
  sections: Array<{ headerName: string | null; lines: string[] }>,
  eol: string
): string {
  const joined = sections
    .map((s) => s.lines.join(eol))
    .filter((block, idx) => idx > 0 || block.length > 0)
    .join(eol);
  const trimmedEnd = joined.replace(/(?:\r?\n)+$/, '');
  return trimmedEnd ? `${trimmedEnd}${eol}` : '';
}

function upsertCodexTomlSection(
  rawToml: string,
  sectionLines: string[]
): string {
  const eol = rawToml.includes('\r\n') ? '\r\n' : os.EOL;
  const sections = parseTomlSections(rawToml);
  const filtered = sections.filter((s) => !isTargetCodexMcpSection(s.headerName));

  // Trim trailing blank lines from last remaining section for tidy spacing
  if (filtered.length > 0) {
    const last = filtered[filtered.length - 1];
    while (last.lines.length > 0 && last.lines[last.lines.length - 1].trim() === '') {
      last.lines.pop();
    }
    if (last.lines.length > 0) {
      last.lines.push('');
    }
  }

  filtered.push({
    headerName: `mcp_servers.${MCP_SERVER_KEY}`,
    lines: sectionLines,
  });

  return serializeTomlSections(filtered, eol);
}

function removeCodexTomlSection(rawToml: string): string {
  const eol = rawToml.includes('\r\n') ? '\r\n' : os.EOL;
  const sections = parseTomlSections(rawToml);
  const filtered = sections.filter((s) => !isTargetCodexMcpSection(s.headerName));
  return serializeTomlSections(filtered, eol);
}

function hasCodexTomlRegistration(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const sections = parseTomlSections(raw);
    return sections.some((s) => s.headerName === `mcp_servers.${MCP_SERVER_KEY}`);
  } catch {
    return false;
  }
}

function getClientPaths(homeDir: string) {
  const agyConfigDir = path.join(homeDir, '.gemini', 'config');
  const isWin = process.platform === 'win32';
  return {
    antigravity: {
      configPath: path.join(agyConfigDir, 'mcp_config.json'),
      hooksPath: path.join(agyConfigDir, 'hooks.json'),
      hookScriptPath: path.join(
        agyConfigDir,
        isWin ? 'agent-cowork-board-hook.cmd' : 'agent-cowork-board-hook.sh'
      ),
      hookCommand: isWin ? '.\\agent-cowork-board-hook.cmd' : './agent-cowork-board-hook.sh',
    },
    codex: {
      configPath: path.join(homeDir, '.codex', 'config.toml'),
    },
    codebuddy: {
      configPath: path.join(homeDir, '.codebuddy', 'mcp.json'),
    },
    claude: {
      configPath: path.join(homeDir, '.claude.json'),
    },
  };
}

function detectClientInstalled(
  clientId: DesktopMcpClientId,
  homeDir: string,
  skipBinaryDetect: boolean
): boolean {
  const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

  const binaryReady = !skipBinaryDetect
    ? detectCliBinary(getCatalogItem(clientId).binaryCandidates(homeDir, localAppData, appData), true).installed
    : false;
  if (binaryReady) return true;

  if (clientId === 'antigravity') {
    return (
      fs.existsSync(path.join(homeDir, '.gemini', 'antigravity')) ||
      fs.existsSync(path.join(homeDir, '.gemini', 'config', 'mcp_config.json'))
    );
  }
  if (clientId === 'codex') {
    return fs.existsSync(path.join(homeDir, '.codex'));
  }
  if (clientId === 'codebuddy') {
    return fs.existsSync(path.join(homeDir, '.codebuddy'));
  }
  return (
    fs.existsSync(path.join(homeDir, '.claude.json')) ||
    fs.existsSync(path.join(homeDir, '.claude'))
  );
}

function hasJsonMcpEntry(filePath: string): boolean {
  try {
    const { exists, data } = readJsonFilePreservingBom(filePath);
    if (!exists) return false;
    const servers = data.mcpServers as Record<string, unknown> | undefined;
    return Boolean(servers && typeof servers === 'object' && MCP_SERVER_KEY in servers);
  } catch {
    return false;
  }
}

function hasAntigravityHookEntry(hooksPath: string): boolean {
  try {
    const { exists, data } = readJsonFilePreservingBom(hooksPath);
    if (!exists) return false;
    return Boolean(ANTIGRAVITY_HOOK_KEY in data);
  } catch {
    return false;
  }
}

export function listDesktopMcpClients(options?: RegistrarOptions): DesktopMcpClientStatus[] {
  const { homeDir, skipBinaryDetect } = resolveOptions(options);
  const paths = getClientPaths(homeDir);

  return [
    {
      id: 'antigravity',
      name: 'Antigravity',
      engine: 'antigravity',
      installed: detectClientInstalled('antigravity', homeDir, skipBinaryDetect),
      registered: hasJsonMcpEntry(paths.antigravity.configPath),
      hookRegistered: hasAntigravityHookEntry(paths.antigravity.hooksPath),
      supportsHook: true,
      configPath: paths.antigravity.configPath,
      hookPath: paths.antigravity.hooksPath,
      backupExists: fs.existsSync(`${paths.antigravity.configPath}.bak-cowork`),
      hint: '接入后请在 Antigravity 的 MCP Servers 开关中确认开启（或刷新一次）；支持右侧分栏 MCP App 与闲置留言自动注入。',
    },
    {
      id: 'codex',
      name: 'CodeX',
      engine: 'codex',
      installed: detectClientInstalled('codex', homeDir, skipBinaryDetect),
      registered: hasCodexTomlRegistration(paths.codex.configPath),
      supportsHook: false,
      configPath: paths.codex.configPath,
      backupExists: fs.existsSync(`${paths.codex.configPath}.bak-cowork`),
      hint: '已自动配置 tool_timeout_sec = 3600 防止长波次等待超时，新开 CodeX 对话立即生效。',
    },
    {
      id: 'codebuddy',
      name: 'CodeBuddy',
      engine: 'codebuddy',
      installed: detectClientInstalled('codebuddy', homeDir, skipBinaryDetect),
      registered: hasJsonMcpEntry(paths.codebuddy.configPath),
      supportsHook: false,
      configPath: paths.codebuddy.configPath,
      backupExists: fs.existsSync(`${paths.codebuddy.configPath}.bak-cowork`),
      hint: '接入后在 CodeBuddy 新开对话即可调用看板团队工具，支持等待期实时插话回传。',
    },
    {
      id: 'claude',
      name: 'Claude Code',
      engine: 'claude',
      installed: detectClientInstalled('claude', homeDir, skipBinaryDetect),
      registered: hasJsonMcpEntry(paths.claude.configPath),
      supportsHook: false,
      configPath: paths.claude.configPath,
      backupExists: fs.existsSync(`${paths.claude.configPath}.bak-cowork`),
      hint: '写入用户级 ~/.claude.json 的 mcpServers，保留你原有的项目配置与全部其他 MCP 服务。',
    },
  ];
}

export function registerDesktopMcpClient(
  clientId: DesktopMcpClientId,
  options?: RegistrarOptions
): DesktopMcpClientStatus {
  const { homeDir, nodeExecPath, mcpIndexJsPath, hookJsPath, enableHook } = resolveOptions(options);
  const paths = getClientPaths(homeDir);

  if (clientId === 'antigravity') {
    const parsed = readJsonFilePreservingBom(paths.antigravity.configPath);
    const mcpServers =
      parsed.data.mcpServers &&
      typeof parsed.data.mcpServers === 'object' &&
      !Array.isArray(parsed.data.mcpServers)
        ? { ...(parsed.data.mcpServers as Record<string, unknown>) }
        : {};
    mcpServers[MCP_SERVER_KEY] = {
      command: nodeExecPath,
      args: [mcpIndexJsPath],
    };
    writeJsonFilePreservingBom(
      paths.antigravity.configPath,
      { ...parsed.data, mcpServers },
      parsed.hasBom
    );

    if (enableHook) {
      fs.mkdirSync(path.dirname(paths.antigravity.hookScriptPath), { recursive: true });
      if (process.platform === 'win32') {
        const bat = `@echo off\r\n"${nodeExecPath}" "${hookJsPath}"\r\n`;
        fs.writeFileSync(paths.antigravity.hookScriptPath, bat, 'utf8');
      } else {
        const sh = `#!/bin/sh\nexec ${JSON.stringify(nodeExecPath)} ${JSON.stringify(hookJsPath)}\n`;
        fs.writeFileSync(paths.antigravity.hookScriptPath, sh, { encoding: 'utf8', mode: 0o755 });
      }

      const hookParsed = readJsonFilePreservingBom(paths.antigravity.hooksPath);
      const nextHooks = { ...hookParsed.data };
      nextHooks[ANTIGRAVITY_HOOK_KEY] = {
        PreInvocation: [
          {
            type: 'command',
            command: paths.antigravity.hookCommand,
            timeout: 5,
          },
        ],
      };
      writeJsonFilePreservingBom(paths.antigravity.hooksPath, nextHooks, hookParsed.hasBom);
    } else {
      if (fs.existsSync(paths.antigravity.hooksPath)) {
        const hookParsed = readJsonFilePreservingBom(paths.antigravity.hooksPath);
        if (ANTIGRAVITY_HOOK_KEY in hookParsed.data) {
          const nextHooks = { ...hookParsed.data };
          delete nextHooks[ANTIGRAVITY_HOOK_KEY];
          writeJsonFilePreservingBom(paths.antigravity.hooksPath, nextHooks, hookParsed.hasBom);
        }
      }
      try {
        if (fs.existsSync(paths.antigravity.hookScriptPath)) {
          fs.unlinkSync(paths.antigravity.hookScriptPath);
        }
      } catch {
        // ignore cleanup error
      }
    }
  } else if (clientId === 'codex') {
    const filePath = paths.codex.configPath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    const hasBom = raw.charCodeAt(0) === 0xfeff;
    const cleanRaw = hasBom ? raw.slice(1) : raw;
    if (fs.existsSync(filePath)) {
      ensureBackupOnce(filePath);
    }

    const sectionLines = [
      `[mcp_servers.${MCP_SERVER_KEY}]`,
      `command = ${JSON.stringify(nodeExecPath)}`,
      `args = [${JSON.stringify(mcpIndexJsPath)}]`,
      `cwd = ${JSON.stringify(homeDir)}`,
      `tool_timeout_sec = 3600`,
    ];
    const nextToml = upsertCodexTomlSection(cleanRaw, sectionLines);
    fs.writeFileSync(filePath, hasBom ? `\uFEFF${nextToml}` : nextToml, 'utf8');
  } else if (clientId === 'codebuddy') {
    const parsed = readJsonFilePreservingBom(paths.codebuddy.configPath);
    const mcpServers =
      parsed.data.mcpServers &&
      typeof parsed.data.mcpServers === 'object' &&
      !Array.isArray(parsed.data.mcpServers)
        ? { ...(parsed.data.mcpServers as Record<string, unknown>) }
        : {};
    mcpServers[MCP_SERVER_KEY] = {
      command: nodeExecPath,
      args: [mcpIndexJsPath],
    };
    const nextData: Record<string, unknown> = { ...parsed.data, mcpServers };
    if (Array.isArray(parsed.data.disabledMcpServers)) {
      nextData.disabledMcpServers = parsed.data.disabledMcpServers.filter(
        (id) => id !== MCP_SERVER_KEY
      );
    }
    writeJsonFilePreservingBom(paths.codebuddy.configPath, nextData, parsed.hasBom);
  } else if (clientId === 'claude') {
    const parsed = readJsonFilePreservingBom(paths.claude.configPath);
    const mcpServers =
      parsed.data.mcpServers &&
      typeof parsed.data.mcpServers === 'object' &&
      !Array.isArray(parsed.data.mcpServers)
        ? { ...(parsed.data.mcpServers as Record<string, unknown>) }
        : {};
    mcpServers[MCP_SERVER_KEY] = {
      type: 'stdio',
      command: nodeExecPath,
      args: [mcpIndexJsPath],
    };
    writeJsonFilePreservingBom(
      paths.claude.configPath,
      { ...parsed.data, mcpServers },
      parsed.hasBom
    );
  }

  return listDesktopMcpClients(options).find((c) => c.id === clientId)!;
}

export function unregisterDesktopMcpClient(
  clientId: DesktopMcpClientId,
  options?: RegistrarOptions
): DesktopMcpClientStatus {
  const { homeDir } = resolveOptions(options);
  const paths = getClientPaths(homeDir);

  if (clientId === 'antigravity') {
    if (fs.existsSync(paths.antigravity.configPath)) {
      const parsed = readJsonFilePreservingBom(paths.antigravity.configPath);
      const mcpServers =
        parsed.data.mcpServers && typeof parsed.data.mcpServers === 'object'
          ? { ...(parsed.data.mcpServers as Record<string, unknown>) }
          : {};
      delete mcpServers[MCP_SERVER_KEY];
      writeJsonFilePreservingBom(
        paths.antigravity.configPath,
        { ...parsed.data, mcpServers },
        parsed.hasBom
      );
    }
    if (fs.existsSync(paths.antigravity.hooksPath)) {
      const hookParsed = readJsonFilePreservingBom(paths.antigravity.hooksPath);
      if (ANTIGRAVITY_HOOK_KEY in hookParsed.data) {
        const nextHooks = { ...hookParsed.data };
        delete nextHooks[ANTIGRAVITY_HOOK_KEY];
        writeJsonFilePreservingBom(paths.antigravity.hooksPath, nextHooks, hookParsed.hasBom);
      }
    }
    try {
      if (fs.existsSync(paths.antigravity.hookScriptPath)) {
        fs.unlinkSync(paths.antigravity.hookScriptPath);
      }
    } catch {
      // ignore cleanup error
    }
  } else if (clientId === 'codex') {
    const filePath = paths.codex.configPath;
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const hasBom = raw.charCodeAt(0) === 0xfeff;
      const cleanRaw = hasBom ? raw.slice(1) : raw;
      ensureBackupOnce(filePath);
      const nextToml = removeCodexTomlSection(cleanRaw);
      fs.writeFileSync(filePath, hasBom ? `\uFEFF${nextToml}` : nextToml, 'utf8');
    }
  } else if (clientId === 'codebuddy') {
    if (fs.existsSync(paths.codebuddy.configPath)) {
      const parsed = readJsonFilePreservingBom(paths.codebuddy.configPath);
      const mcpServers =
        parsed.data.mcpServers && typeof parsed.data.mcpServers === 'object'
          ? { ...(parsed.data.mcpServers as Record<string, unknown>) }
          : {};
      delete mcpServers[MCP_SERVER_KEY];
      writeJsonFilePreservingBom(
        paths.codebuddy.configPath,
        { ...parsed.data, mcpServers },
        parsed.hasBom
      );
    }
  } else if (clientId === 'claude') {
    if (fs.existsSync(paths.claude.configPath)) {
      const parsed = readJsonFilePreservingBom(paths.claude.configPath);
      const mcpServers =
        parsed.data.mcpServers && typeof parsed.data.mcpServers === 'object'
          ? { ...(parsed.data.mcpServers as Record<string, unknown>) }
          : {};
      delete mcpServers[MCP_SERVER_KEY];
      writeJsonFilePreservingBom(
        paths.claude.configPath,
        { ...parsed.data, mcpServers },
        parsed.hasBom
      );
    }
  }

  return listDesktopMcpClients(options).find((c) => c.id === clientId)!;
}
