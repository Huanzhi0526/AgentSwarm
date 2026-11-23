import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distServerDir = path.join(REPO_ROOT, 'dist-server');
const distMcpDir = path.join(REPO_ROOT, 'dist-mcp');

fs.mkdirSync(distServerDir, { recursive: true });
fs.mkdirSync(distMcpDir, { recursive: true });

// Embed official native brand icons + app logo as data URIs so MCP App CSP `default-src 'none'` renders crisp icons offline
const ICON_FILES = {
  'app-logo': 'app-logo.svg',
  antigravity: 'antigravity.svg',
  codex: 'codex.svg',
  codebuddy: 'codebuddy.svg',
  claude: 'claude.svg',
  gemini: 'gemini.svg',
  qwen: 'qwen.svg',
  opencode: 'opencode.svg',
  cursor: 'cursor.png',
  copilot: 'github.svg',
  kimi: 'kimi.svg',
  auggie: 'auggie.svg',
  goose: 'goose.svg',
  droid: 'droid.svg',
  qoder: 'qoder.png',
  vibe: 'mistral.svg',
  kiro: 'kiro.svg',
  hermes: 'hermes.svg',
  snow: 'snow.png',
  openclaw: 'openclaw.svg',
  nanobot: 'nanobot.svg',
};

const iconDataMap = {};
const iconsDir = path.join(REPO_ROOT, 'public', 'icons');
for (const [key, filename] of Object.entries(ICON_FILES)) {
  const fullPath = path.join(iconsDir, filename);
  if (!fs.existsSync(fullPath)) continue;
  const buf = fs.readFileSync(fullPath);
  const mime = filename.endsWith('.png') ? 'image/png' : 'image/svg+xml';
  iconDataMap[key] = `data:${mime};base64,${buf.toString('base64')}`;
}

// 1. Build single-file React 19 MCP App HTML for Antigravity aux_pane / global view
const panelBuild = await esbuild.build({
  entryPoints: [path.join(REPO_ROOT, 'server', 'mcp', 'panelClient.tsx')],
  bundle: true,
  write: false,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  define: {
    __COWORK_ICON_DATA_MAP__: JSON.stringify(iconDataMap),
  },
});

const panelJs = panelBuild.outputFiles[0].text;
const panelHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentSwarm 协同看板</title>
  <style>
    :root {
      --cw-canvas: #F6F6F9;
      --cw-card: #FFFFFF;
      --cw-subtle: #FAFAFC;
      --cw-soft: #F3F2F7;
      --cw-border: #EAEAEF;
      --cw-border-strong: #DCDCE6;
      --cw-text: #1F2024;
      --cw-text-sec: #555866;
      --cw-text-muted: #8A8D98;
      --cw-accent: #7768A6;
      --cw-accent-hover: #665794;
      --cw-accent-soft: #F3F0FA;
      --cw-accent-border: #DFD8F0;
      --cw-accent-text: #5E4F87;
      --cw-human-bg: #7B6BA8;
      --cw-green-bg: #EAF5EE;
      --cw-green-border: #CBE6D5;
      --cw-green-text: #3B7A57;
      --cw-err-bg: #FDF5F4;
      --cw-err-border: #EED7D4;
      --cw-err-text: #A65850;
      --cw-shadow: 0 2px 10px rgba(20, 20, 35, 0.035);
      --cw-pop-shadow: 0 10px 28px rgba(20, 20, 35, 0.12);
    }
    html[data-theme="dark"] {
      --cw-canvas: var(--color-background-primary, #17181E);
      --cw-card: var(--color-background-secondary, #20222A);
      --cw-subtle: var(--color-background-tertiary, #272933);
      --cw-soft: #2C2E3A;
      --cw-border: var(--color-border-primary, #343746);
      --cw-border-strong: #464A5E;
      --cw-text: var(--color-text-primary, #F2F3F7);
      --cw-text-sec: var(--color-text-secondary, #C2C5D3);
      --cw-text-muted: #8E92A4;
      --cw-accent: #8B7CC0;
      --cw-accent-hover: #9C8ED0;
      --cw-accent-soft: rgba(139, 124, 192, 0.16);
      --cw-accent-border: rgba(139, 124, 192, 0.36);
      --cw-accent-text: #D2C8F2;
      --cw-human-bg: #695A96;
      --cw-green-bg: rgba(76, 168, 115, 0.15);
      --cw-green-border: rgba(76, 168, 115, 0.35);
      --cw-green-text: #7CD49F;
      --cw-err-bg: rgba(182, 91, 80, 0.16);
      --cw-err-border: rgba(182, 91, 80, 0.38);
      --cw-err-text: #F2A89F;
      --cw-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
      --cw-pop-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    }
    html[data-accent="blue"] {
      --cw-accent: #4F7CAC;
      --cw-accent-hover: #416994;
      --cw-accent-soft: #EEF4FB;
      --cw-accent-border: #C5D7EA;
      --cw-accent-text: #385A80;
      --cw-human-bg: #5480AE;
    }
    html[data-theme="dark"][data-accent="blue"] {
      --cw-accent: #6A97C6;
      --cw-accent-hover: #7DA8D5;
      --cw-accent-soft: rgba(106, 151, 198, 0.18);
      --cw-accent-border: rgba(106, 151, 198, 0.38);
      --cw-accent-text: #C2D8EE;
      --cw-human-bg: #466E9A;
    }
    html[data-accent="green"] {
      --cw-accent: #4D8B74;
      --cw-accent-hover: #3F7661;
      --cw-accent-soft: #EDF7F3;
      --cw-accent-border: #C3DFD4;
      --cw-accent-text: #366654;
      --cw-human-bg: #528F78;
    }
    html[data-theme="dark"][data-accent="green"] {
      --cw-accent: #62A38B;
      --cw-accent-hover: #75B59E;
      --cw-accent-soft: rgba(98, 163, 139, 0.18);
      --cw-accent-border: rgba(98, 163, 139, 0.38);
      --cw-accent-text: #BCE0D3;
      --cw-human-bg: #437A66;
    }
    html[data-accent="pink"] {
      --cw-accent: #B06986;
      --cw-accent-hover: #9A5773;
      --cw-accent-soft: #FBF0F5;
      --cw-accent-border: #E9CCD8;
      --cw-accent-text: #884762;
      --cw-human-bg: #B46E8B;
    }
    html[data-theme="dark"][data-accent="pink"] {
      --cw-accent: #C7809D;
      --cw-accent-hover: #D694AF;
      --cw-accent-soft: rgba(199, 128, 157, 0.18);
      --cw-accent-border: rgba(199, 128, 157, 0.38);
      --cw-accent-text: #EFCAD9;
      --cw-human-bg: #965470;
    }
    * { box-sizing: border-box; }
    html, body, #app {
      height: 100%;
      margin: 0;
      padding: 0;
      background: var(--cw-canvas);
      color: var(--cw-text);
      font-family: var(--font-sans, "Segoe UI", system-ui, -apple-system, sans-serif);
      font-size: 13px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    button, input { font-family: inherit; }
    .cw-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-width: 780px;
      margin: 0 auto;
      padding: 10px 12px 12px;
      gap: 8px;
    }
    .cw-header {
      background: var(--cw-card);
      border: 1px solid var(--cw-border);
      border-radius: 18px;
      padding: 10px 12px;
      box-shadow: var(--cw-shadow);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }
    .cw-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .cw-brand-left {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .cw-app-logo { width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0; }
    .cw-brand-title { font-size: 14px; font-weight: 700; color: var(--cw-text); white-space: nowrap; }
    .cw-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      border: 1px solid var(--cw-border);
    }
    .cw-badge-green { background: var(--cw-green-bg); border-color: var(--cw-green-border); color: var(--cw-green-text); }
    .cw-badge-purple { background: var(--cw-accent-soft); border-color: var(--cw-accent-border); color: var(--cw-accent-text); }
    .cw-badge-neutral { background: var(--cw-subtle); color: var(--cw-text-sec); }
    .cw-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .cw-dot-green { background: #4CA873; }
    .cw-dot-pulse { background: #4CA873; animation: cwPulse 1.6s ease-in-out infinite; }
    .cw-dot-purple { background: var(--cw-accent); }
    .cw-dot-muted { background: #9FA3B0; }
    @keyframes cwPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    @keyframes cwSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .cw-spin { animation: cwSpin 1s linear infinite; }
    .cw-header-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .cw-theme-dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 6px;
      border-radius: 999px;
      border: 1px solid var(--cw-border);
      background: var(--cw-subtle);
    }
    .cw-theme-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      border: none;
      padding: 0;
      cursor: pointer;
      opacity: 0.72;
      transition: transform 0.15s, opacity 0.15s;
    }
    .cw-theme-dot:hover { opacity: 1; transform: scale(1.1); }
    .cw-theme-dot.is-active {
      opacity: 1;
      transform: scale(1.12);
      outline: 2px solid var(--cw-text);
      outline-offset: 1px;
    }
    .cw-icon-btn {
      width: 28px;
      height: 28px;
      border-radius: 9px;
      border: 1px solid var(--cw-border);
      background: var(--cw-card);
      color: var(--cw-text-sec);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .cw-icon-btn:hover { background: var(--cw-soft); }
    .cw-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 10px;
      border-radius: 9px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .cw-btn-ghost { border-color: var(--cw-border); background: var(--cw-card); color: var(--cw-text-sec); }
    .cw-btn-ghost:hover { background: var(--cw-soft); }
    .cw-btn-primary { background: var(--cw-accent); color: #fff; }
    .cw-btn-primary:hover { background: var(--cw-accent-hover); }
    .cw-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .cw-board-select { flex: 1; min-width: 140px; }
    .cw-toggles-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .cw-pill-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 9px;
      border-radius: 9px;
      border: 1px solid var(--cw-border);
      background: var(--cw-card);
      color: var(--cw-text-sec);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    .cw-pill-toggle.is-green { background: var(--cw-green-bg); border-color: var(--cw-green-border); color: var(--cw-green-text); font-weight: 600; }
    .cw-pill-toggle.is-purple { background: var(--cw-accent-soft); border-color: var(--cw-accent-border); color: var(--cw-accent-text); font-weight: 600; }
    .cw-sync-time { font-size: 11px; color: var(--cw-text-muted); margin-left: auto; white-space: nowrap; }
    .cw-tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      background: var(--cw-soft);
      padding: 3px;
      border-radius: 12px;
    }
    .cw-tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 30px;
      border-radius: 9px;
      border: none;
      background: transparent;
      color: var(--cw-text-muted);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .cw-tab.is-active { background: var(--cw-card); color: var(--cw-text); box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .cw-tab-count {
      border-radius: 999px;
      padding: 0 5px;
      font-size: 10.5px;
      background: var(--cw-accent-soft);
      color: var(--cw-accent-text);
    }
    /* Custom SelectMenu matching Web UI */
    .cw-select-wrap { position: relative; min-width: 0; }
    .cw-select-trigger {
      display: flex;
      width: 100%;
      height: 30px;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 0 9px;
      border-radius: 10px;
      border: 1px solid var(--cw-border);
      background: var(--cw-card);
      color: var(--cw-text);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .cw-select-trigger.is-open { border-color: var(--cw-accent); box-shadow: 0 0 0 2px var(--cw-accent-soft); }
    .cw-select-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cw-select-caret { flex-shrink: 0; color: var(--cw-text-muted); transition: transform 150ms; }
    .cw-select-caret.is-open { transform: rotate(180deg); color: var(--cw-accent); }
    .cw-select-menu {
      position: absolute;
      top: calc(100% + 5px);
      z-index: 60;
      min-width: 100%;
      max-width: 240px;
      width: max-content;
      max-height: 210px;
      overflow-y: auto;
      border-radius: 14px;
      border: 1px solid var(--cw-border);
      background: var(--cw-card);
      padding: 5px;
      box-shadow: var(--cw-pop-shadow);
    }
    .cw-select-menu.is-left { left: 0; }
    .cw-select-menu.is-right { right: 0; }
    .cw-select-opt {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 9px;
      border-radius: 9px;
      border: none;
      background: transparent;
      color: var(--cw-text-sec);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }
    .cw-select-opt:hover { background: var(--cw-soft); }
    .cw-select-opt.is-selected { background: var(--cw-accent-soft); color: var(--cw-accent-text); font-weight: 600; }
    .cw-select-opt-right { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .cw-opt-badge {
      border-radius: 5px;
      padding: 1px 5px;
      font-size: 10px;
      background: var(--cw-green-bg);
      color: var(--cw-green-text);
    }
    .cw-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cw-notice {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 11px;
      border-radius: 12px;
      border: 1px solid var(--cw-accent-border);
      background: var(--cw-accent-soft);
      color: var(--cw-accent-text);
      font-size: 12px;
      font-weight: 500;
      flex-shrink: 0;
    }
    .cw-error-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 11px;
      border-radius: 12px;
      border: 1px solid var(--cw-err-border);
      background: var(--cw-err-bg);
      color: var(--cw-err-text);
      font-size: 12px;
      flex-shrink: 0;
    }
    .cw-main-col { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 8px; }
    .cw-feed {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 4px 2px;
    }
    .cw-scroll-col {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 4px;
    }
    .cw-system-pill {
      align-self: center;
      border-radius: 999px;
      background: var(--cw-soft);
      color: var(--cw-text-muted);
      padding: 4px 12px;
      font-size: 11.5px;
    }
    .cw-msg-human-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
    .cw-msg-human-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--cw-text-muted); padding: 0 4px; }
    .cw-msg-human-bubble {
      max-width: 86%;
      border-radius: 16px 4px 16px 16px;
      background: var(--cw-human-bg);
      color: #FFFFFF;
      padding: 9px 13px;
      box-shadow: 0 2px 8px rgba(123, 107, 168, 0.16);
    }
    .cw-delivery-note { font-size: 11px; color: var(--cw-text-muted); padding: 0 4px; }
    .cw-delivery-note.is-ok { color: var(--cw-green-text); font-weight: 500; }
    .cw-msg-agent-row { display: flex; align-items: flex-start; gap: 8px; }
    .cw-avatar {
      width: 30px;
      height: 30px;
      border-radius: 10px;
      background: var(--cw-card);
      border: 1px solid var(--cw-border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .cw-avatar-sm {
      width: 26px;
      height: 26px;
      border-radius: 8px;
      background: var(--cw-subtle);
      border: 1px solid var(--cw-border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .cw-engine-icon { object-fit: contain; border-radius: 4px; display: block; }
    .cw-msg-agent-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .cw-msg-agent-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
    .cw-model-badge {
      border-radius: 6px;
      background: var(--cw-soft);
      color: var(--cw-text-sec);
      padding: 1px 6px;
      font-size: 10.5px;
    }
    .cw-time { font-size: 11px; color: var(--cw-text-muted); }
    .cw-agent-card {
      background: var(--cw-card);
      border: 1px solid var(--cw-border);
      border-radius: 4px 16px 16px 16px;
      padding: 10px 12px;
      box-shadow: var(--cw-shadow);
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .cw-card-heading { font-size: 13.5px; font-weight: 700; color: var(--cw-text); }
    .cw-md { font-size: 12.5px; line-height: 1.55; word-break: break-word; }
    .cw-md-spacer { height: 5px; }
    .cw-md-li { display: flex; gap: 5px; padding-left: 2px; }
    .cw-md-dot { opacity: 0.65; }
    .cw-inline-code.agent {
      background: var(--cw-soft);
      color: var(--cw-accent-text);
      padding: 1px 5px;
      border-radius: 5px;
      font-family: ui-monospace, monospace;
      font-size: 11.5px;
    }
    .cw-inline-code.human {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 1px 5px;
      border-radius: 5px;
      font-family: ui-monospace, monospace;
      font-size: 11.5px;
    }
    .cw-mention.agent {
      background: var(--cw-accent-soft);
      color: var(--cw-accent-text);
      padding: 0 5px;
      border-radius: 5px;
      font-weight: 600;
    }
    .cw-mention.human {
      background: rgba(255, 255, 255, 0.22);
      color: #fff;
      padding: 0 5px;
      border-radius: 5px;
      font-weight: 600;
    }
    .cw-staff-box {
      border-radius: 10px;
      background: var(--cw-subtle);
      border: 1px solid var(--cw-border);
      padding: 7px 9px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cw-staff-title { font-size: 11px; font-weight: 700; color: var(--cw-text-muted); }
    .cw-staff-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
    .cw-files-row { display: flex; flex-wrap: wrap; gap: 5px; }
    .cw-file-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 8px;
      border: 1px solid var(--cw-border);
      background: var(--cw-subtle);
      color: var(--cw-text-sec);
      font-size: 11px;
      font-family: ui-monospace, monospace;
      cursor: pointer;
    }
    .cw-file-chip:hover { border-color: var(--cw-accent); color: var(--cw-accent-text); }
    .cw-snap-inline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--cw-border);
      font-size: 11.5px;
    }
    .cw-snap-state { font-size: 11.5px; color: var(--cw-text-muted); font-weight: 500; }
    .cw-snap-state.is-adopted { color: var(--cw-green-text); font-weight: 600; }
    .cw-snap-state.is-reverted { color: var(--cw-err-text); font-weight: 600; }
    .cw-snap-btns { display: flex; gap: 5px; }
    .cw-snap-btns-full { display: flex; justify-content: flex-end; gap: 6px; padding-top: 4px; }
    .cw-mini-btn {
      height: 24px;
      padding: 0 9px;
      border-radius: 7px;
      border: 1px solid var(--cw-border);
      background: var(--cw-card);
      color: var(--cw-text-sec);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .cw-mini-btn.is-primary { background: var(--cw-accent); border-color: var(--cw-accent); color: #fff; }
    .cw-composer {
      background: var(--cw-card);
      border: 1px solid var(--cw-border);
      border-radius: 16px;
      padding: 9px 10px;
      box-shadow: var(--cw-shadow);
      display: flex;
      flex-direction: column;
      gap: 7px;
      flex-shrink: 0;
    }
    .cw-composer-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
    .cw-mode-pills { display: flex; gap: 4px; background: var(--cw-soft); padding: 2px; border-radius: 9px; }
    .cw-mode-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 24px;
      padding: 0 8px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--cw-text-muted);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .cw-mode-btn.is-active { background: var(--cw-card); color: var(--cw-accent-text); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
    .cw-target-select { width: 132px; }
    .cw-quick-row { display: flex; flex-wrap: wrap; gap: 5px; }
    .cw-quick-pill {
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid var(--cw-accent-border);
      background: var(--cw-accent-soft);
      color: var(--cw-accent-text);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .cw-input-row { display: flex; gap: 6px; }
    .cw-input-row input, .cw-inline-form input {
      flex: 1;
      min-width: 0;
      height: 32px;
      border-radius: 10px;
      border: 1px solid var(--cw-border);
      background: var(--cw-subtle);
      color: var(--cw-text);
      padding: 0 10px;
      font-size: 12.5px;
      outline: none;
    }
    .cw-input-row input:focus, .cw-inline-form input:focus { border-color: var(--cw-accent); }
    .cw-send-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 32px;
      padding: 0 12px;
      border-radius: 10px;
      border: none;
      background: var(--cw-accent);
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
    }
    .cw-send-btn:hover { background: var(--cw-accent-hover); }
    .cw-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .cw-card {
      background: var(--cw-card);
      border: 1px solid var(--cw-border);
      border-radius: 16px;
      padding: 11px 12px;
      box-shadow: var(--cw-shadow);
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .cw-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .cw-card-title-group { display: flex; align-items: center; gap: 7px; }
    .cw-card-title { font-size: 13px; font-weight: 700; color: var(--cw-text); }
    .cw-count-pill {
      border-radius: 999px;
      background: var(--cw-accent-soft);
      color: var(--cw-accent-text);
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 600;
    }
    .cw-link-btn {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border: none;
      background: transparent;
      color: var(--cw-accent-text);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .cw-progress-track { height: 6px; border-radius: 999px; background: var(--cw-soft); overflow: hidden; }
    .cw-progress-fill { height: 100%; border-radius: 999px; background: var(--cw-accent); transition: width 260ms ease; }
    .cw-inline-form { display: flex; gap: 6px; }
    .cw-task-list { display: flex; flex-direction: column; gap: 6px; }
    .cw-task-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border-radius: 12px;
      border: 1px solid var(--cw-border);
      background: var(--cw-subtle);
      color: var(--cw-text);
      font-size: 12.5px;
      cursor: pointer;
    }
    .cw-task-item:hover { border-color: var(--cw-border-strong); }
    .cw-task-icon { display: flex; flex-shrink: 0; }
    .cw-task-title { flex: 1; min-width: 0; font-weight: 500; }
    .cw-task-title.is-done { text-decoration: line-through; color: var(--cw-text-muted); font-weight: 400; }
    .cw-task-who { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--cw-text-muted); flex-shrink: 0; }
    .cw-roster-list { display: flex; flex-direction: column; gap: 8px; }
    .cw-member-card {
      border-radius: 14px;
      border: 1px solid var(--cw-border);
      background: var(--cw-subtle);
      padding: 9px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cw-member-card.is-working { border-color: var(--cw-accent); background: var(--cw-accent-soft); }
    .cw-member-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .cw-member-id { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .cw-member-names { min-width: 0; }
    .cw-member-title-line { display: flex; align-items: center; gap: 5px; font-size: 13px; }
    .cw-leader-tag {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border-radius: 6px;
      background: var(--cw-accent-soft);
      color: var(--cw-accent-text);
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 600;
    }
    .cw-member-right { display: flex; align-items: center; gap: 4px; font-size: 11.5px; flex-shrink: 0; }
    .cw-state-text { font-weight: 600; color: var(--cw-green-text); }
    .cw-state-text.is-working { color: var(--cw-accent-text); }
    .cw-state-text.is-err { color: var(--cw-err-text); }
    .cw-member-controls { display: flex; align-items: center; gap: 6px; }
    .cw-flex-1 { flex: 1; min-width: 0; }
    .cw-effort-select { width: 88px; flex-shrink: 0; }
    .cw-backups-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 2px; }
    .cw-snap-title { font-size: 12.5px; color: var(--cw-text); }
    .cw-muted { font-size: 11.5px; color: var(--cw-text-muted); }
    .cw-muted-center { text-align: center; padding: 14px 8px; font-size: 12px; color: var(--cw-text-muted); }
    .cw-empty-card {
      margin: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px 16px;
      text-align: center;
      border-radius: 16px;
      border: 1px dashed var(--cw-border-strong);
      background: var(--cw-card);
      color: var(--cw-text-muted);
      font-size: 12.5px;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>${panelJs}</script>
</body>
</html>
`;

fs.writeFileSync(path.join(distMcpDir, 'panel.html'), panelHtml, 'utf8');

// 2. Build self-contained Node bundles (keeping only optional C++ addons external so installed desktop runtime works without node_modules)
const NODE_BANNER_JS =
  "import { createRequire as __cwCreateRequire } from 'node:module'; const require = __cwCreateRequire(import.meta.url);";
const nodeBundleOpts = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: NODE_BANNER_JS },
  sourcemap: false,
};

await esbuild.build({
  ...nodeBundleOpts,
  entryPoints: [path.join(REPO_ROOT, 'server', 'index.ts')],
  outfile: path.join(distServerDir, 'index.js'),
});

await esbuild.build({
  ...nodeBundleOpts,
  entryPoints: [path.join(REPO_ROOT, 'server', 'mcp', 'index.ts')],
  outfile: path.join(distMcpDir, 'index.js'),
});

await esbuild.build({
  ...nodeBundleOpts,
  entryPoints: [path.join(REPO_ROOT, 'server', 'mcp', 'preInvocationHook.ts')],
  outfile: path.join(distMcpDir, 'preInvocationHook.js'),
});

console.log('Built dist-server/index.js, dist-mcp/index.js, dist-mcp/preInvocationHook.js, dist-mcp/panel.html');
