import type { EngineId, ModelOption, ReasoningEffort } from '../types';

export function formatEffortLabel(effort?: ReasoningEffort): string {
  return (effort || 'high').trim();
}

export function formatCompactTokens(n: number): string {
  if (n >= 1_000_000_000) {
    return n >= 100_000_000_000
      ? `${(n / 1_000_000_000).toFixed(1)}G`
      : `${(n / 1_000_000_000).toFixed(2)}G`;
  }
  if (n >= 1_000_000) {
    return n >= 100_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

export function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return '昨天';
  return `${days}天前`;
}

export const ENGINE_OPTIONS: Array<{ id: Exclude<EngineId, 'demo'>; label: string }> = [
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'codex', label: 'CodeX' },
  { id: 'codebuddy', label: 'CodeBuddy' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'qwen', label: 'Qwen Code' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot CLI' },
  { id: 'kimi', label: 'Kimi CLI' },
  { id: 'auggie', label: 'Auggie' },
  { id: 'goose', label: 'Goose' },
  { id: 'droid', label: 'Droid' },
  { id: 'qoder', label: 'Qoder' },
  { id: 'vibe', label: 'Mistral Vibe' },
  { id: 'kiro', label: 'Kiro' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'snow', label: 'Snow' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'nanobot', label: 'Nanobot' },
];

export const FALLBACK_MODELS_BY_ENGINE: Record<string, ModelOption[]> = {
  antigravity: [
    { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
  ],
  codex: [
    { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'high' },
    { id: 'gpt-6.2-astra', label: 'GPT-6.2-Astra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'high' },
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium' },
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
    { id: 'codex-auto-review', label: 'Codex Review', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
  ],
  codebuddy: [
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'glm-5.3', label: 'GLM-5.3', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { id: 'minimax-m3.1-flash', label: 'MiniMax M3.1', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'hy4std', label: 'Hunyuan 4 Std', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  ],
  claude: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high' },
  ],
};

export function getModelsForEngine(
  engine: EngineId,
  modelsByEngine: Record<string, ModelOption[]>
): ModelOption[] {
  const key = engine === 'demo' ? 'antigravity' : engine;
  if (modelsByEngine[key]?.length) return modelsByEngine[key];
  if (FALLBACK_MODELS_BY_ENGINE[key]?.length) return FALLBACK_MODELS_BY_ENGINE[key];
  return [{ id: `${key}-default`, label: 'Default', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' }];
}

export function getEffortsForModel(
  engine: EngineId,
  modelId: string,
  modelsByEngine: Record<string, ModelOption[]>
): string[] {
  const list = getModelsForEngine(engine, modelsByEngine);
  const hit = list.find((m) => m.id === modelId);
  return hit?.efforts?.length ? hit.efforts : ['low', 'medium', 'high'];
}

export function formatModelLabel(modelId?: string, allModels?: ModelOption[]): string {
  if (!modelId) return '';
  const stripped = modelId.replace(/-(low|medium|high|xhigh|max)$/i, '');
  if (allModels) {
    const hit = allModels.find((m) => m.id === modelId || m.id === stripped);
    if (hit) return hit.label;
  }
  for (const list of Object.values(FALLBACK_MODELS_BY_ENGINE)) {
    const hit = list.find((m) => m.id === modelId || m.id === stripped);
    if (hit) return hit.label;
  }
  return stripped;
}

export function buildResumeCommand(engine: EngineId, sessionId: string | null): string | null {
  if (!sessionId) return null;
  if (engine === 'codex') return `codex resume ${sessionId}`;
  if (engine === 'antigravity') return `agy --conversation ${sessionId}`;
  if (engine === 'codebuddy') return `codebuddy -r ${sessionId}`;
  if (engine === 'claude') return `claude -r ${sessionId}`;
  if (engine === 'gemini') return `gemini --resume ${sessionId}`;
  if (engine === 'qwen') return `qwen --resume ${sessionId}`;
  if (engine === 'opencode') return `opencode --session ${sessionId}`;
  return null;
}
