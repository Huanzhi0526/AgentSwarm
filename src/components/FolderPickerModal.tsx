import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ArrowUp,
  Check,
  X,
  AppWindow,
  Loader2,
  ChevronRight,
  Search,
} from 'lucide-react';
import { apiFetch } from '../utils/api';

interface QuickRootItem {
  label: string;
  path: string;
  kind: 'drive' | 'shortcut';
}

interface DirectoryEntryItem {
  name: string;
  path: string;
}

interface FolderPickerModalProps {
  open: boolean;
  initialPath?: string;
  title?: string;
  onClose: () => void;
  onSelect: (selectedPath: string) => void;
}

export const FolderPickerModal: React.FC<FolderPickerModalProps> = ({
  open,
  initialPath,
  title = '选择项目文件夹',
  onClose,
  onSelect,
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [pathInput, setPathInput] = useState(initialPath || '');
  const [filterQuery, setFilterQuery] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [roots, setRoots] = useState<QuickRootItem[]>([]);
  const [directories, setDirectories] = useState<DirectoryEntryItem[]>([]);
  const [totalDirectories, setTotalDirectories] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [unsafeReason, setUnsafeReason] = useState<string | null>(null);
  const [canPickNativeDialog, setCanPickNativeDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickingNative, setPickingNative] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDir = useCallback(
    async (
      targetPath?: string,
      options?: { query?: string; strict?: boolean; resetFilter?: boolean; quietLoading?: boolean }
    ) => {
      const reqId = ++reqIdRef.current;
      if (!options?.quietLoading) setLoading(true);
      setErrorMsg(null);
      if (options?.resetFilter) setFilterQuery('');

      try {
        const params = new URLSearchParams();
        if (targetPath) params.set('path', targetPath);
        if (options?.query?.trim()) params.set('q', options.query.trim());
        if (options?.strict) params.set('strict', '1');
        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await apiFetch(`/api/fs/browse${qs}`);
        if (reqId !== reqIdRef.current) return;

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setErrorMsg(err.error || '无法读取该文件夹');
          return;
        }
        const data = await res.json();
        if (reqId !== reqIdRef.current) return;

        setCurrentPath(data.currentPath);
        setPathInput(data.currentPath);
        setParentPath(data.parentPath);
        setRoots(data.roots || []);
        setDirectories(data.directories || []);
        setTotalDirectories(
          typeof data.totalDirectories === 'number'
            ? data.totalDirectories
            : (data.directories || []).length
        );
        setTruncated(Boolean(data.truncated));
        setUnsafeReason(data.unsafeReason || null);
        setCanPickNativeDialog(Boolean(data.canPickNativeDialog));
      } finally {
        if (reqId === reqIdRef.current && !options?.quietLoading) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (open) {
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
      void loadDir(initialPath, { resetFilter: true });
    }
  }, [open, initialPath, loadDir]);

  useEffect(() => {
    return () => {
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    };
  }, []);

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

  const handleNativePick = async () => {
    setPickingNative(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/fs/pick-native-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPath: currentPath }),
      });
      if (res.ok) {
        const data = (await res.json()) as { cancelled: boolean; path: string | null };
        if (!data.cancelled && data.path) {
          onSelect(data.path);
          onClose();
        }
      }
    } finally {
      setPickingNative(false);
    }
  };

  const navigateTo = (targetPath: string, strict = false) => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    void loadDir(targetPath, { strict, resetFilter: true });
  };

  const handleFilterChange = (val: string) => {
    setFilterQuery(val);
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => {
      void loadDir(currentPath, { query: val, quietLoading: true });
    }, 140);
  };

  const handleJumpPath = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    navigateTo(pathInput.trim(), true);
  };

  const handleCreateSubFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setErrorMsg(null);
    const res = await apiFetch('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath: currentPath, name: newFolderName.trim() }),
    });
    if (res.ok) {
      const data = (await res.json()) as { path: string };
      setNewFolderName('');
      setCreatingFolder(false);
      navigateTo(data.path);
    } else {
      const err = await res.json().catch(() => ({ error: '创建失败' }));
      setErrorMsg(err.error || '创建失败');
    }
  };

  const folderDisplayName =
    currentPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || currentPath;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-4">
      <div className="flex w-full max-w-[640px] max-h-[84vh] flex-col rounded-3xl bg-white shadow-2xl border border-[#EAEAEF] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-4 border-b border-[#F1F1F5]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ac-soft)] text-[var(--ac-primary)] flex-shrink-0">
              <FolderOpen className="h-4.5 w-4.5" />
            </span>
            <h3 className="text-[16.5px] font-bold text-[#1F2024] truncate">{title}</h3>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {canPickNativeDialog && (
              <button
                type="button"
                disabled={pickingNative}
                onClick={() => void handleNativePick()}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-tint)] px-3 text-[12.5px] font-semibold text-[var(--ac-text)] hover:bg-[#EDE8F8] transition cursor-pointer"
              >
                {pickingNative ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 等待系统窗口...
                  </>
                ) : (
                  <>
                    <AppWindow className="h-3.5 w-3.5" /> 调用系统窗口
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭选择文件夹窗口"
              className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Quick Drive & Shortcut Strip */}
        <div className="flex items-center gap-1.5 px-5 sm:px-6 py-2.5 bg-[#FAFAFC] border-b border-[#F1F1F5] overflow-x-auto flex-shrink-0">
          {roots.map((r) => {
            const active = currentPath.toLowerCase() === r.path.toLowerCase();
            return (
              <button
                type="button"
                key={r.path}
                onClick={() => navigateTo(r.path)}
                className={`inline-flex h-7.5 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium transition flex-shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[var(--ac-primary)] text-white'
                    : 'bg-white border border-[#E6E6EE] text-[#4B4D57] hover:border-[#CFCFD9]'
                }`}
              >
                {r.kind === 'drive' ? (
                  <HardDrive className="h-3.5 w-3.5" />
                ) : (
                  <Folder className="h-3.5 w-3.5" />
                )}
                <span>{r.label}</span>
              </button>
            );
          })}
        </div>

        {/* Current Location Bar (Editable Path Jump) + Up + New Folder */}
        <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-2.5 border-b border-[#F1F1F5] bg-white flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              disabled={!parentPath}
              onClick={() => parentPath && navigateTo(parentPath)}
              title="返回上一级"
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#E4E4EC] bg-white px-2.5 text-[12.5px] font-medium text-[#3C3E47] hover:bg-[#F7F7FA] disabled:opacity-35 cursor-pointer flex-shrink-0"
            >
              <ArrowUp className="h-3.5 w-3.5" /> 上一级
            </button>
            <form onSubmit={handleJumpPath} className="flex items-center gap-1.5 min-w-0 flex-1">
              <input
                type="text"
                aria-label="文件夹路径"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                className="h-8 w-full min-w-0 rounded-lg border border-transparent hover:border-[#E4E4EC] focus:border-[var(--ac-mid)] bg-transparent focus:bg-[#FAFAFC] px-2 font-mono text-[12.5px] text-[#5E616D] focus:outline-none"
                title={currentPath}
              />
              {pathInput.trim() && pathInput.trim() !== currentPath && (
                <button
                  type="submit"
                  className="h-7.5 rounded-lg bg-[var(--ac-soft-hover)] px-2.5 text-[12px] font-semibold text-[var(--ac-text)] hover:bg-[#E4DEF4] flex-shrink-0 cursor-pointer"
                >
                  前往
                </button>
              )}
            </form>
          </div>

          <button
            type="button"
            onClick={() => setCreatingFolder((v) => !v)}
            className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[12.5px] font-medium text-[var(--ac-deep)] hover:bg-[var(--ac-soft)] cursor-pointer flex-shrink-0"
          >
            <FolderPlus className="h-3.5 w-3.5" /> 新建文件夹
          </button>
        </div>

        {/* Subfolder Filter Bar */}
        <div className="flex items-center gap-2 px-5 sm:px-6 py-2 border-b border-[#F1F1F5] bg-[#FCFCFD] flex-shrink-0">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9A9DA8]" />
            <input
              type="text"
              aria-label="筛选当前目录下的子文件夹"
              value={filterQuery}
              onChange={(e) => handleFilterChange(e.target.value)}
              placeholder="筛选子文件夹名称..."
              className="h-8 w-full rounded-xl border border-[#E6E6EE] bg-white pl-8 pr-7 text-[12.5px] text-[#232429] placeholder:text-[#A4A7B2] focus:border-[var(--ac-mid)] focus:outline-none"
            />
            {filterQuery && (
              <button
                type="button"
                aria-label="清空文件夹筛选"
                onClick={() => handleFilterChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9A9DA8] hover:text-[#4B4D57] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {creatingFolder && (
          <form
            onSubmit={handleCreateSubFolder}
            className="flex items-center gap-2 px-5 sm:px-6 py-2.5 bg-[#F8F7FC] border-b border-[#ECEAF6]"
          >
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="输入新文件夹名称..."
              className="h-8.5 flex-1 rounded-xl border border-[#D8D5E8] bg-white px-3 text-[13px] focus:border-[var(--ac-mid)] focus:outline-none"
            />
            <button
              type="submit"
              className="h-8.5 rounded-xl bg-[var(--ac-primary)] px-3.5 text-[12.5px] font-semibold text-white cursor-pointer"
            >
              创建并进入
            </button>
          </form>
        )}

        {errorMsg && (
          <div className="px-6 py-2 bg-[#FDF4F3] text-[12.5px] text-[#A65850]">{errorMsg}</div>
        )}

        {unsafeReason && (
          <div className="px-5 sm:px-6 py-2 bg-[#FCF7EF] border-b border-[#EFE2CE] text-[12px] text-[#8E5F24]">
            {unsafeReason}
          </div>
        )}

        {truncated && (
          <div className="px-5 sm:px-6 py-1.5 bg-[var(--ac-tint)] border-b border-[var(--ac-border-soft)] text-[12px] text-[var(--ac-hover)]">
            共 {totalDirectories} 个子文件夹，当前显示前 {directories.length} 项，可输入名称快速筛选
          </div>
        )}

        {/* Directory List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1 min-h-[240px]">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[13.5px] text-[#8A8D98] gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ac-primary)]" /> 读取文件夹中...
            </div>
          ) : directories.length === 0 ? (
            <div className="py-16 text-center text-[13.5px] text-[#9A9DA8]">
              {filterQuery.trim()
                ? '没有匹配的子文件夹，可清空上方筛选词'
                : '此文件夹下没有子文件夹，可直接点击下方「选定此文件夹」'}
            </div>
          ) : (
            directories.map((dir) => (
              <button
                type="button"
                key={dir.path}
                onClick={() => navigateTo(dir.path)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left hover:bg-[var(--ac-soft)] transition group cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Folder className="h-4.5 w-4.5 text-[var(--ac-bar)] flex-shrink-0" />
                  <span className="truncate text-[14px] font-medium text-[#232429]">
                    {dir.name}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-[#B0B3BE] group-hover:text-[var(--ac-primary)] flex-shrink-0" />
              </button>
            ))
          )}
        </div>

        {/* Footer Confirm */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-[#F1F1F5] bg-[#FAFAFC]">
          <div className="min-w-0">
            <div className="text-[12px] text-[#8A8D98]">当前选定文件夹</div>
            <div className="text-[14px] font-bold text-[#1F2024] truncate">{folderDisplayName}</div>
          </div>

          <div className="flex items-center gap-2.5 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-9.5 rounded-xl px-4 text-[13.5px] font-medium text-[#6E717C] hover:bg-[#EFEFF4] cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={Boolean(unsafeReason)}
              onClick={() => {
                if (unsafeReason) return;
                onSelect(currentPath);
                onClose();
              }}
              className="inline-flex h-9.5 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-5 text-[13.5px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
            >
              <Check className="h-4 w-4" /> 选定此文件夹
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
