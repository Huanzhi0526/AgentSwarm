# AgentCoWorkBoard v1.3 开发计划：MCP 桌面端主管直驱与双模协同

> **文档状态**：已完成实施与全链路验收（2026-11-22）。在 **v1.2** 基线（`package.json` 版本 `0.1.0`，服务端口 `25880`）上完成 **MCP 桌面端主管直驱模式（MCP Host Leader Mode）** Phases 1–5 全部落地，并 **100% 保留**既有网页/手机端直驱 CLI 协同模式（Web Direct Mode）。

---

## 一、 架构转向背景与核心目标

### 1.1 为什么下线旧「对话显示到桌面端」选项
- **多桌面端存储机制割裂**：实测表明 **CodeX** 的命令行 `codex exec` 与桌面端共用 `~/.codex/sessions`，但 **Antigravity 2.0 桌面应用**读取 `~/.gemini/antigravity/conversations/`，而无头命令行 `agy -p` 写入 `~/.gemini/antigravity-cli/conversations/`（标记为 `CORTEX_TRAJECTORY_SOURCE_CLI`），桌面端侧边栏不会主动列出 `agy` 跑出的外部会话。强行从网页看板反向向各家桌面端注入会话既无法跨客户端统一，又容易引发兼容风险。
- **v1.3 控制流反转思路**：不再把网页里的主管对话「塞回」桌面端，而是**让用户在原生桌面端（Antigravity / Codex / CodeBuddy / Claude Code / Cursor）里直接跟当前对话中的「主管 Agent」交流**；`AgentCoWorkBoard` 作为标准 **MCP Server（及 Antigravity 专属 `MCP App` 侧边栏面板）** 被主管调用，负责自动拉起本地团队、读取偏好与额度、并发调度多引擎 CLI 队员执行、打好文件三向快照并向网页/手机端实时投屏。

### 1.2 双模并存产品形态
1. **桌面端主管直驱模式（v1.3 新增，`leaderMode = 'mcp_host'`）**：
   - 你直接在 Antigravity / Codex 桌面端里下达需求。
   - 桌面端主管调用看板 MCP：自动静默拉起 `25880` 后台服务 → 按**用户显式指令 > 全局分工偏好与模型特长 > 实时 5h/周余量**自动搭建/复用看板团队 → 下发波次任务并进入**零轮询阻塞等待（0 Token 空耗）** → 看板网页/手机实时展示群聊、任务进度条与改动撤回卡 → 本波次完工或你在看板中途插话时 1 秒唤醒并返回结构化结果与证据包回桌面端主管。
2. **网页/手机直驱 CLI 模式（既有能力，100% 保留，`leaderMode = 'cli'`）**：
   - 你继续可以在 `http://127.0.0.1:25880` 或手机扫码界面直接新建看板、选择 CLI 主管并驱动全员协同，原有自由增删改成员、全局分工偏好、交付沙盒预览、三向冲突备份还原与额度监控全部保持不变。

---

## 二、 开源生态参考与核心技术决策（已核实，免重复调研）

| 参考项目 / SDK | 许可证 | 核心借鉴点与在 v1.3 中的落地决策 |
| :--- | :---: | :--- |
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) & `@modelcontextprotocol/ext-apps` | MIT | 实现标准 stdio MCP Server、`notifications/progress` 长任务心跳保活，以及 Antigravity 2.0 原生 `MCP App`（`ui://` 孤立沙盒页面，支持 `aux_pane` 右侧分栏与 `global` 侧边栏入口及官方 `app.sendMessage()` 能力）。 |
| [`JialaoLiu/dsh-baton`](https://github.com/JialaoLiu/dsh-baton) | MIT | 1. **服务端长等待 `wait` 替代频繁轮询**（`tool_timeout_sec = 3600` 配到 Codex，1 次等待覆盖最长 59 分钟，不烧主管额度）；<br>2. **中途人工插话实时唤醒（`human_interjections`）**：等待期用户在看板发消息或队员卡住提问时，1 秒内唤醒等待调用把话带回桌面端；<br>3. **客观验收证据包（`evidence`）**：自动汇总真改文件清单 + 快照 ID + 测试/执行结果，避免桌面端主管重读全仓浪费上下文；<br>4. **绝对路径自注册（`process.execPath`）与极简顶层 `instructions`**（防止 Codex 对每个工具重复拼接长指令）。 |
| [`jazzenchen/agent-hud-open`](https://github.com/jazzenchen/agent-hud-open) | Apache-2.0 | 1. **消息投递防重回执与指纹校验**：跨端唤醒与入队附带唯一请求 ID 与内容指纹，超时标记 `uncertain` 且绝不盲目重发，避免重复唤醒双倍扣费；<br>2. **「只传结论与指令，同目录共享上下文」原则**；<br>3. **合规红线确立**：明确**不照搬**其探测 Antigravity 本地 `language_server` 私有内部接口注入消息的高风险黑盒做法（Windows 兼容性差且随版本更新易断），仅使用官方公开协议。 |
| 已有项目基础设施（`AgentCoWorkBoard` v1.2） | — | 直接复用 `server/orchestrator/swarmBus.ts` 的波次并发与 `blockedBy` 自动解锁、`server/safety/snapshotManager.ts` 三向备份、`server/telemetry/quotaFetcher.ts` 实时额度与 `server/db.ts` 全局分工偏好表。 |

---

## 三、 跨桌面端「看板发消息 ↔ 桌面端主管」三档机制设计

不同桌面客户端的 MCP 超时、Hook 事件触发条件与连续续跑上限不同，v1.3 按能力分级提供一致且诚实的体验（主流程全部基于标准 MCP，外部闲置唤醒按客户端官方通道增强）：

| 能力档位 | 适用桌面端 | ① 派工与零轮询波次等待 | ② 等待期在看板中途插话 | ③ 桌面端**已彻底闲置**时从看板 `@主管` |
| :--- | :--- | :--- | :--- | :--- |
| **第一档（全链路 + 闲置增强）** | **Antigravity 桌面端**<br>**Codex 桌面端**<br>**Claude Code** | 标准 MCP `dispatch` / `wait`（Codex 自动写入 `tool_timeout_sec = 3600`） | Web/手机端向 `@lead` 发言或出现待确认项，Node 事件总线 `<1s` 中断 `wait` 并带回桌面端 | - **Antigravity**：电脑前可通过右侧 `MCP App` 面板调用官方 `app.sendMessage()` 直接打入左栏对话框当场唤醒；手机/纯网页离线留言写入未读队列，由官方 `~/.gemini/config/hooks.json` 的 `PreInvocation` Hook（`{"injectSteps": [{"ephemeralMessage": "..."}]}`）在下次对话前毫秒级无感注入。<br>- **Codex**：通过官方 `codex app-server` 入队配合 `codex://threads/wake/<threadId>`（若 Windows 环境不支持唤醒 URI，则平滑回退未读队列）。 |
| **第二档（等待期全通，闲置不强醒）** | **CodeBuddy / WorkBuddy**<br>**Cursor / Qoder 等** | 标准 MCP `dispatch` / `wait`（按各端超时分段续等） | 同上，等待期内看板插话 `<1s` 立即回传桌面端 | **不依赖脆弱的 `Stop` Hook 循环强唤醒**（Cursor/TRAE/Kimi 等客户端对 `Stop` Hook 有 1~5 次上限且 Windows 兼容不一）；消息入未读队列，同时网页提供「改由 CLI 主管代答」。 |
| **网页/手机兜底体验** | 所有 `mcp_host` 模式看板 | 若用户发 `@具体队员`（如 `@frontend`），后台直接跑 CLI 队员不卡住 | 消息状态清晰标注「已回传桌面端主管」或「已送达」 | 当桌面端既未挂载 `wait` 也未立即响应时，用户在网页 `@主管` 气泡旁出现 **「桌面端当前闲置，留言已暂存 · 本轮改由后台 CLI 主管立即代答」** 一键开关。 |

---

## 四、 分阶段开发实施清单（Phases 1–5）

### Phase 1：数据模型演进与下线旧同步下拉框
- **涉及文件**：[`src/types.ts`](./src/types.ts)、[`server/db.ts`](./server/db.ts)、[`src/components/BoardStreamView.tsx`](./src/components/BoardStreamView.tsx)、[`src/components/NewBoardModal.tsx`](./src/components/NewBoardModal.tsx)
- **后端数据库兼容迁移**（`server/db.ts`）：
  - 在 `boards` 表安全增量迁移（复用既有 `try/catch ALTER TABLE` 模式，不破坏 `data/cowork-board.db` 已有看板）：
    - `leader_mode TEXT NOT NULL DEFAULT 'cli'`（`'cli' | 'mcp_host'`）
    - `host_client TEXT NOT NULL DEFAULT ''`（如 `'antigravity' | 'codex' | 'codebuddy' | 'claude'`）
    - `host_session_ref TEXT`（记录宿主关联会话 ID，如 Codex `threadId` 或 Antigravity `conversationId`）
    - `host_waiting INTEGER NOT NULL DEFAULT 0`（服务端实时标记桌面端当前是否正在 `wait` 挂起等待中）
    - `host_last_read_seq_id INTEGER NOT NULL DEFAULT 0`（Antigravity `PreInvocation` Hook 已注入位点，防止重复注入）
  - 保留既有 `session_sync_mode` 数据库列作为历史兼容字段（不再在新建/看板 UI 暴露）。
- **前端改造**：
  - 移除 `BoardStreamView.tsx` 顶栏 `SYNC_MODE_OPTIONS` 与 `NewBoardModal.tsx` `SYNC_OPTIONS`（下线 `对话显示到主管桌面端` 等选项与 `open-session` 提示文案；可保留右侧 CLI 成员已完成会话的本机快捷查看入口或简化为「查看命令行会话」）。
  - 在 `BoardStreamView.tsx` 顶栏根据 `board.leaderMode === 'mcp_host'` 渲染状态胶囊：
    - `桌面端等待结果中`（桌面端正在挂起 `wait`，发给主管的消息会立即回传桌面端）
    - `桌面端待命（留言待同步）`（并提供触发「改由后台 CLI 主管代答」按钮）。

### Phase 2：服务端零轮询波次等待器与本机协同接口
- **涉及文件**：[`server/orchestrator/swarmBus.ts`](./server/orchestrator/swarmBus.ts)、[`server/index.ts`](./server/index.ts)
- **事件驱动波次等待器**（`server/orchestrator/swarmBus.ts`）：
  - 在 `SwarmOrchestrator` 内部增加 `boardEvents`（`EventEmitter`），每次波次状态变化（成员完成/失败、全部波次清空、新增用户对主管留言 `human_directive`、触发 `approval_gate`、产生快照）均立即 emit 事件，**绝不轮询数据库或 CLI**。
  - 实现 `waitForWaveSettlement(boardId, options: { sinceSeqId: number; timeoutMs: number; signal?: AbortSignal })`：
    - 若目标看板为 `mcp_host` 模式：当用户新发消息直接 `@lead`（无明确仅指向某工作队员时）或波次非主管队列全部排空时，立即结算返回 `WaveSettlementResult`：
      - `reason`: `'wave_completed' | 'human_interjection' | 'approval_needed' | 'worker_failed' | 'timeout'`
      - `posts`: `seqId > sinceSeqId` 的增量帖子摘要与队员交付正文
      - `humanInterjections`: 期间用户在看板给主管或全局下的新增插话
      - `evidence`: 汇总本次涉及快照的真实文件变更列表（`added` / `modified` / `deleted`、`snapshotId`）、任务完成计数 `tasksSummary` 与成员本轮用量/剩余额度摘要
      - `latestSeqId`: 本次截断位点，供下次 `cowork_wait_board` 无缝续接且防重。
  - 在 `mcp_host` 模式下默认禁止自动唤醒外部 CLI 主管去代答（避免和桌面端主管抢答），仅执行非主管 CLI 队员及 `blockedBy` 自动解锁流转；若用户明确点击网页「本轮改由 CLI 代答」，再临时调用指定引擎回答单轮。
- **本机限定 HTTP 内部接口**（`server/index.ts`，统一强制 `isLocalRequest(req)` 鉴权）：
  - `GET /api/mcp/overview`：返回全站 20 引擎可用性、真实 5h/周余量、全局分工偏好与已有活跃看板摘要。
  - `POST /api/mcp/boards/setup`：支持新建或复用 `mcp_host` 看板（支持指定 `workspacePath`、`hostClient`、成员数组、不填职责自动按全局偏好+额度配岗）。
  - `POST /api/mcp/boards/:boardId/dispatch-wave`：入库主管派工指令与结构化 `tasks`（支持 `blockedBy`）及成员唤醒队列；若 `wait: true` 则挂起直至波次收敛或出现人工插话。
  - `GET /api/mcp/boards/:boardId/wait`：纯等待已有进行中波次完成或监听新插话（处理单次调用超时续等，同样基于 `boardEvents` 零轮询，并在连接期间更新 `host_waiting = 1` / 断开时清零）。
  - `POST /api/mcp/boards/:boardId/manage`：供桌面端主管在对话中动态增删改成员、切换分工或发起快照检查点/撤销。
  - `POST /api/mcp/host-inbox/pull`：供 Antigravity `PreInvocation` Hook 快速调用（150ms 内返回），原子读取对应工作区绑定的 `mcp_host` 看板中 `seq_id > host_last_read_seq_id` 的用户未读留言并推进位点；无数据时快速返回空。

### Phase 3：标准 MCP Server、静默自启守护与 Antigravity MCP App
- **新增目录**：`server/mcp/`（独立 TS 编译输出至 `dist-mcp/`，`package.json` `build` 脚本同步构建）
- **新增依赖**：`@modelcontextprotocol/sdk`、`@modelcontextprotocol/ext-apps`（均为官方 MIT）
- **模块清单**：
  1. **`server/mcp/index.ts`（stdio MCP 入口）**：
     - 实现 `ensureBoardServerRunning()`：收到任意工具调用时探活 `http://127.0.0.1:${PORT}/api/health`；未启动则使用 `process.execPath` 静默后台启动 `dist-server/index.js`（`detached: true`, `windowsHide: true`, `stdio: 'ignore'`，日志落盘到 `data/server.out.log`，复用并兼容既有 `AGENT_COWORK_DATA_DIR`），轮询 `/api/health` 就绪（最长 8s）。
     - 顶层 `instructions` 保持 **一句话极简原则**（避免 Codex 反复拼接工具说明挤占上下文），把参数说明放在各工具 schema 中。
     - 注册 **5 个高内聚 MCP 工具**：
       - `cowork_overview`：查看本机已安装引擎、Antigravity/Codex 5h/周额度、全局默认分工偏好及现有看板列表。
       - `cowork_setup_board`：创建或绑定协同看板（选定工作区与团队成员，自动按偏好与可用性配好引擎/模型/思考强度）。
       - `cowork_dispatch_wave`：派发本波次任务（支持并行成员、任务清单与 `blockedBy` 依赖），默认服务端阻塞等待至本波次完结或出现 `human_interjections` 人工插话返回完整 `evidence`；等待期间每 15 秒发送 `notifications/progress` 心跳保活防止客户端断流。
       - `cowork_wait_board`：续等超长波次完成，或在用户要求监控看板时挂起监听下一条人工插话/事件（0 轮询、0 Token）。
       - `cowork_manage_board`：开工后随时向看板增删改成员、标记任务状态或创建安全快照检查点。
  2. **`server/mcp/appPanel.ts` & 单文件 UI 资源（`ui://cowork-board/panel.html`）**：
     - 参照官方 `mcp-app-development` 规范，注册 MIME 类型 `text/html;profile=mcp-app` 的 `ui://` 资源（构建为单文件 HTML），设置 `_meta["com.google.antigravity/ui"].entrypoints` 同时支持 `aux_pane`（对话右侧栏 `+` 菜单）与 `global`（侧边栏入口）。
     - 通过 App-only 工具实时读取 `127.0.0.1:25880` 活跃看板的任务卡片、成员执行态与文件改动状态。
     - 当宿主环境 `app.getHostCapabilities()?.message` 存在（右侧分栏打开场景），提供输入框直接调官方 `app.sendMessage()` 向左侧闲置的 Antigravity 对话注入指示，实现桌面端左侧对话与右侧看板的双向实时互动。
  3. **`server/mcp/preInvocationHook.ts`（Antigravity 官方 Hook CLI 子命令）**：
     - 无常驻进程开销，供 `~/.gemini/config/hooks.json` 在 `PreInvocation` 触发；读取 stdin JSON 中的 `workspacePaths` 与 `conversationId`，请求本机 `http://127.0.0.1:25880/api/mcp/host-inbox/pull`（设定 `300ms` 超时保证绝不拖慢桌面端响应），若有未读看板留言则按官方文档输出 `{"injectSteps": [{"ephemeralMessage": "..."}]}`，否则输出 `{}` 立即退出 `0`。

### Phase 4：桌面端「一键接入」图形面板与安全配置写入器
- **涉及文件**：新增 `server/mcp/registrar.ts`、`src/components/DesktopMcpModal.tsx`；更新 `server/index.ts`、`src/components/WorkbenchView.tsx`、`src/App.tsx`
- **安全自动配置写入（`registrar.ts`）**：
  - 全程采用规范语法编辑器 + 自动保留用户原有条目 + 首次修改前写入 `.bak-cowork` 备份文件，严格使用 `process.execPath` 绝对路径与 `dist-mcp/index.js` 绝对路径：
    1. **Antigravity 桌面端**：读写 `~/.gemini/config/mcp_config.json`（保留 BOM 与用户自定义字段，写入 `mcpServers.agent_cowork_board`），并可选在 `~/.gemini/config/hooks.json` 中非破坏性地挂载/卸载 `agent-cowork-board-inbox` `PreInvocation` 钩子。
    2. **CodeX 桌面端**：安全行级编辑 `~/.codex/config.toml`（写入 `[mcp_servers.agent_cowork_board]`，显式附带 `command`、`args`、`cwd = os.homedir()` 与 `tool_timeout_sec = 3600`；移除时精准删除自身节区）。
    3. **CodeBuddy / Claude Code**：分别安全增量更新 `~/.codebuddy/mcp.json`（存在则维护）与 `~/.claude.json` 的 `mcpServers` 节点。
- **纯图形化前端面板（`DesktopMcpModal.tsx`）**：
  - 在「工作台」顶部与左侧导航提供一个低饱和淡雅卡片/入口「桌面端 MCP 接入」。
  - 面向非编程用户纯按钮交互：逐一显示 Antigravity、CodeX、CodeBuddy、Claude Code 是否「本机已安装」「已接入 / 未接入」，点击 **「一键接入」** / **「一键取消」** 即完成写入与备份，并给出清晰一句提示（如 Antigravity 新接入或更新后提示开启插件开关/重启生效一次，Codex 新开会话立即生效）。

### Phase 5：全链路验证、回归测试与文档同步
- **自动化隔离验证脚本（`mcp_bridge_audit.mjs`）**：
  - 使用独立临时目录与随机测试端口验证：
    1. `ensureBoardServerRunning` 静默自启探活（确认无黑框弹窗）。
    2. 通过 stdio MCP 客户端真实调用 `cowork_overview` → `cowork_setup_board` → `cowork_dispatch_wave`，验证同波次并发 CLI 全部完结后仅返回 1 次且携带完整文件增量 `evidence` 与 `snapshotId`。
    3. 在 `cowork_dispatch_wave` 等待过程中通过 HTTP 向看板发送 `@lead` 人工插话，断言挂起中的 MCP 调用在 `< 1.5s` 内中断返回 `reason === 'human_interjection'` 且 `humanInterjections` 包含原文。
    4. 验证 Antigravity `PreInvocation` Hook 脚本在存在未读消息时返回合法 `injectSteps`，再次触发时已被 `host_last_read_seq_id` 消费幂等去重返回 `{}`。
    5. 验证 `registrar.ts` 对模拟 `mcp_config.json`、`hooks.json`、`config.toml`（含中文路径、已有第三方 MCP 与自定义注释）的增删改保留原配置且 100% 可逆还原。
    6. 验证旧模式 `leaderMode = 'cli'` 的网页建队、派工与三向快照撤回 100% 无回归。
- **真实构建与双端浏览实测**：
  - `pnpm build`（涵盖前端 Vite、后端服务端与 `dist-mcp/`）退出码 `0`。
  - 重启 `25880` 生产服务后在浏览器实测 `1440×900`（桌面端）与 `375×812`（移动端）下新旧看板顶栏、状态胶囊、「桌面端 MCP 接入」弹窗及控制台零报错、零横向溢出，确认用户既有的 `data/` 正式看板完好无损。
  - 同步更新 `AGENTS.md`、`README.md`、`PLAN.md`、`HANDOFF.md`。

---

## 五、 兼容性约束与给接手实现者的注意事项

1. **严格保护既有正式数据**：用户本机根目录 `data/cowork-board.db` 中存有真实测试记录与会话，所有自动化回归必须通过 `AGENT_COWORK_DATA_DIR` 指向临时目录隔离执行，严禁清理或污染正式 `data/`。
2. **保留 Windows 无弹窗铁律**：MCP 进程拉起后台服务、Hook 调用、浏览器面板后端及模拟 CLI 测试脚本必须保持 `windowsHide: true`（或纯 Node HTTP 请求），严禁出现黑框终端闪烁。
3. **遵循本地规则与开源复用规范**：实施过程中遵守仓库根目录 [`AGENTS.md`](./AGENTS.md) 的架构、控件统一（`<SelectMenu />`、官方图标、淡雅低饱和配色、无 Emoji/无首字母头像）与代码质量规范。

---

## 六、 v1.3 体验复测建议闭环记录（2026-11-23）

针对独立体验审阅提出的全部 7 项问题与建议（`P1 · 01` 至 `P2 · 07` 及版本号对齐）已完成全量落地与真机主管闭环验收：

1. **P1 · 01 & P1 · 05（拆分接手与收件确认、三态回执账本与会话隔离边界）**：
   - `POST /api/mcp/boards/setup` 复用、改名或切换宿主时严禁隐式推进 `host_last_read_seq_id`，并随返回值附带 `unreadCount` 与 `unreadMessages`。
   - 新增 SQLite `host_inbox_deliveries` 表维护 `claimed`（短租约防并发双取）→ `hook_injected`（Hook 成功输出 stdout 后登记）→ `acked`（主管实际通过看板工具操作或 `ack_inbox` 确认后推进 `host_last_read_seq_id`）及 `failed` 安全重试；工作区回退匹配严格限定未绑定会话看板（禁止向下穿透子目录，多看板竞争时返回显式选板提示）。
2. **P1 · 02（`cowork_panel` 极速直读与面板防重刷新/错误重试）**：
   - 新增纯 SQLite 轻量接口 `GET /api/mcp/panel-state`，`fetchPanelState` 彻底解耦全量概览与 `agy -p /usage`（同时在 `quotaFetcher.ts` 引入过期缓存后台异步刷新）；`panelClient.ts` 加入 `refreshInFlight` 轮询互斥锁、上次更新时间（`HH:MM:SS`）与可重试错误提示条。
3. **P1 · 03 & P2 · 04（Hook 独立停用、三种唤醒引导与无副作用一键自检）**：
   - `registrar.ts` 在 `enableHook: false` 时精准移除 `agent-cowork-board-inbox` 与 `.cmd`/`.sh` 包装器，完整保留 MCP 接入与第三方 Hook；`DesktopMcpModal.tsx` 增加「停用/启用 Hook」快捷按钮、三种唤醒结果说明、四维独立状态胶囊与 `POST /api/mcp/self-test` 一键自检，并优化 `375×812` 手机端弹窗单屏高度与卡片按钮排布。
4. **P2 · 06 & P2 · 07（波次续接凭据 `waveId`、插话运行态胶囊与回归脚本 PID 精准清理）**：
   - 新增 `mcp_waves` 波次账本，返回可续接 `waveId`、`recoveryAction` 与幂等派发去重（断连重连保证同波次仅执行一次），网页顶栏新增 `插话已回传 · 队员继续运行` 状态胶囊；`scripts/mcp_bridge_audit.mjs` 升级为动态空闲端口分配、端口占用保护与 `server.pid.json` + 命令行校验的精准清理（旁路服务零误伤）。

---

## 七、 v1.3.1 体验打磨与闲置自动唤醒升级（2026-11-23 · 已验收）

1. **Antigravity MCP App 侧栏重绘与品牌风格统一（`server/mcp/panelClient.tsx` + `scripts/build-mcp.mjs`）**：
   - 将原简易 HTML 侧栏升级为单文件打包（`694,541` 字节 `< 1 MiB`）的 React 19 UI，构建时将 `public/icons/` 下 21 款官方品牌 SVG/PNG 内联为 base64 `data:` URI（零外部网络请求，完全兼容 MCP App `default-src 'none'` CSP）。
   - 视觉全面对齐主程序：`#F6F6F9` 淡雅画布、白底 `rounded-2xl` 卡片、`#7768A6` 薰衣草紫强调、自研 `<PanelSelectMenu />`、`协同对话 / 成员与任务 / 改动备份` 三段视图、行内模型与思考强度切换、以及 `html[data-theme="dark"]` 宿主深浅色无缝自适应。
2. **工作台预设每款 Agent 的默认模型与思考强度**：
   - 后端新增 `app_settings('engine_default_configs')` 持久化与 `/api/settings/engine-defaults(/:engineId)` REST 接口，`resolveEffectiveEngineDefaults` 自动把默认配置继承到 `createBoard`、`addAgentSlotToBoard`、`updateAgentSlot` 与 MCP `cowork_setup_board`。
   - 前端 `WorkbenchView.tsx` 为 20 款引擎卡片增设「默认模型与思考」与「恢复默认」，`App.tsx` 通过 `engineDefaultReqSeqRef` + 函数式 `setOverview` 乐观更新消除快速连续切换覆盖竞态，思考强度选择框拓宽至 `sm:w-[104px]` 完整显示 `medium`，保存提示延长至 `8000ms` 稳定呈现。
3. **官方 `app.sendMessage()` 侧栏直通闲置自动唤醒 + 零消耗监听快捷方式**：
   - 新增 `POST /api/mcp/boards/:boardId/panel-claim-inbox`、MCP 动作 `claim_forward_inbox` / `confirm_forward_inbox` 与网页心跳标识 `hostPanelBridgeActive`。
   - 开启右侧栏「自动唤醒左侧:开」时，侧栏先以 `15_000ms` 原子 `claimed` 租约认领未读网页/手机 `@主管` 留言再通过官方 `app.sendMessage()` 送入左侧对话框并签收 `panel_forwarded`（确保并发的 `PreInvocation` Hook 识别 `claimed_in_flight` 后让行、零重复注入），网页实时展示 `侧栏直通已连接（留言自动转入）` 与 `已自动发入桌面端对话`；同时提供 **「进入零消耗监听」**（驱动 `cowork_wait_board(waitForNewActivity: true)`）一键挂起方案，全链路通过 `scripts/mcp_bridge_audit.mjs` **9/9 隔离审计** 与 `1440×900` / `375×812` 双视口终验。
