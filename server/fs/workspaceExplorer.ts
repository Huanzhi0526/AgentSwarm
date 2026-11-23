import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SKIP_SYSTEM_DIRS = new Set([
  '$RECYCLE.BIN',
  'System Volume Information',
  'Recovery',
  'PerfLogs',
  'node_modules',
  '.git',
]);

export interface QuickRootItem {
  label: string;
  path: string;
  kind: 'drive' | 'shortcut';
}

export interface DirectoryEntryItem {
  name: string;
  path: string;
}

const MAX_BROWSE_DIRS = 200;

export interface BrowseDirsResponse {
  currentPath: string;
  parentPath: string | null;
  roots: QuickRootItem[];
  directories: DirectoryEntryItem[];
  totalDirectories: number;
  truncated: boolean;
  unsafeReason: string | null;
}

export function normalizeCmpPath(raw: string): string {
  const cleaned = path.resolve(raw).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
}

export function validateWorkspaceDirectory(
  targetPath: string,
  extraRestrictedRoots: string[] = []
): string | null {
  let resolved = '';
  try {
    resolved = path.resolve(targetPath.trim());
  } catch {
    return '文件夹路径格式无效';
  }
  const cmp = normalizeCmpPath(resolved);
  const parsedRoot = normalizeCmpPath(path.parse(resolved).root);
  if (cmp === parsedRoot) {
    return '为防止误扫描整个磁盘，请选择具体的项目子文件夹（不能直接使用磁盘根目录）';
  }

  if (process.platform === 'win32') {
    const winDir = normalizeCmpPath(process.env.WINDIR || 'C:\\Windows');
    const progFiles = normalizeCmpPath(process.env.ProgramFiles || 'C:\\Program Files');
    const progFiles86 = normalizeCmpPath(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
    for (const sysRoot of [winDir, progFiles, progFiles86]) {
      if (cmp === sysRoot || cmp.startsWith(`${sysRoot}\\`)) {
        return '不能选择 Windows 系统目录或程序安装目录作为智能体工作区';
      }
    }
    const execDir = normalizeCmpPath(path.dirname(process.execPath));
    const installParent = normalizeCmpPath(path.resolve(execDir, '..'));
    if (
      execDir.includes('\\agentswarm') &&
      (cmp === execDir ||
        cmp.startsWith(`${execDir}\\`) ||
        cmp === installParent ||
        cmp.startsWith(`${installParent}\\`))
    ) {
      return '不能选择 AgentSwarm 软件安装目录，请在「文档」或代码目录下选择/新建项目文件夹';
    }
  }

  for (const r of extraRestrictedRoots) {
    if (!r) continue;
    const rCmp = normalizeCmpPath(r);
    if (!rCmp) continue;
    const sep = process.platform === 'win32' ? '\\' : '/';
    if (cmp === rCmp || cmp.startsWith(`${rCmp}${sep}data`) || cmp.includes(`${sep}bundle-stage`)) {
      return '请为你的任务选择独立项目文件夹（避免直接选定 AgentSwarm 软件运行目录或数据库目录）';
    }
  }

  return null;
}

function resolveDefaultBrowseStart(): string {
  const home = os.homedir();
  const candidates = [path.join(home, 'Documents'), path.join(home, 'Desktop'), home];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      // try next
    }
  }
  return home;
}

export function listQuickRoots(): QuickRootItem[] {
  const roots: QuickRootItem[] = [];
  const home = os.homedir();

  const shortcuts: Array<{ label: string; dir: string }> = [
    { label: '桌面', dir: path.join(home, 'Desktop') },
    { label: '文档', dir: path.join(home, 'Documents') },
    { label: '下载', dir: path.join(home, 'Downloads') },
    { label: '主目录', dir: home },
  ];

  for (const s of shortcuts) {
    if (fs.existsSync(s.dir)) {
      roots.push({ label: s.label, path: s.dir, kind: 'shortcut' });
    }
  }

  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      const driveRoot = `${letter}:\\`;
      try {
        if (fs.existsSync(driveRoot)) {
          roots.push({ label: `${letter}: 盘`, path: driveRoot, kind: 'drive' });
        }
      } catch {
        // ignore inaccessible drive
      }
    }
  } else {
    roots.push({ label: '根目录 /', path: '/', kind: 'drive' });
  }

  return roots;
}

export function browseDirectories(
  requestedPath?: string,
  filterQuery?: string,
  restrictedRoots: string[] = []
): BrowseDirsResponse {
  const fallback = resolveDefaultBrowseStart();
  let currentPath = requestedPath?.trim() ? path.resolve(requestedPath.trim()) : fallback;
  if (!fs.existsSync(currentPath)) {
    currentPath = fallback;
  }
  try {
    if (!fs.statSync(currentPath).isDirectory()) {
      currentPath = path.dirname(currentPath);
    }
  } catch {
    currentPath = fallback;
  }

  const parsed = path.parse(currentPath);
  const parentPath = currentPath === parsed.root ? null : path.dirname(currentPath);
  const q = filterQuery?.trim().toLowerCase() || '';

  const directories: DirectoryEntryItem[] = [];
  try {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || SKIP_SYSTEM_DIRS.has(entry.name)) continue;
      if (q && !entry.name.toLowerCase().includes(q)) continue;
      directories.push({
        name: entry.name,
        path: path.join(currentPath, entry.name),
      });
    }
  } catch {
    // ignore permission errors on protected OS folders
  }

  const totalDirectories = directories.length;
  if (totalDirectories <= 500) {
    directories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  } else {
    directories.sort((a, b) => {
      const al = a.name.toLowerCase();
      const bl = b.name.toLowerCase();
      return al < bl ? -1 : al > bl ? 1 : 0;
    });
  }

  const limited = directories.slice(0, MAX_BROWSE_DIRS);

  return {
    currentPath,
    parentPath,
    roots: listQuickRoots(),
    directories: limited,
    totalDirectories,
    truncated: totalDirectories > MAX_BROWSE_DIRS,
    unsafeReason: validateWorkspaceDirectory(currentPath, restrictedRoots),
  };
}

export function createSubDirectory(parentDir: string, folderName: string): string {
  const trimmed = folderName.trim().replace(/[<>:"/\\|?*]/g, '');
  if (!trimmed) {
    throw new Error('文件夹名称不能为空');
  }
  const base = path.resolve(parentDir);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error('上级目录不存在');
  }
  const target = path.join(base, trimmed);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

export async function pickNativeWindowsFolder(initialPath?: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;

  const safeInit =
    initialPath && fs.existsSync(initialPath) ? path.resolve(initialPath) : resolveDefaultBrowseStart();
  const escapedInit = safeInit.replace(/'/g, "''");

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.Width = 1
$owner.Height = 1
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = '请选择项目工作区文件夹'
$dlg.ShowNewFolderButton = $true
$dlg.SelectedPath = '${escapedInit}'
$res = $dlg.ShowDialog($owner)
$owner.Close()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($dlg.SelectedPath)
}
`;

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Sta', '-EncodedCommand', encoded],
      { timeout: 120_000, windowsHide: true }
    );
    const chosen = stdout.trim().split(/\r?\n/).pop()?.trim() || '';
    return chosen && fs.existsSync(chosen) ? chosen : null;
  } catch {
    return null;
  }
}

export interface WorkspaceEntryItem {
  name: string;
  relPath: string;
  kind: 'dir' | 'file';
  size: number;
  updatedAt: number;
}

export function listWorkspaceDirectoryEntries(
  workspacePath: string,
  relSubDir = ''
): { currentRelDir: string; parentRelDir: string | null; entries: WorkspaceEntryItem[] } {
  const root = path.resolve(workspacePath);
  const cleanRel = relSubDir.replace(/^[/\\]+/, '');
  const targetDir = path.resolve(root, cleanRel);

  if (!targetDir.startsWith(root) || !fs.existsSync(targetDir)) {
    return { currentRelDir: '', parentRelDir: null, entries: [] };
  }

  const currentRelDir = path.relative(root, targetDir).replace(/\\/g, '/');
  const parentRelDir =
    !currentRelDir || currentRelDir === '.'
      ? null
      : path.dirname(currentRelDir).replace(/\\/g, '/') === '.'
        ? ''
        : path.dirname(currentRelDir).replace(/\\/g, '/');

  const entries: WorkspaceEntryItem[] = [];
  try {
    const rawEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const e of rawEntries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.endsWith('.db-wal') || e.name.endsWith('.db-shm')) {
        continue;
      }
      const full = path.join(targetDir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      try {
        const st = fs.statSync(full);
        entries.push({
          name: e.name,
          relPath: rel,
          kind: e.isDirectory() ? 'dir' : 'file',
          size: st.isDirectory() ? 0 : st.size,
          updatedAt: st.mtimeMs,
        });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return { currentRelDir, parentRelDir, entries };
}

export function resolveSafeWorkspacePath(workspacePath: string, inputPath: string): {
  fullPath: string;
  relPath: string;
} | null {
  if (!inputPath?.trim()) return null;
  const root = path.resolve(workspacePath);
  const cleaned = inputPath.trim().replace(/^file:\/\/\/?/i, '');
  const candidate = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(root, cleaned);

  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const isInside =
    process.platform === 'win32'
      ? candidate.toLowerCase() === root.toLowerCase() ||
        candidate.toLowerCase().startsWith(rootWithSep.toLowerCase())
      : candidate === root || candidate.startsWith(rootWithSep);

  if (!isInside) return null;
  if (fs.existsSync(candidate)) {
    const relPath = path.relative(root, candidate).replace(/\\/g, '/');
    return { fullPath: candidate, relPath };
  }

  // Fallback for bare filename mentioned in prose (e.g. `pelican.html` inside `测试/pelican.html`)
  if (!cleaned.includes('/') && !cleaned.includes('\\')) {
    const targetLower = cleaned.toLowerCase();
    let matchedFull: string | null = null;
    const searchSub = (dir: string, depth: number) => {
      if (depth > 3 || matchedFull) return;
      let list: fs.Dirent[] = [];
      try {
        list = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of list) {
        if (matchedFull) break;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_SYSTEM_DIRS.has(e.name) || e.name === 'dist' || e.name.startsWith('.')) continue;
          searchSub(full, depth + 1);
        } else if (e.isFile() && e.name.toLowerCase() === targetLower) {
          matchedFull = full;
        }
      }
    };
    searchSub(root, 0);
    if (matchedFull) {
      return {
        fullPath: matchedFull,
        relPath: path.relative(root, matchedFull).replace(/\\/g, '/'),
      };
    }
  }

  return null;
}

export type PreviewKind = 'markdown' | 'html' | 'image' | 'pdf' | 'code' | 'binary';

export interface FilePreviewPayload {
  name: string;
  relPath: string;
  ext: string;
  size: number;
  updatedAt: number;
  kind: PreviewKind;
  content?: string;
  truncated?: boolean;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const TEXT_CODE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.scss',
  '.less',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.sh',
  '.ps1',
  '.cmd',
  '.bat',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.xml',
  '.sql',
  '.csv',
  '.tsv',
  '.txt',
  '.log',
  '.gitignore',
]);

export function getMimeTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.md':
    case '.mdx':
    case '.txt':
    case '.log':
    case '.csv':
      return 'text/plain; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff2':
      return 'font/woff2';
    case '.woff':
      return 'font/woff';
    case '.ttf':
      return 'font/ttf';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export function buildWorkspaceFilePreview(
  workspacePath: string,
  targetPath: string
): FilePreviewPayload | null {
  const resolved = resolveSafeWorkspacePath(workspacePath, targetPath);
  if (!resolved) return null;
  const st = fs.statSync(resolved.fullPath);
  if (!st.isFile()) return null;

  const name = path.basename(resolved.fullPath);
  const ext = path.extname(name).toLowerCase();

  let kind: PreviewKind = 'binary';
  if (ext === '.md' || ext === '.mdx') kind = 'markdown';
  else if (ext === '.html' || ext === '.htm') kind = 'html';
  else if (IMAGE_EXTS.has(ext)) kind = 'image';
  else if (ext === '.pdf') kind = 'pdf';
  else if (TEXT_CODE_EXTS.has(ext) || !ext) kind = 'code';
  else if (st.size <= 128 * 1024) {
    // Sniff small unknown extension files for UTF-8 text (zero null bytes)
    const sample = fs.readFileSync(resolved.fullPath).subarray(0, 2048);
    if (!sample.includes(0)) kind = 'code';
  }

  if (kind === 'markdown' || kind === 'html' || kind === 'code') {
    const maxBytes = 512 * 1024;
    const buf = fs.readFileSync(resolved.fullPath);
    const truncated = buf.length > maxBytes;
    const content = (truncated ? buf.subarray(0, maxBytes) : buf).toString('utf8');
    return {
      name,
      relPath: resolved.relPath,
      ext,
      size: st.size,
      updatedAt: st.mtimeMs,
      kind,
      content,
      truncated,
    };
  }

  return {
    name,
    relPath: resolved.relPath,
    ext,
    size: st.size,
    updatedAt: st.mtimeMs,
    kind,
  };
}

export function openPathOnHost(targetFullPath: string, revealInFolder = false): void {
  if (!fs.existsSync(targetFullPath)) {
    throw new Error('目标文件或文件夹不存在');
  }
  const st = fs.statSync(targetFullPath);

  if (process.platform === 'win32') {
    if (revealInFolder && st.isFile()) {
      const child = spawn('explorer.exe', [`/select,${targetFullPath}`], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return;
    }
    if (st.isDirectory()) {
      const child = spawn('explorer.exe', [targetFullPath], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return;
    }
    // Native GUI handler avoids spawning a flashing cmd.exe console window
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', targetFullPath], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
}

export function extractMentionedWorkspaceFiles(workspacePath: string, text: string): string[] {
  if (!text || !fs.existsSync(workspacePath)) return [];
  const found = new Set<string>();

  // 1. Backticked paths: `src/App.tsx`, `docs/plan.md`, `index.html`
  const backtickRe = /`([^`\r\n]{2,140})`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(text)) !== null) {
    const raw = m[1].trim().replace(/^[./\\]+/, '');
    if (!raw || raw.startsWith('@') || raw.includes(' ')) continue;
    if (!/[./\\]/.test(raw)) continue;
    const resolved = resolveSafeWorkspacePath(workspacePath, raw);
    if (resolved && fs.statSync(resolved.fullPath).isFile()) {
      found.add(resolved.relPath);
    }
  }

  // 2. Markdown file links: [label](path/to/file.ext)
  const linkRe = /\]\(([^)\r\n]{2,180})\)/g;
  while ((m = linkRe.exec(text)) !== null) {
    const raw = m[1].trim().replace(/#L\d+.*$/i, '').replace(/:\d+$/, '');
    if (!raw || /^https?:\/\//i.test(raw)) continue;
    const resolved = resolveSafeWorkspacePath(workspacePath, raw);
    if (resolved && fs.statSync(resolved.fullPath).isFile()) {
      found.add(resolved.relPath);
    }
  }

  return Array.from(found).slice(0, 12);
}
