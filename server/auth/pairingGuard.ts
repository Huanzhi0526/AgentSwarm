import crypto from 'node:crypto';
import type http from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import type { PairingConfig } from '../../src/types.js';
import { db } from '../db.js';

const validClientTokens = new Set<string>();

export function getPairingConfig(): PairingConfig {
  const getVal = (key: string) => {
    const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return r?.value;
  };
  const setVal = (key: string, value: string) => {
    db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  };

  let pinCode = getVal('lan_pin_code');
  if (!pinCode) {
    pinCode = String(Math.floor(1000 + Math.random() * 9000));
    setVal('lan_pin_code', pinCode);
  }

  let pairToken = getVal('lan_pair_token');
  if (!pairToken) {
    pairToken = crypto.randomBytes(12).toString('hex');
    setVal('lan_pair_token', pairToken);
  }

  const requirePinOnLan = getVal('require_pin_on_lan') === 'true';
  return { requirePinOnLan, pinCode, pairToken };
}

export function updatePairingConfig(patch: {
  requirePinOnLan?: boolean;
  regeneratePin?: boolean;
  revokeDevices?: boolean;
}): PairingConfig {
  if (patch.requirePinOnLan !== undefined) {
    db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('require_pin_on_lan', patch.requirePinOnLan ? 'true' : 'false');
  }
  if (patch.regeneratePin) {
    const nextPin = String(Math.floor(1000 + Math.random() * 9000));
    db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('lan_pin_code', nextPin);
  }
  if (patch.revokeDevices) {
    validClientTokens.clear();
    const nextPairToken = crypto.randomBytes(12).toString('hex');
    db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('lan_pair_token', nextPairToken);
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

export function verifyClientAccess(req: Request): boolean {
  if (isLocalRequest(req)) return true;
  const cfg = getPairingConfig();
  if (!cfg.requirePinOnLan) return true;

  const headerTok = String(req.headers['x-cowork-auth'] || req.query.token || '');
  if (headerTok && validClientTokens.has(headerTok)) return true;
  return false;
}

export function verifyWsAccess(req: http.IncomingMessage): boolean {
  if (isLocalSocketAddress(req.socket.remoteAddress)) return true;
  const cfg = getPairingConfig();
  if (!cfg.requirePinOnLan) return true;

  try {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const tok = parsedUrl.searchParams.get('token') || '';
    if (tok && validClientTokens.has(tok)) return true;
  } catch {
    // ignore
  }
  return false;
}

export function issueClientToken(input: { pairToken?: string; pinCode?: string }): string | null {
  const cfg = getPairingConfig();
  if (
    (input.pairToken && input.pairToken === cfg.pairToken) ||
    (input.pinCode && input.pinCode.trim() === cfg.pinCode)
  ) {
    const sessionToken = crypto.randomBytes(18).toString('hex');
    validClientTokens.add(sessionToken);
    return sessionToken;
  }
  return null;
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
  res.status(401).json({ error: '需要输入连接码验证', locked: true });
}
