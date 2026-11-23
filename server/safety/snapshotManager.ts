import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  FileChangeItem,
  SnapshotConflictItem,
  SnapshotDiffDetail,
  SnapshotRevertOutcome,
  WorkspaceSnapshot,
} from '../../src/types.js';
import { DATA_DIR, db } from '../db.js';

const SNAPSHOT_ROOT = path.join(DATA_DIR, 'snapshots');
if (!fs.existsSync(SNAPSHOT_ROOT)) {
  fs.mkdirSync(SNAPSHOT_ROOT, { recursive: true });
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'data',
  '.turbo',
  '.cache',
  'coverage',
]);

const IGNORED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const SKIPPED_BINARY_OR_ARCHIVE_RE = /\.(db|db-wal|db-shm|exe|dll|zip|7z|tar|gz)$/i;
const MAX_TRACKED_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_TOTAL_FILES = 1500;

export interface WorkspaceBaseline {
  workspacePath: string;
  files: Map<string, { hash: string; content: Buffer }>;
  skippedCount: number;
  skippedSummary: string;
}

interface ScanWorkspaceResult {
  files: string[];
  skippedCount: number;
  skippedSummary: string;
}

function sha1Buffer(buf: Buffer): string {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function sha1File(fullPath: string): string | null {
  try {
    return sha1Buffer(fs.readFileSync(fullPath));
  } catch {
    return null;
  }
}

function isBinaryBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 2048));
  return sample.includes(0);
}

function formatPreviewFromBuffer(buf: Buffer | null, emptyText: string): { text: string; isBinary: boolean } {
  if (!buf) return { text: emptyText, isBinary: false };
  if (isBinaryBuffer(buf)) {
    return {
      text: `（二进制或图片资源，大小 ${Math.max(1, Math.round(buf.length / 1024))} KB）`,
      isBinary: true,
    };
  }
  return {
    text: buf.toString('utf8').slice(0, 12_000),
    isBinary: false,
  };
}

function scanWorkspaceFiles(workspacePath: string): ScanWorkspaceResult {
  const results: string[] = [];
  if (!fs.existsSync(workspacePath)) {
    return { files: results, skippedCount: 0, skippedSummary: '' };
  }

  let skippedOversized = 0;
  let skippedArchiveOrDb = 0;
  let skippedCap = 0;

  function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue;
        if (SKIPPED_BINARY_OR_ARCHIVE_RE.test(entry.name)) {
          skippedArchiveOrDb += 1;
          continue;
        }
        const full = path.join(dir, entry.name);
        try {
          const st = fs.statSync(full);
          if (st.size > MAX_TRACKED_FILE_BYTES) {
            skippedOversized += 1;
            continue;
          }
          if (results.length >= MAX_TOTAL_FILES) {
            skippedCap += 1;
            continue;
          }
          results.push(path.relative(workspacePath, full).replace(/\\/g, '/'));
        } catch {
          // ignore unreadable entry
        }
      }
    }
  }

  walk(workspacePath);

  const skippedCount = skippedOversized + skippedArchiveOrDb + skippedCap;
  const reasons: string[] = [];
  if (skippedOversized > 0) reasons.push(`${skippedOversized} 个超过 2MB 文件`);
  if (skippedArchiveOrDb > 0) reasons.push(`${skippedArchiveOrDb} 个数据库/压缩包/可执行文件`);
  if (skippedCap > 0) reasons.push(`${skippedCap} 个超出 ${MAX_TOTAL_FILES} 上限文件`);

  const skippedSummary =
    skippedCount > 0 ? `已跳过 ${reasons.join('、')}` : '';

  return { files: results, skippedCount, skippedSummary };
}

function listFilesUnderDirRelative(baseDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(baseDir)) return results;

  function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(path.relative(baseDir, full).replace(/\\/g, '/'));
      }
    }
  }

  walk(baseDir);
  return results;
}

export function listWorkspaceRelativePaths(workspacePath: string, limit = 60): string[] {
  return scanWorkspaceFiles(workspacePath).files.slice(0, limit);
}

export function captureWorkspaceBaseline(workspacePath: string): WorkspaceBaseline {
  const scanned = scanWorkspaceFiles(workspacePath);
  const files = new Map<string, { hash: string; content: Buffer }>();
  for (const rel of scanned.files) {
    try {
      const buf = fs.readFileSync(path.join(workspacePath, rel));
      const hash = sha1Buffer(buf);
      files.set(rel, { hash, content: buf });
    } catch {
      // ignore unreadable file
    }
  }
  return {
    workspacePath,
    files,
    skippedCount: scanned.skippedCount,
    skippedSummary: scanned.skippedSummary,
  };
}

function parseSnapshotMeta(row: Record<string, unknown>): {
  skippedCount?: number;
  skippedSummary?: string;
  postCheckpointAddedCount?: number;
  lastRevertOutcome?: SnapshotRevertOutcome | null;
} {
  try {
    return JSON.parse(String(row.meta_json || '{}'));
  } catch {
    return {};
  }
}

function mapSnapshotRow(row: Record<string, unknown>): WorkspaceSnapshot {
  const changes = JSON.parse(String(row.files_changed_json || '[]')) as FileChangeItem[];
  const meta = parseSnapshotMeta(row);
  return {
    id: String(row.id),
    boardId: String(row.board_id),
    label: String(row.label),
    authorName: String(row.author_name),
    kind: (row.kind as WorkspaceSnapshot['kind']) || 'auto_turn',
    status: (row.status as WorkspaceSnapshot['status']) || 'pending',
    fileCount: Number(row.file_count || changes.length),
    filesChanged: changes,
    skippedCount: meta.skippedCount || undefined,
    skippedSummary: meta.skippedSummary || undefined,
    postCheckpointAddedCount: meta.postCheckpointAddedCount,
    lastRevertOutcome: meta.lastRevertOutcome ?? null,
    createdAt: Number(row.created_at),
  };
}

export function listBoardSnapshots(boardId: string): WorkspaceSnapshot[] {
  const rows = db
    .prepare('SELECT * FROM workspace_snapshots WHERE board_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(boardId) as Record<string, unknown>[];
  return rows.map(mapSnapshotRow);
}

export function createManualCheckpoint(params: {
  boardId: string;
  workspacePath: string;
  label?: string;
}): WorkspaceSnapshot {
  const id = `snp_${crypto.randomUUID().slice(0, 8)}`;
  const snapDir = path.join(SNAPSHOT_ROOT, id, 'before');
  fs.mkdirSync(snapDir, { recursive: true });

  const baseline = captureWorkspaceBaseline(params.workspacePath);
  const tracked: FileChangeItem[] = [];

  for (const [rel, item] of baseline.files.entries()) {
    const dest = path.join(snapDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, item.content);
    tracked.push({ path: rel, status: 'modified' });
  }

  const now = Date.now();
  const label =
    params.label?.trim() ||
    `手动备份点 (${new Date(now).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })})`;

  const metaJson = JSON.stringify({
    skippedCount: baseline.skippedCount,
    skippedSummary: baseline.skippedSummary,
  });

  db.prepare(
    `INSERT INTO workspace_snapshots (
      id, board_id, workspace_path, label, author_name, kind, status, file_count, files_changed_json, meta_json, created_at
    ) VALUES (?, ?, ?, ?, '手动保存', 'manual_checkpoint', 'adopted', ?, ?, ?, ?)`
  ).run(
    id,
    params.boardId,
    params.workspacePath,
    label,
    tracked.length,
    JSON.stringify(tracked),
    metaJson,
    now
  );

  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return mapSnapshotRow(row);
}

function createAutoProtectionBackup(
  boardId: string,
  workspacePath: string,
  targetPaths: string[]
): WorkspaceSnapshot | null {
  const existingFiles: FileChangeItem[] = [];
  const id = `snp_${crypto.randomUUID().slice(0, 8)}`;
  const beforeDir = path.join(SNAPSHOT_ROOT, id, 'before');
  fs.mkdirSync(beforeDir, { recursive: true });

  for (const rel of targetPaths) {
    const full = path.join(workspacePath, rel);
    if (!fs.existsSync(full)) continue;
    try {
      const buf = fs.readFileSync(full);
      const dest = path.join(beforeDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      existingFiles.push({ path: rel, status: 'modified' });
    } catch {
      // ignore unreadable
    }
  }

  if (existingFiles.length === 0) {
    try {
      fs.rmSync(path.join(SNAPSHOT_ROOT, id), { recursive: true, force: true });
    } catch {
      // ignore
    }
    return null;
  }

  const now = Date.now();
  const label = `覆盖撤回前保护备份 (${new Date(now).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })})`;

  db.prepare(
    `INSERT INTO workspace_snapshots (
      id, board_id, workspace_path, label, author_name, kind, status, file_count, files_changed_json, meta_json, created_at
    ) VALUES (?, ?, ?, ?, '系统保护', 'pre_overwrite_backup', 'adopted', ?, ?, '{}', ?)`
  ).run(
    id,
    boardId,
    workspacePath,
    label,
    existingFiles.length,
    JSON.stringify(existingFiles),
    now
  );

  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return mapSnapshotRow(row);
}

export function recordTurnSnapshotIfChanged(params: {
  boardId: string;
  authorName: string;
  label: string;
  baseline: WorkspaceBaseline;
  kind?: 'auto_turn' | 'failed_turn';
}): WorkspaceSnapshot | null {
  const after = captureWorkspaceBaseline(params.baseline.workspacePath);
  const changes: FileChangeItem[] = [];

  const allPaths = new Set([...params.baseline.files.keys(), ...after.files.keys()]);
  for (const rel of allPaths) {
    const b = params.baseline.files.get(rel);
    const a = after.files.get(rel);
    if (!b && a) {
      changes.push({ path: rel, status: 'added' });
    } else if (b && !a) {
      changes.push({ path: rel, status: 'deleted' });
    } else if (b && a && b.hash !== a.hash) {
      changes.push({ path: rel, status: 'modified' });
    }
  }

  if (changes.length === 0) return null;

  const id = `snp_${crypto.randomUUID().slice(0, 8)}`;
  const beforeDir = path.join(SNAPSHOT_ROOT, id, 'before');
  const afterDir = path.join(SNAPSHOT_ROOT, id, 'after');
  fs.mkdirSync(beforeDir, { recursive: true });
  fs.mkdirSync(afterDir, { recursive: true });

  for (const ch of changes) {
    const b = params.baseline.files.get(ch.path);
    const a = after.files.get(ch.path);
    if (b) {
      const destB = path.join(beforeDir, ch.path);
      fs.mkdirSync(path.dirname(destB), { recursive: true });
      fs.writeFileSync(destB, b.content);
    }
    if (a) {
      const destA = path.join(afterDir, ch.path);
      fs.mkdirSync(path.dirname(destA), { recursive: true });
      fs.writeFileSync(destA, a.content);
    }
  }

  const totalSkipped = Math.max(params.baseline.skippedCount, after.skippedCount);
  const skippedSummary = after.skippedSummary || params.baseline.skippedSummary;
  const snapKind = params.kind ?? 'auto_turn';
  const now = Date.now();

  db.prepare(
    `INSERT INTO workspace_snapshots (
      id, board_id, workspace_path, label, author_name, kind, status, file_count, files_changed_json, meta_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    id,
    params.boardId,
    params.baseline.workspacePath,
    params.label,
    params.authorName,
    snapKind,
    changes.length,
    JSON.stringify(changes),
    JSON.stringify({ skippedCount: totalSkipped, skippedSummary }),
    now
  );

  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return mapSnapshotRow(row);
}

export function createSeedSnapshotForDemo(params: {
  boardId: string;
  workspacePath: string;
  authorName: string;
  label: string;
  sampleFiles: Array<{ path: string; before: string; after: string }>;
}): WorkspaceSnapshot {
  const id = `snp_${crypto.randomUUID().slice(0, 8)}`;
  const beforeDir = path.join(SNAPSHOT_ROOT, id, 'before');
  const afterDir = path.join(SNAPSHOT_ROOT, id, 'after');
  fs.mkdirSync(beforeDir, { recursive: true });
  fs.mkdirSync(afterDir, { recursive: true });

  const changes: FileChangeItem[] = [];
  for (const f of params.sampleFiles) {
    const destB = path.join(beforeDir, f.path);
    const destA = path.join(afterDir, f.path);
    fs.mkdirSync(path.dirname(destB), { recursive: true });
    fs.mkdirSync(path.dirname(destA), { recursive: true });
    fs.writeFileSync(destB, f.before, 'utf8');
    fs.writeFileSync(destA, f.after, 'utf8');
    changes.push({ path: f.path, status: 'modified' });
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO workspace_snapshots (
      id, board_id, workspace_path, label, author_name, kind, status, file_count, files_changed_json, meta_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'auto_turn', 'pending', ?, ?, '{}', ?)`
  ).run(
    id,
    params.boardId,
    params.workspacePath,
    params.label,
    params.authorName,
    changes.length,
    JSON.stringify(changes),
    now
  );

  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return mapSnapshotRow(row);
}

export function inspectSnapshotConflicts(snapshotId: string): SnapshotConflictItem[] {
  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(snapshotId) as Record<string, unknown> | undefined;
  if (!row) return [];

  const snapshot = mapSnapshotRow(row);
  if (snapshot.kind === 'manual_checkpoint' || snapshot.kind === 'pre_overwrite_backup') {
    return [];
  }

  const workspacePath = String(row.workspace_path);
  if (!fs.existsSync(workspacePath)) return [];

  const beforeDir = path.join(SNAPSHOT_ROOT, snapshot.id, 'before');
  const afterDir = path.join(SNAPSHOT_ROOT, snapshot.id, 'after');
  const conflicts: SnapshotConflictItem[] = [];

  for (const ch of snapshot.filesChanged) {
    const targetFile = path.join(workspacePath, ch.path);
    const beforeFile = path.join(beforeDir, ch.path);
    const afterFile = path.join(afterDir, ch.path);

    const diskExists = fs.existsSync(targetFile);
    const diskBuf = diskExists ? fs.readFileSync(targetFile) : null;
    const diskHash = diskBuf ? sha1Buffer(diskBuf) : null;
    const beforeHash = fs.existsSync(beforeFile) ? sha1File(beforeFile) : null;
    const afterHash = fs.existsSync(afterFile) ? sha1File(afterFile) : null;

    if (ch.status === 'modified') {
      if (!diskExists) {
        conflicts.push({
          path: ch.path,
          status: ch.status,
          reason: '该文件在交付后已被移除或重命名，直接撤回将重新写回旧文件',
          currentDiskPreview: '（当前磁盘无此文件）',
          snapshotTargetPreview: formatPreviewFromBuffer(
            fs.existsSync(beforeFile) ? fs.readFileSync(beforeFile) : null,
            ''
          ).text.slice(0, 600),
        });
      } else if (diskHash && diskHash !== afterHash && diskHash !== beforeHash) {
        conflicts.push({
          path: ch.path,
          status: ch.status,
          reason: '该文件在本次交付后又有新改动，直接覆盖会丢失较新的编辑内容',
          currentDiskPreview: formatPreviewFromBuffer(diskBuf, '').text.slice(0, 600),
          snapshotTargetPreview: formatPreviewFromBuffer(
            fs.existsSync(beforeFile) ? fs.readFileSync(beforeFile) : null,
            ''
          ).text.slice(0, 600),
        });
      }
    } else if (ch.status === 'added') {
      if (diskExists && afterHash && diskHash !== afterHash) {
        conflicts.push({
          path: ch.path,
          status: ch.status,
          reason: '该新增文件后续被重新编辑过，直接撤回移除将丢失后续编辑',
          currentDiskPreview: formatPreviewFromBuffer(diskBuf, '').text.slice(0, 600),
          snapshotTargetPreview: '（撤回将删除此新增文件）',
        });
      }
    } else if (ch.status === 'deleted') {
      if (diskExists && diskHash && diskHash !== beforeHash) {
        conflicts.push({
          path: ch.path,
          status: ch.status,
          reason: '该文件被删除后，工作区中又新建了不同内容的同名文件',
          currentDiskPreview: formatPreviewFromBuffer(diskBuf, '').text.slice(0, 600),
          snapshotTargetPreview: formatPreviewFromBuffer(
            fs.existsSync(beforeFile) ? fs.readFileSync(beforeFile) : null,
            ''
          ).text.slice(0, 600),
        });
      }
    }
  }

  return conflicts;
}

export function getSnapshotDiffDetail(snapshotId: string): SnapshotDiffDetail | null {
  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(snapshotId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const snapshot = mapSnapshotRow(row);
  const beforeDir = path.join(SNAPSHOT_ROOT, snapshot.id, 'before');
  const afterDir = path.join(SNAPSHOT_ROOT, snapshot.id, 'after');

  // Union recorded changes with actual files in beforeDir for legacy manual checkpoints
  const changeMap = new Map<string, FileChangeItem>();
  for (const ch of snapshot.filesChanged) {
    changeMap.set(ch.path, ch);
  }
  if (snapshot.kind === 'manual_checkpoint' || snapshot.kind === 'pre_overwrite_backup') {
    for (const rel of listFilesUnderDirRelative(beforeDir)) {
      if (!changeMap.has(rel)) {
        changeMap.set(rel, { path: rel, status: 'modified' });
      }
    }
  }

  const allItems = Array.from(changeMap.values());
  const conflicts = inspectSnapshotConflicts(snapshotId);
  const conflictSet = new Set(conflicts.map((c) => c.path));

  const diffs = allItems.slice(0, 200).map((ch) => {
    const pB = path.join(beforeDir, ch.path);
    const pA = path.join(afterDir, ch.path);
    const bufB = fs.existsSync(pB) ? fs.readFileSync(pB) : null;
    const bufA = fs.existsSync(pA) ? fs.readFileSync(pA) : null;
    const prevB = formatPreviewFromBuffer(bufB, '');
    const prevA = formatPreviewFromBuffer(bufA, '');
    return {
      path: ch.path,
      status: ch.status,
      beforeText: prevB.text,
      afterText: prevA.text,
      currentDiskDiverged: conflictSet.has(ch.path),
      isBinary: prevB.isBinary || prevA.isBinary,
    };
  });

  return {
    snapshot: {
      ...snapshot,
      fileCount: Math.max(snapshot.fileCount, allItems.length),
      filesChanged: allItems,
    },
    totalFiles: allItems.length,
    conflicts,
    diffs,
  };
}

export function adoptSnapshot(snapshotId: string): WorkspaceSnapshot | null {
  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(snapshotId) as Record<string, unknown> | undefined;
  if (!row) return null;
  db.prepare("UPDATE workspace_snapshots SET status = 'adopted' WHERE id = ?").run(snapshotId);
  return mapSnapshotRow(
    db.prepare('SELECT * FROM workspace_snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown>
  );
}

export interface RevertSnapshotResult {
  ok: boolean;
  hasConflicts?: boolean;
  conflicts?: SnapshotConflictItem[];
  snapshot: WorkspaceSnapshot;
  protectionSnapshot?: WorkspaceSnapshot | null;
  restoredCount: number;
  skippedConflicts: number;
  restoredFiles?: string[];
  skippedFiles?: string[];
  postCheckpointAddedCount?: number;
}

export function revertSnapshotToDisk(
  snapshotId: string,
  options?: { mode?: 'strict' | 'skip_conflicts' | 'overwrite_all' }
): RevertSnapshotResult | null {
  const row = db
    .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
    .get(snapshotId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const mode = options?.mode ?? 'strict';
  const snapshot = mapSnapshotRow(row);
  const boardId = String(row.board_id);
  const workspacePath = String(row.workspace_path);
  const beforeDir = path.join(SNAPSHOT_ROOT, snapshot.id, 'before');

  // Manual checkpoint / protection backup restore path: union stored list + all files in beforeDir
  if (snapshot.kind === 'manual_checkpoint' || snapshot.kind === 'pre_overwrite_backup') {
    const unionPaths = new Set<string>(snapshot.filesChanged.map((c) => c.path));
    for (const rel of listFilesUnderDirRelative(beforeDir)) {
      unionPaths.add(rel);
    }

    const filesToOverwrite: string[] = [];
    for (const rel of unionPaths) {
      const targetFile = path.join(workspacePath, rel);
      const backupFile = path.join(beforeDir, rel);
      if (!fs.existsSync(backupFile)) continue;
      if (fs.existsSync(targetFile) && sha1File(targetFile) !== sha1File(backupFile)) {
        filesToOverwrite.push(rel);
      }
    }

    let protectionSnapshot: WorkspaceSnapshot | null = null;
    if (filesToOverwrite.length > 0) {
      protectionSnapshot = createAutoProtectionBackup(boardId, workspacePath, filesToOverwrite);
    }

    let restoredCount = 0;
    const restoredFiles: string[] = [];
    const failedPaths: string[] = [];

    if (fs.existsSync(beforeDir) && fs.existsSync(workspacePath)) {
      for (const rel of unionPaths) {
        const targetFile = path.join(workspacePath, rel);
        const backupFile = path.join(beforeDir, rel);
        if (!fs.existsSync(backupFile)) continue;
        try {
          fs.mkdirSync(path.dirname(targetFile), { recursive: true });
          fs.copyFileSync(backupFile, targetFile);
          if (sha1File(targetFile) !== sha1File(backupFile)) {
            failedPaths.push(rel);
          } else {
            restoredCount += 1;
            restoredFiles.push(rel);
          }
        } catch {
          failedPaths.push(rel);
        }
      }
    }

    if (failedPaths.length > 0) {
      throw new Error(`部分文件还原失败（可能被其他程序占用）：${failedPaths.slice(0, 5).join('、')}`);
    }

    // Count newer files added after checkpoint (preserved, never auto-deleted)
    const currentWorkspaceFiles = scanWorkspaceFiles(workspacePath).files;
    const postCheckpointAddedCount = currentWorkspaceFiles.filter((rel) => !unionPaths.has(rel)).length;
    const fullFilesChanged: FileChangeItem[] = Array.from(unionPaths).map((p) => ({
      path: p,
      status: 'modified',
    }));
    const prevMeta = parseSnapshotMeta(row);
    const outcome: SnapshotRevertOutcome = {
      mode: mode || 'strict',
      at: Date.now(),
      restoredFiles,
      skippedFiles: [],
      protectionSnapshotId: protectionSnapshot?.id ?? null,
    };
    const nextMetaJson = JSON.stringify({
      ...prevMeta,
      postCheckpointAddedCount,
      lastRevertOutcome: outcome,
    });

    db.prepare(
      `UPDATE workspace_snapshots
       SET status = 'reverted', file_count = ?, files_changed_json = ?, meta_json = ?
       WHERE id = ?`
    ).run(fullFilesChanged.length, JSON.stringify(fullFilesChanged), nextMetaJson, snapshotId);

    const updatedSnap = mapSnapshotRow(
      db.prepare('SELECT * FROM workspace_snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown>
    );
    return {
      ok: true,
      snapshot: updatedSnap,
      protectionSnapshot,
      restoredCount,
      skippedConflicts: 0,
      restoredFiles,
      skippedFiles: [],
      postCheckpointAddedCount,
    };
  }

  // Turn snapshot restore path (`auto_turn` / `failed_turn`) with 3-way conflict detection
  const conflicts = inspectSnapshotConflicts(snapshotId);
  if (mode === 'strict' && conflicts.length > 0) {
    return {
      ok: false,
      hasConflicts: true,
      conflicts,
      snapshot,
      restoredCount: 0,
      skippedConflicts: conflicts.length,
    };
  }

  const conflictPaths = new Set(conflicts.map((c) => c.path));
  let protectionSnapshot: WorkspaceSnapshot | null = null;
  if (mode === 'overwrite_all' && conflicts.length > 0) {
    protectionSnapshot = createAutoProtectionBackup(
      boardId,
      workspacePath,
      conflicts.map((c) => c.path)
    );
  }

  let restoredCount = 0;
  let skippedConflicts = 0;
  const restoredFiles: string[] = [];
  const skippedFiles: string[] = [];
  const failedPaths: string[] = [];

  if (fs.existsSync(workspacePath)) {
    for (const ch of snapshot.filesChanged) {
      if (mode === 'skip_conflicts' && conflictPaths.has(ch.path)) {
        skippedConflicts += 1;
        skippedFiles.push(ch.path);
        continue;
      }

      const targetFile = path.join(workspacePath, ch.path);
      const backupFile = path.join(beforeDir, ch.path);

      try {
        if (ch.status === 'added') {
          if (fs.existsSync(targetFile) && !fs.existsSync(backupFile)) {
            fs.unlinkSync(targetFile);
            if (fs.existsSync(targetFile)) {
              failedPaths.push(ch.path);
            } else {
              restoredCount += 1;
              restoredFiles.push(ch.path);
            }
          } else if (!fs.existsSync(targetFile)) {
            restoredCount += 1;
            restoredFiles.push(ch.path);
          }
        } else if (ch.status === 'modified' || ch.status === 'deleted') {
          if (!fs.existsSync(backupFile)) {
            failedPaths.push(ch.path);
            continue;
          }
          fs.mkdirSync(path.dirname(targetFile), { recursive: true });
          fs.copyFileSync(backupFile, targetFile);
          if (!fs.existsSync(targetFile) || sha1File(targetFile) !== sha1File(backupFile)) {
            failedPaths.push(ch.path);
          } else {
            restoredCount += 1;
            restoredFiles.push(ch.path);
          }
        }
      } catch {
        failedPaths.push(ch.path);
      }
    }
  }

  if (failedPaths.length > 0) {
    throw new Error(`撤回写回失败（文件可能正被占用）：${failedPaths.slice(0, 5).join('、')}`);
  }

  const prevMeta = parseSnapshotMeta(row);
  const outcome: SnapshotRevertOutcome = {
    mode: mode || 'strict',
    at: Date.now(),
    restoredFiles,
    skippedFiles,
    protectionSnapshotId: protectionSnapshot?.id ?? null,
  };
  const nextMetaJson = JSON.stringify({
    ...prevMeta,
    lastRevertOutcome: outcome,
  });

  if (restoredCount > 0 || (skippedConflicts === 0 && snapshot.filesChanged.length === 0)) {
    db.prepare("UPDATE workspace_snapshots SET status = 'reverted', meta_json = ? WHERE id = ?").run(
      nextMetaJson,
      snapshotId
    );
  } else {
    db.prepare('UPDATE workspace_snapshots SET meta_json = ? WHERE id = ?').run(
      nextMetaJson,
      snapshotId
    );
  }

  const updatedSnap = mapSnapshotRow(
    db.prepare('SELECT * FROM workspace_snapshots WHERE id = ?').get(snapshotId) as Record<string, unknown>
  );

  return {
    ok: true,
    snapshot: updatedSnap,
    protectionSnapshot,
    restoredCount,
    skippedConflicts,
    restoredFiles,
    skippedFiles,
  };
}
