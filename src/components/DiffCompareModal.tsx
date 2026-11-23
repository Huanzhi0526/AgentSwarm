import React, { useEffect, useState } from 'react';
import {
  X,
  Check,
  RotateCcw,
  FileText,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import type { SnapshotConflictItem, SnapshotDiffDetail } from '../types';
import { apiFetch } from '../utils/api';

export interface RevertClientOutcome {
  ok: boolean;
  hasConflicts?: boolean;
  conflicts?: SnapshotConflictItem[];
  restoredCount?: number;
  skippedConflicts?: number;
  error?: string;
}

interface DiffCompareModalProps {
  snapshotId: string | null;
  pendingConflicts?: SnapshotConflictItem[] | null;
  onClose: () => void;
  onAdopt: (snapshotId: string) => Promise<void>;
  onRevert: (
    snapshotId: string,
    mode?: 'strict' | 'skip_conflicts' | 'overwrite_all'
  ) => Promise<RevertClientOutcome | void>;
}

const PAGE_SIZE = 12;

const STATUS_BADGE: Record<'added' | 'modified' | 'deleted', { label: string; cls: string }> = {
  added: { label: '新增文件', cls: 'bg-[#EBF6F0] text-[#458964]' },
  modified: { label: '内容修改', cls: 'bg-[var(--ac-soft)] text-[var(--ac-deep)]' },
  deleted: { label: '删除文件', cls: 'bg-[#FAEDEC] text-[#B0615A]' },
};

export const DiffCompareModal: React.FC<DiffCompareModalProps> = ({
  snapshotId,
  pendingConflicts,
  onClose,
  onAdopt,
  onRevert,
}) => {
  const [detail, setDetail] = useState<SnapshotDiffDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [activeConflicts, setActiveConflicts] = useState<SnapshotConflictItem[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setActiveConflicts(pendingConflicts ?? null);
    setActionError(null);
    setPage(1);
    if (!snapshotId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    apiFetch(`/api/snapshots/${snapshotId}/diff`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SnapshotDiffDetail | null) => {
        setDetail(data);
        if (!pendingConflicts && data?.conflicts?.length) {
          // Leave available so banner can warn before click if desired
        }
      })
      .finally(() => setLoading(false));
  }, [snapshotId, pendingConflicts]);

  useEffect(() => {
    if (!snapshotId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [snapshotId, onClose]);

  if (!snapshotId) return null;

  const handleAdopt = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await onAdopt(snapshotId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = async (mode: 'strict' | 'skip_conflicts' | 'overwrite_all' = 'strict') => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await onRevert(snapshotId, mode);
      if (result && result.hasConflicts && result.conflicts?.length) {
        setActiveConflicts(result.conflicts);
        return;
      }
      if (result && !result.ok && result.error) {
        setActionError(result.error);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const totalDiffs = detail?.diffs.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalDiffs / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedDiffs = detail?.diffs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) ?? [];
  const divergedCount = detail?.conflicts?.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-3 sm:p-6">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl border border-[#EAEAEF] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EFEFF4] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-[17px] font-bold text-[#1F2024] truncate">
              {detail?.snapshot.label || '改动详情预览'}
            </h3>
            <p className="text-[13px] text-[#8A8D98] mt-0.5">
              共覆盖 {detail?.totalFiles ?? detail?.diffs.length ?? 0} 个文件
              {detail?.snapshot.skippedSummary ? `（${detail.snapshot.skippedSummary}）` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭改动对比窗口"
            className="rounded-full p-2 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer flex-shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Interactive Conflict Prevention Panel (P0-01) */}
        {activeConflicts && activeConflicts.length > 0 && (
          <div className="border-b border-[#EED9D6] bg-[#FDF6F5] px-5 py-4 sm:px-6 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-[#B65B50] flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold text-[#7A352E]">
                  检测到 {activeConflicts.length} 个文件在交付后有较新的编辑或变更，直接撤回将覆盖新内容
                </div>
                <div className="text-[12.5px] text-[#8E4C45] mt-0.5">
                  请选择保护后续编辑，或在自动生成保护备份后再覆盖还原：
                </div>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-2">
              {activeConflicts.map((c) => (
                <div
                  key={c.path}
                  className="rounded-xl border border-[#EED7D4] bg-white px-3.5 py-2.5 text-[12.5px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#1F2024]">{c.path}</span>
                    <span className="text-[#B05B51] font-medium">{c.reason}</span>
                  </div>
                  {c.currentDiskPreview !== undefined && (
                    <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px] font-mono">
                      <div className="rounded-lg bg-[#FFF8F6] p-2 text-[#5E403C] truncate">
                        当前磁盘：{c.currentDiskPreview || '（空）'}
                      </div>
                      <div className="rounded-lg bg-[#F5F4FA] p-2 text-[#4B4D57] truncate">
                        撤回目标：{c.snapshotTargetPreview || '（空）'}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveConflicts(null)}
                className="inline-flex h-9 items-center rounded-xl border border-[#E4E4EC] bg-white px-3.5 text-[12.5px] font-medium text-[#555866] hover:bg-[#F7F7FA] cursor-pointer"
              >
                返回对比
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRevert('overwrite_all')}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#E4D5D3] bg-white px-3.5 text-[12.5px] font-semibold text-[#A65850] hover:bg-[#F9ECEA] disabled:opacity-45 cursor-pointer"
              >
                先自动备份当前内容再覆盖还原
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRevert('skip_conflicts')}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-[var(--ac-primary)] px-4 text-[12.5px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-45 cursor-pointer"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> 保留较新修改（仅撤回无冲突文件）
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <div className="border-b border-[#EED9D6] bg-[#FDF6F5] px-5 py-2.5 text-[13px] text-[#A65850]">
            {actionError}
          </div>
        )}

        {/* Non-blocking Diverged Hint Banner when viewing Diff before clicking Revert */}
        {!activeConflicts && divergedCount > 0 && (
          <div className="border-b border-[#EFE3D2] bg-[#FCF8F2] px-5 py-2.5 sm:px-6 text-[12.5px] text-[#8A6334] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[#B3803D]" />
            <span>
              提示：其中 {divergedCount} 个文件在这条记录之后又有新的修改，点击撤回时系统会自动引导你选择是否保留新修改。
            </span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#F8F8FB]">
          {loading ? (
            <div className="py-16 text-center text-[14px] text-[#8A8D98]">正在读取修改前后内容...</div>
          ) : !detail || detail.diffs.length === 0 ? (
            <div className="py-16 text-center text-[14px] text-[#8A8D98]">该备份点无具体文本差异</div>
          ) : (
            <>
              {pagedDiffs.map((item) => {
                const badge = STATUS_BADGE[item.status];
                return (
                  <div
                    key={item.path}
                    className="rounded-2xl border border-[#E6E6EE] bg-white overflow-hidden shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-[#F1F1F5] px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-[var(--ac-primary)] flex-shrink-0" />
                        <span className="truncate font-mono text-[13px] font-medium text-[#232429]">
                          {item.path}
                        </span>
                        {item.currentDiskDiverged && (
                          <span className="rounded-md bg-[#FCF4E8] px-2 py-0.5 text-[11px] font-semibold text-[#9C6A29] flex-shrink-0">
                            后续已有新编辑
                          </span>
                        )}
                      </div>
                      <span className={`rounded-lg px-2.5 py-0.5 text-[12px] font-medium flex-shrink-0 ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#F1F1F5]">
                      <div className="p-4">
                        <div className="mb-2 text-[12px] font-semibold text-[#8E919C]">
                          {detail.snapshot.kind === 'manual_checkpoint' ? '备份点内容' : '修改前'}
                        </div>
                        <pre className="max-h-56 overflow-auto rounded-xl bg-[#FAFAFC] p-3 font-mono text-[12.5px] leading-relaxed text-[#666975] whitespace-pre-wrap break-all">
                          {item.beforeText || '（原本无此文件）'}
                        </pre>
                      </div>
                      <div className="p-4">
                        <div className="mb-2 text-[12px] font-semibold text-[#529471]">
                          {detail.snapshot.kind === 'manual_checkpoint' ? '状态说明' : '修改后'}
                        </div>
                        <pre className="max-h-56 overflow-auto rounded-xl bg-[#F6FBF8] p-3 font-mono text-[12.5px] leading-relaxed text-[#25262B] whitespace-pre-wrap break-all">
                          {item.afterText ||
                            (detail.snapshot.kind === 'manual_checkpoint'
                              ? '（手动备份快照，还原时将按备份内容恢复该文件）'
                              : '（文件已被移除）')}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              })}

              {totalPages > 1 && (
                <div className="flex items-center justify-between rounded-2xl border border-[#E6E6EE] bg-white px-4 py-2.5 text-[13px]">
                  <span className="text-[#7A7D89]">
                    第 {safePage} / {totalPages} 页（共 {totalDiffs} 个文件）
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#E4E4EC] px-2.5 text-[#3C3E47] disabled:opacity-35 cursor-pointer"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> 上一页
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#E4E4EC] px-2.5 text-[#3C3E47] disabled:opacity-35 cursor-pointer"
                    >
                      下一页 <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFEFF4] bg-white px-5 py-4 sm:px-6">
          <span className="text-[13px] text-[#8A8D98]">
            {detail?.snapshot.status === 'reverted'
              ? '当前状态：已撤回还原'
              : detail?.snapshot.status === 'adopted'
                ? '当前状态：已采纳生效'
                : '当前状态：待确认'}
            {detail?.snapshot.kind === 'manual_checkpoint'
              ? ' · 还原不会删除备份点之后新建的其他文件'
              : ''}
          </span>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRevert('strict')}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E4D5D3] bg-[#FDF7F6] px-4 text-[13.5px] font-semibold text-[#A65850] hover:bg-[#F9ECEA] disabled:opacity-45 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              {detail?.snapshot.kind === 'manual_checkpoint' ? '还原到此步' : '一键撤回修改'}
            </button>
            {detail?.snapshot.kind !== 'manual_checkpoint' &&
              detail?.snapshot.kind !== 'pre_overwrite_backup' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAdopt()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-5 text-[13.5px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-45 cursor-pointer"
                >
                  <Check className="h-4 w-4" /> 采纳保留
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};
