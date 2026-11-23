import type { EngineId, ReasoningEffort, TeamPreset } from '../../src/types.js';
import { getCatalogItem } from '../engines/catalog.js';

export function getDefaultModelForEngine(engine: EngineId): string {
  return getCatalogItem(engine).defaultModels[0]?.id || 'default';
}

export function getDefaultEffortForModel(engine: EngineId, modelId: string): ReasoningEffort {
  const item = getCatalogItem(engine);
  const matched = item.defaultModels.find((m) => m.id === modelId);
  return matched?.defaultEffort || matched?.efforts?.[0] || 'high';
}

export function resolveAntigravityCliModel(baseOrFullId: string, effort: ReasoningEffort): string {
  const stripped = baseOrFullId.replace(/-(low|medium|high|xhigh|max)$/i, '');
  const supportsXHigh = stripped === 'gemini-4-neon' || stripped === 'gemini-4-hydrogen';
  const normalized = ['low', 'medium', 'high', 'xhigh'].includes(effort) ? effort : 'high';
  const safeEffort = normalized === 'xhigh' && !supportsXHigh ? 'high' : normalized;
  return `${stripped}-${safeEffort}`;
}

export const TEAM_PRESETS: TeamPreset[] = [
  {
    id: 'free-collab',
    name: '自由协同',
    badge: '自定义',
    description: '自由增删成员与指定主管，未填职责由主管自动分配',
    tags: ['自定义人数', '主管自动定岗', '按需唤醒'],
    members: [
      {
        slotId: 'lead',
        displayName: '总控主管',
        roleTitle: '统筹拆解与验收',
        roleBrief: '接收需求、为未定岗成员分配职责、按需唤醒协作者并汇总把关。',
        roleAutoAssigned: false,
        isLeader: true,
        defaultEngine: 'antigravity',
        defaultModel: 'gemini-4-carbon',
        defaultEffort: 'high',
        avatarColor: '#7B6BA8',
      },
      {
        slotId: 'member_1',
        displayName: '协同成员 1',
        roleTitle: '待主管分配职责',
        roleBrief: '待主管结合任务目标、模型特长与全局分工偏好自动分配。',
        roleAutoAssigned: true,
        isLeader: false,
        defaultEngine: 'codex',
        defaultModel: 'gpt-6.2-sol',
        defaultEffort: 'high',
        avatarColor: '#62997A',
      },
      {
        slotId: 'member_2',
        displayName: '协同成员 2',
        roleTitle: '待主管分配职责',
        roleBrief: '待主管结合任务目标、模型特长与全局分工偏好自动分配。',
        roleAutoAssigned: true,
        isLeader: false,
        defaultEngine: 'codebuddy',
        defaultModel: 'deepseek-v4-pro',
        defaultEffort: 'medium',
        avatarColor: '#6B8EAD',
      },
    ],
  },
  {
    id: 'fullstack-dev',
    name: '研发工程团',
    badge: '闭环',
    description: '需求拆解、前后端实现到验收全流程闭环',
    tags: ['技术主管', '后端开发', '前端界面', '测试审查'],
    members: [
      {
        slotId: 'lead',
        displayName: '技术主管',
        roleTitle: '任务拆解与整合',
        roleBrief: '负责拆解前后端任务并把控交付质量。',
        isLeader: true,
        defaultEngine: 'antigravity',
        defaultModel: 'gemini-4-carbon',
        defaultEffort: 'high',
        avatarColor: '#7B6BA8',
      },
      {
        slotId: 'backend',
        displayName: '后端开发',
        roleTitle: '接口与数据处理',
        roleBrief: '负责数据存储、服务端接口与核心逻辑。',
        isLeader: false,
        defaultEngine: 'codex',
        defaultModel: 'gpt-6.2-sol',
        defaultEffort: 'high',
        avatarColor: '#62997A',
      },
      {
        slotId: 'frontend',
        displayName: '前端界面',
        roleTitle: '页面布局与交互',
        roleBrief: '负责桌面与手机端界面呈现及交互细节。',
        isLeader: false,
        defaultEngine: 'codebuddy',
        defaultModel: 'glm-5.3',
        defaultEffort: 'medium',
        avatarColor: '#8B74AD',
      },
      {
        slotId: 'qa',
        displayName: '测试审查',
        roleTitle: '构建与功能核验',
        roleBrief: '检查前后端衔接与运行报错，确保可用。',
        isLeader: false,
        defaultEngine: 'codex',
        defaultModel: 'codex-auto-review',
        defaultEffort: 'medium',
        avatarColor: '#B58B63',
      },
    ],
  },
  {
    id: 'council-review',
    name: '方案智囊团',
    badge: '研讨',
    description: '正反多视角交叉推演，输出稳妥决策建议',
    tags: ['主持人', '方案起草', '挑刺审视'],
    members: [
      {
        slotId: 'lead',
        displayName: '主持人',
        roleTitle: '议题组织与拍板总结',
        roleBrief: '明确讨论边界，汇总双方观点给出可执行结论。',
        isLeader: true,
        defaultEngine: 'antigravity',
        defaultModel: 'gemini-4-neon',
        defaultEffort: 'xhigh',
        avatarColor: '#7B6BA8',
      },
      {
        slotId: 'proposer',
        displayName: '方案起草',
        roleTitle: '可行路径设计',
        roleBrief: '提出清晰简洁的落地路径与步骤。',
        isLeader: false,
        defaultEngine: 'codebuddy',
        defaultModel: 'deepseek-v4-pro',
        defaultEffort: 'high',
        avatarColor: '#6B8EAD',
      },
      {
        slotId: 'critic',
        displayName: '挑刺审视',
        roleTitle: '风险排查与简化',
        roleBrief: '找出方案里多余复杂或容易踩坑的地方。',
        isLeader: false,
        defaultEngine: 'codex',
        defaultModel: 'gpt-6.2-astra',
        defaultEffort: 'high',
        avatarColor: '#B0706A',
      },
    ],
  },
];

export function getPresetById(id: string): TeamPreset {
  return TEAM_PRESETS.find((p) => p.id === id) ?? TEAM_PRESETS[0];
}
