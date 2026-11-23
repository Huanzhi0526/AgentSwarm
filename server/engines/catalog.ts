import os from 'node:os';
import path from 'node:path';
import type { EngineId, ModelOption } from '../../src/types.js';

export interface EngineCatalogItem {
  id: Exclude<EngineId, 'demo'>;
  name: string;
  vendorLabel: string;
  iconUrl: string;
  binaryCandidates: (home: string, localAppData: string, appData: string) => string[];
  sessionDir?: (home: string) => string;
  authPaths?: (home: string) => string[];
  supportsAccountSwitch: boolean;
  statusNoteWhenReady?: string;
  defaultModels: ModelOption[];
}

export const ENGINE_CATALOG: EngineCatalogItem[] = [
  {
    id: 'antigravity',
    name: 'Antigravity',
    vendorLabel: 'Google',
    iconUrl: '/icons/antigravity.svg',
    binaryCandidates: (_h, local) => [path.join(local, 'agy', 'bin', 'agy.exe'), 'agy'],
    sessionDir: (h) => path.join(h, '.gemini', 'antigravity', 'brain'),
    authPaths: (h) => [path.join(h, '.gemini', 'antigravity-cli')],
    supportsAccountSwitch: true,
    defaultModels: [
      { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'codex',
    name: 'CodeX',
    vendorLabel: 'OpenAI',
    iconUrl: '/icons/codex.svg',
    binaryCandidates: (_h, local) => [
      path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      'codex',
    ],
    sessionDir: (h) => path.join(h, '.codex', 'sessions'),
    authPaths: (h) => [path.join(h, '.codex', 'auth.json')],
    supportsAccountSwitch: true,
    defaultModels: [
      { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'high' },
      { id: 'gpt-6.2-astra', label: 'GPT-6.2-Astra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'high' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium' },
      { id: 'gpt-6-sol', label: 'GPT-6-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
      { id: 'codex-auto-review', label: 'Codex Review', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    vendorLabel: 'Tencent',
    iconUrl: '/icons/codebuddy.svg',
    binaryCandidates: (_h, _local, roaming) => [path.join(roaming, 'npm', 'codebuddy.cmd'), 'codebuddy'],
    sessionDir: (h) => path.join(h, '.codebuddy', 'projects'),
    authPaths: (h) => [path.join(h, '.codebuddy.json')],
    supportsAccountSwitch: true,
    statusNoteWhenReady: '积分计费 · 极速就绪',
    defaultModels: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'glm-5.3', label: 'GLM-5.3', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'minimax-m3.1-flash', label: 'MiniMax M3.1', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'hy4std', label: 'Hunyuan 4 Std', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    vendorLabel: 'Anthropic',
    iconUrl: '/icons/claude.svg',
    binaryCandidates: (_h, _l, roaming) => [path.join(roaming, 'npm', 'claude.cmd'), 'claude'],
    sessionDir: (h) => path.join(h, '.claude', 'projects'),
    authPaths: (h) => [path.join(h, '.claude.json')],
    supportsAccountSwitch: true,
    defaultModels: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendorLabel: 'Google',
    iconUrl: '/icons/gemini.svg',
    binaryCandidates: (_h, _l, roaming) => [path.join(roaming, 'npm', 'gemini.cmd'), 'gemini'],
    sessionDir: (h) => path.join(h, '.gemini', 'tmp'),
    authPaths: (h) => [path.join(h, '.gemini', 'oauth_creds.json')],
    supportsAccountSwitch: true,
    defaultModels: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    vendorLabel: 'Alibaba',
    iconUrl: '/icons/qwen.svg',
    binaryCandidates: (_h, _l, roaming) => [path.join(roaming, 'npm', 'qwen.cmd'), 'qwen'],
    sessionDir: (h) => path.join(h, '.qwen', 'projects'),
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'qwq-plus', label: 'QwQ Plus', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendorLabel: 'SST',
    iconUrl: '/icons/opencode.svg',
    binaryCandidates: (_h, _l, roaming) => [path.join(roaming, 'npm', 'opencode.cmd'), 'opencode'],
    sessionDir: (h) => path.join(h, '.local', 'share', 'opencode'),
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'anthropic/claude-sonnet', label: 'Claude Sonnet', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'openai/gpt-5', label: 'GPT-5', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    vendorLabel: 'Anysphere',
    iconUrl: '/icons/cursor.png',
    binaryCandidates: (_h, local) => [
      path.join(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      'cursor-agent',
    ],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'auto', label: 'Cursor Auto', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'claude-sonnet', label: 'Claude Sonnet', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    vendorLabel: 'GitHub',
    iconUrl: '/icons/github.svg',
    binaryCandidates: (_h, _l, roaming) => [path.join(roaming, 'npm', 'copilot.cmd'), 'copilot'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'gpt-5', label: 'GPT-5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi CLI',
    vendorLabel: 'Moonshot',
    iconUrl: '/icons/kimi.svg',
    binaryCandidates: () => ['kimi'],
    sessionDir: (h) => path.join(h, '.kimi', 'sessions'),
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'kimi-latest', label: 'Kimi Latest', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'auggie',
    name: 'Auggie',
    vendorLabel: 'Augment Code',
    iconUrl: '/icons/auggie.svg',
    binaryCandidates: (_h, _l, roaming) => [path.join(roaming, 'npm', 'auggie.cmd'), 'auggie'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'augment-default', label: 'Augment Agent', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'goose',
    name: 'Goose',
    vendorLabel: 'Block',
    iconUrl: '/icons/goose.svg',
    binaryCandidates: () => ['goose'],
    sessionDir: (h) => path.join(h, '.local', 'share', 'goose', 'sessions'),
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'goose-default', label: 'Goose Default', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'droid',
    name: 'Droid',
    vendorLabel: 'Factory',
    iconUrl: '/icons/droid.svg',
    binaryCandidates: () => ['droid'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'droid-sonnet', label: 'Factory Droid', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'qoder',
    name: 'Qoder',
    vendorLabel: 'Qoder',
    iconUrl: '/icons/qoder.png',
    binaryCandidates: () => ['qoder'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'qoder-default', label: 'Qoder Agent', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'vibe',
    name: 'Mistral Vibe',
    vendorLabel: 'Mistral',
    iconUrl: '/icons/mistral.svg',
    binaryCandidates: () => ['vibe'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'devstral-medium', label: 'Devstral Medium', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'kiro',
    name: 'Kiro',
    vendorLabel: 'AWS',
    iconUrl: '/icons/kiro.svg',
    binaryCandidates: () => ['kiro'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'kiro-claude-sonnet', label: 'Kiro Sonnet', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'hermes',
    name: 'Hermes',
    vendorLabel: 'Nous Research',
    iconUrl: '/icons/hermes.svg',
    binaryCandidates: () => ['hermes'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'hermes-4', label: 'Hermes 4', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'snow',
    name: 'Snow',
    vendorLabel: 'Snow CLI',
    iconUrl: '/icons/snow.png',
    binaryCandidates: () => ['snow'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'snow-default', label: 'Snow Default', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    vendorLabel: 'OpenClaw',
    iconUrl: '/icons/openclaw.svg',
    binaryCandidates: (_h, _l, roaming) => [path.join(roaming, 'npm', 'openclaw.cmd'), 'openclaw'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'openclaw-default', label: 'OpenClaw Gateway', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    ],
  },
  {
    id: 'nanobot',
    name: 'Nanobot',
    vendorLabel: 'Nanobot',
    iconUrl: '/icons/nanobot.svg',
    binaryCandidates: () => ['nanobot'],
    supportsAccountSwitch: false,
    defaultModels: [
      { id: 'nanobot-default', label: 'Nanobot Agent', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
  },
];

export function getCatalogItem(engine: EngineId): EngineCatalogItem {
  return ENGINE_CATALOG.find((e) => e.id === engine) ?? ENGINE_CATALOG[0];
}

export function getAllCatalogAuthPaths(engine: Exclude<EngineId, 'demo'>): string[] {
  const item = getCatalogItem(engine);
  return item.authPaths ? item.authPaths(os.homedir()) : [];
}
