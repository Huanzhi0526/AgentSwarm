import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveMcpRepoRoot(): string {
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

export function resolveDefaultDataDir(repoRoot: string): string {
  const envDir = process.env.AGENT_COWORK_DATA_DIR?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }
  // Keep repo-local ./data during source development or when an existing DB is present
  if (
    fs.existsSync(path.join(repoRoot, 'tsconfig.json')) ||
    fs.existsSync(path.join(repoRoot, 'data', 'cowork-board.db'))
  ) {
    return path.join(repoRoot, 'data');
  }
  // Installed desktop runtime (read-only app bundle): store mutable data in user AppData
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
    return path.join(base, 'AgentSwarm', 'data');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AgentSwarm', 'data');
  }
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgData, 'AgentSwarm', 'data');
}

export function getBoardApiPort(): number {
  const n = Number(process.env.AGENT_COWORK_PORT || process.env.PORT || 25880);
  return Number.isFinite(n) && n > 0 ? n : 25880;
}

export function getBoardApiBaseUrl(): string {
  return `http://127.0.0.1:${getBoardApiPort()}`;
}
