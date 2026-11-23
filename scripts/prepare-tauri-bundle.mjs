import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_DIR = path.join(REPO_ROOT, 'src-tauri', 'bundle-stage');
const RUNTIME_DIR = path.join(STAGE_DIR, 'runtime');
const APP_DIR = path.join(STAGE_DIR, 'app');

function runStep(cmd, args) {
  const isWin = process.platform === 'win32';
  const executable = isWin && cmd === 'pnpm' ? 'cmd.exe' : cmd;
  const finalArgs = isWin && cmd === 'pnpm' ? ['/d', '/c', 'pnpm', ...args] : args;
  execFileSync(executable, finalArgs, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
}

if (process.env.SKIP_WEB_BUILD !== '1') {
  runStep('pnpm', ['build']);
}

const sourcePng = path.join(REPO_ROOT, 'src-tauri', 'app-icon-source.png');
const targetIco = path.join(REPO_ROOT, 'src-tauri', 'icons', 'icon.ico');
if (!fs.existsSync(targetIco)) {
  if (!fs.existsSync(sourcePng)) {
    runStep(process.execPath, [path.join(REPO_ROOT, 'scripts', 'generate-tauri-icons.mjs')]);
  }
  runStep('pnpm', ['exec', 'tauri', 'icon', sourcePng, '-o', path.join(REPO_ROOT, 'src-tauri', 'icons')]);
}

fs.rmSync(STAGE_DIR, { recursive: true, force: true });
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
fs.mkdirSync(APP_DIR, { recursive: true });

// 1. Copy Node 24+ executable into bundled runtime/
const nodeBinName = process.platform === 'win32' ? 'node.exe' : 'node';
const stagedNodePath = path.join(RUNTIME_DIR, nodeBinName);
fs.copyFileSync(process.execPath, stagedNodePath);
if (process.platform !== 'win32') {
  fs.chmodSync(stagedNodePath, 0o755);
}

// 2. Copy built self-contained app assets (no node_modules or data/ shipped)
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const runtimePkg = {
  name: 'agent-swarm-runtime',
  version: pkg.version || '1.4.0',
  private: true,
  type: 'module',
};
fs.writeFileSync(path.join(APP_DIR, 'package.json'), `${JSON.stringify(runtimePkg, null, 2)}\n`, 'utf8');

for (const dirName of ['dist', 'dist-server', 'dist-mcp', 'skills']) {
  const src = path.join(REPO_ROOT, dirName);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(APP_DIR, dirName), { recursive: true });
  }
}

const helperSrc = path.join(REPO_ROOT, 'scripts', 'cowork-cli.mjs');
if (fs.existsSync(helperSrc)) {
  fs.mkdirSync(path.join(APP_DIR, 'scripts'), { recursive: true });
  fs.copyFileSync(helperSrc, path.join(APP_DIR, 'scripts', 'cowork-cli.mjs'));
}

console.log(`Staged Tauri runtime & app bundle in ${STAGE_DIR}`);
