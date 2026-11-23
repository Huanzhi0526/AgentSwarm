import React, { useEffect, useState } from 'react';
import {
  Terminal,
  Copy,
  Check,
  X,
  Loader2,
  CheckCircle2,
  Circle,
  Clock,
  Plus,
  History,
  RotateCcw,
  Eye,
  BookmarkPlus,
  Pencil,
  Trash2,
  Crown,
  SlidersHorizontal,
  ExternalLink,
} from 'lucide-react';
import type {
  AgentSlot,
  Board,
  BoardTask,
  CustomMemberDraft,
  EngineId,
  EngineStatusCard,
  ModelOption,
  ReasoningEffort,
  TaskStatus,
  WorkspaceSnapshot,
} from '../types';
import {
  buildResumeCommand,
  ENGINE_OPTIONS,
  formatRelativeTime,
  getEffortsForModel,
  getModelsForEngine,
} from '../utils/format';
import { EngineIcon } from './BrandIcon';
import { SelectMenu } from './SelectMenu';
import { apiFetch } from '../utils/api';

/**
 * Bottom-Left Task List Panel (Interactive Checklist + Progress Bar)
 */
export const LeftTasksPanel: React.FC<{
  tasks: BoardTask[];
  agents: AgentSlot[];
  onAddTask: (title: string) => Promise<void>;
  onToggleTask: (taskId: string, nextStatus: TaskStatus) => Promise<void>;
}> = ({ tasks, agents, onAddTask, onToggleTask }) => {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  const getAssignee = (slotId: string) => agents.find((a) => a.slotId === slotId);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await onAddTask(newTitle.trim());
    setNewTitle('');
    setAdding(false);
  };

  return (
    <div className="flex flex-col border-t border-[#EAEAEF] bg-[#FAFAFC] px-4 py-4 h-[44%] min-h-[210px]">
      <div className="flex items-center justify-between px-0.5 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-[#232429]">任务分工进度</span>
          <span className="rounded-full bg-[var(--ac-soft-hover)] px-2 py-0.5 text-[12px] font-semibold text-[var(--ac-deep)]">
            {completedCount}/{tasks.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title="添加待办任务"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-[var(--ac-deep)] hover:bg-[var(--ac-soft-hover)] cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" /> 添加
        </button>
      </div>

      {/* Smooth Lavender Progress Bar */}
      <div className="h-1.5 w-full rounded-full bg-[#EAE9F2] overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-[var(--ac-bar)] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="mb-2.5 flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="输入待办事项..."
            className="h-8.5 flex-1 rounded-xl border border-[#D8D5E8] bg-white px-3 text-[13px] focus:border-[var(--ac-mid)] focus:outline-none"
          />
          <button
            type="submit"
            className="h-8.5 rounded-xl bg-[var(--ac-primary)] px-3 text-[12.5px] font-semibold text-white cursor-pointer"
          >
            确定
          </button>
        </form>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
        {tasks.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[#9A9DA8]">暂无拆解任务</div>
        ) : (
          tasks.map((task) => {
            const isDone = task.status === 'completed';
            const isRunning = task.status === 'in_progress';
            const assignee = getAssignee(task.assigneeSlotId);

            return (
              <div
                key={task.id}
                className="flex items-start gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 border border-[#ECECF1] hover:border-[#DFDFE8] transition"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={`任务 ${task.title}：${isDone ? '已完成，点击标为进行中' : '未完成，点击标为已完成'}`}
                  onClick={() =>
                    void onToggleTask(task.id, isDone ? 'in_progress' : 'completed')
                  }
                  className="-m-1 mt-0 p-1.5 rounded-lg flex-shrink-0 hover:bg-[#F3F2F8] cursor-pointer"
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4.5 w-4.5 text-[#5BA97B]" />
                  ) : isRunning ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin text-[var(--ac-bubble)]" />
                  ) : (
                    <Clock className="h-4.5 w-4.5 text-[#B0B3BE]" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[13.5px] leading-snug ${
                      isDone ? 'text-[#9A9DA8] line-through' : 'font-medium text-[#25262B]'
                    }`}
                  >
                    {task.title}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[#8E919C]">
                    {assignee && <EngineIcon engine={assignee.engine} size={13} />}
                    <span>{assignee?.displayName || task.assigneeSlotId}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/**
 * Right Sidebar: Tab 1 = Team Members + Engine/Model + Reasoning Effort; Tab 2 = Graphical File Changes & Backups
 */
interface RosterAndTasksPaneProps {
  board: Board;
  agents: AgentSlot[];
  snapshots: WorkspaceSnapshot[];
  initialTab?: 'roster' | 'snapshots';
  availableEngines?: EngineStatusCard[];
  modelsByEngine: Record<string, ModelOption[]>;
  liveLogsBySlot: Record<string, string[]>;
  isLocalhost?: boolean;
  onUpdateAgent: (
    slotId: string,
    patch: {
      displayName?: string;
      roleTitle?: string;
      roleBrief?: string;
      roleAutoAssigned?: boolean;
      isLeader?: boolean;
      engine?: EngineId;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
    }
  ) => void;
  onAddAgent?: (draft: CustomMemberDraft & { assignImmediately?: boolean }) => Promise<void>;
  onRemoveAgent?: (slotId: string) => Promise<void>;
  onOpenDispatchSettings?: () => void;
  onSelectTargetSlot: (slotId: string) => void;
  onCreateCheckpoint: () => Promise<void>;
  onOpenSnapshotDiff: (snapshotId: string) => void;
  onRevertSnapshot: (snapshotId: string) => Promise<void>;
  onPreviewFile?: (relPath: string) => void;
  onCloseDrawer?: () => void;
}

export const RosterAndTasksPane: React.FC<RosterAndTasksPaneProps> = ({
  board,
  agents,
  snapshots,
  initialTab = 'roster',
  availableEngines,
  modelsByEngine,
  liveLogsBySlot,
  isLocalhost = true,
  onUpdateAgent,
  onAddAgent,
  onRemoveAgent,
  onOpenDispatchSettings,
  onSelectTargetSlot,
  onCreateCheckpoint,
  onOpenSnapshotDiff,
  onRevertSnapshot,
  onPreviewFile,
  onCloseDrawer,
}) => {
  const [rightTab, setRightTab] = useState<'roster' | 'snapshots'>(initialTab);
  const [logModalSlot, setLogModalSlot] = useState<AgentSlot | null>(null);
  const [fetchedLogs, setFetchedLogs] = useState<string[]>([]);
  const [copiedSlot, setCopiedSlot] = useState<string | null>(null);
  const [openingSlot, setOpeningSlot] = useState<string | null>(null);
  const [savingBackup, setSavingBackup] = useState(false);
  const [expandedSnapFiles, setExpandedSnapFiles] = useState<Record<string, boolean>>({});

  // Mid-flight member addition & role editing state
  const firstReadyCard = availableEngines?.find((e) => e.installed);
  const firstReadyEngine: EngineId = firstReadyCard?.id || 'antigravity';
  const [showAddMember, setShowAddMember] = useState(false);
  const [newEngine, setNewEngine] = useState<EngineId>(firstReadyEngine);
  const [newModelId, setNewModelId] = useState(
    () =>
      firstReadyCard?.defaultModel ||
      getModelsForEngine(firstReadyEngine, modelsByEngine)[0]?.id ||
      ''
  );
  const [newEffort, setNewEffort] = useState<ReasoningEffort>(
    () => firstReadyCard?.defaultEffort || 'high'
  );
  const [newName, setNewName] = useState('');
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [assignImmediately, setAssignImmediately] = useState(true);
  const [addingMember, setAddingMember] = useState(false);
  const [memberActionErr, setMemberActionErr] = useState<string | null>(null);

  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRoleTitle, setEditRoleTitle] = useState('');
  const [editRoleBrief, setEditRoleBrief] = useState('');

  useEffect(() => {
    setRightTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!logModalSlot) return;
    apiFetch(`/api/boards/${board.id}/agents/${logModalSlot.slotId}/logs`)
      .then((r) => r.json())
      .then((data) => setFetchedLogs(data.logs || []))
      .catch(() => {});
  }, [board.id, logModalSlot]);

  useEffect(() => {
    if (!logModalSlot) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLogModalSlot(null);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [logModalSlot]);

  const handleCopyResume = (slot: AgentSlot) => {
    const cmd = buildResumeCommand(slot.engine, slot.nativeSessionId);
    if (!cmd) return;
    navigator.clipboard.writeText(cmd);
    setCopiedSlot(slot.slotId);
    setTimeout(() => setCopiedSlot(null), 1600);
  };

  const handleOpenSession = async (slot: AgentSlot) => {
    if (openingSlot) return;
    setOpeningSlot(slot.slotId);
    setMemberActionErr(null);
    try {
      const resp = await apiFetch(
        `/api/boards/${board.id}/agents/${slot.slotId}/open-session`,
        { method: 'POST' }
      );
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || '打开对话窗口失败');
      }
    } catch (err) {
      setMemberActionErr(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningSlot(null);
    }
  };

  const handleManualBackup = async () => {
    setSavingBackup(true);
    try {
      await onCreateCheckpoint();
    } finally {
      setSavingBackup(false);
    }
  };

  const engineMenuOptions = availableEngines?.length
    ? availableEngines.map((e) => ({
        value: e.id,
        label: e.name,
        badge: e.installed ? '可用' : '未装',
        muted: !e.installed,
      }))
    : ENGINE_OPTIONS.map((e) => ({ value: e.id, label: e.label }));

  const handleNewEngineChange = (nextEng: EngineId) => {
    const nextModels = getModelsForEngine(nextEng, modelsByEngine);
    const engineCard = availableEngines?.find((e) => e.id === nextEng);
    const preferredMod =
      (engineCard?.defaultModel && nextModels.find((m) => m.id === engineCard.defaultModel)) ||
      nextModels[0];
    const effs = preferredMod?.efforts?.length ? preferredMod.efforts : ['low', 'medium', 'high'];
    const preferredEff = engineCard?.defaultEffort;
    setNewEngine(nextEng);
    setNewModelId(preferredMod?.id || '');
    setNewEffort(
      preferredEff && effs.includes(preferredEff)
        ? preferredEff
        : effs.includes(newEffort)
          ? newEffort
          : preferredMod?.defaultEffort || effs[0] || 'high'
    );
  };

  const handleSubmitAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddAgent) return;
    setAddingMember(true);
    setMemberActionErr(null);
    try {
      const cleanRole = newRoleTitle.trim();
      await onAddAgent({
        engine: newEngine,
        modelId: newModelId,
        reasoningEffort: newEffort,
        displayName: newName.trim() || undefined,
        roleTitle: cleanRole || undefined,
        roleBrief: cleanRole || undefined,
        roleAutoAssigned: !cleanRole,
        assignImmediately:
          assignImmediately && (board.turnCount > 0 || Boolean(board.goal.trim())),
      });
      setNewName('');
      setNewRoleTitle('');
      setShowAddMember(false);
    } catch (err) {
      setMemberActionErr(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingMember(false);
    }
  };

  const startEditSlot = (slot: AgentSlot) => {
    setEditingSlotId(slot.slotId);
    setEditName(slot.displayName);
    setEditRoleTitle(slot.roleAutoAssigned ? '' : slot.roleTitle);
    setEditRoleBrief(slot.roleAutoAssigned ? '' : slot.roleBrief);
    setMemberActionErr(null);
  };

  const saveEditSlot = (slot: AgentSlot) => {
    const cleanTitle = editRoleTitle.trim();
    const isAuto = !slot.isLeader && !cleanTitle;
    onUpdateAgent(slot.slotId, {
      displayName: editName.trim() || slot.displayName,
      roleTitle: cleanTitle || undefined,
      roleBrief: editRoleBrief.trim() || cleanTitle || undefined,
      roleAutoAssigned: isAuto,
    });
    setEditingSlotId(null);
  };

  const handleRemoveSlot = async (slot: AgentSlot) => {
    if (!onRemoveAgent) return;
    setMemberActionErr(null);
    try {
      await onRemoveAgent(slot.slotId);
      if (editingSlotId === slot.slotId) setEditingSlotId(null);
    } catch (err) {
      setMemberActionErr(err instanceof Error ? err.message : String(err));
    }
  };

  const newMemberModels = getModelsForEngine(newEngine, modelsByEngine);
  const newMemberEfforts = getEffortsForModel(newEngine, newModelId, modelsByEngine);

  return (
    <aside className="flex h-full flex-col bg-white border-l border-[#EAEAEF] overflow-hidden">
      {/* Top Aligned Segmented Switcher + Mobile Close Button */}
      <div className="px-4 py-3 border-b border-[#F1F1F5] flex items-center gap-2 flex-shrink-0">
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[#F4F3F8] p-1 flex-1">
          <button
            type="button"
            onClick={() => setRightTab('roster')}
            className={`h-8.5 rounded-xl text-[13px] font-semibold transition cursor-pointer ${
              rightTab === 'roster'
                ? 'bg-white text-[#1F2024] shadow-2xs'
                : 'text-[#7A7D89] hover:text-[#3C3E47]'
            }`}
          >
            团队与模型 ({agents.length})
          </button>
          <button
            type="button"
            onClick={() => setRightTab('snapshots')}
            className={`h-8.5 rounded-xl text-[13px] font-semibold transition cursor-pointer ${
              rightTab === 'snapshots'
                ? 'bg-white text-[#1F2024] shadow-2xs'
                : 'text-[#7A7D89] hover:text-[#3C3E47]'
            }`}
          >
            改动与备份 ({snapshots.length})
          </button>
        </div>

        {onCloseDrawer && (
          <button
            type="button"
            onClick={onCloseDrawer}
            aria-label="关闭右侧面板"
            className="xl:hidden rounded-full p-2 text-[#7A7D89] hover:bg-[#F3F2F7] cursor-pointer flex-shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {rightTab === 'roster' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {/* Dynamic Roster Actions */}
          {(onAddAgent || onOpenDispatchSettings) && (
            <div className="flex items-center justify-between gap-2">
              {onAddAgent ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddMember((v) => !v);
                    setMemberActionErr(null);
                  }}
                  className="inline-flex h-8.5 items-center gap-1 rounded-xl bg-[var(--ac-primary)] px-3 text-[12.5px] font-semibold text-white hover:bg-[var(--ac-hover)] transition cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" /> 新增成员
                </button>
              ) : (
                <span />
              )}
              {onOpenDispatchSettings && (
                <button
                  type="button"
                  onClick={onOpenDispatchSettings}
                  className="inline-flex h-8.5 items-center gap-1 rounded-xl border border-[#E4E3EE] bg-[#FAFAFC] px-3 text-[12.5px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-soft)] transition cursor-pointer"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> 分工偏好
                </button>
              )}
            </div>
          )}

          {memberActionErr && (
            <div className="rounded-xl border border-[#EED7D4] bg-[#FDF5F4] px-3 py-2 text-[12px] text-[#A65850]">
              {memberActionErr}
            </div>
          )}

          {showAddMember && onAddAgent && (
            <form
              onSubmit={handleSubmitAddMember}
              className="rounded-2xl border border-[#D8CFE8] bg-[var(--ac-tint)] p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-[#1F2024]">添加新成员到当前团队</span>
                <button
                  type="button"
                  onClick={() => setShowAddMember(false)}
                  aria-label="取消新增成员"
                  className="rounded-full p-1 text-[#8A8D98] hover:bg-[#ECEAF6] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <SelectMenu
                  value={newEngine}
                  options={engineMenuOptions}
                  ariaLabel="新成员引擎"
                  onChange={(val) => handleNewEngineChange(val as EngineId)}
                />
                <SelectMenu
                  value={newModelId}
                  options={newMemberModels.map((m) => ({ value: m.id, label: m.label }))}
                  align="right"
                  ariaLabel="新成员模型"
                  onChange={(val) => {
                    const mod = newMemberModels.find((x) => x.id === val);
                    const effs = mod?.efforts?.length ? mod.efforts : ['low', 'medium', 'high'];
                    setNewModelId(val);
                    if (!effs.includes(newEffort)) {
                      setNewEffort(mod?.defaultEffort || effs[0] || 'high');
                    }
                  }}
                />
              </div>

              <div className="grid grid-cols-[100px_1fr] items-center gap-1.5">
                <SelectMenu
                  value={newEffort}
                  options={newMemberEfforts.map((eff) => ({ value: eff, label: eff }))}
                  ariaLabel="新成员思考强度"
                  onChange={(val) => setNewEffort(val)}
                />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="成员称呼（选填）"
                  className="h-9 rounded-xl border border-[#E4E4EC] bg-white px-2.5 text-[12.5px] focus:border-[var(--ac-mid)] focus:outline-none"
                />
              </div>

              <input
                type="text"
                value={newRoleTitle}
                onChange={(e) => setNewRoleTitle(e.target.value)}
                placeholder="职责要求（留空则交由主管自动定岗）"
                className="h-8.5 w-full rounded-xl border border-[#E4E4EC] bg-white px-2.5 text-[12.5px] focus:border-[var(--ac-mid)] focus:outline-none"
              />

              {(board.turnCount > 0 || Boolean(board.goal.trim())) && (
                <label className="flex items-center gap-2 text-[12px] text-[#555866] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignImmediately}
                    onChange={(e) => setAssignImmediately(e.target.checked)}
                    className="rounded border-[var(--ac-border-strong)] accent-[var(--ac-primary)]"
                  />
                  <span>加入后立即由主管为其安排分工</span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => setShowAddMember(false)}
                  className="h-8 rounded-xl border border-[#E4E4EC] bg-white px-3 text-[12px] text-[#555866] cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={addingMember}
                  className="h-8 rounded-xl bg-[var(--ac-primary)] px-3.5 text-[12px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-45 cursor-pointer"
                >
                  {addingMember ? '加入中...' : '确认加入'}
                </button>
              </div>
            </form>
          )}

          {agents.map((slot) => {
            const isWorking = slot.state === 'working';
            const isEditing = editingSlotId === slot.slotId;
            const engineModels = getModelsForEngine(slot.engine, modelsByEngine);
            const modelOptions = engineModels.map((m) => ({ value: m.id, label: m.label }));

            const modelEfforts = getEffortsForModel(slot.engine, slot.modelId, modelsByEngine);
            const effortOptions = modelEfforts.map((eff) => ({ value: eff, label: eff }));

            const resumeCmd = buildResumeCommand(slot.engine, slot.nativeSessionId);
            const engCard = availableEngines?.find((e) => e.id === slot.engine);
            const isEngineUninstalled = Boolean(
              board.executionMode !== 'demo' && engCard && !engCard.installed
            );
            let quotaBadgeText = '';
            if (engCard?.quotaBars?.length) {
              const targetBar =
                slot.engine === 'antigravity' && slot.modelId.includes('claude')
                  ? engCard.quotaBars.find((b) => b.label.includes('Claude 5h')) || engCard.quotaBars[0]
                  : engCard.quotaBars[0];
              if (targetBar) {
                quotaBadgeText = `5h余量 ${targetBar.remainingPercent}%`;
              }
            } else if (slot.engine === 'codebuddy' && engCard?.installed) {
              quotaBadgeText = '积分就绪';
            }

            return (
              <div
                key={slot.id}
                className={`rounded-2xl border p-4 transition ${
                  isWorking
                    ? 'border-[#BFB4DF] bg-[var(--ac-tint)]'
                    : 'border-[#EAEAEF] bg-[#FCFCFD] hover:border-[#DCDCE4]'
                }`}
              >
                {/* Row 1: Native Icon + Name + Actions + Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white border border-[#ECECF2] shadow-2xs">
                      <EngineIcon engine={slot.engine} size={22} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => onSelectTargetSlot(slot.slotId)}
                          className="text-[14.5px] font-bold text-[#1F2024] hover:text-[var(--ac-primary)] truncate cursor-pointer"
                        >
                          {slot.displayName}
                        </button>
                        {slot.isLeader && (
                          <span className="rounded-md bg-[var(--ac-soft-hover)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ac-deep)]">
                            主管
                          </span>
                        )}
                        {slot.roleAutoAssigned && !slot.isLeader && (
                          <span className="rounded-md bg-[#F4F3F8] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--ac-primary)]">
                            待自动定岗
                          </span>
                        )}
                      </div>
                      <div className="text-[12.5px] text-[#7A7D89] truncate mt-0.5">
                        {slot.roleTitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                    {!isWorking && (
                      <>
                        <button
                          type="button"
                          onClick={() => (isEditing ? setEditingSlotId(null) : startEditSlot(slot))}
                          title="编辑称呼与职责"
                          aria-label={`编辑 ${slot.displayName}`}
                          className="rounded-lg p-1 text-[#9A9DA8] hover:bg-[#EFEFF5] hover:text-[var(--ac-text)] cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {!slot.isLeader && agents.length > 1 && onRemoveAgent && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveSlot(slot)}
                            title="移除此成员"
                            aria-label={`移除 ${slot.displayName}`}
                            className="rounded-lg p-1 text-[#9A9DA8] hover:bg-[#FDF2F0] hover:text-[#A65850] cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                    {isWorking ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ac-primary)] pl-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 运行中
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12px] text-[#7A7D89] pl-1">
                        <Circle className="h-2 w-2 fill-[#5BA97B] text-[#5BA97B]" /> 待命
                      </span>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 rounded-xl border border-[var(--ac-border)] bg-white p-2.5 space-y-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="成员称呼"
                      aria-label="编辑成员称呼"
                      className="h-8 w-full rounded-lg border border-[#E4E4EC] px-2.5 text-[12.5px] font-medium focus:border-[var(--ac-mid)] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={editRoleTitle}
                      onChange={(e) => setEditRoleTitle(e.target.value)}
                      placeholder="职责标题（留空可交由主管自动分配）"
                      aria-label="编辑成员职责标题"
                      className="h-8 w-full rounded-lg border border-[#E4E4EC] px-2.5 text-[12.5px] focus:border-[var(--ac-mid)] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={editRoleBrief}
                      onChange={(e) => setEditRoleBrief(e.target.value)}
                      placeholder="详细分工说明（选填）"
                      aria-label="编辑成员职责说明"
                      className="h-8 w-full rounded-lg border border-[#E4E4EC] px-2.5 text-[12px] focus:border-[var(--ac-mid)] focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        {!slot.isLeader && (
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateAgent(slot.slotId, { isLeader: true });
                              setEditingSlotId(null);
                            }}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--ac-soft)] px-2 text-[11.5px] font-medium text-[var(--ac-text)] hover:bg-[#EAE5F6] cursor-pointer"
                          >
                            <Crown className="h-3 w-3" /> 设为主管
                          </button>
                        )}
                        {!slot.isLeader && (
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateAgent(slot.slotId, { roleAutoAssigned: true });
                              setEditingSlotId(null);
                            }}
                            className="h-7 rounded-lg border border-[#E4E4EC] px-2 text-[11.5px] text-[#6E717C] hover:bg-[#F5F5F9] cursor-pointer"
                          >
                            交由主管自动分配
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingSlotId(null)}
                          className="h-7 rounded-lg px-2 text-[11.5px] text-[#7A7D89] hover:bg-[#F4F4F7] cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEditSlot(slot)}
                          className="h-7 rounded-lg bg-[var(--ac-primary)] px-2.5 text-[11.5px] font-semibold text-white cursor-pointer"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row 2: Strictly Aligned Engine + Model Custom SelectMenus */}
                <div className="mt-3.5 grid grid-cols-[124px_1fr] gap-2">
                  <SelectMenu
                    value={slot.engine}
                    options={engineMenuOptions}
                    onChange={(val) => {
                      const nextEng = val as EngineId;
                      const nextModels = getModelsForEngine(nextEng, modelsByEngine);
                      const engineCard = availableEngines?.find((e) => e.id === nextEng);
                      const preferredMod =
                        (engineCard?.defaultModel &&
                          nextModels.find((m) => m.id === engineCard.defaultModel)) ||
                        nextModels[0];
                      const validEffs = preferredMod?.efforts?.length
                        ? preferredMod.efforts
                        : ['low', 'medium', 'high'];
                      const preferredEff = engineCard?.defaultEffort;
                      const nextEff =
                        preferredEff && validEffs.includes(preferredEff)
                          ? preferredEff
                          : validEffs.includes(slot.reasoningEffort)
                            ? slot.reasoningEffort
                            : preferredMod?.defaultEffort || validEffs[0] || 'high';
                      onUpdateAgent(slot.slotId, {
                        engine: nextEng,
                        modelId: preferredMod?.id,
                        reasoningEffort: nextEff,
                      });
                    }}
                  />
                  <SelectMenu
                    value={slot.modelId}
                    options={modelOptions}
                    align="right"
                    onChange={(val) => {
                      const nextMod = engineModels.find((m) => m.id === val);
                      const validEffs = nextMod?.efforts?.length ? nextMod.efforts : ['low', 'medium', 'high'];
                      const nextEff = validEffs.includes(slot.reasoningEffort)
                        ? slot.reasoningEffort
                        : nextMod?.defaultEffort || validEffs[0] || 'high';
                      onUpdateAgent(slot.slotId, { modelId: val, reasoningEffort: nextEff });
                    }}
                  />
                </div>

                {/* Row 3: Pixel-Aligned Native Model Reasoning Effort Selector */}
                <div className="mt-2 grid grid-cols-[124px_1fr] items-center gap-2">
                  <div className="flex h-9 items-center rounded-xl bg-[#F4F3F8] px-3 text-[12.5px] font-medium text-[#666975]">
                    思考强度
                  </div>
                  <SelectMenu
                    value={slot.reasoningEffort}
                    options={effortOptions}
                    align="right"
                    onChange={(val) => onUpdateAgent(slot.slotId, { reasoningEffort: val })}
                  />
                </div>

                {isEngineUninstalled && (
                  <div className="mt-2 rounded-xl bg-[#FCF5EA] px-3 py-1.5 text-[11.5px] text-[#9C6A29]">
                    当前环境未检测到该引擎命令行，请先安装或切换其他可用引擎
                  </div>
                )}

                {/* Row 4: Clean Footer + Per-Agent Live Quota Hint */}
                <div className="mt-2.5 pt-2.5 border-t border-[#F2F2F6] flex items-center justify-between text-[12px] text-[#8A8D98]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      title={`累计消耗 ${slot.inputTokens + slot.outputTokens} Tokens · 最近单轮上下文约 ${slot.contextPercent}%`}
                    >
                      对话 {slot.turnCount} 轮
                    </span>
                    {quotaBadgeText && (
                      <>
                        <span className="text-[#D4D5DE]">·</span>
                        <span className="text-[var(--ac-deep)] font-medium truncate">{quotaBadgeText}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    {resumeCmd && slot.persistedInNativeApp && board.executionMode !== 'demo' && (
                      isLocalhost ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleOpenSession(slot)}
                            disabled={openingSlot === slot.slotId}
                            title="在本地终端窗口查看并续接该命令行对话"
                            className="inline-flex items-center gap-1 text-[var(--ac-deep)] font-medium hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>{openingSlot === slot.slotId ? '唤起中...' : '查看命令行会话'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyResume(slot)}
                            title={copiedSlot === slot.slotId ? '已复制续接命令' : `复制续接命令：${resumeCmd}`}
                            aria-label="复制续接命令"
                            className="inline-flex items-center text-[#8A8D98] hover:text-[var(--ac-text)] cursor-pointer"
                          >
                            {copiedSlot === slot.slotId ? (
                              <Check className="h-3 w-3 text-[#458964]" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCopyResume(slot)}
                          className="inline-flex items-center gap-1 text-[var(--ac-deep)] hover:underline cursor-pointer"
                        >
                          {copiedSlot === slot.slotId ? (
                            <>
                              <Check className="h-3 w-3" /> 已复制
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> 复制命令
                            </>
                          )}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => setLogModalSlot(slot)}
                      className="inline-flex items-center gap-1 hover:text-[#2C2E35] cursor-pointer"
                    >
                      <Terminal className="h-3.5 w-3.5" /> 轨迹
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Tab 2: Phase 2 Graphical Safety Snapshots & One-Click Restore */
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          <button
            type="button"
            disabled={savingBackup}
            onClick={() => void handleManualBackup()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-tint)] text-[13.5px] font-semibold text-[var(--ac-text)] hover:bg-[#EDE8F7] transition cursor-pointer"
          >
            <BookmarkPlus className="h-4 w-4" />
            {savingBackup ? '正在保存当前备份...' : '保存当前安全备份点'}
          </button>

          {snapshots.length === 0 ? (
            <div className="rounded-2xl bg-[#FAFAFC] py-12 px-4 text-center text-[13.5px] text-[#8A8D98]">
              成员修改文件后将自动在此生成安全记录，随时可对比或撤回
            </div>
          ) : (
            snapshots.map((snap) => {
              const isExpanded = Boolean(expandedSnapFiles[snap.id]);
              const shownFiles = isExpanded ? snap.filesChanged : snap.filesChanged.slice(0, 12);
              const hiddenCount = Math.max(0, snap.filesChanged.length - shownFiles.length);
              const isCheckpointStyle =
                snap.kind === 'manual_checkpoint' || snap.kind === 'pre_overwrite_backup';

              return (
                <div
                  key={snap.id}
                  className="rounded-2xl border border-[#EAEAEF] bg-[#FCFCFD] p-4 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[14px] font-bold text-[#1F2024] truncate">
                          {snap.label}
                        </span>
                        {snap.kind === 'failed_turn' && (
                          <span className="rounded-md bg-[#FCF4E8] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#9C6A29]">
                            失败前改动
                          </span>
                        )}
                        {snap.kind === 'pre_overwrite_backup' && (
                          <span className="rounded-md bg-[var(--ac-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--ac-deep)]">
                            覆盖前保护
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[#8A8D98]">
                        {snap.authorName} · {snap.fileCount} 个文件 · {formatRelativeTime(snap.createdAt)}
                      </div>
                      {snap.skippedSummary && (
                        <div className="mt-0.5 text-[11px] text-[#9A9DA8]">{snap.skippedSummary}</div>
                      )}
                      {typeof snap.postCheckpointAddedCount === 'number' &&
                        snap.postCheckpointAddedCount > 0 && (
                          <div className="mt-0.5 text-[11px] text-[#529471]">
                            已保留备份后新增的 {snap.postCheckpointAddedCount} 个文件
                          </div>
                        )}
                    </div>
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold flex-shrink-0 ${
                        snap.status === 'reverted'
                          ? 'bg-[#FAEDEC] text-[#A65850]'
                          : snap.status === 'adopted'
                            ? 'bg-[#EBF6F0] text-[#458964]'
                            : 'bg-[var(--ac-soft)] text-[var(--ac-deep)]'
                      }`}
                    >
                      {snap.status === 'reverted'
                        ? '已撤回'
                        : snap.status === 'adopted'
                          ? '已保存'
                          : '待确认'}
                    </span>
                  </div>

                  {snap.filesChanged?.length > 0 && onPreviewFile && (
                    <div className="space-y-1.5 pt-0.5">
                      <div className="flex flex-wrap gap-1.5">
                        {shownFiles.map((fc) => (
                          <button
                            type="button"
                            key={fc.path}
                            onClick={() => onPreviewFile(fc.path)}
                            title="点击预览当前文件内容"
                            className="rounded-lg border border-[#E6E6EC] bg-white px-2 py-0.5 font-mono text-[11.5px] text-[#4B4D57] hover:border-[var(--ac-mid)] hover:text-[var(--ac-text)] transition truncate max-w-full cursor-pointer"
                          >
                            {fc.path}
                          </button>
                        ))}
                      </div>
                      {snap.filesChanged.length > 12 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSnapFiles((prev) => ({
                              ...prev,
                              [snap.id]: !prev[snap.id],
                            }))
                          }
                          className="text-[11.5px] font-medium text-[var(--ac-deep)] hover:underline cursor-pointer"
                        >
                          {isExpanded
                            ? '收起部分文件'
                            : `展开其余 ${hiddenCount} 个文件（共 ${snap.filesChanged.length} 个）`}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F2F2F6]">
                    <button
                      type="button"
                      onClick={() => onOpenSnapshotDiff(snap.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#E4E4EC] bg-white px-3 text-[12.5px] font-medium text-[#3C3E47] hover:bg-[#F7F7FA] cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" /> 对比查看
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRevertSnapshot(snap.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#E5D7D5] bg-[#FDF8F7] px-3 text-[12.5px] font-medium text-[#A65850] hover:bg-[#F9ECEA] cursor-pointer"
                    >
                      {isCheckpointStyle ? (
                        <>
                          <History className="h-3.5 w-3.5" /> 还原到此步
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" /> 一键撤回
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Raw Logs Modal */}
      {logModalSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl border border-[#EAEAEF]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <EngineIcon engine={logModalSlot.engine} size={22} />
                <h4 className="text-[16px] font-bold text-[#1F2024]">
                  {logModalSlot.displayName} · 底层运行记录
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setLogModalSlot(null)}
                aria-label="关闭运行记录窗口"
                className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#1E1F26] text-[#D8DAE2] p-4 font-mono text-[12.5px] leading-relaxed h-80 overflow-y-auto">
              {(liveLogsBySlot[logModalSlot.slotId] ?? fetchedLogs).length === 0 ? (
                <div className="text-[#7A7D89]">当前暂无执行日志</div>
              ) : (
                (liveLogsBySlot[logModalSlot.slotId] ?? fetchedLogs).map((line, i) => (
                  <div key={i} className="py-0.5 break-all border-b border-white/5">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
