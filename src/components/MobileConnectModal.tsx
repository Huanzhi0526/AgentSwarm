import React, { useEffect, useState } from 'react';
import { X, Smartphone, Wifi, Copy, Check, Globe, Shield, RefreshCw } from 'lucide-react';
import type { NetworkEndpoint } from '../types';
import { apiFetch } from '../utils/api';

interface MobileConnectModalProps {
  open: boolean;
  onClose: () => void;
  endpoints: NetworkEndpoint[];
  canManageSecurity?: boolean;
}

export const MobileConnectModal: React.FC<MobileConnectModalProps> = ({
  open,
  onClose,
  endpoints,
  canManageSecurity = true,
}) => {
  const preferred =
    endpoints.find((e) => e.kind === 'lan') ||
    endpoints.find((e) => e.kind === 'tailscale') ||
    endpoints[0];

  const [selectedUrl, setSelectedUrl] = useState(preferred?.url || '');
  const [pairUrl, setPairUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [requirePin, setRequirePin] = useState(false);
  const [pinCode, setPinCode] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [revokedMsg, setRevokedMsg] = useState<string | null>(null);

  const loadQrInfo = (target: string) => {
    apiFetch(`/api/mobile-qr?url=${encodeURIComponent(target)}`)
      .then((r) => r.json())
      .then((data) => {
        setQrDataUrl(data.qrDataUrl || '');
        setPairUrl(data.pairUrl || target);
        setRequirePin(Boolean(data.requirePinOnLan));
        if (data.pinCode) setPinCode(data.pinCode);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    const target = selectedUrl || preferred?.url || window.location.origin;
    setSelectedUrl(target);
    loadQrInfo(target);
  }, [open, selectedUrl, preferred?.url]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(pairUrl || selectedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleTogglePin = async () => {
    const next = !requirePin;
    const res = await apiFetch('/api/auth/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirePinOnLan: next }),
    });
    if (res.ok) {
      const cfg = await res.json();
      setRequirePin(Boolean(cfg.requirePinOnLan));
      if (cfg.pinCode) setPinCode(cfg.pinCode);
    }
  };

  const handleRefreshPin = async () => {
    const res = await apiFetch('/api/auth/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regeneratePin: true }),
    });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.pinCode) setPinCode(cfg.pinCode);
    }
  };

  const handleRevokeDevices = async () => {
    const res = await apiFetch('/api/auth/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revokeDevices: true }),
    });
    if (res.ok) {
      loadQrInfo(selectedUrl || preferred?.url || window.location.origin);
      setRevokedMsg('已吊销旧设备令牌并刷新二维码，旧手机链接已失效');
      setTimeout(() => setRevokedMsg(null), 2600);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-[#EAEAEF]">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--ac-soft-hover)] text-[var(--ac-deep)]">
              <Smartphone className="h-5 w-5" />
            </div>
            <h3 className="text-[17px] font-bold text-[#1F2024]">手机扫码连接</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭手机扫码连接"
            className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          {endpoints.map((ep) => (
            <button
              key={ep.url}
              onClick={() => setSelectedUrl(ep.url)}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-2.5 text-left text-[13.5px] transition cursor-pointer ${
                selectedUrl === ep.url
                  ? 'border-[var(--ac-mid)] bg-[var(--ac-tint)] text-[#232429] font-medium'
                  : 'border-[#EAEAEF] bg-white text-[#6E717C] hover:bg-[#FAFAFC]'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {ep.kind === 'tailscale' ? (
                  <Globe className="h-4 w-4 text-[var(--ac-primary)]" />
                ) : (
                  <Wifi className="h-4 w-4 text-[#5BA97B]" />
                )}
                {ep.label}
              </span>
              <span className="font-mono text-[13px] text-[#8A8D98]">{ep.ip}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center justify-center rounded-2xl bg-[#F8F8FB] p-5 border border-[#EFEFF4]">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="扫码连接"
              className="h-44 w-44 rounded-2xl bg-white p-2.5 border border-[#EAEAEF]"
            />
          ) : (
            <div className="h-44 w-44 animate-pulse rounded-2xl bg-[#EAEAEF]" />
          )}

          <div className="mt-4 flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 border border-[#E5E5EC]">
            <code className="flex-1 truncate text-[12.5px] text-[#3C3E47]">{selectedUrl}</code>
            <button
              onClick={handleCopy}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--ac-primary)] px-3 text-[12.5px] font-medium text-white hover:bg-[var(--ac-hover)] cursor-pointer"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
        </div>

        {canManageSecurity && pinCode && (
          <div className="mt-4 rounded-2xl border border-[#EFEFF4] bg-[#FAFAFC] px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-[#2C2E35]">
                <Shield className="h-4 w-4 text-[var(--ac-primary)]" />
                <span>陌生设备需输入连接码</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={requirePin}
                aria-label="开启或关闭陌生设备连接码验证"
                onClick={() => void handleTogglePin()}
                className={`relative h-6 w-11 rounded-full transition cursor-pointer ${
                  requirePin ? 'bg-[var(--ac-primary)]' : 'bg-[#D6D6E0]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition ${
                    requirePin ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {requirePin && (
              <div className="flex items-center justify-between pt-2 border-t border-[#ECECF1] text-[13px]">
                <span className="text-[#7A7D89]">手机手动访问连接码（扫码自动免输）</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-white border border-[#E4E4EC] px-2.5 py-0.5 font-mono text-[15px] font-bold tracking-widest text-[#1F2024]">
                    {pinCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRefreshPin()}
                    aria-label="更换连接码"
                    title="更换连接码"
                    className="rounded-lg p-1 text-[#8A8D98] hover:bg-[#EFEFF4] cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-[#ECECF1]">
              <span className="text-[12px] text-[#8A8D98]">可随时使旧手机与旧二维码立即失效</span>
              <button
                type="button"
                onClick={() => void handleRevokeDevices()}
                className="rounded-lg border border-[#E5D7D5] bg-white px-2.5 py-1 text-[12px] font-medium text-[#A65850] hover:bg-[#FDF4F3] cursor-pointer"
              >
                撤销已配对设备
              </button>
            </div>

            {revokedMsg && (
              <div className="rounded-xl bg-[#EBF6F0] px-3 py-1.5 text-[12px] font-medium text-[#458964]">
                {revokedMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
