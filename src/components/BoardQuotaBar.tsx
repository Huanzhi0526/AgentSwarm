import React, { useEffect, useRef, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import type { EngineId, EngineStatusCard } from '../types';
import { EngineIcon } from './BrandIcon';
import { AccountSwitchModal } from './AccountSwitchModal';

interface BoardQuotaBarProps {
  engines: EngineStatusCard[];
  quotaUpdatedAt?: number | null;
  onRefreshQuota: (force: boolean) => Promise<void> | void;
}

export const BoardQuotaBar: React.FC<BoardQuotaBarProps> = ({
  engines,
  quotaUpdatedAt,
  onRefreshQuota,
}) => {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [switchEngine, setSwitchEngine] = useState<{
    id: Exclude<EngineId, 'demo'>;
    name: string;
  } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  const installedEngines = engines.filter((e) => e.installed);
  const agy = installedEngines.find((e) => e.id === 'antigravity');
  const codex = installedEngines.find((e) => e.id === 'codex');
  const codebuddy = installedEngines.find((e) => e.id === 'codebuddy');
  const primaryEngines = installedEngines.filter(
    (e) => e.quotaBars.length > 0 || e.id === 'codebuddy' || e.id === 'antigravity' || e.id === 'codex'
  );

  if (primaryEngines.length === 0) return null;

  const agy5h = agy?.quotaBars.find((b) => b.label.includes('Gemini 5h'))?.remainingPercent;
  const agyClaude5h = agy?.quotaBars.find((b) => b.label.includes('Claude 5h'))?.remainingPercent;
  const codex5h = codex?.quotaBars.find((b) => b.label === '5h')?.remainingPercent;
  const codexWeek = codex?.quotaBars.find((b) => b.label === '周')?.remainingPercent;

  // Never fabricate a fallback `100%` when no real numeric quota bar was loaded
  const primaryNumericPct =
    typeof agy5h === 'number' ? agy5h : typeof codex5h === 'number' ? codex5h : null;
  const hasOnlyCreditEngine =
    primaryNumericPct === null && Boolean(codebuddy) && !agy?.quotaBars.length && !codex?.quotaBars.length;

  const mobileLabel =
    primaryNumericPct !== null
      ? `${primaryNumericPct}%`
      : hasOnlyCreditEngine
        ? '积分制'
        : '额度';

  const updatedLabel = quotaUpdatedAt
    ? new Date(quotaUpdatedAt).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshQuota(true);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  return (
    <div ref={popRef} className="relative flex items-center">
      {/* Desktop Inline Live Quota Pills */}
      <div className="hidden md:flex items-center gap-2">
        {agy && typeof agy5h === 'number' && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title="点击查看详细额度与重置倒计时"
            className="inline-flex h-8.5 items-center gap-2 rounded-full border border-[#E6E5EE] bg-[#FAFAFC] px-3 text-[12.5px] text-[#3C3E47] hover:border-[var(--ac-border-strong)] hover:bg-[#F5F3FA] transition cursor-pointer"
          >
            <EngineIcon engine="antigravity" size={14} />
            <span>
              Gemini <strong className="font-semibold text-[var(--ac-deep)]">{agy5h}%</strong>
            </span>
            {typeof agyClaude5h === 'number' && (
              <>
                <span className="text-[#D2D3DC]">·</span>
                <span>
                  Claude <strong className="font-semibold text-[var(--ac-deep)]">{agyClaude5h}%</strong>
                </span>
              </>
            )}
          </button>
        )}

        {codex && typeof codex5h === 'number' && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title="点击查看详细额度与重置倒计时"
            className="inline-flex h-8.5 items-center gap-2 rounded-full border border-[#E6E5EE] bg-[#FAFAFC] px-3 text-[12.5px] text-[#3C3E47] hover:border-[var(--ac-border-strong)] hover:bg-[#F5F3FA] transition cursor-pointer"
          >
            <EngineIcon engine="codex" size={14} />
            <span>
              5h <strong className="font-semibold text-[var(--ac-deep)]">{codex5h}%</strong>
            </span>
            {typeof codexWeek === 'number' && (
              <>
                <span className="text-[#D2D3DC]">·</span>
                <span>
                  周 <strong className="font-semibold text-[var(--ac-deep)]">{codexWeek}%</strong>
                </span>
              </>
            )}
          </button>
        )}

        {primaryNumericPct === null && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-[#E6E5EE] bg-[#FAFAFC] px-3 text-[12.5px] font-medium text-[#3C3E47] hover:bg-[#F3F2F7] cursor-pointer"
          >
            <Gauge className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
            <span>{hasOnlyCreditEngine ? '积分计费' : '查看额度'}</span>
          </button>
        )}
      </div>

      {/* Mobile Compact Quota Pill */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="查看实时额度"
        aria-label="查看实时额度与账号"
        aria-expanded={open}
        className="inline-flex md:hidden h-7.5 min-[390px]:h-8 items-center gap-1 rounded-full border border-[#E6E6EC] bg-[#FAFAFC] px-2 min-[390px]:px-2.5 text-[11.5px] min-[390px]:text-[12px] font-semibold text-[var(--ac-text)] hover:bg-[#F3F2F7] cursor-pointer whitespace-nowrap"
      >
        <Gauge className="h-3.5 w-3.5 text-[var(--ac-primary)] flex-shrink-0" />
        <span>{mobileLabel}</span>
      </button>

      {/* Detailed Quota & Account Switch Popover (Centered on Mobile, Right-Anchored on Desktop) */}
      {open && (
        <div className="fixed left-3 right-3 top-15 sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+8px)] z-50 sm:w-[372px] rounded-3xl border border-[#E6E6EE] bg-white p-4 shadow-[0_12px_36px_rgba(20,20,35,0.14)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-[14px] font-bold text-[#1F2024]">实时额度与账号</span>
              {updatedLabel ? (
                <span className="ml-2 text-[11.5px] text-[#8E919C]">更新于 {updatedLabel}</span>
              ) : (
                <span className="ml-2 text-[11.5px] text-[#8E919C]">暂无比例数据</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-[var(--ac-deep)] hover:bg-[var(--ac-soft)] cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="space-y-3 max-h-[68vh] overflow-y-auto pr-0.5">
            {primaryEngines.map((eng) => (
              <div
                key={eng.id}
                className="rounded-2xl border border-[#ECECF2] bg-[#FAFAFC] p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <EngineIcon engine={eng.id} size={17} />
                    <span className="text-[13.5px] font-bold text-[#1F2024]">{eng.name}</span>
                    <span className="text-[11.5px] text-[#8A8D98] truncate">
                      {eng.activeAccountLabel || eng.vendorLabel}
                    </span>
                  </div>

                  {eng.supportsAccountSwitch && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setSwitchEngine({ id: eng.id, name: eng.name });
                      }}
                      className="rounded-full bg-white border border-[#E4E4EC] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--ac-deep)] hover:bg-[var(--ac-soft)] cursor-pointer flex-shrink-0"
                    >
                      切号
                    </button>
                  )}
                </div>

                {eng.quotaBars.length > 0 ? (
                  <div className="space-y-1.5 pt-0.5">
                    {eng.quotaBars.map((bar) => (
                      <div key={bar.label} className="flex items-center gap-2 text-[12px]">
                        <span className="w-[68px] font-medium text-[#3C3E47] truncate">
                          {bar.label}
                        </span>
                        <span className="w-11 text-[#8E919C] truncate">{bar.resetText}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-[#EAE9F2] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--ac-bar)]"
                            style={{ width: `${bar.remainingPercent}%` }}
                          />
                        </div>
                        <span className="w-9 text-right font-semibold text-[var(--ac-deep)]">
                          {bar.remainingPercent}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12px] text-[#529471] font-medium">
                    {eng.statusNote || '已安装'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <AccountSwitchModal
        engine={switchEngine?.id ?? null}
        engineName={switchEngine?.name ?? ''}
        onClose={() => setSwitchEngine(null)}
        onSwitched={() => void onRefreshQuota(false)}
      />
    </div>
  );
};
