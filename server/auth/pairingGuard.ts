import crypto from 'node:crypto';
import type http from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import type { PairedDeviceSummary, PairingConfig } from '../../src/types.js';
import { db } from '../db.js';

interface StoredPairedDevice extends PairedDeviceSummary {
  tokenHash: string;
}

function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function loadPairedDevices(): StoredPairedDevice[] {
  try {
    const raw = getSetting('paired_devices_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredPairedDevice[];
    return Array.isArray(parsed)
      ? parsed.filter((d) => d && typeof d.id === 'string' && typeof d.tokenHash === 'string')
      : [];
  } catch {
    return [];
  }
}

function savePairedDevices(list: StoredPairedDevice[]): void {
  setSetting('paired_devices_v1', JSON.stringify(list));
}

function summarizeDevice(d: StoredPairedDevice): PairedDeviceSummary {
  return {
    id: d.id,
    label: d.label,
    ip: d.ip,
    pairedAt: d.pairedAt,
    lastSeenAt: d.lastSeenAt,
  };
}

export function normalizeSocketIp(ip?: string | null): string {
  const clean = (ip || '').trim();
  if (clean.startsWith('::ffff:')) return clean.slice(7);
  return clean;
}

export function deriveDeviceLabelFromUa(userAgent?: string | null): string {
  const ua = (userAgent || '').trim();
  if (!ua) return '移动/远程浏览器';
  if (/iPhone/i.test(ua)) return 'iPhone 浏览器';
  if (/iPad/i.test(ua)) return 'iPad 浏览器';
  if (/Android/i.test(ua)) return 'Android 手机浏览器';
  if (/Windows/i.test(ua)) return 'Windows 远程浏览器';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac 远程浏览器';
  return '移动/远程浏览器';
}

export function getPairingConfig(): PairingConfig {
  let pinCode = getSetting('lan_pin_code');
  if (!pinCode) {
    pinCode = String(Math.floor(1000 + Math.random() * 9000));
    setSetting('lan_pin_code', pinCode);
  }

  let pairToken = getSetting('lan_pair_token');
  if (!pairToken) {
    pairToken = crypto.randomBytes(12).toString('hex');
    setSetting('lan_pair_token', pairToken);
  }

  // Secure-by-default: localhost-only until user explicitly turns on remote device sharing
  const remoteAccessEnabled = getSetting('remote_access_enabled') === 'true';
  const allowedRemoteHost = (getSetting('allowed_remote_host') || 'all').trim() || 'all';
  // Require PIN/device verification whenever remote sharing is enabled
  const requirePinOnLan = getSetting('require_pin_on_lan') !== 'false';
  const pairedDevices = loadPairedDevices().map(summarizeDevice);

  return {
    remoteAccessEnabled,
    allowedRemoteHost,
    requirePinOnLan,
    pinCode,
    pairToken,
    pairedDevices,
  };
}

export function updatePairingConfig(patch: {
  remoteAccessEnabled?: boolean;
  allowedRemoteHost?: string;
  requirePinOnLan?: boolean;
  regeneratePin?: boolean;
  revokeDevices?: boolean;
  revokeDeviceId?: string;
}): PairingConfig {
  if (patch.remoteAccessEnabled !== undefined) {
    setSetting('remote_access_enabled', patch.remoteAccessEnabled ? 'true' : 'false');
    if (patch.remoteAccessEnabled && getSetting('require_pin_on_lan') === undefined) {
      setSetting('require_pin_on_lan', 'true');
    }
  }
  if (typeof patch.allowedRemoteHost === 'string' && patch.allowedRemoteHost.trim()) {
    setSetting('allowed_remote_host', patch.allowedRemoteHost.trim());
  }
  if (patch.requirePinOnLan !== undefined) {
    setSetting('require_pin_on_lan', patch.requirePinOnLan ? 'true' : 'false');
  }
  if (patch.regeneratePin) {
    const nextPin = String(Math.floor(1000 + Math.random() * 9000));
    setSetting('lan_pin_code', nextPin);
  }
  if (patch.revokeDeviceId) {
    const filtered = loadPairedDevices().filter((d) => d.id !== patch.revokeDeviceId);
    savePairedDevices(filtered);
  }
  if (patch.revokeDevices) {
    savePairedDevices([]);
    setSetting('lan_pair_token', crypto.randomBytes(12).toString('hex'));
  }
  return getPairingConfig();
}

export function isLocalSocketAddress(ip?: string | null): boolean {
  const clean = ip || '';
  return clean === '127.0.0.1' || clean === '::1' || clean === '::ffff:127.0.0.1';
}

export function isLocalRequest(req: Request): boolean {
  return isLocalSocketAddress(req.ip || req.socket.remoteAddress);
}

function isTokenPairedAndTouch(rawToken: string): boolean {
  if (!rawToken) return false;
  const hash = sha256Hex(rawToken);
  const list = loadPairedDevices();
  const idx = list.findIndex((d) => d.tokenHash === hash);
  if (idx < 0) return false;
  const now = Date.now();
  if (now - list[idx].lastSeenAt > 30_000) {
    list[idx] = { ...list[idx], lastSeenAt: now };
    savePairedDevices(list);
  }
  return true;
}

function isAllowedInterfaceAddress(
  cfg: PairingConfig,
  localAddress?: string | null
): boolean {
  if (!cfg.remoteAccessEnabled) return false;
  if (cfg.allowedRemoteHost === 'all') return true;
  const cleanLocal = normalizeSocketIp(localAddress);
  if (!cleanLocal) return true;
  return cleanLocal === cfg.allowedRemoteHost;
}

export function verifyClientAccess(req: Request): boolean {
  if (isLocalRequest(req)) return true;
  const cfg = getPairingConfig();
  if (!isAllowedInterfaceAddress(cfg, req.socket.localAddress)) return false;

  const headerTok = String(req.headers['x-cowork-auth'] || req.query.token || '');
  return isTokenPairedAndTouch(headerTok);
}

export function verifyWsAccess(req: http.IncomingMessage): boolean {
  if (isLocalSocketAddress(req.socket.remoteAddress)) return true;
  const cfg = getPairingConfig();
  if (!isAllowedInterfaceAddress(cfg, req.socket.localAddress)) return false;

  try {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const tok = parsedUrl.searchParams.get('token') || '';
    return isTokenPairedAndTouch(tok);
  } catch {
    return false;
  }
}

export function issueClientToken(input: {
  pairToken?: string;
  pinCode?: string;
  deviceLabel?: string;
  clientIp?: string;
  allowWhenDisabled?: boolean;
}): { token: string; device: PairedDeviceSummary } | null {
  const cfg = getPairingConfig();
  if (!cfg.remoteAccessEnabled && !input.allowWhenDisabled) {
    return null;
  }
  const matchesPair = Boolean(input.pairToken && input.pairToken === cfg.pairToken);
  const matchesPin = Boolean(input.pinCode && input.pinCode.trim() === cfg.pinCode);
  if (!matchesPair && !matchesPin) {
    return null;
  }

  const sessionToken = crypto.randomBytes(18).toString('hex');
  const now = Date.now();
  const entry: StoredPairedDevice = {
    id: `dev_${crypto.randomBytes(4).toString('hex')}`,
    tokenHash: sha256Hex(sessionToken),
    label: (input.deviceLabel || '').trim() || '已配对设备',
    ip: normalizeSocketIp(input.clientIp) || '远程设备',
    pairedAt: now,
    lastSeenAt: now,
  };
  const existing = loadPairedDevices().slice(-19);
  savePairedDevices([...existing, entry]);
  return { token: sessionToken, device: summarizeDevice(entry) };
}

export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (
    req.path === '/api/health' ||
    req.path === '/health' ||
    req.path.startsWith('/api/auth/') ||
    req.path.startsWith('/auth/') ||
    req.path.startsWith('/api/preview-sandbox/') ||
    req.path.startsWith('/preview-sandbox/')
  ) {
    next();
    return;
  }
  if (verifyClientAccess(req)) {
    next();
    return;
  }
  const cfg = getPairingConfig();
  if (!isLocalRequest(req) && !cfg.remoteAccessEnabled) {
    res.status(403).json({
      error: '电脑端当前仅限本机访问，请先在电脑端右上角开启「允许手机/其他设备访问」',
      remoteDisabled: true,
    });
    return;
  }
  res.status(401).json({ error: '需要输入连接码或扫码完成设备配对', locked: true });
}
