import React, { useEffect, useState } from 'react';
import { Sparkles, X, Check } from 'lucide-react';
import { apiFetch } from '../utils/api';

interface GlobalDispatchModalProps {
  open: boolean;
  initialPrompt?: string;
  onClose: () => void;
  onSaved?: (nextPrompt: string) => void;
}

const DISPATCH_TEMPLATES = [
  {
    label: '多引擎主力与交叉验收',
    text: '主力编码与核心实现优先交由 Codex、Antigravity 或 CodeBuddy 承担；倾向使用 Antigravity 中的 Gemini Neon 或 Claude Opus 模型负责前端界面与架构审查；倾向使用 Codex 负责测试验收与代码把关；如与成员数量或明确点名冲突，由主管灵活统筹调配。',
  },
  {
    label: '通用均衡协作',
    text: '请主管根据各成员所选引擎与模型特长，自动划分方案梳理、核心实现、前端交互与测试把关职责；保持职责边界清晰，有冲突时由主管统筹调配。',
  },
  {
    label: '双人结对快审',
    text: '由一名成员专注核心开发与自测，另一名成员专注问题排查、边界核验与文档整理，最后统一汇总给主管验收。',
  },
];

export const GlobalDispatchModal: React.FC<GlobalDispatchModalProps> = ({
  open,
  initialPrompt = '',
  onClose,
  onSaved,
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrompt(initialPrompt);
    setSavedNotice(false);
    apiFetch('/api/settings/orchestration')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { globalDispatchPrompt?: string } | null) => {
        if (d && typeof d.globalDispatchPrompt === 'string') {
          setPrompt(d.globalDispatchPrompt);
        }
      })
      .catch(() => {});
  }, [open, initialPrompt]);

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings/orchestration', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalDispatchPrompt: prompt }),
      });
      if (res.ok) {
        const saved = (await res.json()) as { globalDispatchPrompt: string };
        setSavedNotice(true);
        onSaved?.(saved.globalDispatchPrompt);
        setTimeout(() => onClose(), 420);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] rounded-3xl border border-[#EAEAEF] bg-white p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--ac-soft)] text-[var(--ac-primary)]">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
            <div>
              <h3 className="text-[16.5px] font-bold text-[#1F2024]">全局分工偏好</h3>
              <p className="text-[12.5px] text-[#7A7D89] mt-0.5">
                未给成员单独指定职责时，主管将优先按此偏好与模型特长分工；当次对话有明确安排则以消息为准。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭全局分工偏好"
            className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-[#8E919C]">快速填入范例：</span>
            {DISPATCH_TEMPLATES.map((tpl) => (
              <button
                type="button"
                key={tpl.label}
                onClick={() => setPrompt(tpl.text)}
                className="rounded-full border border-[var(--ac-border-soft)] bg-[var(--ac-tint)] px-2.5 py-1 text-[12px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-soft-hover)] transition cursor-pointer"
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="例如：主力实现优先用 Codex / Antigravity / CodeBuddy，前端界面与审查倾向 Antigravity（Neon / Opus），最终验收测试倾向 Codex；若有冲突由主管统筹协调..."
            className="w-full resize-none rounded-2xl border border-[#E4E4EC] bg-[#FAFAFC] p-3.5 text-[13.5px] leading-relaxed text-[#1F2024] placeholder:text-[#A2A5B0] focus:border-[var(--ac-mid)] focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setPrompt('')}
            className="text-[12.5px] text-[#8E919C] hover:text-[#4B4D57] cursor-pointer"
          >
            清空恢复默认
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-[#E4E4EC] bg-white px-4 text-[13px] font-medium text-[#555866] hover:bg-[#F5F5F9] cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ac-primary)] px-4.5 text-[13px] font-semibold text-white hover:bg-[var(--ac-hover)] transition cursor-pointer"
            >
              {savedNotice ? (
                <>
                  <Check className="h-4 w-4" /> 已保存
                </>
              ) : saving ? (
                '保存中...'
              ) : (
                '保存设置'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
