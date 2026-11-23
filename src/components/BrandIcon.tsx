import React from 'react';
import type { EngineId } from '../types';

const ENGINE_ICON_MAP: Record<string, string> = {
  antigravity: '/icons/antigravity.svg',
  codex: '/icons/codex.svg',
  codebuddy: '/icons/codebuddy.svg',
  claude: '/icons/claude.svg',
  gemini: '/icons/gemini.svg',
  qwen: '/icons/qwen.svg',
  opencode: '/icons/opencode.svg',
  cursor: '/icons/cursor.png',
  copilot: '/icons/github.svg',
  kimi: '/icons/kimi.svg',
  auggie: '/icons/auggie.svg',
  goose: '/icons/goose.svg',
  droid: '/icons/droid.svg',
  qoder: '/icons/qoder.png',
  vibe: '/icons/mistral.svg',
  kiro: '/icons/kiro.svg',
  hermes: '/icons/hermes.svg',
  snow: '/icons/snow.png',
  openclaw: '/icons/openclaw.svg',
  nanobot: '/icons/nanobot.svg',
};

interface EngineIconProps {
  engine?: EngineId;
  size?: number;
  className?: string;
}

export const EngineIcon: React.FC<EngineIconProps> = ({ engine, size = 22, className = '' }) => {
  const src = (engine && ENGINE_ICON_MAP[engine]) || '/icons/app-logo.svg';
  const isRoundedBitmap = src.endsWith('.png');

  return (
    <img
      src={src}
      alt={engine || 'Agent'}
      style={{ width: size, height: size }}
      className={`object-contain select-none flex-shrink-0 ${
        isRoundedBitmap ? 'rounded-[5px]' : ''
      } ${className}`}
    />
  );
};

export const AppBrandLogo: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 36 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="AgentSwarm"
    className="flex-shrink-0 select-none"
  >
    <rect width="36" height="36" rx="10" fill="var(--ac-soft-hover)" />
    <circle cx="18" cy="11.5" r="3.5" fill="var(--ac-bubble)" />
    <circle cx="11" cy="23.5" r="3.2" fill="var(--ac-mid)" />
    <circle cx="25" cy="23.5" r="3.2" fill="#689F84" />
    <path
      d="M16.2 14.5L12.6 20.6M19.8 14.5L23.4 20.6M14.3 23.5H21.7"
      stroke="var(--ac-primary)"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const UserAvatarIcon: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <div
    style={{ width: size, height: size }}
    className="flex items-center justify-center rounded-xl bg-[var(--ac-soft-hover)] text-[var(--ac-text)] flex-shrink-0"
  >
    <svg
      width={size * 0.52}
      height={size * 0.52}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  </div>
);
