import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { AppBrandLogo } from './BrandIcon';
import { setStoredClientToken } from '../utils/api';

interface PairingLockScreenProps {
  onUnlocked: () => void;
}

export const PairingLockScreen: React.FC<PairingLockScreenProps> = ({ onUnlocked }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinCode: pin.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '连接码有误');
      } else {
        setStoredClientToken(data.token);
        onUnlocked();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F6F9] p-5">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-xl border border-[#EAEAEF] text-center"
      >
        <div className="mx-auto mb-4 flex justify-center">
          <AppBrandLogo size={46} />
        </div>
        <h2 className="text-[18px] font-bold text-[#1F2024]">连接 AgentSwarm</h2>
        <p className="mt-1.5 text-[13.5px] text-[#7A7D89]">
          请输入电脑端「手机连接」窗口显示的 4 位连接码
        </p>

        {error && (
          <div className="mt-4 rounded-xl bg-[#FAEDEC] py-2 text-[13px] text-[#A65850]">{error}</div>
        )}

        <div className="mt-5 relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9A9DA8]" />
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="输入 4 位数字连接码"
            className="h-12 w-full rounded-2xl border border-[#E4E4EC] bg-[#FAFAFC] pl-10 pr-4 text-center font-mono text-[18px] tracking-widest focus:border-[var(--ac-mid)] focus:bg-white focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={!pin.trim() || submitting}
          className="mt-5 h-11 w-full rounded-2xl bg-[var(--ac-primary)] text-[15px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-40 cursor-pointer"
        >
          {submitting ? '验证中...' : '确认进入'}
        </button>
      </form>
    </div>
  );
};
