# AgentCoWorkBoard 开发规划与完成记录 (PLAN.md)

## 一、 核心设计目标

将原本分散在多个窗口里的智能体团队，收拢为一块清爽易用的**群聊式协同看板**：

- **群聊式看板呈现**：成员发言与成果统一在左侧按时间流输出，个人指令在右侧发出，一眼看清进展。
- **主管统一接待**：默认只需跟主管对话，由主管拆解任务并调度其他成员；也可点击成员胶囊单独交代。
- **全生态引擎、模型与原生思考强度可控**：参照 AionUi 完整收录 **20 款 CLI 智能体**（Antigravity、Codex、CodeBuddy、Claude Code、Gemini CLI、Qwen Code、OpenCode、Cursor、Copilot CLI、Kimi CLI、Auggie、Goose、Droid、Qoder、Mistral Vibe、Kiro、Hermes、Snow、OpenClaw、Nanobot），每位成员均可直接切换引擎、具体模型以及**模型自身原生的思考强度档位（`low` / `medium` / `high` / `xhigh` / `max` / `ultra`）**，群聊消息头部与底部快捷胶囊同步显示原生档位名称。
- **面向非编程用户的图形化保护**：所有文件改动自动备份，提供直观的「对比查看」「采纳保留」「一键撤回」与手动「保存备份点」，全程无需接触代码分支或命令行。
- **真实额度工作台与手机连接**：集中查看活跃热力图、用量统计、**Antigravity 与 Codex 真实官方剩余额度进度条及重置倒计时**（CodeBuddy 按积分制展示就绪状态）与多账号切换，支持扫码在手机浏览器查看看板与发消息。

---

## 二、 界面与视觉准则

1. **电脑端均衡三栏布局**
   - **左栏 (`316px`)**：上方为项目会话列表，左下角固定展示带进度条的「任务分工进度」（支持直接勾选与快捷添加待办）。
   - **中栏（自适应宽幅）**：群聊消息流 + 底部**立体多功能输入卡片**（内置点选引用项目文件、一键创建安全备份、快捷意图模板与思考强度切换）。
   - **右栏 (`376px`)**：双标签切换「团队与模型」（含像素级对齐的引擎、模型与原生思考强度 `<SelectMenu />`）与「改动与备份」。
2. **手机端专属精调布局**
   - **手机工作台**：自适应免横滑热力图 + 四宫格单行指标卡 + 横向滑动专家团队卡 + 双列智能体引擎配额卡片（支持 `全部 (20)` / `运行中` 一键筛选）。
   - **手机看板页**：顶部快捷呼出「任务」「成员与模型」「改动备份」底部抽屉，底部输入卡片按小屏留足阅读高度。
3. **克制淡雅风格**
   - 采用低饱和度灰紫与浅灰底色，正文字号保持在 `14.5px–15px` 舒适尺寸；全部采用官方原生品牌图标与独立几何图标，统一使用自研对齐下拉菜单组件，杜绝原生控件错位。

---

## 三、 初版四阶段完成清单（v1.0 已全部落地）

### Phase 1：群聊协同看板与 20 款智能体调度底座（已完成）
- [x] 本地 SQLite 存储与 WebSocket 实时推送底座。
- [x] 对齐 AionUi 接入全部 20 款 CLI 智能体与官方原生图标，读取本地模型缓存并按模型原生档位（`low` / `medium` / `high` / `xhigh` / `max` / `ultra`）透传思考强度。
- [x] 电脑端均衡三栏、立体多功能输入卡片与手机端专属响应式布局。

### Phase 2：图形化安全改稿与一键采纳 / 撤回（已完成）
- [x] **自动修改前备份**：智能体执行前自动记录工作区文件快照，无需手动管理代码分支。
- [x] **可视化对比与一键撤回**：聊天成果卡与右侧「改动与备份」面板均提供 **「对比查看」**（左右分栏展示修改前/修改后）、**「采纳保留」**、**「一键撤回」**。
- [x] **手动安全备份点**：随时一键保存当前项目状态，并可一键还原到任意备份点。

### Phase 3：真实官方额度监控与图形化切号（已完成）
- [x] **真实官方额度与重置倒计时**：Antigravity 通过官方 `agy -p "/usage" --output-format json`（0 Token 消耗）读取 `Gemini 5h / 周` 与 `Claude 5h / 周` 真实余量；Codex 解析 `~/.codex/sessions` 最新 `rate_limits` 读取 `5h / 周` 真实剩余百分比与 `PLUS` 等级；CodeBuddy 积分制清晰显示 `积分计费 · 极速就绪`。
- [x] **图形化多账号槽位切换**：点击工作台引擎卡片上的 **「切号」**，即可将当前登录态保存为备注槽位或一键切换备用账号。

### Phase 4：手机扫码连接保护、一键启动与体验精进（已完成）
- [x] **扫码免密与连接码门禁**：手机扫描电脑二维码自动完成信任配对；支持开启「陌生设备需输入 4 位连接码」保护局域网访问安全。
- [x] **双击快捷启动器**：项目根目录提供 `启动协同看板.cmd`，双击即可启动后台服务并自动打开浏览器页面。
- [x] **纯图形化文件夹选择、Markdown 渲染、交付产物预览与看板内额度直显**：
  - 选择工作区文件夹与引用文件全面改为图形化文件夹浏览器（同时支持一键唤起 Windows 原生系统选文件夹窗口）。
  - 集成 `react-markdown` + `remark-gfm` 原生渲染群聊消息与交付文档排版。
  - 看板内交付产物采用左右均衡排版，点击「预览」可直接查看 Markdown / 网页 / 图片 / PDF / 代码，点击「打开」直接调用系统默认程序，下方同步衔接备份状态与「对比改动 / 一键撤回 / 采纳保留」。
  - 对话流中的 `@成员` 标签支持点击弹出**发起者与被 `@` 者的双人往来对话记录**（支持切换双方视角与一键定位原消息）。
  - 工作台活跃热力图支持悬浮/点击任意小格即时浮层展示当日 Token 用量与活跃记录次数；协同看板页顶部栏与成员卡同步直显实时额度胶囊与详情浮层。

---

## 四、 v1.1 全流程安全与体验加固（已完成）

针对普通用户全流程体验审阅建议，完成底层文件保护、消息幂等、权限隔离与无障碍自适应全面升级：

- [x] **文件快照与三向防误覆盖还原 (`snapshotManager.ts`)**：
  - 扩大扫描容量至 `1500` 文件 / 单文件 `2 MiB`，支持常见图片与 PDF 备份并持久化跳过统计与原因摘要。
  - 还原已删除文件并在磁盘重建后校验 SHA-1；完整持久化手动检查点全量清单（解除 20 文件截断并保留备份后新增文件）；CLI 非零错误退出自动捕获 `failed_turn` 保护快照。
  - 自动/失败快照撤回前检测较新磁盘编辑，默认返回 HTTP `409` 并弹出三向冲突确认（「保留较新修改」或「自动创建 `pre_overwrite_backup` 备份当前内容再覆盖还原」）。
- [x] **消息可靠性、按看板草稿隔离与可操作接力门禁 (`swarmBus.ts` / `BoardStreamView.tsx`)**：
  - 草稿、引用附件与收件状态按看板键独立持久化于 `sessionStorage`，仅在服务端确认入库后清空；失败/断线支持一键重试发送且后端通过 `clientMessageId` 实现并发防重。
  - 未手选收件人时输入正文 `@成员` 自动跟随高亮并精准路由；手选与正文冲突时出现一键切换条；未安装引擎发射前直接提示拦截；自动接力暂缓卡提供幂等「继续接力 / 结束本轮」，审批卡支持「退回修改」反馈。
- [x] **独立示例隔离、HTML 隔离沙盒与真实零值遥测**：
  - 首次示范看板隔离至 `data/demo-workspace` 并标注「示例 / 示例演练」；新建看板不再默认填入本仓库目录，支持近期目录去重快选与必填校验。
  - HTML 预览改用独立 `/api/preview-sandbox/:previewToken/{*relPath}` 路由配合 `<iframe sandbox="allow-scripts">`（去除 `allow-same-origin` 并配 `connect-src 'none'` CSP），在隔离宿主机凭证的同时正常加载工作区同目录相对 CSS/图片。
  - 取消虚假 `76.3%`、`12` 轮与 `100%` 手机气泡兜底，区分「已安装 / 未安装 / 正在执行」与「估算」标签；支持 `AGENT_COWORK_DATA_DIR` 与 `AGENT_COWORK_SKIP_HOST_SCAN=1` 实现完全数据隔离。
- [x] **实时网关防掉线、大目录防卡死与窄屏/键盘无障碍**：
  - WebSocket 连接附带签名 Token 鉴权并在本地撤销设备时强制断开远程连接；断线重连按 `sinceSeqId` 自动补齐增量消息；删会话增加确认弹窗，远程设备隐藏仅限电脑本机执行的入口。
  - `FolderPickerModal` 支持 200 项截断提示、服务端 `?q=` 模糊筛选与路径直达；工作台热力图支持方向键聚焦与手机端步进器，`355px` 窄屏顶栏与移动端抽屉关闭按钮全部对齐精调；Vite 构建拆分 `vendor-*` 产物消除大包警告；`启动协同看板.cmd` 改用 `/api/health` 就绪探测后打开浏览器。

## 五、 v1.2 产品化升级：自由组队、全局分工偏好、零轮询波次唤醒与无黑框静默运行（已完成）

- [x] **直观化状态徽标替换（消除 `95%` 歧义）**：
  - 修正 `server/db.ts` 中将所有对话轮次 Token 累加再按 `Math.min(95, ...)` 写入的上下文占比逻辑（改为单轮上下文用量，新会话从 `0` 开始）。
  - 侧边栏切换为 `{b.turnCount} 轮` / `新会话`，看板顶部切换为 `任务 X/Y` 或 `X 人协作`，右栏成员卡切换为 `对话 X 轮`（悬浮提示累计 Token 与单轮参考占比）。
- [x] **自由组建团队与全局默认分工偏好**：
  - 新建看板弹窗新增「自由协同」与完全自定义成员增删改工作流（支持任意人数、设为主管、成员职责留空并由主管自动定岗），默认自动优先填充本机已安装引擎；支持全局共享持久化规则弹窗 [`GlobalDispatchModal.tsx`](./src/components/GlobalDispatchModal.tsx)（`GET/PUT /api/settings/orchestration`），内置 `多引擎主力与交叉验收` / `通用均衡协作` / `双人结对快审` 一键模板。
- [x] **开工后动态增删改成员与切换主管**：
  - 新增 `POST /api/boards/:boardId/agents`、`DELETE /api/boards/:boardId/agents/:slotId` 与扩展 `PATCH`，并通过 WebSocket `agent.created` / `agent.deleted` 实时推送；右栏成员卡支持「+ 新增成员」（可选立即请主管安排分工）、就地编辑成员名称/职责、设为主管与安全移除（未完成任务自动转交主管）。
- [x] **Antigravity Swarm 零轮询事件驱动与波次屏障**：
  - 升级 `swarmBus.ts`：队列按 `slotId` 合并唤醒防止重复运行，提示词强约束禁止轮询等待他人；支持主管输出结构化 ```` ```cowork-dispatch``` ```` / ```` ```cowork-status``` ```` 协议块，自动持久化 `staffingTable` 团队分工卡与 `blockedBy` 依赖任务，同波次非主管并行成员全部执行完毕后再汇总唤醒主管或自动解锁下游任务，消除轮询空转对额度的消耗。
- [x] **Windows 无弹窗静默运行**：
  - `localScanner.ts` 改用纯 JS 扫描 `PATH` + `PATHEXT`（0 子进程、5 分钟检测缓存），`quotaFetcher.ts` 延长非强制额度缓存至 10 分钟，`workspaceExplorer.ts` / `cliRunner.ts` / `cowork-cli.mjs` 全链路启用 `windowsHide: true` 与 `-WindowStyle Hidden`；升级 `启动协同看板.cmd` 为无黑框后台启动并新增 `停止协同看板.cmd`。

## 六、 v1.3 演进落地：MCP 桌面端主管直驱与双模协同（已完成）

完整技术方案与 5 阶段实施记录见 [**`PLAN_v1.3.md`**](./PLAN_v1.3.md)：

- [x] **下线旧「桌面端同步」设置，支持桌面端主管直驱 + 网页直驱双模并存**：100% 保留既有在网页/手机直接向 CLI 主管派工的全套功能（`leaderMode = 'cli'`）；移除易产生误解的 `sessionSyncMode` 下拉框，升级为 `桌面端等待结果中` / `插话已回传 · 队员继续运行` / `已带入下次对话 · 待主管响应` / `桌面端待命` 状态胶囊、闲置 CLI 代答开关及单轮立即代答按钮。
- [x] **零轮询阻塞式 MCP 工具链、波次续接凭据与幂等防重**：基于 `@modelcontextprotocol/sdk`、`EventEmitter` 波次等待器与 `mcp_waves` 波次账本实现 `cowork_overview` / `cowork_setup_board` / `cowork_dispatch_wave` / `cowork_wait_board` / `cowork_manage_board`；支持 `<1.5s`（实测 `11ms`）中断唤醒返回 `human_interjections`、`waveId` 重连凭据、`recoveryAction` 续等指引与改动快照 `evidence`，断连重试只执行一次。
- [x] **Antigravity 专属轻量 `MCP App` 侧边栏与三态回执 `PreInvocation` Hook**：`ui://cowork-board/panel.html` 采用与主界面完全一致的 React 19 + 内嵌 21 款官方原生图标 + `<PanelSelectMenu />` 设计语言（`协同对话` / `成员与任务` / `改动备份`、自适应浅/深色主题、行内成员模型/思考调节），直读轻量 `/api/mcp/panel-state`（模拟 15 秒概览延迟下耗时仅 `3–8ms`），内置防重叠轮询锁、上次更新时间与断连重试栏；支持 **「自动唤醒左侧:开」** 在闲置期间通过官方 `app.sendMessage()` 自动转入网页/手机留言并共享 `15s` 原子租约防重账本（绝不与 `PreInvocation` Hook 重复注入），同时提供「进入零消耗监听」（`waitForNewActivity`）快捷方式。
- [x] **工作台每引擎默认模型与思考强度预设**：在「工作台 -> 智能体看板」为每款引擎独立持久化默认模型与原生思考强度（`GET/PUT/DELETE /api/settings/engine-defaults`），前端采用序列号 + 乐观更新消除连续快选覆盖，自动继承到新建看板、新增成员、切引擎与 `cowork_setup_board`。
- [x] **纯图形化「一键接入与诊断」面板**：[`DesktopMcpModal.tsx`](./src/components/DesktopMcpModal.tsx) 配合 [`registrar.ts`](./server/mcp/registrar.ts) 提供配置检测、原始配置自动备份、一键接入/更新/取消、Antigravity Hook 独立停用/启用、三种唤醒说明、四维状态展示与 `POST /api/mcp/self-test` 无副作用一键自检。

## 七、 v1.4.0 桌面化发布、MCP 自动挂起监听与统一多色主题（已完成）

- [x] **MCP 自动挂起监听与即时释放控制**：升级 MCP 服务端 `instructions`、工具描述、`cowork_standby_mode` Prompt 及接口返回 `autoStandby` 指令，指导 CodeX / Claude Code / CodeBuddy / Antigravity 等桌面端主管在工具返回后主动挂起 `cowork_wait_board(waitForNewActivity=true)` 零消耗待命；看板与侧栏新增 **「自动监听：开 / 关」** 开关，关闭或收到用户 `结束监听` 口令时毫秒级释放挂起等待。
- [x] **主软件与 Antigravity 插件统一 4 套主题色**：基于 CSS 变量与热力图色阶实现 **薰衣草紫（默认）/ 雾霭蓝 / 鼠尾草绿 / 樱花粉** 四色切换（`app_settings.ui_theme` + WebSocket `theme.updated` 实时广播），主界面与 `ui://cowork-board/panel.html` 保持一致视觉调性与浅/深适配；窄屏移动端将主题切换整合进左侧滑出抽屉避免顶栏挤占。
- [x] **面向发布级产品的全站文案打磨**：统一产品定名为 **AgentSwarm**，消除早期研发测试性表述，精简弹窗引导、状态提示与新用户导览模板文案。
- [x] **Tauri v2 桌面端打包与零 `node_modules` 自包含运行时**：`scripts/build-mcp.mjs` 内联打包全量 JS 依赖至单文件 `dist-server/index.js`、`dist-mcp/index.js`、`dist-mcp/preInvocationHook.js`；`resolveDefaultDataDir` 在安装后只读目录自动落盘到 `%LOCALAPPDATA%/AgentSwarm/data`（本地源码环境继续沿用 `./data`）；`src-tauri/` 提供单实例窗口激活、系统托盘、关闭最小化托盘、无黑框内嵌 Node 24 服务守护及 GitHub Actions 自动构建 `.exe` / `.msi` GitHub Release。

## 八、 v1.4.1 安全加固、桌面多实例隔离与体验/文档发布打磨（已完成）

- [x] **默认仅本机访问（P0）**：`server/index.ts` 默认只监听 `127.0.0.1`；`server/auth/pairingGuard.ts` 默认 `remoteAccessEnabled = false` 与 `requirePinOnLan = true`，采用 SHA-256 持久化已配对设备列表（支持单台移除与全量撤销）及动态按所选网卡绑定/关闭远程端口；前端 `MobileConnectModal.tsx` 与 `PairingLockScreen.tsx` 清晰区分本机/局域网/组网条件。
- [x] **消除 Windows 后台终端闪窗（`CREATE_NO_WINDOW`）**：清理 `server/mcp/index.ts`、`workspaceExplorer.ts`（换用 `rundll32.exe` 打开常规文件）、`cliRunner.ts` 中 Windows 下绕过 `CREATE_NO_WINDOW` 的 `detached: true` 用法；`quotaFetcher.ts` 移除每 10 分钟无感轮询弹出 `agy.exe`，延长被动缓存至 6 小时；`start-server.ps1` 切换为无窗口拉起。
- [x] **桌面端实例身份识别、端口冲突隔离与可恢复诊断**：`/api/health` 返回服务标识、`version` 与本机 `dataDir`；`src-tauri/src/lib.rs` 发现 25880 被其他目录实例占用时自动转到 25881+ 独立启动并在 `boot-ui/index.html` 提供选择，捕获服务 stderr 日志支持「重启本地服务」与「查看/复制脱敏诊断」。
- [x] **建板首条消息共用引擎拦截、目录安全防护与三向冲突明确回执**：`NewBoardModal.tsx` 转为 3 步递进式表单（默认打开用户「文档」目录并拦截根目录/系统目录/软件目录；支持一键创建练习文件夹）；未装主管引擎时保留 `pendingInitialDraft` 至输入框并统一禁用按钮；`swarmBus.ts` 区分未安装/需登录/执行失败三态；`DiffCompareModal.tsx` 与交付卡明确展示保留较新修改结果及保护快照入口。
- [x] **完整用户文档、配图与 Release 工程化完善**：新增 `docs/USAGE_GUIDE.md`、真实导览与对比截图、`SECURITY.md`、Issue 模板、升级版 `README.md` 与 GitHub Release 安装包静默安装烟雾验证步骤。
