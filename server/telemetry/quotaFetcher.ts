import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { QuotaWindowBar } from '../../src/types.js';
import { db } from '../db.js';

export function formatResetCountdown(resetEpochMs: number): string {
  const diffMs = resetEpochMs - Date.now();
  if (diffMs <= 0) return '已满额';
  const totalMin = Math.ceil(diffMs / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return remH > 0 ? `${days}d${remH}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

// 1. Official Antigravity Quota via documented `agy -p "/usage" --output-format json` (0 tokens consumed)
let agyQuotaCache: { at: number; bars: QuotaWindowBar[] } | null = null;
let agyInFlight: Promise<QuotaWindowBar[]> | null = null;

function loadPersistedAgyQuota(): { at: number; bars: QuotaWindowBar[] } | null {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'agy_quota_cache'").get() as
      | { value: string }
      | undefined;
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as { at: number; bars: QuotaWindowBar[] };
    return Array.isArray(parsed.bars) && parsed.bars.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function savePersistedAgyQuota(entry: { at: number; bars: QuotaWindowBar[] }): void {
  try {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('agy_quota_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(JSON.stringify(entry));
  } catch {
    // ignore
  }
}

const PASSIVE_AGY_QUOTA_TTL_MS = 6 * 3600_000;

export async function fetchAntigravityRealQuota(
  agyBinaryPath: string | null,
  forceRefresh = false
): Promise<QuotaWindowBar[]> {
  if (!agyBinaryPath) return [];
  if (!agyQuotaCache) {
    agyQuotaCache = loadPersistedAgyQuota();
  }
  if (!forceRefresh && agyQuotaCache && Date.now() - agyQuotaCache.at < PASSIVE_AGY_QUOTA_TTL_MS) {
    return agyQuotaCache.bars;
  }
  if (agyInFlight) return agyInFlight;

  agyInFlight = (async () => {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          agyBinaryPath,
          ['-p', '/usage', '--output-format', 'json', '--print-timeout', '12s'],
          {
            windowsHide: true,
            detached: false,
            stdio: ['ignore', 'pipe', 'ignore'],
            env: {
              ...process.env,
              CI: '1',
              NO_COLOR: '1',
            },
          }
        );
        let out = '';
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // ignore kill error
          }
          reject(new Error('quota fetch timeout'));
        }, 14_000);
        child.stdout?.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0 || out.trim().length > 0) resolve(out);
          else reject(new Error(`quota exited with ${code}`));
        });
      });

      const line = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.startsWith('{') && s.includes('"usage"'));
      if (!line) return agyQuotaCache?.bars ?? [];

      const parsed = JSON.parse(line) as {
        command?: {
          data?: {
            groups?: Array<{
              name: string;
              buckets?: Array<{
                id: string;
                window: string;
                remaining_fraction: number;
                reset_time?: string;
              }>;
            }>;
          };
        };
      };

      const groups = parsed.command?.data?.groups ?? [];
      const bars: QuotaWindowBar[] = [];

      for (const g of groups) {
        const isGemini = g.name.toLowerCase().includes('gemini');
        const prefix = isGemini ? 'Gemini' : 'Claude';
        const buckets = g.buckets ?? [];
        // Show 5h first, then weekly
        const sorted = [...buckets].sort((a, b) => (a.window === '5h' ? -1 : b.window === '5h' ? 1 : 0));
        for (const b of sorted) {
          const pct = Math.max(0, Math.min(100, Math.round((b.remaining_fraction ?? 0) * 100)));
          const resetMs = b.reset_time ? Date.parse(b.reset_time) : 0;
          const winLabel = b.window === '5h' ? '5h' : '周';
          bars.push({
            label: `${prefix} ${winLabel}`,
            resetText: resetMs ? formatResetCountdown(resetMs) : winLabel,
            remainingPercent: pct,
          });
        }
      }

      if (bars.length > 0) {
        agyQuotaCache = { at: Date.now(), bars };
        savePersistedAgyQuota(agyQuotaCache);
      }
      return bars.length > 0 ? bars : agyQuotaCache?.bars ?? [];
    } catch {
      return agyQuotaCache?.bars ?? [];
    } finally {
      agyInFlight = null;
    }
  })();

  return agyInFlight;
}

// 2. Official Codex Quota from local `~/.codex/sessions` `rate_limits` telemetry events
export interface CodexQuotaReadout {
  planType: string | null;
  bars: QuotaWindowBar[];
}

export function readCodexLocalRateLimits(codexSessionsDir: string): CodexQuotaReadout {
  if (!fs.existsSync(codexSessionsDir)) {
    return { planType: null, bars: [] };
  }

  // Collect recent .jsonl files sorted by mtime descending
  const jsonlFiles: Array<{ path: string; mtime: number }> = [];
  function collect(dir: string, depth: number) {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        collect(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          jsonlFiles.push({ path: full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  }
  collect(codexSessionsDir, 0);
  jsonlFiles.sort((a, b) => b.mtime - a.mtime);

  interface RateLimitBucket {
    used_percent?: number;
    window_minutes?: number;
    resets_at?: number;
  }

  interface RateLimitsPayload {
    primary?: RateLimitBucket;
    secondary?: RateLimitBucket;
    plan_type?: string | null;
  }

  let latestRl: RateLimitsPayload | null = null;

  for (const item of jsonlFiles.slice(0, 8)) {
    try {
      const raw = fs.readFileSync(item.path, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const ln = lines[i];
        if (!ln || !ln.includes('"rate_limits"')) continue;
        const obj = JSON.parse(ln) as Record<string, unknown>;
        const payload = (obj.payload && typeof obj.payload === 'object' ? obj.payload : obj) as Record<
          string,
          unknown
        >;
        if (payload.rate_limits && typeof payload.rate_limits === 'object') {
          latestRl = payload.rate_limits as RateLimitsPayload;
          break;
        }
      }
      if (latestRl) break;
    } catch {
      // ignore malformed line
    }
  }

  if (!latestRl) {
    return { planType: null, bars: [] };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const bars: QuotaWindowBar[] = [];

  if (latestRl.primary) {
    const resetsAt = Number(latestRl.primary.resets_at || 0);
    const expired = resetsAt > 0 && nowSec >= resetsAt;
    const used = expired ? 0 : Number(latestRl.primary.used_percent || 0);
    bars.push({
      label: '5h',
      resetText: expired || !resetsAt ? '5h' : formatResetCountdown(resetsAt * 1000),
      remainingPercent: Math.max(0, Math.min(100, Math.round(100 - used))),
    });
  }

  if (latestRl.secondary) {
    const resetsAt = Number(latestRl.secondary.resets_at || 0);
    const expired = resetsAt > 0 && nowSec >= resetsAt;
    const used = expired ? 0 : Number(latestRl.secondary.used_percent || 0);
    bars.push({
      label: '周',
      resetText: expired || !resetsAt ? '7d' : formatResetCountdown(resetsAt * 1000),
      remainingPercent: Math.max(0, Math.min(100, Math.round(100 - used))),
    });
  }

  return {
    planType: latestRl.plan_type ? String(latestRl.plan_type) : null,
    bars,
  };
}
