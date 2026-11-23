import React, { useCallback, useEffect, useState } from 'react';
import { X, Check, Plus, Trash2, RefreshCw } from 'lucide-react';
import type { AccountSlot, EngineId } from '../types';
import { EngineIcon } from './BrandIcon';
import { apiFetch } from '../utils/api';

interface AccountSwitchModalProps {
  engine: Exclude<EngineId, 'demo'> | null;
  engineName: string;
  onClose: () => void;
  onSwitched: () => void;
}

export const AccountSwitchModal: React.FC<AccountSwitchModalProps> = ({
  engine,
  engineName,
  onClose,
  onSwitched,
}) => {
  const [slots, setSlots] = useState<AccountSlot[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSlots = useCallback(async () => {
    if (!engine) return;
    const res = await apiFetch(`/api/accounts?engine=${engine}`);
    if (res.ok) {
      setSlots(await res.json());
    }
  }, [engine]);

  useEffect(() => {
    setErrorMsg(null);
    void loadSlots();
  }, [loadSlots]);

  useEffect(() => {
    if (!engine) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [engine, onClose]);

  if (!engine) return null;

  const handleSaveCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, label: newLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || '保存失败');
      } else {
        setNewLabel('');
        await loadSlots();
        onSwitched();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = async (slotId: string) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/accounts/${slotId}/switch`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || '切换失败');
      } else {
        await loadSlots();
        onSwitched();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (slotId: string) => {
    await apiFetch(`/api/accounts/${slotId}`, { method: 'DELETE' });
    await loadSlots();
    onSwitched();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-[#EAEAEF]">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F7F7FA] border border-[#EFEFF4]">
              <EngineIcon engine={engine} size={24} />
            </div>
            <div>
              <h3 className="text-[17px] font-bold text-[#1F2024]">{engineName} 账号切换</h3>
              <p className="text-[12.5px] text-[#8A8D98]">保存多个登录态槽位，一键切换备用号</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭账号切换窗口"
            className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-xl bg-[#FAEDEC] px-3.5 py-2.5 text-[13px] text-[#A65850]">
            {errorMsg}
          </div>
        )}

        <div className="space-y-2.5 max-h-60 overflow-y-auto mb-5">
          {slots.length === 0 ? (
            <div className="rounded-2xl bg-[#F8F8FB] py-8 text-center text-[13.5px] text-[#8A8D98]">
              暂无已保存的账号槽位
            </div>
          ) : (
            slots.map((slot) => (
              <div
                key={slot.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                  slot.isActive
                    ? 'border-[var(--ac-border-strong)] bg-[var(--ac-tint)]'
                    : 'border-[#EAEAEF] bg-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold text-[#1F2024] truncate">{slot.label}</span>
                    {slot.isActive && (
                      <span className="rounded-md bg-[#EBF6F0] px-2 py-0.5 text-[11px] font-semibold text-[#458964]">
                        当前使用
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[#8A8D98] mt-0.5">{slot.accountHint}</div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!slot.isActive ? (
                    <button
                      disabled={busy}
                      onClick={() => void handleSwitch(slot.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-xl bg-[var(--ac-primary)] px-3 text-[12.5px] font-semibold text-white hover:bg-[var(--ac-hover)] cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" /> 切换
                    </button>
                  ) : (
                    <span className="inline-flex h-8 items-center px-2 text-[#529471]">
                      <Check className="h-4 w-4" />
                    </span>
                  )}

                  {slots.length > 1 && (
                    <button
                      onClick={() => void handleDelete(slot.id)}
                      title="移除槽位"
                      className="rounded-lg p-1.5 text-[#A0A3AD] hover:bg-[#F3F2F7] hover:text-[#A65850] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSaveCurrent} className="border-t border-[#F1F1F5] pt-4">
          <label className="block text-[13px] font-semibold text-[#3C3E47] mb-2">
            将本机当前登录账号保存为新槽位
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="输入备注名，如：备用号 2"
              className="h-10 flex-1 rounded-xl border border-[#E4E4EC] px-3.5 text-[13.5px] focus:border-[var(--ac-mid)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newLabel.trim() || busy}
              className="inline-flex h-10 items-center gap-1 rounded-xl bg-[var(--ac-soft-hover)] px-4 text-[13.5px] font-semibold text-[var(--ac-text)] hover:bg-[#E4DEF2] disabled:opacity-45 cursor-pointer"
            >
              <Plus className="h-4 w-4" /> 保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
