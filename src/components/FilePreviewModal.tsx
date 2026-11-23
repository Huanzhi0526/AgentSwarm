import React, { useEffect, useState } from 'react';
import {
  X,
  ExternalLink,
  FolderOpen,
  Download,
  Copy,
  Check,
  FileText,
  Loader2,
} from 'lucide-react';
import { apiFetch, getStoredClientToken } from '../utils/api';
import { MarkdownContent } from './MarkdownContent';

interface FilePreviewResponse {
  name: string;
  relPath: string;
  ext: string;
  size: number;
  updatedAt: number;
  kind: 'markdown' | 'html' | 'image' | 'pdf' | 'code' | 'binary';
  content?: string;
  truncated?: boolean;
  sandboxUrl?: string;
  canOpenOnHost?: boolean;
}

interface FilePreviewModalProps {
  boardId: string | null;
  filePath: string | null;
  onClose: () => void;
  onNavigateFile?: (nextRelPath: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  boardId,
  filePath,
  onClose,
  onNavigateFile,
}) => {
  const [data, setData] = useState<FilePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId || !filePath) {
      setData(null);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setViewMode('rendered');
    apiFetch(`/api/boards/${boardId}/files/preview?path=${encodeURIComponent(filePath)}`)
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: '无法打开该文件' }));
          throw new Error(d.error || '无法打开该文件');
        }
        return res.json() as Promise<FilePreviewResponse>;
      })
      .then((d) => setData(d))
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [boardId, filePath]);

  useEffect(() => {
    if (!boardId || !filePath) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [boardId, filePath, onClose]);

  if (!boardId || !filePath) return null;

  const token = getStoredClientToken();
  const rawBaseUrl = `/api/boards/${boardId}/files/raw?path=${encodeURIComponent(
    data?.relPath || filePath
  )}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  const downloadUrl = `${rawBaseUrl}&download=1`;

  const triggerHostOpen = async (reveal: boolean) => {
    const res = await apiFetch(`/api/boards/${boardId}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: data?.relPath || filePath, reveal }),
    });
    if (res.ok) {
      setToast(reveal ? '已在资源管理器中定位该文件' : '已调用系统默认程序打开');
      setTimeout(() => setToast(null), 2000);
    }
  };

  const handleCopyContent = () => {
    if (!data?.content) return;
    navigator.clipboard.writeText(data.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-3 sm:p-6">
      <div className="relative flex w-full max-w-4xl max-h-[88vh] flex-col rounded-3xl bg-white shadow-2xl border border-[#EAEAEF] overflow-hidden">
        {toast && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 rounded-full bg-[#2C2E35] px-4 py-1.5 text-[12.5px] font-medium text-white shadow-lg">
            {toast}
          </div>
        )}

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[#F1F1F5] bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ac-soft)] text-[var(--ac-primary)] flex-shrink-0">
              <FileText className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-[#1F2024] truncate">
                {data?.name || filePath}
              </div>
              <div className="text-[12px] text-[#8A8D98] truncate font-mono">
                {data?.relPath || filePath}
                {data ? ` · ${formatBytes(data.size)}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(data?.kind === 'markdown' || data?.kind === 'html') && (
              <div className="flex rounded-xl bg-[#F3F2F8] p-0.5 text-[12px]">
                <button
                  type="button"
                  onClick={() => setViewMode('rendered')}
                  className={`rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                    viewMode === 'rendered'
                      ? 'bg-white text-[#1F2024] shadow-2xs'
                      : 'text-[#7A7D89]'
                  }`}
                >
                  预览视图
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('source')}
                  className={`rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                    viewMode === 'source'
                      ? 'bg-white text-[#1F2024] shadow-2xs'
                      : 'text-[#7A7D89]'
                  }`}
                >
                  源码
                </button>
              </div>
            )}

            {data?.content && (
              <button
                type="button"
                onClick={handleCopyContent}
                className="inline-flex h-8.5 items-center gap-1 rounded-xl border border-[#E4E4EC] bg-white px-3 text-[12.5px] font-medium text-[#3C3E47] hover:bg-[#F7F7FA] cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#529471]" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> 复制内容
                  </>
                )}
              </button>
            )}

            {data?.canOpenOnHost && (
              <>
                <button
                  type="button"
                  onClick={() => void triggerHostOpen(false)}
                  className="inline-flex h-8.5 items-center gap-1 rounded-xl bg-[var(--ac-primary)] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[var(--ac-hover)] transition cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> 默认程序打开
                </button>
                <button
                  type="button"
                  onClick={() => void triggerHostOpen(true)}
                  className="hidden sm:inline-flex h-8.5 items-center gap-1 rounded-xl border border-[#E4E4EC] bg-white px-3 text-[12.5px] font-medium text-[#3C3E47] hover:bg-[#F7F7FA] cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-[var(--ac-primary)]" /> 所在文件夹
                </button>
              </>
            )}

            <a
              href={downloadUrl}
              download={data?.name || undefined}
              className="inline-flex h-8.5 items-center gap-1 rounded-xl border border-[#E4E4EC] bg-white px-3 text-[12.5px] font-medium text-[#3C3E47] hover:bg-[#F7F7FA]"
            >
              <Download className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
              <span className="hidden sm:inline">下载</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              aria-label="关闭文件预览"
              className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-[#FAFAFC] p-4 sm:p-6 min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[14px] text-[#8A8D98] gap-2">
              <Loader2 className="h-4.5 w-4.5 animate-spin text-[var(--ac-primary)]" /> 正在读取文件内容...
            </div>
          ) : errorMsg ? (
            <div className="py-20 text-center text-[14px] text-[#A65850]">{errorMsg}</div>
          ) : !data ? null : data.kind === 'markdown' && viewMode === 'rendered' ? (
            <div className="mx-auto max-w-3xl rounded-2xl bg-white p-5 sm:p-7 border border-[#EAEAEF] shadow-2xs">
              <MarkdownContent
                content={data.content || ''}
                onOpenFilePath={onNavigateFile}
              />
            </div>
          ) : data.kind === 'html' && viewMode === 'rendered' ? (
            <div className="space-y-2.5">
              <div className="h-[62vh] w-full overflow-hidden rounded-2xl border border-[#EAEAEF] bg-white">
                <iframe
                  title={data.name}
                  src={data.sandboxUrl || rawBaseUrl}
                  sandbox="allow-scripts"
                  className="h-full w-full border-0"
                />
              </div>
              <div className="px-1 text-[12px] text-[#7A7D89]">
                安全隔离预览：工作区同目录样式与图片资源已就绪，已隔离宿主登录凭证与外部网络请求
              </div>
            </div>
          ) : data.kind === 'image' ? (
            <div className="flex items-center justify-center rounded-2xl border border-[#EAEAEF] bg-white p-6 min-h-[320px]">
              <img
                src={rawBaseUrl}
                alt={data.name}
                className="max-h-[64vh] max-w-full object-contain rounded-lg"
              />
            </div>
          ) : data.kind === 'pdf' ? (
            <div className="h-[66vh] w-full overflow-hidden rounded-2xl border border-[#EAEAEF] bg-white">
              <iframe title={data.name} src={rawBaseUrl} className="h-full w-full border-0" />
            </div>
          ) : data.kind === 'binary' ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#EAEAEF] bg-white py-16 px-6 text-center space-y-4">
              <FileText className="h-10 w-10 text-[var(--ac-bar)]" />
              <div className="text-[15px] font-semibold text-[#1F2024]">{data.name}</div>
              <div className="text-[13.5px] text-[#7A7D89]">
                该文件类型不支持网页内文本渲染，可直接用电脑默认软件打开或下载查看
              </div>
              <div className="flex items-center gap-3 pt-1">
                {data.canOpenOnHost && (
                  <button
                    type="button"
                    onClick={() => void triggerHostOpen(false)}
                    className="inline-flex h-9.5 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-4 text-[13.5px] font-semibold text-white hover:bg-[var(--ac-hover)] cursor-pointer"
                  >
                    <ExternalLink className="h-4 w-4" /> 用默认程序打开
                  </button>
                )}
                <a
                  href={downloadUrl}
                  download={data.name}
                  className="inline-flex h-9.5 items-center gap-1.5 rounded-xl border border-[#E4E4EC] bg-white px-4 text-[13.5px] font-medium text-[#3C3E47] hover:bg-[#F7F7FA]"
                >
                  <Download className="h-4 w-4 text-[var(--ac-primary)]" /> 下载文件
                </a>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#EAEAEF] bg-white overflow-hidden">
              <pre className="overflow-x-auto p-4 sm:p-5 font-mono text-[12.5px] leading-[1.65] text-[#282A32]">
                <code>{data.content || ''}</code>
              </pre>
              {data.truncated && (
                <div className="border-t border-[#F1F1F5] bg-[#FAFAFC] px-4 py-2 text-[12px] text-[#8A8D98]">
                  文件较大，仅展示前 512 KB 预览，可点击上方「默认程序打开」查看完整文件。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
