import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Crown,
  FolderOpen,
  FolderPlus,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CustomMemberDraft,
  EngineId,
  EngineStatusCard,
  ModelOption,
  ReasoningEffort,
  SessionSyncMode,
  TeamPreset,
} from '../types';
import { ENGINE_OPTIONS, getEffortsForModel, getModelsForEngine } from '../utils/format';
import { apiFetch } from '../utils/api';
import { EngineIcon } from './BrandIcon';
import { SelectMenu } from './SelectMenu';
import { FolderPickerModal } from './FolderPickerModal';

const RECENT_WORKSPACES_KEY = 'cowork_recent_workspaces_v1';

function normalizePathForDedupe(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const stripped = trimmed.length > 3 ? trimmed.replace(/[\\/]+$/, '') : trimmed;
  return stripped.toLowerCase();
}

function dedupePaths(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const trimmed = item.trim();
    const cleaned = trimmed.length > 3 ? trimmed.replace(/[\\/]+$/, '') : trimmed;
    const key = normalizePathForDedupe(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function loadRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(arr) ? dedupePaths(arr.map(String)).slice(0, 4) : [];
  } catch {
    return [];
  }
}

function saveRecentWorkspace(ws: string): void {
  const clean = ws.trim();
  if (!clean) return;
  try {
    const next = dedupePaths([clean, ...loadRecentWorkspaces()]).slice(0, 4);
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

interface EditableMemberDraft extends CustomMemberDraft {
  slotId: string;
  displayName: string;
  roleTitle: string;
  roleBrief: string;
  roleAutoAssigned: boolean;
  isLeader: boolean;
  engine: EngineId;
  modelId: string;
  reasoningEffort: ReasoningEffort;
  avatarColor: string;
}

interface NewBoardModalProps {
  open: boolean;
  presets: TeamPreset[];
  availableEngines?: EngineStatusCard[];
  modelsByEngine: Record<string, ModelOption[]>;
  recentWorkspaces?: string[];
  defaultPresetId?: string;
  defaultWorkspace?: string;
  onClose: () => void;
  onOpenDispatchSettings?: () => void;
  onOpenDesktopMcpModal?: () => void;
  onCreate: (payload: {
    title: string;
    workspacePath: string;
    presetId: string;
    sessionSyncMode?: SessionSyncMode;
    engineOverrides: Record<string, EngineId>;
    modelOverrides: Record<string, string>;
    effortOverrides: Record<string, ReasoningEffort>;
    customMembers?: CustomMemberDraft[];
    initialDirective: string;
  }) => Promise<void>;
}

export const NewBoardModal: React.FC<NewBoardModalProps> = ({
  open,
  presets,
  availableEngines,
  modelsByEngine,
  recentWorkspaces = [],
  defaultPresetId,
  defaultWorkspace,
  onClose,
  onOpenDispatchSettings,
  onOpenDesktopMcpModal,
  onCreate,
}) => {
  const [presetId, setPresetId] = useState(defaultPresetId || 'fullstack-dev');
  const [title, setTitle] = useState('');
  const [workspacePath, setWorkspacePath] = useState(defaultWorkspace || '');
  const [recentList, setRecentList] = useState<string[]>([]);
  const [members, setMembers] = useState<EditableMemberDraft[]>([]);
  const [initialDirective, setInitialDirective] = useState('');
  const [folderRequiredError, setFolderRequiredError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creatingDemoDir, setCreatingDemoDir] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const seededKeyRef = useRef('');

  useEffect(() => {
    if (defaultPresetId) setPresetId(defaultPresetId);
  }, [defaultPresetId]);

  useEffect(() => {
    if (!open) {
      seededKeyRef.current = '';
      setSubmitError(null);
      return;
    }
    const mergedRecent = dedupePaths([...loadRecentWorkspaces(), ...recentWorkspaces]).slice(0, 4);
    setRecentList(mergedRecent);
    setFolderRequiredError(false);
    setSubmitError(null);
    setWorkspacePath(defaultWorkspace || '');
    setRosterExpanded(presetId === 'free-collab');
  }, [open, defaultWorkspace, recentWorkspaces, presetId]);

  useEffect(() => {
    if (!open) return;
    const preset = presets.find((p) => p.id === presetId) || presets[0];
    if (!preset) return;
    const nextSeedKey = `${preset.id}:${open}`;
    if (seededKeyRef.current === nextSeedKey) return;
    seededKeyRef.current = nextSeedKey;

    const firstInstalled = availableEngines?.find((e) => e.installed)?.id;
    const resolvedMembers: EditableMemberDraft[] = preset.members.map((m) => {
      const preferredCard = availableEngines?.find((e) => e.id === m.defaultEngine);
      const chosenEngine: EngineId =
        availableEngines?.length && preferredCard && !preferredCard.installed && firstInstalled
          ? firstInstalled
          : m.defaultEngine;
      const chosenCard = availableEngines?.find((e) => e.id === chosenEngine);
      const engineModels = getModelsForEngine(chosenEngine, modelsByEngine);
      const targetModelId = chosenCard?.hasCustomDefault
        ? chosenCard.defaultModel
        : chosenEngine === m.defaultEngine
          ? m.defaultModel
          : chosenCard?.defaultModel || engineModels[0]?.id;
      const chosenMod =
        engineModels.find((x) => x.id === targetModelId) || engineModels[0];
      const chosenModelId = chosenMod?.id || targetModelId || m.defaultModel;
      const effs = chosenMod?.efforts?.length ? chosenMod.efforts : ['low', 'medium', 'high'];
      const targetEffort = chosenCard?.hasCustomDefault
        ? chosenCard.defaultEffort
        : chosenEngine === m.defaultEngine
          ? m.defaultEffort
          : chosenCard?.defaultEffort || chosenMod?.defaultEffort;
      const chosenEffort =
        targetEffort && effs.includes(targetEffort)
          ? targetEffort
          : chosenMod?.defaultEffort || effs[0] || 'high';

      const isAuto = Boolean(m.roleAutoAssigned);
      return {
        slotId: m.slotId,
        displayName: m.displayName,
        roleTitle: isAuto ? '' : m.roleTitle,
        roleBrief: isAuto ? '' : m.roleBrief,
        roleAutoAssigned: isAuto,
        isLeader: m.isLeader,
        engine: chosenEngine,
        modelId: chosenModelId,
        reasoningEffort: chosenEffort,
        avatarColor: m.avatarColor,
      };
    });
    setMembers(resolvedMembers);
    const leaderObj = resolvedMembers.find((x) => x.isLeader) || resolvedMembers[0];
    const leaderCard = availableEngines?.find((x) => x.id === leaderObj?.engine);
    if (preset.id === 'free-collab' || (leaderCard && !leaderCard.installed)) {
      setRosterExpanded(true);
    }
  }, [open, presetId, presets, availableEngines, modelsByEngine]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !folderPickerOpen) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, folderPickerOpen, onClose]);

  if (!open) return null;

  const activePreset = presets.find((p) => p.id === presetId) || presets[0];

  const engineMenuOptions = availableEngines?.length
    ? availableEngines.map((e) => ({
        value: e.id,
        label: e.name,
        badge: e.installed ? '可用' : '未装',
        muted: !e.installed,
      }))
    : ENGINE_OPTIONS.map((e) => ({ value: e.id, label: e.label }));

  const leaderMember = members.find((m) => m.isLeader) || members[0];
  const leaderEngineCard = availableEngines?.find((e) => e.id === leaderMember?.engine);
  const isLeaderEngineMissing = Boolean(
    availableEngines?.length && leaderMember && leaderEngineCard && !leaderEngineCard.installed
  );
  const installedCount = availableEngines?.filter((e) => e.installed).length ?? 0;

  const hasUninstalledMember = Boolean(
    availableEngines?.length &&
      members.some((m) => {
        const card = availableEngines.find((x) => x.id === m.engine);
        return card && !card.installed;
      })
  );

  const handleQuickCreatePracticeFolder = async () => {
    setCreatingDemoDir(true);
    setSubmitError(null);
    try {
      const res = await apiFetch('/api/fs/browse');
      if (!res.ok) throw new Error('无法读取本地默认目录');
      const data = (await res.json()) as {
        currentPath: string;
        roots?: Array<{ label: string; path: string }>;
      };
      const baseParent =
        data.roots?.find((r) => r.label === '文档')?.path || data.currentPath;
      const mkRes = await apiFetch('/api/fs/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: baseParent, name: 'AgentSwarm-Demo' }),
      });
      if (!mkRes.ok) {
        const err = (await mkRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || '新建练习目录失败');
      }
      const mkData = (await mkRes.json()) as { path: string };
      setWorkspacePath(mkData.path);
      setFolderRequiredError(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingDemoDir(false);
    }
  };

  const handleMemberEngineChange = (idx: number, nextEngine: EngineId) => {
    const models = getModelsForEngine(nextEngine, modelsByEngine);
    const engineCard = availableEngines?.find((e) => e.id === nextEngine);
    const preferredMod =
      (engineCard?.defaultModel && models.find((x) => x.id === engineCard.defaultModel)) ||
      models[0];
    const validEffs = preferredMod?.efforts?.length ? preferredMod.efforts : ['low', 'medium', 'high'];
    setMembers((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        const preferredEff = engineCard?.defaultEffort;
        const nextEff =
          preferredEff && validEffs.includes(preferredEff)
            ? preferredEff
            : validEffs.includes(m.reasoningEffort)
              ? m.reasoningEffort
              : preferredMod?.defaultEffort || validEffs[0] || 'high';
        return {
          ...m,
          engine: nextEngine,
          modelId: preferredMod?.id || '',
          reasoningEffort: nextEff,
        };
      })
    );
  };

  const handleAddMember = () => {
    const firstCard = availableEngines?.find((e) => e.installed);
    const firstInstalled = firstCard?.id || 'antigravity';
    const models = getModelsForEngine(firstInstalled, modelsByEngine);
    const preferredMod =
      (firstCard?.defaultModel && models.find((x) => x.id === firstCard.defaultModel)) || models[0];
    const effs = preferredMod?.efforts?.length ? preferredMod.efforts : ['low', 'medium', 'high'];
    const preferredEff =
      firstCard?.defaultEffort && effs.includes(firstCard.defaultEffort)
        ? firstCard.defaultEffort
        : preferredMod?.defaultEffort || effs[0] || 'high';
    const usedIds = new Set(members.map((m) => m.slotId));
    let n = 1;
    while (usedIds.has(`member_${n}`)) n++;
    const nextSlotId = `member_${n}`;

    setMembers((prev) => [
      ...prev,
      {
        slotId: nextSlotId,
        displayName: `协同成员 ${prev.length}`,
        roleTitle: '',
        roleBrief: '',
        roleAutoAssigned: true,
        isLeader: false,
        engine: firstInstalled,
        modelId: preferredMod?.id || '',
        reasoningEffort: preferredEff,
        avatarColor: '#6B8EAD',
      },
    ]);
  };

  const handleSetLeader = (targetIdx: number) => {
    setMembers((prev) =>
      prev.map((m, i) => ({
        ...m,
        isLeader: i === targetIdx,
        roleAutoAssigned: i === targetIdx ? false : m.roleAutoAssigned,
        roleTitle: i === targetIdx && !m.roleTitle.trim() ? '统筹拆解与验收' : m.roleTitle,
      }))
    );
  };

  const handleRemoveMember = (targetIdx: number) => {
    setMembers((prev) => {
      if (prev.length <= 1 || prev[targetIdx]?.isLeader) return prev;
      return prev.filter((_, i) => i !== targetIdx);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!workspacePath.trim()) {
      setFolderRequiredError(true);
      return;
    }
    setSubmitting(true);
    try {
      saveRecentWorkspace(workspacePath);
      const engineOverrides: Record<string, EngineId> = {};
      const modelOverrides: Record<string, string> = {};
      const effortOverrides: Record<string, ReasoningEffort> = {};
      const customMembers: CustomMemberDraft[] = members.map((m) => {
        engineOverrides[m.slotId] = m.engine;
        modelOverrides[m.slotId] = m.modelId;
        effortOverrides[m.slotId] = m.reasoningEffort;
        const cleanRole = m.roleTitle.trim();
        const autoRole = !m.isLeader && !cleanRole;
        return {
          slotId: m.slotId,
          displayName: m.displayName.trim() || (m.isLeader ? '总控主管' : '协同成员'),
          roleTitle: cleanRole || undefined,
          roleBrief: m.roleBrief.trim() || cleanRole || undefined,
          roleAutoAssigned: autoRole,
          isLeader: m.isLeader,
          engine: m.engine,
          modelId: m.modelId,
          reasoningEffort: m.reasoningEffort,
          avatarColor: m.avatarColor,
        };
      });

      await onCreate({
        title: title.trim() || `${activePreset?.name || '团队'}会话`,
        workspacePath: workspacePath.trim(),
        presetId,
        engineOverrides,
        modelOverrides,
        effortOverrides,
        customMembers,
        initialDirective,
      });
      setTitle('');
      setInitialDirective('');
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-4 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[760px] rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-[#EAEAEF] my-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[18px] font-bold text-[#1F2024]">新建协同看板</h3>
            <p className="text-[12.5px] text-[#7A7D89] mt-0.5">
              按「选定目录 → 检查主管可用性 → 发送首个任务」三步即可开跑，进阶设置可按需展开
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭新建协同看板"
            className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {submitError && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[#EED7D4] bg-[#FDF5F4] px-3.5 py-2.5 text-[12.5px] text-[#943F37]">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-[#B65B50]" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="space-y-4">
          {/* Step 1: Project Folder + Practice Folder Helper */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="block text-[14px] font-semibold text-[#2C2E35]">
                1. 选择项目文件夹
              </label>
              <button
                type="button"
                disabled={creatingDemoDir}
                onClick={() => void handleQuickCreatePracticeFolder()}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ac-border)] bg-[var(--ac-tint)] px-2.5 text-[11.5px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-soft)] disabled:opacity-50 cursor-pointer"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {creatingDemoDir ? '创建中...' : '在「文档」新建练习文件夹'}
              </button>
            </div>

            <div
              className={`flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 ${
                folderRequiredError && !workspacePath.trim()
                  ? 'border-[#DBA9A3] bg-[#FDF5F4]'
                  : 'border-[#E4E4EC] bg-[#FAFAFC]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white border border-[#ECECF2] text-[var(--ac-primary)]">
                  <FolderOpen className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  {workspacePath.trim() ? (
                    <>
                      <div className="text-[14px] font-semibold text-[#1F2024] truncate">
                        {workspacePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || workspacePath}
                      </div>
                      <div className="text-[12px] text-[#7A7D89] font-mono break-all" title={workspacePath}>
                        {workspacePath}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[13.5px] font-semibold text-[#4B4D57]">
                        尚未选定项目文件夹
                      </div>
                      <div className="text-[12px] text-[#8E919C]">
                        智能体会在这个文件夹内阅读或修改文件（系统安装目录与磁盘根目录将被保护拦截）
                      </div>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFolderPickerOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D8D2EC] bg-white px-3.5 text-[13px] font-semibold text-[var(--ac-text)] hover:bg-[#F5F3FB] transition flex-shrink-0 cursor-pointer"
              >
                <FolderOpen className="h-3.5 w-3.5" /> 选择文件夹
              </button>
            </div>

            {recentList.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[12px] text-[#8E919C]">近期目录：</span>
                {recentList.map((dir) => {
                  const selected = dir === workspacePath;
                  const short = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
                  return (
                    <button
                      type="button"
                      key={dir}
                      onClick={() => {
                        setWorkspacePath(dir);
                        setFolderRequiredError(false);
                        setSubmitError(null);
                      }}
                      title={dir}
                      className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition cursor-pointer ${
                        selected
                          ? 'bg-[var(--ac-soft-hover)] text-[var(--ac-text)] font-semibold'
                          : 'bg-[#F3F3F7] text-[#555866] hover:bg-[#EAEAF2]'
                      }`}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
            )}

            {folderRequiredError && !workspacePath.trim() && (
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#A65850]">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>创建看板前，请先选择项目文件夹或点击右上角一键新建练习文件夹</span>
              </div>
            )}
          </div>

          {/* Step 2: Template & Leader Status + Board Name */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[14px] font-semibold text-[#2C2E35] mb-1.5">
                  2. 看板名称（选填）
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：网站首页改版"
                  className="h-10 w-full rounded-xl border border-[#E4E4EC] px-3.5 text-[14px] focus:border-[var(--ac-mid)] focus:outline-none"
                />
              </div>

              <div className="flex flex-col justify-end">
                <div
                  className={`flex h-10 items-center justify-between rounded-xl border px-3 text-[12.5px] ${
                    isLeaderEngineMissing
                      ? 'border-[#EFE2CE] bg-[#FCF7EF] text-[#8E5F24]'
                      : 'border-[#DCECE2] bg-[#F4FAF6] text-[#357350]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 min-w-0 truncate">
                    {leaderMember && <EngineIcon engine={leaderMember.engine} size={16} />}
                    <span className="truncate font-medium">
                      主管：{leaderMember?.displayName || '总控主管'}（
                      {leaderEngineCard?.name || leaderMember?.engine}）
                    </span>
                  </span>
                  <span className="font-semibold flex-shrink-0 ml-2">
                    {isLeaderEngineMissing
                      ? installedCount === 0
                        ? '本机无 CLI'
                        : '未安装'
                      : '已就绪'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-[#555866] mb-1.5">
                团队模板
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {presets.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPresetId(p.id)}
                    className={`rounded-2xl border p-3 text-left transition cursor-pointer ${
                      presetId === p.id
                        ? 'border-[#8D7EC0] bg-[var(--ac-tint)]'
                        : 'border-[#EAEAEF] hover:border-[#D6D6E0]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-bold text-[#1F2024]">{p.name}</span>
                      <span className="rounded-md bg-[#F1F0F6] px-2 py-0.5 text-[11px] font-medium text-[var(--ac-deep)]">
                        {p.badge}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#7A7D89] mt-1">{p.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Progressive Collapsible Advanced Member Roster */}
          <div className="rounded-2xl bg-[#F8F8FB] border border-[#EFEFF4] overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setRosterExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3C3E47] cursor-pointer"
              >
                {rosterExpanded ? (
                  <ChevronDown className="h-4 w-4 text-[var(--ac-primary)]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-[#8A8D98]" />
                )}
                <span>进阶：调整成员、模型与分工规则（{members.length} 人）</span>
                {hasUninstalledMember && (
                  <span className="ml-1 rounded-md bg-[#FCF4E8] px-1.5 py-0.5 text-[11px] font-medium text-[#A26D32]">
                    含未安装引擎
                  </span>
                )}
              </button>

              {rosterExpanded && (
                <div className="flex items-center gap-2">
                  {onOpenDispatchSettings && (
                    <button
                      type="button"
                      onClick={onOpenDispatchSettings}
                      className="inline-flex h-7.5 items-center gap-1 rounded-xl border border-[#E2DFEE] bg-white px-2.5 text-[12px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-soft)] cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3 w-3" /> 全局分工偏好
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddMember}
                    className="inline-flex h-7.5 items-center gap-1 rounded-xl bg-[var(--ac-primary)] px-3 text-[12px] font-semibold text-white hover:bg-[var(--ac-hover)] transition cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加成员
                  </button>
                </div>
              )}
            </div>

            {rosterExpanded && (
              <div className="px-4 pb-3.5 pt-1 space-y-2 max-h-[270px] overflow-y-auto">
                {members.map((m, idx) => {
                  const engineModels = getModelsForEngine(m.engine, modelsByEngine);
                  const models = engineModels.map((x) => ({ value: x.id, label: x.label }));
                  const nativeEfforts = getEffortsForModel(m.engine, m.modelId, modelsByEngine);
                  const curEff = nativeEfforts.includes(m.reasoningEffort)
                    ? m.reasoningEffort
                    : nativeEfforts[0] || 'high';
                  const isAuto = !m.isLeader && !m.roleTitle.trim();

                  return (
                    <div
                      key={`${m.slotId}-${idx}`}
                      className="rounded-xl bg-white p-3 border border-[#EAEAEF] space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <EngineIcon engine={m.engine} size={18} />
                          <input
                            type="text"
                            value={m.displayName}
                            aria-label={`成员 ${idx + 1} 称呼`}
                            onChange={(e) =>
                              setMembers((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, displayName: e.target.value } : x
                                )
                              )
                            }
                            placeholder="成员称呼"
                            className="h-7.5 w-28 sm:w-36 rounded-lg border border-transparent hover:border-[#E4E4EC] focus:border-[var(--ac-mid)] bg-transparent focus:bg-[#FAFAFC] px-1.5 text-[13.5px] font-bold text-[#1F2024] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSetLeader(idx)}
                            className={`inline-flex h-6.5 items-center gap-1 rounded-md px-2 text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition cursor-pointer ${
                              m.isLeader
                                ? 'bg-[var(--ac-soft-hover)] text-[var(--ac-text)]'
                                : 'bg-[#F4F4F7] text-[#7A7D89] hover:bg-[#ECEAF5] hover:text-[var(--ac-text)]'
                            }`}
                          >
                            <Crown className="h-3 w-3 flex-shrink-0" />
                            <span>{m.isLeader ? '主管' : '设为主管'}</span>
                          </button>
                          {isAuto && (
                            <span className="rounded-md bg-[#F5F3FA] px-2 py-0.5 text-[11px] font-medium text-[var(--ac-primary)] whitespace-nowrap flex-shrink-0">
                              由主管自动分配职责
                            </span>
                          )}
                        </div>

                        {members.length > 1 && !m.isLeader && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(idx)}
                            title="移除此成员"
                            aria-label={`移除 ${m.displayName || `成员 ${idx + 1}`}`}
                            className="rounded-lg p-1.5 text-[#9A9DA8] hover:bg-[#FDF2F0] hover:text-[#A65850] flex-shrink-0 transition cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <SelectMenu
                          value={m.engine}
                          options={engineMenuOptions}
                          ariaLabel={`${m.displayName || `成员 ${idx + 1}`} 引擎`}
                          onChange={(val) => handleMemberEngineChange(idx, val as EngineId)}
                        />
                        <SelectMenu
                          value={m.modelId}
                          options={models}
                          ariaLabel={`${m.displayName || `成员 ${idx + 1}`} 模型`}
                          onChange={(val) => {
                            const targetMod = engineModels.find((x) => x.id === val);
                            const effs = targetMod?.efforts?.length
                              ? targetMod.efforts
                              : ['low', 'medium', 'high'];
                            setMembers((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? {
                                      ...x,
                                      modelId: val,
                                      reasoningEffort: effs.includes(x.reasoningEffort)
                                        ? x.reasoningEffort
                                        : targetMod?.defaultEffort || effs[0] || 'high',
                                    }
                                  : x
                              )
                            );
                          }}
                        />
                        <SelectMenu
                          value={curEff}
                          align="right"
                          ariaLabel={`${m.displayName || `成员 ${idx + 1}`} 思考强度`}
                          options={nativeEfforts.map((eff) => ({
                            value: eff,
                            label: eff,
                          }))}
                          onChange={(val) =>
                            setMembers((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, reasoningEffort: val as ReasoningEffort } : x
                              )
                            )
                          }
                        />
                      </div>

                      <input
                        type="text"
                        value={m.roleTitle}
                        aria-label={`${m.displayName || `成员 ${idx + 1}`} 职责提示`}
                        onChange={(e) =>
                          setMembers((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    roleTitle: e.target.value,
                                    roleAutoAssigned: !x.isLeader && !e.target.value.trim(),
                                  }
                                : x
                            )
                          )
                        }
                        placeholder={
                          m.isLeader
                            ? '主管职责（默认：需求拆解、统筹分工与验收）'
                            : '职责提示（可选，留空则开局由主管结合模型与全局偏好自动定岗）'
                        }
                        className="h-8 w-full rounded-lg border border-[#ECECF2] bg-[#FAFAFC] px-2.5 text-[12.5px] text-[#3C3E47] placeholder:text-[#A2A5B0] focus:border-[var(--ac-mid)] focus:bg-white focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 3: Initial Task Prompt + Desktop MCP Tip */}
          <div>
            <label className="block text-[14px] font-semibold text-[#2C2E35] mb-1.5">
              3. 首条任务指令（选填）
            </label>
            <textarea
              rows={2}
              value={initialDirective}
              onChange={(e) => setInitialDirective(e.target.value)}
              placeholder="告诉主管你想完成什么目标；若留空，也可建好看板后再发消息..."
              className="w-full rounded-xl border border-[#E4E4EC] px-3.5 py-2.5 text-[14px] focus:border-[var(--ac-mid)] focus:outline-none"
            />
            {isLeaderEngineMissing && initialDirective.trim() && (
              <div className="mt-1.5 rounded-xl border border-[#EFE2CE] bg-[#FCF7EF] px-3 py-1.5 text-[12px] text-[#8E5F24]">
                当前主管使用的「{leaderEngineCard?.name}」尚未安装：点击创建后会先建好空白看板，并把这条消息安全保留在输入框草稿中，方便你切换到可用引擎后一键发送。
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EAE8F3] bg-[#F8F7FC] px-3.5 py-2 text-[12px] text-[#5F6270]">
            <span>
              本看板适合由网页/手机直接驱动命令行智能体；若你想让 Antigravity / CodeX 主对话担任主管，请从桌面端 MCP 建组。
            </span>
            {onOpenDesktopMcpModal && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDesktopMcpModal();
                }}
                className="font-semibold text-[var(--ac-hover)] hover:underline flex-shrink-0 cursor-pointer"
              >
                桌面端 MCP 接入
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl px-4 text-[14px] font-medium text-[#6E717C] hover:bg-[#F3F2F7] cursor-pointer"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-10 rounded-xl bg-[var(--ac-primary)] px-6 text-[14px] font-semibold text-white hover:bg-[var(--ac-hover)] disabled:opacity-45 cursor-pointer"
          >
            {submitting
              ? '创建中...'
              : isLeaderEngineMissing && initialDirective.trim()
                ? '创建看板（保留草稿）'
                : '创建'}
          </button>
        </div>
      </form>

      <FolderPickerModal
        open={folderPickerOpen}
        initialPath={workspacePath || undefined}
        title="选择项目工作区文件夹"
        onClose={() => setFolderPickerOpen(false)}
        onSelect={(chosen) => {
          setWorkspacePath(chosen);
          setFolderRequiredError(false);
          setSubmitError(null);
        }}
      />
    </div>
  );
};
