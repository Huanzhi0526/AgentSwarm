import React, { useState } from 'react';
import { Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import { AppBrandLogo } from './BrandIcon';
import { setStoredClientToken } from '../utils/api';

interface PairingLockScreenProps {
  remoteDisabled?: boolean;
  onUnlocked: () => void;
}

export const PairingLockScreen: React.FC<PairingLockScreenProps> = ({
  remoteDisabled = false,
  onUnlocked,
}) => {
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

  if (remoteDisabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F6F9] p-5">
        <div className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-xl border border-[#EAEAEF] text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <AppBrandLogo size={46} />
          </div>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FCF4E8] text-[#A26D32]">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h2 className="text-[18px] font-bold text-[#1F2024]">电脑端未开启远程访问</h2>
          <p className="mt-2 text-[13.5px] text-[#6E717C] leading-relaxed">
            为保护本地文件与对话隐私，AgentSwarm 默认仅允许电脑本机访问。
          </p>
          <p className="mt-2 text-[12.5px] text-[#8A8D98] leading-relaxed">
            请在电脑端右上角点击 <strong className="text-[#3C3E47]">「仅本机」</strong>，开启{' '}
            <strong className="text-[#3C3E47]">「允许手机 / 其他设备访问」</strong> 后再刷新或重新扫码。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--ac-primary)] text-[14px] font-semibold text-white hover:bg-[var(--ac-hover)] cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" /> 重新检测连接状态
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F6F9] p-5">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-xl border border-[#EAEAEF] text-center"
      >
        <div className="mx-auto mb-4 flex justify-center">
          <AppBrandLogo size={46} />
        </div>
        <h2 className="text-[18px] font-bold text-[#1F2024]">配对连接 AgentSwarm</h2>
        <p className="mt-1.5 text-[13.5px] text-[#7A7D89]">
          请输入电脑端「手机与跨设备连接」窗口显示的 4 位连接码，或直接使用手机相机扫码打开
        </p>

        {error && (
          <div className="mt-4 rounded-xl bg-[#FAEDEC] py-2 px-3 text-[13px] text-[#A65850]">
            {error}
          </div>
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
