import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Users,
  Cpu,
  MessageSquare,
  GitFork,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  SlidersHorizontal,
  Plug,
} from 'lucide-react';
import type { EngineId, HeatmapCell, ReasoningEffort, WorkbenchOverview } from '../types';
import { formatCompactTokens } from '../utils/format';
import { EngineIcon } from './BrandIcon';
import { AccountSwitchModal } from './AccountSwitchModal';
import { SelectMenu } from './SelectMenu';

interface WorkbenchViewProps {
  overview: WorkbenchOverview | null;
  onStartPreset: (presetId: string) => void;
  onRefresh: (forceQuota?: boolean) => void;
  onOpenDispatchSettings?: () => void;
  onOpenDesktopMcp?: () => void;
  onSaveEngineDefault?: (
    engineId: Exclude<EngineId, 'demo'>,
    modelId: string,
    reasoningEffort: ReasoningEffort
  ) => Promise<void>;
  onResetEngineDefault?: (engineId: Exclude<EngineId, 'demo'>) => Promise<void>;
}

const HEATMAP_COLORS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-[#EDECF2]',
  1: 'bg-[var(--hm-1)]',
  2: 'bg-[var(--hm-2)]',
  3: 'bg-[var(--hm-3)]',
  4: 'bg-[var(--hm-4)]',
};

export const WorkbenchView: React.FC<WorkbenchViewProps> = ({
  overview,
  onStartPreset,
  onRefresh,
  onOpenDispatchSettings,
  onOpenDesktopMcp,
  onSaveEngineDefault,
  onResetEngineDefault,
}) => {
  const [switchModalEngine, setSwitchModalEngine] = useState<{
    id: Exclude<EngineId, 'demo'>;
    name: string;
  } | null>(null);
  const [engineFilter, setEngineFilter] = useState<'all' | 'installed'>('all');
  const [savedDefaultEngineId, setSavedDefaultEngineId] = useState<string | null>(null);
  const savedDefaultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredHeatmap, setHoveredHeatmap] = useState<{
    cell: HeatmapCell;
    leftPx: number;
    topPx: number;
  } | null>(null);
  const [selectedCellIndex, setSelectedCellIndex] = useState<number | null>(null);
  const heatmapCardRef = useRef<HTMLDivElement | null>(null);
  const desktopCellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileCellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    return () => {
      if (savedDefaultTimerRef.current) {
        clearTimeout(savedDefaultTimerRef.current);
      }
    };
  }, []);

  if (!overview) {
    return (
      <div className="flex flex-1 items-center justify-center p-12 text-[15px] text-[#8A8D98]">
        加载工作台数据中...
      </div>
    );
  }

  const updateTooltipForElement = (cell: HeatmapCell, idx: number, el: HTMLElement) => {
    setSelectedCellIndex(idx);
    const cardRect = heatmapCardRef.current?.getBoundingClientRect();
    const cellRect = el.getBoundingClientRect();
    if (!cardRect) return;
    const rawCenter = cellRect.left - cardRect.left + cellRect.width / 2;
    const clampedLeft = Math.max(128, Math.min(cardRect.width - 128, rawCenter));
    const topPx = Math.max(8, cellRect.top - cardRect.top - 8);
    setHoveredHeatmap({ cell, leftPx: clampedLeft, topPx });
  };

  const handleHeatmapKeyDown = (
    e: React.KeyboardEvent,
    globalIdx: number,
    totalLen: number,
    isMobile: boolean
  ) => {
    let next = globalIdx;
    if (e.key === 'ArrowRight') next = Math.min(totalLen - 1, globalIdx + 7);
    else if (e.key === 'ArrowLeft') next = Math.max(0, globalIdx - 7);
    else if (e.key === 'ArrowDown') next = Math.min(totalLen - 1, globalIdx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, globalIdx - 1);
    else return;

    e.preventDefault();
    const refs = isMobile ? mobileCellRefs.current : desktopCellRefs.current;
    const targetBtn = refs[next];
    if (targetBtn) {
      targetBtn.focus();
    }
  };

  const allColumns: typeof overview.heatmap[] = [];
  for (let i = 0; i < overview.heatmap.length; i += 7) {
    allColumns.push(overview.heatmap.slice(i, i + 7));
  }
  const mobileOffset = Math.max(0, overview.heatmap.length - 15 * 7);
  const mobileColumns = allColumns.slice(-15);

  const activeCell =
    hoveredHeatmap?.cell ||
    (selectedCellIndex !== null ? overview.heatmap[selectedCellIndex] : null) ||
    overview.heatmap[overview.heatmap.length - 1];

  const readyEnginesCount = overview.engines.filter((e) => e.installed).length;
  const visibleEngines =
    engineFilter === 'installed'
      ? overview.engines.filter((e) => e.installed)
      : overview.engines;

  return (
    <div className="flex-1 overflow-y-auto px-3.5 py-4 sm:px-7 sm:py-6 bg-[#F6F6F9]">
      <div className="mx-auto max-w-6xl space-y-5 sm:space-y-7">
        {onOpenDesktopMcp && (
          <section className="rounded-3xl bg-white px-4 py-3.5 sm:px-6 sm:py-4 shadow-[0_2px_12px_rgba(20,20,35,0.03)] border border-[#EAEAEF] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center -space-x-1.5 flex-shrink-0">
                {(['antigravity', 'codex', 'codebuddy', 'claude'] as const).map((eid) => (
                  <span
                    key={eid}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FAFAFC] border border-[#EAEAEF]"
                  >
                    <EngineIcon engine={eid} size={17} />
                  </span>
                ))}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14.5px] sm:text-[15px] font-bold text-[#1F2024]">
                    桌面端主管直驱（MCP 协同）
                  </span>
                  <span className="rounded-md bg-[var(--ac-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ac-deep)]">
                    零轮询双模
                  </span>
                </div>
                <p className="text-[12px] sm:text-[12.5px] text-[#7A7D89] mt-0.5">
                  一键接入后，可直接在 Antigravity / CodeX / CodeBuddy / Claude Code 中指挥看板团队，与网页直驱模式并行不冲突。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenDesktopMcp}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--ac-hover)] transition flex-shrink-0 cursor-pointer"
            >
              <Plug className="h-3.5 w-3.5" />
              <span>桌面端 MCP 接入</span>
            </button>
          </section>
        )}

        {/* 1. Activity Heatmap Card */}
        <section
          ref={heatmapCardRef}
          onMouseLeave={() => setHoveredHeatmap(null)}
          className="relative rounded-3xl bg-white p-4 sm:p-6 shadow-[0_2px_12px_rgba(20,20,35,0.03)] border border-[#EAEAEF]"
        >
          {/* Instant Custom Hover Tooltip for Daily Usage */}
          {hoveredHeatmap && (
            <div
              style={{ left: hoveredHeatmap.leftPx, top: hoveredHeatmap.topPx }}
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full rounded-2xl bg-[#23242C] px-3.5 py-2 text-white shadow-[0_8px_24px_rgba(15,16,24,0.22)] whitespace-nowrap"
            >
              <div className="text-[11.5px] text-[#B8BAC7] font-mono">
                {hoveredHeatmap.cell.date}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[12.5px] font-semibold">
                <span>
                  当日用量：
                  {hoveredHeatmap.cell.tokens > 0
                    ? `${formatCompactTokens(hoveredHeatmap.cell.tokens)} Tokens`
                    : '0 (无消耗)'}
                </span>
                {hoveredHeatmap.cell.count > 0 && (
                  <span className="text-[var(--ac-border-strong)] font-normal">
                    · {hoveredHeatmap.cell.count} 次记录
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-3.5 sm:mb-5">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-[var(--ac-icon)]" />
              <h2 className="text-[16px] sm:text-[17px] font-bold text-[#1F2024]">活跃热力图</h2>
            </div>
            <button
              type="button"
              onClick={() => onRefresh(true)}
              aria-label="刷新实时额度与热力数据"
              title="刷新实时额度与热力数据"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-[#7A7D89] hover:bg-[#F3F2F7] hover:text-[#1F2024] transition cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile 15x7 Accessible Grid */}
          <div className="grid grid-cols-15 gap-1.5 sm:hidden">
            {mobileColumns.map((col, ci) => (
              <div key={ci} className="grid grid-rows-7 gap-1.5">
                {col.map((cell, ri) => {
                  const globalIdx = mobileOffset + ci * 7 + ri;
                  const isActive = hoveredHeatmap?.cell.date === cell.date || selectedCellIndex === globalIdx;
                  return (
                    <button
                      type="button"
                      ref={(el) => {
                        mobileCellRefs.current[globalIdx] = el;
                      }}
                      key={cell.date}
                      aria-label={`${cell.date}，当日用量 ${
                        cell.tokens > 0 ? `${formatCompactTokens(cell.tokens)} Tokens` : '0'
                      }`}
                      onMouseEnter={(e) => updateTooltipForElement(cell, globalIdx, e.currentTarget)}
                      onFocus={(e) => updateTooltipForElement(cell, globalIdx, e.currentTarget)}
                      onClick={(e) => updateTooltipForElement(cell, globalIdx, e.currentTarget)}
                      onKeyDown={(e) => handleHeatmapKeyDown(e, globalIdx, overview.heatmap.length, true)}
                      className={`aspect-square w-full rounded-[4px] transition-transform cursor-pointer focus:outline-none ${
                        HEATMAP_COLORS[cell.level]
                      } ${isActive ? 'ring-2 ring-[var(--ac-primary)] ring-offset-1 scale-110 z-10' : ''}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Mobile Accessible Touch Date Strip for Small Viewports */}
          {activeCell && (
            <div className="mt-3 flex sm:hidden items-center justify-between gap-2 rounded-xl bg-[#F8F8FB] border border-[#EFEFF4] px-2.5 py-1.5 text-[12px]">
              <button
                type="button"
                aria-label="前一天热力数据"
                onClick={() => {
                  const cur = selectedCellIndex ?? overview.heatmap.length - 1;
                  const nextIdx = Math.max(0, cur - 1);
                  setSelectedCellIndex(nextIdx);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-[#E6E6EE] text-[#4B4D57]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <div className="text-center truncate">
                <span className="font-mono text-[#6E717C]">{activeCell.date}</span>
                <span className="mx-1.5 text-[#D2D3DC]">·</span>
                <span className="font-semibold text-[var(--ac-text)]">
                  {activeCell.tokens > 0 ? formatCompactTokens(activeCell.tokens) : '0'}
                </span>
              </div>
              <button
                type="button"
                aria-label="后一天热力数据"
                onClick={() => {
                  const cur = selectedCellIndex ?? overview.heatmap.length - 1;
                  const nextIdx = Math.min(overview.heatmap.length - 1, cur + 1);
                  setSelectedCellIndex(nextIdx);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-[#E6E6EE] text-[#4B4D57]"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Desktop / Tablet 18x7 Accessible Grid */}
          <div className="hidden sm:grid grid-cols-18 gap-2">
            {allColumns.map((col, ci) => (
              <div key={ci} className="grid grid-rows-7 gap-2">
                {col.map((cell, ri) => {
                  const globalIdx = ci * 7 + ri;
                  const isActive = hoveredHeatmap?.cell.date === cell.date;
                  return (
                    <button
                      type="button"
                      ref={(el) => {
                        desktopCellRefs.current[globalIdx] = el;
                      }}
                      key={cell.date}
                      aria-label={`${cell.date}，当日用量 ${
                        cell.tokens > 0 ? `${formatCompactTokens(cell.tokens)} Tokens` : '0'
                      }`}
                      onMouseEnter={(e) => updateTooltipForElement(cell, globalIdx, e.currentTarget)}
                      onFocus={(e) => updateTooltipForElement(cell, globalIdx, e.currentTarget)}
                      onKeyDown={(e) => handleHeatmapKeyDown(e, globalIdx, overview.heatmap.length, false)}
                      className={`h-[18px] w-full rounded-[5px] transition-transform cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--ac-primary)] focus:ring-offset-1 ${
                        HEATMAP_COLORS[cell.level]
                      } ${isActive ? 'ring-2 ring-[var(--ac-primary)] ring-offset-1 scale-110 z-10' : ''}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* 4 Metric Cards */}
          <div className="mt-4 sm:mt-5 grid grid-cols-4 gap-1.5 sm:gap-3.5">
            <div className="rounded-2xl bg-[#F8F8FB] px-2 py-2.5 sm:px-4 sm:py-3.5 border border-[#EFEFF4]">
              <div className="text-[11px] sm:text-[13px] text-[#7A7D89] whitespace-nowrap">今日消耗</div>
              <div className="mt-1 text-[13.5px] sm:text-[21px] font-bold tracking-tight text-[var(--ac-bar)] whitespace-nowrap">
                {formatCompactTokens(overview.todayTokens)}
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8F8FB] px-2 py-2.5 sm:px-4 sm:py-3.5 border border-[#EFEFF4]">
              <div className="text-[11px] sm:text-[13px] text-[#7A7D89] whitespace-nowrap">累计消耗</div>
              <div className="mt-1 text-[13.5px] sm:text-[21px] font-bold tracking-tight text-[#1F2024] whitespace-nowrap">
                {formatCompactTokens(overview.cumulativeTokens)}
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8F8FB] px-2 py-2.5 sm:px-4 sm:py-3.5 border border-[#EFEFF4]">
              <div className="text-[11px] sm:text-[13px] text-[#7A7D89] whitespace-nowrap">缓存命中</div>
              <div
                className={`mt-1 font-bold tracking-tight whitespace-nowrap ${
                  overview.cacheHitRate === null
                    ? 'text-[12px] sm:text-[16px] text-[#8E919C] pt-0.5 sm:pt-1'
                    : 'text-[13.5px] sm:text-[21px] text-[#1F2024]'
                }`}
              >
                {overview.cacheHitRate === null ? '暂无数据' : `${overview.cacheHitRate}%`}
              </div>
            </div>
            <div className="rounded-2xl bg-[#F8F8FB] px-2 py-2.5 sm:px-4 sm:py-3.5 border border-[#EFEFF4]">
              <div className="flex items-center gap-1 text-[11px] sm:text-[13px] text-[#7A7D89] whitespace-nowrap">
                <span>对话轮次</span>
                {overview.turnsAreEstimated && (
                  <span className="hidden sm:inline rounded bg-[#EFEFF4] px-1.5 py-0.2 text-[10px] text-[#7A7D89]">
                    估算
                  </span>
                )}
              </div>
              <div className="mt-1 text-[13.5px] sm:text-[21px] font-bold tracking-tight text-[#1F2024] whitespace-nowrap">
                {overview.totalTurns.toLocaleString()}
              </div>
            </div>
          </div>
        </section>

        {/* 2. Expert Teams */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4 px-1">
            <div className="flex items-center gap-2">
              <Users className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-[var(--ac-icon)]" />
              <h2 className="text-[16px] sm:text-[17px] font-bold text-[#1F2024]">专家团队</h2>
            </div>
            <div className="flex items-center gap-2">
              {onOpenDispatchSettings && (
                <button
                  type="button"
                  onClick={onOpenDispatchSettings}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--ac-border-soft)] bg-white px-3 text-[12.5px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-tint)] transition cursor-pointer"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>分工偏好</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onStartPreset('fullstack-dev')}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--ac-soft-hover)] px-3.5 text-[12.5px] sm:text-[13px] font-medium text-[var(--ac-hover)] hover:bg-[var(--ac-border-soft)] transition cursor-pointer"
              >
                选择团队模板 <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory pb-1 lg:grid lg:grid-cols-3 lg:overflow-visible">
            {overview.presets.map((preset, idx) => (
              <div
                key={preset.id}
                className={`w-[80vw] max-w-[300px] snap-start flex-shrink-0 lg:w-auto lg:max-w-none flex flex-col justify-between rounded-3xl bg-white p-4.5 sm:p-6 shadow-[0_2px_12px_rgba(20,20,35,0.03)] border transition ${
                  idx === 0 ? 'border-[var(--ac-border-strong)]' : 'border-[#EAEAEF]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--ac-soft)] text-[var(--ac-bubble)]">
                        <GitFork className="h-4.5 w-4.5" />
                      </span>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[15px] sm:text-[16px] font-bold text-[#1F2024] truncate">
                          {preset.name}
                        </span>
                        <span className="rounded-lg bg-[#F2F2F6] px-2 py-0.5 text-[11.5px] text-[#7A7D89] flex-shrink-0">
                          {preset.badge}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onStartPreset(preset.id)}
                      className="inline-flex h-8.5 items-center gap-1.5 rounded-full bg-[var(--ac-primary)] px-3.5 text-[12.5px] sm:text-[13px] font-semibold text-white hover:bg-[var(--ac-hover)] transition flex-shrink-0 cursor-pointer"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> 开启
                    </button>
                  </div>

                  <p className="mt-3 text-[13.5px] sm:text-[14px] text-[#6E717C]">{preset.description}</p>

                  <div className="mt-3.5 flex flex-wrap gap-1.5 sm:gap-2">
                    {preset.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-xl bg-[var(--ac-soft)] px-2.5 py-1 text-[12px] sm:text-[13px] font-medium text-[#3C3E47]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 sm:mt-5 pt-3 border-t border-[#F1F1F5] flex items-center justify-between text-[12.5px] sm:text-[13px]">
                  <span className="inline-flex items-center gap-1.5 text-[#529471] font-medium">
                    <span className="h-2 w-2 rounded-full bg-[#5BA97B]" />
                    {preset.members.length} 位成员职能
                  </span>
                  <button
                    type="button"
                    onClick={() => onStartPreset(preset.id)}
                    className="text-[var(--ac-primary)] font-medium hover:underline cursor-pointer"
                  >
                    配置成员
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 3. Agent Engine Dashboard (All 20 AionUi-Supported Engines + Honest Status & Real Quota Bars) */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4 px-1">
            <div className="flex items-center gap-2">
              <Cpu className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-[var(--ac-icon)]" />
              <h2 className="text-[16px] sm:text-[17px] font-bold text-[#1F2024]">智能体看板</h2>
            </div>

            <div className="flex items-center gap-1 rounded-full bg-[#ECEBF2] p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => setEngineFilter('all')}
                className={`rounded-full px-3 py-1 font-medium transition cursor-pointer ${
                  engineFilter === 'all' ? 'bg-white text-[#1F2024] shadow-2xs' : 'text-[#6E717C]'
                }`}
              >
                全部 ({overview.engines.length})
              </button>
              <button
                type="button"
                onClick={() => setEngineFilter('installed')}
                className={`rounded-full px-3 py-1 font-medium transition cursor-pointer ${
                  engineFilter === 'installed' ? 'bg-white text-[#1F2024] shadow-2xs' : 'text-[#6E717C]'
                }`}
              >
                已安装 ({readyEnginesCount})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4">
            {visibleEngines.map((eng, engIdx) => {
              const dotCls = !eng.installed
                ? 'bg-[#C8C9D2]'
                : eng.isActivelyWorking
                  ? 'bg-[var(--ac-primary)] animate-pulse'
                  : 'bg-[#5BA97B]';

              const activeModObj =
                eng.availableModels.find((m) => m.id === eng.defaultModel) ||
                eng.availableModels[0];
              const effortOptions = activeModObj?.efforts?.length
                ? activeModObj.efforts
                : ['low', 'medium', 'high'];
              const currentEffort = eng.defaultEffort || activeModObj?.defaultEffort || effortOptions[0] || 'high';

              const persistEngineDefault = async (
                nextModel: string,
                nextEff: ReasoningEffort
              ) => {
                if (!onSaveEngineDefault) return;
                if (savedDefaultTimerRef.current) {
                  clearTimeout(savedDefaultTimerRef.current);
                }
                setSavedDefaultEngineId(eng.id);
                savedDefaultTimerRef.current = setTimeout(() => {
                  setSavedDefaultEngineId((cur) => (cur === eng.id ? null : cur));
                }, 8000);
                await onSaveEngineDefault(eng.id, nextModel, nextEff);
              };

              return (
                <div
                  key={eng.id}
                  className={`flex flex-col justify-between rounded-3xl bg-white p-3.5 sm:p-6 shadow-[0_2px_12px_rgba(20,20,35,0.03)] border transition ${
                    eng.installed ? 'border-[#EAEAEF]' : 'border-[#EFEFF4] opacity-80 hover:opacity-100'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
                        <div className="sm:hidden flex-shrink-0 pt-0.5">
                          <EngineIcon engine={eng.id} size={18} />
                        </div>
                        <div className="hidden sm:flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#F7F7FA] border border-[#EFEFF4]">
                          <EngineIcon engine={eng.id} size={23} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-[13.5px] sm:text-[16px] font-bold text-[#1F2024] truncate">
                              {eng.name}
                            </h3>
                            <span className={`hidden sm:inline-block h-2 w-2 rounded-full flex-shrink-0 ${dotCls}`} />
                          </div>
                          <div
                            className={`mt-0.5 flex items-center gap-1 text-[11px] sm:text-[13px] font-medium ${
                              eng.isActivelyWorking
                                ? 'text-[var(--ac-deep)]'
                                : eng.installed
                                  ? 'text-[#529471]'
                                  : 'text-[#8E919C]'
                            }`}
                          >
                            <span className={`sm:hidden h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotCls}`} />
                            <span>{eng.stateLabel}</span>
                          </div>
                        </div>
                      </div>

                      {eng.supportsAccountSwitch && (
                        <button
                          type="button"
                          onClick={() => setSwitchModalEngine({ id: eng.id, name: eng.name })}
                          className="inline-flex h-6 sm:h-7 items-center gap-0.5 sm:gap-1 rounded-full bg-[#F4F3F8] px-1.5 sm:px-3 text-[10.5px] sm:text-[12px] font-medium text-[var(--ac-deep)] hover:bg-[var(--ac-border-soft)] transition flex-shrink-0 cursor-pointer whitespace-nowrap"
                        >
                          <RefreshCw className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> 切号
                        </button>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[11.5px] sm:text-[13px] text-[#7A7D89]">
                      <span className="truncate">{eng.vendorLabel}</span>
                      {eng.activeAccountLabel && (
                        <span className="hidden sm:inline text-[12px] text-[#8E919C]">
                          {eng.activeAccountLabel}
                        </span>
                      )}
                    </div>

                    {eng.quotaBars.length > 0 ? (
                      <div className="mt-2.5 sm:mt-3.5 space-y-2">
                        {eng.quotaBars.map((bar) => (
                          <div
                            key={bar.label}
                            className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-[12.5px]"
                          >
                            <span className="w-14 sm:w-[70px] font-medium text-[#3C3E47] truncate">
                              {bar.label}
                            </span>
                            <span className="hidden sm:inline w-12 text-[#8E919C] truncate">
                              {bar.resetText}
                            </span>
                            <div className="flex-1 h-1.5 sm:h-2 rounded-full bg-[#F0EFF5] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--ac-bar)]"
                                style={{ width: `${bar.remainingPercent}%` }}
                              />
                            </div>
                            <span className="w-8 sm:w-10 text-right font-semibold text-[var(--ac-icon)]">
                              {bar.remainingPercent}%
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 sm:mt-4 flex items-center gap-1.5 text-[11.5px] sm:text-[13px]">
                        <span
                          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                            eng.installed ? 'bg-[#5BA97B]' : 'bg-[#C8C9D2]'
                          }`}
                        />
                        <span className={eng.installed ? 'text-[#529471] font-medium' : 'text-[#9A9DA8]'}>
                          {eng.statusNote || (eng.installed ? '已安装' : '本机未安装')}
                        </span>
                      </div>
                    )}

                    {/* Per-Engine Preconfigured Default Model & Native Reasoning Effort */}
                    {onSaveEngineDefault && eng.availableModels.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-[#F3F3F7]">
                        <div className="flex items-center justify-between gap-1 mb-1.5 text-[11px] sm:text-[12px]">
                          <span className="text-[#7A7D89] truncate">默认模型与思考</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {savedDefaultEngineId === eng.id && (
                              <span className="text-[#458964] font-medium whitespace-nowrap">已保存</span>
                            )}
                            {eng.hasCustomDefault && onResetEngineDefault && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (savedDefaultTimerRef.current) {
                                    clearTimeout(savedDefaultTimerRef.current);
                                    savedDefaultTimerRef.current = null;
                                  }
                                  setSavedDefaultEngineId((cur) => (cur === eng.id ? null : cur));
                                  void onResetEngineDefault(eng.id);
                                }}
                                className="text-[var(--ac-primary)] hover:underline whitespace-nowrap cursor-pointer"
                              >
                                恢复默认
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-1.5">
                          <SelectMenu
                            size="sm"
                            align={engIdx % 2 === 1 ? 'right' : 'left'}
                            className="flex-1 min-w-0"
                            ariaLabel={`${eng.name} 默认模型`}
                            value={eng.defaultModel}
                            options={eng.availableModels.map((m) => ({
                              value: m.id,
                              label: m.label,
                            }))}
                            onChange={(nextModId) => {
                              const nextMod =
                                eng.availableModels.find((m) => m.id === nextModId) ||
                                eng.availableModels[0];
                              const nextValidEffs = nextMod?.efforts?.length
                                ? nextMod.efforts
                                : ['low', 'medium', 'high'];
                              const nextEff = nextValidEffs.includes(currentEffort)
                                ? currentEffort
                                : nextMod?.defaultEffort || nextValidEffs[0] || 'high';
                              void persistEngineDefault(nextModId, nextEff);
                            }}
                          />
                          <SelectMenu
                            size="sm"
                            align="right"
                            className="w-full sm:w-[104px] flex-shrink-0"
                            ariaLabel={`${eng.name} 默认思考强度`}
                            value={currentEffort}
                            options={effortOptions.map((eff) => ({
                              value: eff,
                              label: eff,
                            }))}
                            onChange={(nextEff) => {
                              void persistEngineDefault(eng.defaultModel, nextEff);
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-3.5 sm:mt-4 pt-2.5 sm:pt-3 border-t border-[#F1F1F5] flex items-center justify-between text-[12.5px] sm:text-[15px]">
                    <span className="font-bold text-[var(--ac-bar)]">
                      {formatCompactTokens(eng.totalTokensEstimated)}
                    </span>
                    <span className="font-bold text-[#1F2024]">
                      {eng.turnCountEstimated.toLocaleString()}轮
                      {eng.statsAreEstimated && (
                        <span className="ml-1 text-[10.5px] font-normal text-[#8E919C]">估</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <AccountSwitchModal
        engine={switchModalEngine?.id ?? null}
        engineName={switchModalEngine?.name ?? ''}
        onClose={() => setSwitchModalEngine(null)}
        onSwitched={() => onRefresh(false)}
      />
    </div>
  );
};
