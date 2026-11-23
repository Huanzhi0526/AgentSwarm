import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Smartphone,
  Wifi,
  Copy,
  Check,
  Globe,
  Shield,
  RefreshCw,
  Trash2,
  Lock,
  HelpCircle,
} from 'lucide-react';
import type { NetworkEndpoint, PairedDeviceSummary } from '../types';
import { apiFetch } from '../utils/api';

interface MobileConnectModalProps {
  open: boolean;
  onClose: () => void;
  endpoints: NetworkEndpoint[];
  canManageSecurity?: boolean;
  onConfigChanged?: () => void;
}

export const MobileConnectModal: React.FC<MobileConnectModalProps> = ({
  open,
  onClose,
  endpoints,
  canManageSecurity = true,
  onConfigChanged,
}) => {
  const remoteEndpoints = useMemo(() => {
    const lanFirst = endpoints.filter((e) => e.kind === 'lan');
    const vpnNext = endpoints.filter((e) => e.kind === 'tailscale');
    return [...lanFirst, ...vpnNext];
  }, [endpoints]);

  const [selectedUrl, setSelectedUrl] = useState(remoteEndpoints[0]?.url || '');
  const [pairUrl, setPairUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [remoteAccessEnabled, setRemoteAccessEnabled] = useState(false);
  const [allowedRemoteHost, setAllowedRemoteHost] = useState<string>('all');
  const [pinCode, setPinCode] = useState<string>('');
  const [pairedDevices, setPairedDevices] = useState<PairedDeviceSummary[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showTips, setShowTips] = useState(false);

  const selectedEp = remoteEndpoints.find((e) => e.url === selectedUrl) || remoteEndpoints[0] || null;

  const applyServerCfg = (data: {
    remoteAccessEnabled?: boolean;
    allowedRemoteHost?: string;
    pinCode?: string;
    pairedDevices?: PairedDeviceSummary[];
    qrDataUrl?: string;
    pairUrl?: string;
  }) => {
    if (typeof data.remoteAccessEnabled === 'boolean') {
      setRemoteAccessEnabled(data.remoteAccessEnabled);
    }
    if (typeof data.allowedRemoteHost === 'string') {
      setAllowedRemoteHost(data.allowedRemoteHost);
    }
    if (data.pinCode) setPinCode(data.pinCode);
    if (Array.isArray(data.pairedDevices)) setPairedDevices(data.pairedDevices);
    if (typeof data.qrDataUrl === 'string') setQrDataUrl(data.qrDataUrl);
    if (typeof data.pairUrl === 'string') setPairUrl(data.pairUrl);
  };

  const loadQrInfo = (target?: string) => {
    const base = target || remoteEndpoints[0]?.url || '';
    const qs = base ? `?url=${encodeURIComponent(base)}` : '';
    apiFetch(`/api/mobile-qr${qs}`)
      .then((r) => r.json())
      .then((data) => {
        applyServerCfg(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    setStatusMsg(null);
    const nextUrl =
      selectedUrl && remoteEndpoints.some((e) => e.url === selectedUrl)
        ? selectedUrl
        : remoteEndpoints[0]?.url || '';
    if (nextUrl !== selectedUrl) setSelectedUrl(nextUrl);
    loadQrInfo(nextUrl);
  }, [open, selectedUrl, remoteEndpoints]);

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

  const patchAuthConfig = async (
    payload: Record<string, unknown>,
    feedback?: string
  ) => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/auth/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const cfg = await res.json();
        applyServerCfg(cfg);
        loadQrInfo(selectedEp?.url || remoteEndpoints[0]?.url);
        onConfigChanged?.();
        if (feedback) {
          setStatusMsg(feedback);
          setTimeout(() => setStatusMsg(null), 2800);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRemoteAccess = async () => {
    const next = !remoteAccessEnabled;
    await patchAuthConfig(
      {
        remoteAccessEnabled: next,
        allowedRemoteHost: next && selectedEp ? selectedEp.ip : 'all',
      },
      next ? '已开启手机远程访问，需扫码或输入 4 位连接码配对' : '已关闭远程访问，当前仅允许本机连接'
    );
  };

  const handleSelectEndpoint = async (ep: NetworkEndpoint) => {
    setSelectedUrl(ep.url);
    if (remoteAccessEnabled && canManageSecurity && allowedRemoteHost !== 'all') {
      await patchAuthConfig({ allowedRemoteHost: ep.ip });
    }
  };

  const handleToggleHostScope = async () => {
    if (!selectedEp) return;
    const nextHost = allowedRemoteHost === 'all' ? selectedEp.ip : 'all';
    await patchAuthConfig(
      { allowedRemoteHost: nextHost },
      nextHost === 'all' ? '已开放全部可用局域网 / 组网地址' : `已限定仅监听 ${nextHost}`
    );
  };

  const handleCopy = () => {
    const textToCopy = pairUrl || selectedUrl;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-md max-h-[calc(100vh-28px)] flex flex-col rounded-3xl bg-white p-5 sm:p-6 shadow-2xl border border-[#EAEAEF] overflow-hidden">
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--ac-soft-hover)] text-[var(--ac-deep)]">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[17px] font-bold text-[#1F2024]">手机与跨设备连接</h3>
              <p className="text-[12px] text-[#7A7D89]">
                {remoteAccessEnabled ? '远程共享已开启 · 需扫码或连接码配对' : '当前仅监听电脑本机 (127.0.0.1)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭手机与跨设备连接窗口"
            className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3.5 pr-0.5">
          {/* Master Remote Access Switch */}
          {canManageSecurity && (
            <div className="rounded-2xl border border-[var(--ac-border-soft)] bg-[var(--ac-tint)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {remoteAccessEnabled ? (
                    <Shield className="h-4.5 w-4.5 text-[#458964] flex-shrink-0" />
                  ) : (
                    <Lock className="h-4.5 w-4.5 text-[var(--ac-primary)] flex-shrink-0" />
                  )}
                  <div>
                    <div className="text-[13.5px] font-semibold text-[#1F2024]">
                      允许手机 / 其他设备访问
                    </div>
                    <div className="text-[11.5px] text-[#6E717C] mt-0.5">
                      {remoteAccessEnabled
                        ? '已绑定所选网卡，未配对设备将被拒绝'
                        : '默认仅限本机使用，开启后才会开放局域网端口'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  disabled={busy}
                  aria-checked={remoteAccessEnabled}
                  aria-label="开启或关闭手机及跨设备访问"
                  onClick={() => void handleToggleRemoteAccess()}
                  className={`relative h-6 w-11 rounded-full transition flex-shrink-0 cursor-pointer disabled:opacity-50 ${
                    remoteAccessEnabled ? 'bg-[var(--ac-primary)]' : 'bg-[#D6D6E0]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition ${
                      remoteAccessEnabled ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {!canManageSecurity && (
            <div className="rounded-2xl border border-[#EFE2CE] bg-[#FCF7EF] px-4 py-3 text-[12.5px] text-[#8E5F24]">
              远程设备安全设置与设备撤销仅支持在电脑本机操作。
            </div>
          )}

          {statusMsg && (
            <div className="rounded-xl bg-[#EAF5EE] border border-[#CBE6D5] px-3.5 py-2 text-[12px] font-medium text-[#3B7A57]">
              {statusMsg}
            </div>
          )}

          {!remoteAccessEnabled ? (
            <div className="rounded-2xl border border-[#EFEFF4] bg-[#F8F8FB] p-4 space-y-2 text-[12.5px] text-[#5E616D]">
              <div className="font-semibold text-[#232429]">安全说明</div>
              <p className="leading-relaxed">
                AgentSwarm 默认仅监听电脑本机 <code className="rounded bg-white px-1.5 py-0.5 border border-[#E6E6EE]">127.0.0.1</code>，同网络下的其他设备无法读取您的会话或项目目录。
              </p>
              <p className="leading-relaxed">
                仅当您需要在手机上查看进展或发消息时，开启上方开关，再使用手机微信/系统相机扫描下方二维码即可配对连接。
              </p>
            </div>
          ) : (
            <>
              {/* Reachable Remote Endpoints */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[12px] text-[#7A7D89] px-0.5">
                  <span>选择手机可访问的网络地址</span>
                  {selectedEp && canManageSecurity && remoteEndpoints.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleToggleHostScope()}
                      className="text-[11.5px] font-medium text-[var(--ac-deep)] hover:underline cursor-pointer"
                    >
                      {allowedRemoteHost === 'all' ? '当前：开放全部' : `当前：仅限 ${allowedRemoteHost}`}
                    </button>
                  )}
                </div>

                {remoteEndpoints.length === 0 ? (
                  <div className="rounded-2xl border border-[#EFE2CE] bg-[#FCF7EF] px-4 py-3 text-[12.5px] text-[#8E5F24]">
                    暂未检测到局域网（Wi-Fi/以太网）或异地组网 IP。请确认电脑已连网，本机地址 <code className="font-mono">127.0.0.1</code> 仅供当前电脑自身使用。
                  </div>
                ) : (
                  remoteEndpoints.map((ep) => {
                    const isLan = ep.kind === 'lan';
                    const selected = selectedEp?.url === ep.url;
                    return (
                      <button
                        type="button"
                        key={ep.url}
                        onClick={() => void handleSelectEndpoint(ep)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-3.5 py-2.5 text-left text-[13px] transition cursor-pointer ${
                          selected
                            ? 'border-[var(--ac-mid)] bg-[var(--ac-tint)] text-[#232429] font-medium'
                            : 'border-[#EAEAEF] bg-white text-[#6E717C] hover:bg-[#FAFAFC]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            {isLan ? (
                              <Wifi className="h-4 w-4 text-[#5BA97B] flex-shrink-0" />
                            ) : (
                              <Globe className="h-4 w-4 text-[var(--ac-primary)] flex-shrink-0" />
                            )}
                            <span className="truncate">{ep.label}</span>
                          </div>
                          <div className="text-[11px] text-[#8A8D98] mt-0.5 pl-6">
                            {isLan
                              ? '同一 Wi-Fi 下手机可直接扫码访问'
                              : '异地组网地址（需手机与电脑登录同一 Tailscale/ZeroTier）'}
                          </div>
                        </div>
                        <span className="font-mono text-[12.5px] text-[#6E717C] flex-shrink-0">
                          {ep.ip}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* QR Code & Pair URL */}
              {remoteEndpoints.length > 0 && selectedEp && (
                <div className="flex flex-col items-center justify-center rounded-2xl bg-[#F8F8FB] p-4 border border-[#EFEFF4]">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="手机扫码配对二维码"
                      className="h-40 w-40 rounded-2xl bg-white p-2 border border-[#EAEAEF]"
                    />
                  ) : (
                    <div className="h-40 w-40 animate-pulse rounded-2xl bg-[#EAEAEF]" />
                  )}

                  <div className="mt-3 flex w-full items-center gap-2 rounded-xl bg-white px-3 py-1.5 border border-[#E5E5EC]">
                    <code className="flex-1 truncate text-[12px] text-[#3C3E47]">
                      {selectedEp.url}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex h-7.5 items-center gap-1 rounded-lg bg-[var(--ac-primary)] px-2.5 text-[12px] font-medium text-white hover:bg-[var(--ac-hover)] cursor-pointer flex-shrink-0"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? '已复制配对链接' : '复制配对链接'}
                    </button>
                  </div>
                </div>
              )}

              {/* 4-Digit PIN & Paired Devices List */}
              {canManageSecurity && pinCode && (
                <div className="rounded-2xl border border-[#EFEFF4] bg-[#FAFAFC] px-4 py-3 space-y-2.5">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-[#5E616D]">手动输入地址时的 4 位连接码</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-white border border-[#E4E4EC] px-2.5 py-0.5 font-mono text-[15px] font-bold tracking-widest text-[#1F2024]">
                        {pinCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => void patchAuthConfig({ regeneratePin: true }, '已更新 4 位连接码')}
                        aria-label="更换连接码"
                        title="更换连接码"
                        className="rounded-lg p-1 text-[#8A8D98] hover:bg-[#EFEFF4] cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Paired Devices */}
                  <div className="pt-2 border-t border-[#ECECF1] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-[#5E616D]">
                        已配对设备（{pairedDevices.length}）
                      </span>
                      {pairedDevices.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            void patchAuthConfig(
                              { revokeDevices: true },
                              '已撤销全部已配对设备并刷新二维码令牌'
                            )
                          }
                          className="rounded-lg border border-[#E5D7D5] bg-white px-2.5 py-0.5 text-[11.5px] font-medium text-[#A65850] hover:bg-[#FDF4F3] cursor-pointer"
                        >
                          全部撤销
                        </button>
                      )}
                    </div>

                    {pairedDevices.length === 0 ? (
                      <div className="text-[11.5px] text-[#8A8D98]">
                        暂无已配对手机或远程浏览器；扫码或验证连接码后将列在此处。
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {pairedDevices.map((dev) => (
                          <div
                            key={dev.id}
                            className="flex items-center justify-between gap-2 rounded-xl border border-[#ECECF2] bg-white px-2.5 py-1.5 text-[12px]"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-[#232429] truncate">{dev.label}</div>
                              <div className="text-[11px] font-mono text-[#8A8D98]">{dev.ip}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                void patchAuthConfig(
                                  { revokeDeviceId: dev.id },
                                  `已移除设备 ${dev.label}`
                                )
                              }
                              aria-label={`移除已配对设备 ${dev.label}`}
                              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] text-[#A65850] hover:bg-[#FDF4F3] cursor-pointer flex-shrink-0"
                            >
                              <Trash2 className="h-3 w-3" /> 移除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Troubleshooting & Security Caveats */}
              <div className="rounded-2xl border border-[#EAEAEF] bg-white px-3.5 py-2.5">
                <button
                  type="button"
                  onClick={() => setShowTips((v) => !v)}
                  className="flex w-full items-center justify-between text-[12px] font-medium text-[#555866] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
                    连不上或安全注意事项
                  </span>
                  <span className="text-[#8A8D98]">{showTips ? '收起' : '展开'}</span>
                </button>
                {showTips && (
                  <ul className="mt-2 space-y-1 text-[11.5px] text-[#6E717C] list-disc pl-4 leading-relaxed">
                    <li>手机与电脑需连接同一路由器 Wi-Fi（路由器需未开启 AP 隔离），或在两台设备登录同一异地组网账号。</li>
                    <li>首次开启共享时若 Windows 弹出防火墙提醒，请勾选「专用网络」允许通过；公共 Wi-Fi 下建议关闭本共享。</li>
                    <li>请勿将 25880 端口通过路由器端口映射直接暴露到公网。不需要手机访问时随时关闭上方开关即可立即断开。</li>
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
