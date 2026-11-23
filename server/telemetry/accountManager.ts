import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AccountSlot, EngineId } from '../../src/types.js';
import { DATA_DIR, db } from '../db.js';
import { ENGINE_CATALOG, getAllCatalogAuthPaths } from '../engines/catalog.js';

type RealEngine = Exclude<EngineId, 'demo'>;

const VAULT_DIR = path.join(DATA_DIR, 'account-vault');
if (!fs.existsSync(VAULT_DIR)) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

function copyPathRecursive(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyPathRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function mapAccountRow(row: Record<string, unknown>): AccountSlot {
  return {
    id: String(row.id),
    engine: row.engine as RealEngine,
    label: String(row.label),
    accountHint: String(row.account_hint || ''),
    isActive: Boolean(row.is_active),
    savedAt: Number(row.saved_at),
  };
}

export function ensureDefaultAccountSlots(): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM account_slots').get() as { c: number }).c;
  if (count > 0) return;

  for (const cat of ENGINE_CATALOG) {
    if (!cat.supportsAccountSwitch) continue;
    const authPaths = getAllCatalogAuthPaths(cat.id);
    if (authPaths.some((p) => fs.existsSync(p))) {
      try {
        saveCurrentAccountAsSlot(cat.id, '默认主账号', `${cat.vendorLabel} 登录态`);
      } catch {
        // ignore
      }
    }
  }
}

export function listAccountSlots(engine?: RealEngine): AccountSlot[] {
  const rows = engine
    ? (db
        .prepare('SELECT * FROM account_slots WHERE engine = ? ORDER BY saved_at ASC')
        .all(engine) as Record<string, unknown>[])
    : (db.prepare('SELECT * FROM account_slots ORDER BY engine ASC, saved_at ASC').all() as Record<
        string,
        unknown
      >[]);
  return rows.map(mapAccountRow);
}

export function getActiveAccountLabel(engine: RealEngine): string {
  const row = db
    .prepare('SELECT label FROM account_slots WHERE engine = ? AND is_active = 1 LIMIT 1')
    .get(engine) as { label?: string } | undefined;
  return row?.label || '';
}

export function saveCurrentAccountAsSlot(
  engine: RealEngine,
  label: string,
  accountHint = '本机已登录凭证'
): AccountSlot {
  const authPaths = getAllCatalogAuthPaths(engine);
  const existingPath = authPaths.find((p) => fs.existsSync(p));
  if (!existingPath) {
    throw new Error(`未检测到 ${engine} 的本地登录凭证文件，请先在对应客户端完成登录。`);
  }

  const id = `acc_${crypto.randomUUID().slice(0, 8)}`;
  const slotDir = path.join(VAULT_DIR, engine, id);
  fs.mkdirSync(slotDir, { recursive: true });

  for (const p of authPaths) {
    if (fs.existsSync(p)) {
      copyPathRecursive(p, path.join(slotDir, path.basename(p)));
    }
  }

  db.prepare('UPDATE account_slots SET is_active = 0 WHERE engine = ?').run(engine);
  const now = Date.now();
  db.prepare(
    `INSERT INTO account_slots (id, engine, label, account_hint, vault_path, is_active, saved_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, engine, label.trim() || '备用账号', accountHint, slotDir, now);

  const row = db.prepare('SELECT * FROM account_slots WHERE id = ?').get(id) as Record<string, unknown>;
  return mapAccountRow(row);
}

export function switchActiveAccountSlot(slotId: string): AccountSlot {
  const row = db
    .prepare('SELECT * FROM account_slots WHERE id = ?')
    .get(slotId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error('未找到该账号槽位');
  }

  const engine = row.engine as RealEngine;
  const vaultPath = String(row.vault_path);
  if (!fs.existsSync(vaultPath)) {
    throw new Error('该账号的本地备份快照不存在');
  }

  const authPaths = getAllCatalogAuthPaths(engine);
  const currentActive = db
    .prepare('SELECT * FROM account_slots WHERE engine = ? AND is_active = 1')
    .get(engine) as Record<string, unknown> | undefined;
  if (currentActive && String(currentActive.id) !== slotId) {
    const curVault = String(currentActive.vault_path);
    for (const p of authPaths) {
      if (fs.existsSync(p)) {
        copyPathRecursive(p, path.join(curVault, path.basename(p)));
      }
    }
  }

  for (const targetSysPath of authPaths) {
    const backedUp = path.join(vaultPath, path.basename(targetSysPath));
    if (fs.existsSync(backedUp)) {
      copyPathRecursive(backedUp, targetSysPath);
    }
  }

  db.prepare('UPDATE account_slots SET is_active = 0 WHERE engine = ?').run(engine);
  db.prepare('UPDATE account_slots SET is_active = 1 WHERE id = ?').run(slotId);

  const updated = db.prepare('SELECT * FROM account_slots WHERE id = ?').get(slotId) as Record<string, unknown>;
  return mapAccountRow(updated);
}

export function deleteAccountSlot(slotId: string): void {
  const row = db
    .prepare('SELECT * FROM account_slots WHERE id = ?')
    .get(slotId) as Record<string, unknown> | undefined;
  if (!row) return;
  const vaultPath = String(row.vault_path || '');
  if (vaultPath && fs.existsSync(vaultPath)) {
    try {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  db.prepare('DELETE FROM account_slots WHERE id = ?').run(slotId);
}
