import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type {
  EngineStatusCard,
  HeatmapCell,
  ModelOption,
  NetworkEndpoint,
  QuotaWindowBar,
  WorkbenchOverview,
} from '../../src/types.js';
import { ENGINE_CATALOG, getCatalogItem } from '../engines/catalog.js';
import { TEAM_PRESETS } from '../orchestrator/presets.js';
import { db, getEngineDefaultConfigs, getOrchestrationPreferences } from '../db.js';
import { getActiveAccountLabel } from './accountManager.js';
import { fetchAntigravityRealQuota, readCodexLocalRateLimits } from './quotaFetcher.js';

interface CliDetectResult {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
}

const detectCache = new Map<string, { at: number; result: CliDetectResult }>();

function resolveExecutableInPath(cmdName: string): string | null {
  const pathEnv = process.env.PATH || process.env.Path || '';
  if (!pathEnv) return null;
  const dirs = pathEnv
    .split(path.delimiter)
    .map((s) => s.trim().replace(/^"+|"+$/g, ''))
    .filter(Boolean);
  const isWin = process.platform === 'win32';
  const hasExt = Boolean(path.extname(cmdName));
  const exts = isWin ? (hasExt ? [''] : ['.exe', '.cmd', '.bat', '.com', '']) : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${cmdName}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // ignore inaccessible PATH entry
      }
    }
  }
  return null;
}

export function detectCliBinary(
  candidates: string[],
  skipVersion = false,
  forceRefresh = false
): CliDetectResult {
  const cacheKey = `${candidates.join('|')}:${skipVersion}`;
  const cached = detectCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < 300_000) {
    return cached.result;
  }

  const isWin = process.platform === 'win32';
  for (const candidate of candidates) {
    try {
      let resolvedPath: string | null = null;
      if (path.isAbsolute(candidate)) {
        if (fs.existsSync(candidate)) {
          resolvedPath = candidate;
        }
      } else {
        resolvedPath = resolveExecutableInPath(candidate);
      }

      if (resolvedPath) {
        let version: string | null = '已就绪';
        if (!skipVersion) {
          try {
            const isWinCmd = isWin && /\.(cmd|bat)$/i.test(resolvedPath);
            const verOut = (
              isWinCmd
                ? execFileSync(
                    process.env.ComSpec || 'cmd.exe',
                    ['/d', '/c', resolvedPath, '--version'],
                    {
                      encoding: 'utf8',
                      stdio: ['ignore', 'pipe', 'ignore'],
                      timeout: 2000,
                      windowsHide: true,
                    }
                  )
                : execFileSync(resolvedPath, ['--version'], {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                    timeout: 2000,
                    windowsHide: true,
                  })
            ).trim();
            version = verOut.split(/\r?\n/)[0]?.slice(0, 48) || '已就绪';
          } catch {
            version = '已就绪';
          }
        }
        const result = { installed: true, binaryPath: resolvedPath, version };
        detectCache.set(cacheKey, { at: Date.now(), result });
        return result;
      }
    } catch {
      // try next
    }
  }

  const fallback = { installed: false, binaryPath: null, version: null };
  detectCache.set(cacheKey, { at: Date.now(), result: fallback });
  return fallback;
}

export function loadLocalCodexModelsWithEfforts(homeDir: string): ModelOption[] {
  const fallback = getCatalogItem('codex').defaultModels;
  try {
    const cacheFile = path.join(homeDir, '.codex', 'models_cache.json');
    if (!fs.existsSync(cacheFile)) return fallback;
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { models?: Array<Record<string, unknown>> };
    const list = Array.isArray(raw.models) ? raw.models : [];
    const parsed: ModelOption[] = [];
    for (const m of list.slice(0, 12)) {
      const id = String(m.slug || m.id || '').trim();
      const label = String(m.display_name || m.name || id).trim();
      const rawLevels = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [];
      const efforts = rawLevels
        .map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).effort || '') : String(x || '')))
        .filter(Boolean);
      const defaultEffort = typeof m.default_reasoning_level === 'string' && m.default_reasoning_level
        ? m.default_reasoning_level
        : efforts.includes('high')
          ? 'high'
          : efforts[0] || 'medium';

      if (id) {
        parsed.push({
          id,
          label,
          efforts: efforts.length > 0 ? efforts : ['low', 'medium', 'high', 'xhigh'],
          defaultEffort,
        });
      }
    }
    return parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function getAllEngineModelsMap(): Record<string, ModelOption[]> {
  const skipHostScan = process.env.AGENT_COWORK_SKIP_HOST_SCAN === '1';
  const codexModels = skipHostScan
    ? getCatalogItem('codex').defaultModels
    : loadLocalCodexModelsWithEfforts(os.homedir());
  const map: Record<string, ModelOption[]> = {};
  for (const cat of ENGINE_CATALOG) {
    map[cat.id] = cat.id === 'codex' ? codexModels : cat.defaultModels;
  }
  return map;
}

interface DirScanSummary {
  sessionCount: number;
  estimatedBytes: number;
  dayBuckets: Map<string, { count: number; bytes: number }>;
}

function toLocalDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function scanSessionDirectory(rootDir: string, maxDepth = 4): DirScanSummary {
  const dayBuckets = new Map<string, { count: number; bytes: number }>();
  let sessionCount = 0;
  let estimatedBytes = 0;

  if (!rootDir || !fs.existsSync(rootDir)) {
    return { sessionCount, estimatedBytes, dayBuckets };
  }

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'Cache' || entry.name === '.git') continue;
        walk(fullPath, depth + 1);
      } else if (
        entry.isFile() &&
        entry.name !== 'transcript_full.jsonl' &&
        (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json') || entry.name.endsWith('.vscdb'))
      ) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size < 128) continue;
          if (
            entry.name === 'transcript.jsonl' ||
            entry.name.startsWith('rollout-') ||
            entry.name.endsWith('.jsonl')
          ) {
            sessionCount += 1;
          }
          estimatedBytes += stat.size;
          const dateStr = toLocalDateKey(stat.mtimeMs);
          const prev = dayBuckets.get(dateStr) ?? { count: 0, bytes: 0 };
          prev.count += 1;
          prev.bytes += stat.size;
          dayBuckets.set(dateStr, prev);
        } catch {
          // ignore
        }
      }
    }
  }

  walk(rootDir, 0);
  return { sessionCount, estimatedBytes, dayBuckets };
}

export function detectNetworkEndpoints(port: number): NetworkEndpoint[] {
  const endpoints: NetworkEndpoint[] = [
    {
      label: '本机',
      kind: 'localhost',
      ip: '127.0.0.1',
      url: `http://127.0.0.1:${port}`,
    },
  ];

  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      const lowerName = name.toLowerCase();
      if (ip.startsWith('100.') || lowerName.includes('tailscale') || lowerName.includes('zerotier')) {
        endpoints.push({
          label: `异地组网 (${name})`,
          kind: 'tailscale',
          ip,
          url: `http://${ip}:${port}`,
        });
      } else if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
        endpoints.push({
          label: `局域网 (${name})`,
          kind: 'lan',
          ip,
          url: `http://${ip}:${port}`,
        });
      }
    }
  }

  return endpoints;
}

export async function buildWorkbenchOverview(
  port: number,
  forceRefreshQuota = false
): Promise<WorkbenchOverview> {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const skipHostScan = process.env.AGENT_COWORK_SKIP_HOST_SCAN === '1';

  const ledgerRows = db
    .prepare(
      `SELECT engine,
              SUM(input_tokens + output_tokens) AS total_tok,
              SUM(cached_tokens) AS cached_tok,
              SUM(input_tokens) AS in_tok,
              COUNT(*) AS turns
       FROM usage_ledger
       GROUP BY engine`
    )
    .all() as Array<{
    engine: string;
    total_tok: number;
    cached_tok: number;
    in_tok: number;
    turns: number;
  }>;
  const ledgerByEngine = new Map(ledgerRows.map((r) => [r.engine, r]));

  const workingEngineRows = db
    .prepare("SELECT DISTINCT engine FROM agent_slots WHERE state = 'working'")
    .all() as Array<{ engine: string }>;
  const activelyWorkingSet = new Set(workingEngineRows.map((r) => r.engine));

  const mergedDays = new Map<string, { count: number; tokens: number }>();
  let cumulativeTokens = 0;
  let totalScannedSessions = 0;

  const codexModels = skipHostScan ? getCatalogItem('codex').defaultModels : loadLocalCodexModelsWithEfforts(home);
  const codexQuota = skipHostScan
    ? { planType: null, bars: [] }
    : readCodexLocalRateLimits(path.join(home, '.codex', 'sessions'));

  // Detect Antigravity binary first so we can fetch live official quota in parallel
  const agyItem = getCatalogItem('antigravity');
  const agyDetect = detectCliBinary(agyItem.binaryCandidates(home, localAppData, appData), true);
  const agyRealBars =
    !skipHostScan && agyDetect.installed
      ? await fetchAntigravityRealQuota(agyDetect.binaryPath, forceRefreshQuota)
      : [];

  let quotaUpdatedAt: number | null =
    agyRealBars.length > 0 || codexQuota.bars.length > 0 ? Date.now() : null;

  const engineDefaultsMap = getEngineDefaultConfigs();
  const engines: EngineStatusCard[] = [];

  for (const cat of ENGINE_CATALOG) {
    const det =
      cat.id === 'antigravity'
        ? agyDetect
        : detectCliBinary(cat.binaryCandidates(home, localAppData, appData), true);

    const scan =
      !skipHostScan && cat.sessionDir
        ? scanSessionDirectory(cat.sessionDir(home), 4)
        : { sessionCount: 0, estimatedBytes: 0, dayBuckets: new Map() };

    for (const [date, val] of scan.dayBuckets.entries()) {
      const cur = mergedDays.get(date) ?? { count: 0, tokens: 0 };
      cur.count += val.count;
      cur.tokens += Math.round(val.bytes / 3.8);
      mergedDays.set(date, cur);
    }

    const ledger = ledgerByEngine.get(cat.id);
    const ledgerTurns = Number(ledger?.turns ?? 0);
    const scannedTokens = Math.round(scan.estimatedBytes / 3.8);
    const scannedTurns = scan.sessionCount > 0 ? scan.sessionCount * 6 : 0;
    const engineTokens = scannedTokens + Number(ledger?.total_tok ?? 0);
    cumulativeTokens += engineTokens;
    totalScannedSessions += scan.sessionCount;

    let quotaBars: QuotaWindowBar[] = [];
    let vendorLabel = `配置 ${cat.vendorLabel}`;
    let statusNote = cat.statusNoteWhenReady;

    if (cat.id === 'antigravity' && det.installed) {
      quotaBars = agyRealBars;
      if (quotaBars.length === 0) {
        statusNote = '已安装 · 暂未获取实时额度';
      }
    } else if (cat.id === 'codex' && det.installed) {
      quotaBars = codexQuota.bars;
      if (codexQuota.planType) {
        vendorLabel = `OpenAI · ${codexQuota.planType.toUpperCase()}`;
      }
      if (quotaBars.length === 0) {
        statusNote = '已安装 · 暂未读取限额记录';
      }
    } else if (!det.installed) {
      statusNote = '本机未安装';
    } else if (!statusNote) {
      statusNote = '已安装 · 可随时调用';
    }

    const models = cat.id === 'codex' ? codexModels : cat.defaultModels;
    const isActivelyWorking = det.installed && activelyWorkingSet.has(cat.id);

    const savedDef = engineDefaultsMap[cat.id];
    const matchedSavedModel = savedDef ? models.find((m) => m.id === savedDef.modelId) : undefined;
    const effectiveModelObj = matchedSavedModel || models[0];
    const defaultModel = effectiveModelObj?.id || savedDef?.modelId || 'default';
    const validEffs = effectiveModelObj?.efforts?.length
      ? effectiveModelObj.efforts
      : ['low', 'medium', 'high'];
    const defaultEffort =
      savedDef?.reasoningEffort && validEffs.includes(savedDef.reasoningEffort)
        ? savedDef.reasoningEffort
        : effectiveModelObj?.defaultEffort || validEffs[0] || 'high';

    engines.push({
      id: cat.id,
      name: cat.name,
      vendorLabel,
      iconUrl: cat.iconUrl,
      activeAccountLabel: cat.supportsAccountSwitch ? getActiveAccountLabel(cat.id) : '',
      installed: det.installed,
      binaryPath: det.binaryPath,
      version: det.version,
      stateLabel: !det.installed ? '未安装' : isActivelyWorking ? '正在执行' : '已安装',
      isActivelyWorking,
      statusNote,
      localSessionCount: scan.sessionCount,
      totalTokensEstimated: engineTokens,
      turnCountEstimated: scannedTurns + ledgerTurns,
      statsAreEstimated: scan.sessionCount > 0,
      supportsAccountSwitch: cat.supportsAccountSwitch && det.installed,
      defaultModel,
      defaultEffort,
      hasCustomDefault: Boolean(savedDef),
      availableModels: models,
      quotaBars,
    });
  }

  // Sort installed/active engines first while preserving catalog priority order
  engines.sort((a, b) => (a.installed === b.installed ? 0 : a.installed ? -1 : 1));

  const dailyLedger = db
    .prepare(
      `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS d,
              COUNT(*) AS c,
              SUM(input_tokens + output_tokens) AS t
       FROM usage_ledger
       GROUP BY d`
    )
    .all() as Array<{ d: string; c: number; t: number }>;

  for (const row of dailyLedger) {
    if (!row.d) continue;
    const cur = mergedDays.get(row.d) ?? { count: 0, tokens: 0 };
    cur.count += Number(row.c || 0);
    cur.tokens += Number(row.t || 0);
    mergedDays.set(row.d, cur);
  }

  const heatmap: HeatmapCell[] = [];
  const today = new Date();
  const todayStr = toLocalDateKey(today.getTime());
  for (let i = 125; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const dateKey = toLocalDateKey(d.getTime());
    const stat = mergedDays.get(dateKey) ?? { count: 0, tokens: 0 };
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (stat.tokens > 8_000_000 || stat.count >= 20) level = 4;
    else if (stat.tokens > 2_000_000 || stat.count >= 10) level = 3;
    else if (stat.tokens > 400_000 || stat.count >= 4) level = 2;
    else if (stat.tokens > 0 || stat.count >= 1) level = 1;
    heatmap.push({ date: dateKey, count: stat.count, tokens: stat.tokens, level });
  }

  const todayBucket = mergedDays.get(todayStr) ?? { count: 0, tokens: 0 };
  const totalLedgerIn = ledgerRows.reduce((acc, r) => acc + Number(r.in_tok || 0), 0);
  const totalLedgerCached = ledgerRows.reduce((acc, r) => acc + Number(r.cached_tok || 0), 0);
  const totalLedgerTurns = ledgerRows.reduce((acc, r) => acc + Number(r.turns || 0), 0);
  const totalScannedTurns = totalScannedSessions * 6;
  const cacheHitRate =
    totalLedgerIn > 0 ? Math.round((totalLedgerCached / totalLedgerIn) * 1000) / 10 : null;

  return {
    todayTokens: todayBucket.tokens,
    cumulativeTokens,
    cacheHitRate,
    totalTurns: totalLedgerTurns + totalScannedTurns,
    turnsAreEstimated: totalScannedTurns > 0,
    quotaUpdatedAt,
    orchestrationPreferences: getOrchestrationPreferences(),
    heatmap,
    engines,
    presets: TEAM_PRESETS,
    endpoints: detectNetworkEndpoints(port),
  };
}
