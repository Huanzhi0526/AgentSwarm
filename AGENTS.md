# AgentSwarm (AgentCoWorkBoard) 工程架构与协作规范 (AGENTS.md)

## 1. 项目定位与界面准则

**AgentSwarm** 是面向本地多智能体协作的群聊式集成看板、桌面端 MCP 调度中枢与额度工作台（提供 Tauri v2 桌面安装程序与 Web/手机端界面，完整功能演进见 `PLAN.md`）：

- **电脑端均衡三栏**：左栏 `316px`（会话列表含导览/桌面端标记与确认删除弹窗、`桌面端 MCP 接入` 快捷入口 + 移动端抽屉内嵌主题切换行 + 左下角无障碍任务清单），中栏群聊消息流（点击 `@成员` 查看双人对话、左右均衡交付预览与三向冲突安全撤回卡、系统接力暂缓确认卡、`mcp_host` 模式下支持 `桌面端等待结果中` / `插话已回传 · 队员继续运行` / `已带入下次对话 · 待主管响应` / `侧栏直通已连接（留言自动转入）` / `桌面端待命` 状态胶囊与 `已自动发入桌面端对话` 回执、「自动监听：开/关」开关、「闲置时 CLI 主管代答」开关与「本轮改由后台 CLI 主管立即代答」卡片）+ 按看板独立保留的 `sessionStorage` 草稿/附件/重试输入卡片（支持 `@mention` 自动跟随与未安装引擎拦截），右栏 `376px`（团队成员引擎/模型/原生思考强度面板含可用性标记与「查看命令行会话」入口 + 改动备份面板含 `failed_turn` 与 `pre_overwrite_backup`）。
- **手机端精调适配与 4 套全局主题**：支持 **薰衣草紫（默认）/ 雾霭蓝 / 鼠尾草绿 / 樱花粉** 四套 CSS 变量与热力图色阶主题（`app_settings` 键 `ui_theme` + `theme.updated` WebSocket 实时广播，主界面与 Antigravity MCP App 侧栏实时同步）；工作台采用无横滑键盘可聚焦热力图、单行四宫格统计、横滑团队卡与双列引擎看板（含默认模型与思考强度预设及「恢复默认」）；看板页采用 `355px+` 无遮挡顶栏（`< sm` 窄屏将主题色移入左抽屉为额度胶囊让路）与带显式关闭按钮的抽屉面板，提供纯图形化 `DesktopMcpModal` 一键接入、独立停用 Hook 与只读一键自检。
- **视觉与控件一致性**：全站统一使用自研 `<SelectMenu />` 对齐组件、动态主题品牌图标 `<AppBrandLogo />`、20 款 AionUi 适配引擎官方原生品牌图标与低饱和度淡雅配色，思考强度直接显示各模型原生档位名（`low` / `medium` / `high` / `xhigh` / `max` / `ultra`），面向非编程用户提供简洁精准的图形化操作体验。

## 2. 开源参考与选型记录

| 参考项目 | 许可证 | 借鉴与取舍结论 |
| :--- | :---: | :--- |
| `iOfficeAI/AionUi` | Apache-2.0 | 借鉴局域网扫码配对、WebSocket 实时同步与辅助 CLI 技能注入机制；独立构建轻量全栈以规避无关重型依赖。 |
| Antigravity Swarm | 内置参考 | 吸收公共消息板、`@slot_id` 按需唤醒、零轮询事件驱动与主管统筹分工机制。 |
| `claudioed/agent-blackboard` / `peshotan/event-driven-multi-agent-system` | MIT | 借鉴事件驱动黑板队列合并、波次收敛屏障（Coordinator Barrier）与主管动态定岗排期思想，避免轮询浪费额度。 |
| `dsh-swarm-panel` / `dsh-agent-teams` | 开源插件 | 吸收 SQLite `seq_id` 增量恢复与任务依赖（`blockedBy`）自动解锁唤醒。 |
| `JialaoLiu/dsh-baton` | MIT | （v1.3 借鉴）借鉴超长阻塞 `wait` 工具消除轮询、`human_interjections` 等待期插话唤醒、`evidence` 证据包与 `process.execPath` 无感配置注册及 Codex `tool_timeout_sec = 3600` 配置。 |
| `jazzenchen/agent-hud-open` | Apache-2.0 | （v1.3 借鉴）借鉴跨端投递防重指纹回执账本与各客户端 Hook 能力分级结论（明确回避探测私有 `language_server` 接口，严格走官方 MCP/Hooks）。 |
| `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps` | MIT | （v1.3 选型）标准 stdio MCP 服务端与 Antigravity 2.0 官方 `ui://` 侧边栏面板（`MCP App`）官方实现库。 |
| `ccusage` / `agy-switch` | MIT | 借鉴本地会话目录只读扫描生成活跃热力图、5h/7d 滚动窗口统计与多账号凭证快照切换。 |
| `react-markdown` + `remark-gfm` | MIT | 原生安全渲染群聊流与文件预览中的 GFM Markdown 列表、表格、加粗与代码块，默认转义原始 HTML 防止注入。 |

## 3. 目录结构与常用命令

```text
AgentSwarm/
├── .github/workflows/release.yml   # Windows x64 Tauri 安装包自动构建与 GitHub Release 工作流
├── LICENSE                         # MIT 开源许可证
├── README.md                       # 对外发布版产品说明与快速上手指南
├── PLAN.md                         # 产品规划与 v1.0 – v1.4.0 完成记录
├── PLAN_v1.3.md                    # v1.3 桌面端 MCP 主管直驱与双模协同开发方案（已验收）
├── HANDOFF.md                      # 阶段验收记录与维护交接文档
├── 启动协同看板.cmd                 # 纯 ASCII CRLF 入口，调用 scripts/start-server.ps1 无黑框启动 dist-server/index.js
├── 停止协同看板.cmd                 # 纯 ASCII CRLF 入口，调用 scripts/stop-server.ps1 按 server.pid.json 与命令行核验停止
├── scripts/
│   ├── build-mcp.mjs               # esbuild 单文件自包含构建（内嵌 21 款品牌图标 + npm JS 依赖构建 dist-server/ 与 dist-mcp/*，免 node_modules 运行）
│   ├── prepare-tauri-bundle.mjs    # 复制精简 Node 24 运行时与自包含 app 产物到 src-tauri/bundle-stage/
│   ├── generate-tauri-icons.mjs    # 纯 Node PNG 品牌图标生成脚本（供 tauri icon 生成桌面与托盘多尺寸图标）
│   ├── start-server.ps1            # Windows UTF-8 BOM 静默启动与 /api/health 探活脚本
│   ├── stop-server.ps1             # Windows UTF-8 BOM 安全 PID 校验停止脚本
│   ├── cowork-cli.mjs              # 辅助 CLI 工具脚本
│   └── mcp_bridge_audit.mjs        # 隔离自动化回归脚本（10 项全链路审计、动态端口保护、PID 精准清理、正式 data/ 零触碰）
├── src-tauri/                      # Tauri v2 桌面端宿主工程（系统托盘、单实例唤醒、CREATE_NO_WINDOW 内嵌服务守护与 NSIS/MSI 打包配置）
├── server/
│   ├── index.ts                    # HTTP + WebSocket 服务入口 (端口 25880，含 /api/settings/theme、engine-defaults、panel-state 等)
│   ├── db.ts                       # Node v24 node:sqlite 存储（默认目录在打包态自动落盘到 %LOCALAPPDATA%/AgentSwarm/data；含 host_auto_standby、ui_theme 等）
│   ├── auth/pairingGuard.ts        # 手机扫码令牌、4 位连接码、设备撤销与 WebSocket 鉴权网关
│   ├── fs/workspaceExplorer.ts     # 目录浏览（200 项截断与筛选）、隐藏窗口系统弹窗、产物预览与系统打开
│   ├── safety/snapshotManager.ts   # 三向冲突检测与自动/手动/失败保护备份还原引擎
│   ├── orchestrator/               # 团队预设（含自由协同）、零轮询事件驱动波次总线（含 waveId、standby_released 与停止监听指令）
│   ├── mcp/
│   │   ├── index.ts                # stdio MCP Server（自动静默拉起后台服务、autoStandby 指令与 cowork_standby_mode Prompt）
│   │   ├── appPanel.ts             # Antigravity 专属 ui://cowork-board/panel.html（直读轻量快照，彻底解耦全量概览）
│   │   ├── panelClient.tsx         # React 19 MCP App 侧栏前端（内嵌原生品牌图标、4 套同步主题切换、自动监听切换与 app.sendMessage() 自动转入）
│   │   ├── preInvocationHook.ts    # Antigravity PreInvocation Hook（pull -> stdout -> hook_injected 二段确认与 dryRun 自检）
│   │   ├── registrar.ts            # 四大桌面端安全配置读写器（支持独立停用 Hook、自动备份保留与 Codex 3600s 超时）
│   │   └── utils.ts                # MCP 仓库路径、只读/可写数据目录与本机端口解析辅助
│   ├── engines/
│   │   ├── catalog.ts              # 对齐 AionUi 的全部 20 款 CLI 智能体注册表与模型原生思考档位
│   │   └── cliRunner.ts            # 多智能体统一调度（windowsHide: true、环境变量隔离、Antigravity --project 匹配与本地会话唤起）
│   └── telemetry/
│       ├── quotaFetcher.ts         # Antigravity (/usage 10分钟缓存) 与 Codex (rate_limits) 真实官方额度读取
│       ├── localScanner.ts         # 纯 JS PATH 探测（无弹窗/5分钟缓存）、热力图、零值可信遥测与全局默认档位合成
│       └── accountManager.ts       # 多账号凭证槽位保存与一键切号
├── public/icons/                   # 20 款智能体官方原生品牌图标与独立几何矢量资源
└── src/                            # React 19 + Tailwind CSS v4 桌面/手机自适应前端
    ├── App.tsx                     # 全局导航、4 色主题切换、三栏骨架、双模入口、默认档位乐观更新与 WebSocket 同步
    └── components/
        ├── BrandIcon.tsx           # 随主题色动态着色的品牌 Logo、20 款官方图标映射与主题色元数据
        ├── WorkbenchView.tsx       # 工作台（MCP 接入横幅、主题化热力图、全局分工偏好、专家团队、20 引擎看板与每引擎默认模型/思考配置）
        ├── BoardStreamView.tsx     # 群聊消息流（任务 X/Y 徽标、自动监听：开/关开关、桌面端等待状态胶囊、CLI 代答开关、团队分工安排表与交付卡）
        ├── BoardQuotaBar.tsx       # 协同看板顶部实时额度胶囊与详情/切号浮层
        ├── RosterAndTasksPane.tsx  # 左下角任务清单 + 右栏成员动态增删改、「查看命令行会话」与备份面板
        ├── DesktopMcpModal.tsx     # 四大桌面客户端纯图形化一键接入 / 取消弹窗
        ├── MarkdownContent.tsx     # GFM Markdown 渲染、可点击 @成员 胶囊与内联文件预览链接
        ├── PairwiseDialogueModal.tsx # 点击 @成员 弹出的发起者与被 @ 者双人往来对话记录视图
        ├── NewBoardModal.tsx       # 新建看板弹窗（自由增删改成员、设为主管、空白定岗与双模提示）
        ├── GlobalDispatchModal.tsx # 全局默认分工偏好配置弹窗（内置模板与持久化规则）
        ├── FilePreviewModal.tsx    # 交付产物直接预览（隔离 HTML 沙盒 / Markdown / 图片 / PDF / 代码）
        ├── FolderPickerModal.tsx   # 图形化文件夹选择器（200 项防卡死截断、关键词筛选、路径直达与系统弹窗）
        ├── DiffCompareModal.tsx    # 三向冲突处理与修改前/后分栏对比、采纳及一键撤回弹窗
        ├── AccountSwitchModal.tsx  # 多账号凭证槽位保存与一键切换弹窗
        ├── MobileConnectModal.tsx  # 局域网/异地组网二维码扫码配对、4 位连接码与撤销已配对设备
        └── SelectMenu.tsx          # 全站统一像素级对齐自定义下拉菜单组件
```

- 安装依赖：`pnpm install`
- 开发模式：`pnpm dev`
- 全量构建：`pnpm build`（运行 `tsc --noEmit && vite build && node scripts/build-mcp.mjs`，同时构建前端与零 `node_modules` 依赖单文件 `dist-server/`、`dist-mcp/`）
- Tauri 舞台整理 / 打包：`pnpm tauri:prepare`（打包节点与静态资源）/ `pnpm tauri build`（构建 Windows NSIS `.exe` 与 `.msi` 安装包）
- 隔离回归：`pnpm exec tsx scripts/mcp_bridge_audit.mjs`（完全隔离测试数据与主目录，10 项全链路校验，不触碰正式 `data/`）
- 生产启动：`pnpm start` 或 `node dist-server/index.js`（或直接双击 `启动协同看板.cmd`，访问 `http://127.0.0.1:25880`）
- 维护交接入口：[HANDOFF.md](./HANDOFF.md)；v1.3 演进开发方案与验收记录见 [PLAN_v1.3.md](./PLAN_v1.3.md)；历史产品规划和完成记录沿用 [PLAN.md](./PLAN.md)。
