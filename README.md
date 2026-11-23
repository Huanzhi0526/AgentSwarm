# AgentSwarm

**AgentSwarm** 是一款本地优先（Local-First）的多智能体群聊式协同看板、桌面端 MCP 主管调度中枢与额度工作台，提供开箱即用的 **Windows 桌面端应用（Tauri v2）** 与 **局域网 / 手机端实时 Web 协同界面**，完整兼容并收录 **20 款主流 CLI 智能体**：

> **Antigravity** · **CodeX** · **CodeBuddy** · **Claude Code** · Gemini CLI · Qwen Code · OpenCode · Cursor · Copilot CLI · Kimi CLI · Auggie · Goose · Droid · Qoder · Mistral Vibe · Kiro · Hermes · Snow · OpenClaw · Nanobot

---

## 核心特性

### 1. 桌面端 MCP 主管直驱 + 看板 CLI 双模协同
- **双模无缝并存**：既可直接在桌面 AI 客户端（**Antigravity、CodeX、CodeBuddy、Claude Code**）中由主对话担任“团队主管”统筹全局，也可切换为看板独立驱动后台 CLI 团队，两种模式随时互补。
- **自动挂起监听（0 Token 待命）**：看板内置 MCP `instructions`、工具契约与 `cowork_standby_mode` 提示词规范，桌面端主管在工具返回后会自动调用 `cowork_wait_board(waitForNewActivity=true)` 进入零轮询阻塞监听；监听期间不空耗额外额度，网页或手机端随时发送 `@主管` 留言均可秒级唤醒并附带客观工作区文件改动证据包。
- **可控监听与兜底接管**：看板顶栏提供一键 **「自动监听：开 / 关」**（关闭时立即释放所有挂起监听）与 **「闲置时 CLI 主管代答」** 开关，兼顾自动化与手动节奏控制。
- **Antigravity 原生右侧栏插件（MCP App）与 Hook**：通过官方 `ui://cowork-board/panel.html` 在 Antigravity 右侧边栏原生渲染看板对话、成员与任务、改动备份三段视图，支持「自动唤醒左侧」通过官方 `app.sendMessage()` 直达主对话；配合可独立启停的 `PreInvocation` Hook，在闲置下轮发话时自动带入未读留言。

### 2. 工作台统一调度与 20 款智能体模型预设
- **引擎默认档位预设**：在工作台为 20 款智能体逐一预设默认模型与**模型原生思考强度**（`low` / `medium` / `high` / `xhigh` / `max` / `ultra`），新建看板、调整成员或 MCP 建板时自动继承。
- **自由组队与波次屏障**：支持「自由协同」与多种内置专业团队模板，开工前后可随时增删成员、切换主管、编辑团队规则（自动优先选用本机已安装引擎）；多成员并行时自动等待整波次完成后汇总，支持任务依赖（`blockedBy`）自动解锁与点击 `@成员` 查看双人往来记录。
- **真实额度监控与热力图**：本地只读扫描会话日志生成可聚焦活跃热力图，实时读取 **Antigravity**（`Gemini 5h / 周`、`Claude 5h / 周`）与 **CodeX**（`5h / 周`）官方剩余额度与重置倒计时，支持多账号槽位保存与一键切号。

### 3. 安全代码快照与三向防冲突撤回
- **全自动改动保护**：每轮智能体交付前自动记录工作区快照，命令行异常退出时同样捕获保护快照；聊天气泡与右侧备份栏支持分栏 **「对比改动」**、**「采纳保留」**、**「一键撤回」** 与随时新建手动检查点。
- **三向冲突检测**：当磁盘文件存在较新人工修改时，撤回前自动提示并支持「保留较新修改」或「备份当前改动后再还原」，避免误覆写工作成果。
- **隔离预览与图形选目录**：HTML 交付产物通过无宿主凭证权限的独立隔离沙盒渲染，兼容 Markdown / 图片 / PDF / 代码预览；内置高响应图形化目录选择器与系统原生选文件夹窗口。

### 4. 四套柔和主题色与手机端扫码直连
- **主软件 & 侧栏插件统一换肤**：内置 **薰衣草紫（默认）/ 雾霭蓝 / 鼠尾草绿 / 樱花粉** 四套低饱和度主题色，主软件顶部切换后 Antigravity MCP App 侧栏插件实时同步一致风格。
- **桌面端常驻 + 手机协同**：Tauri 桌面应用自带托盘常驻、单实例唤醒与「在浏览器中打开」；点击右上角网络胶囊即可生成手机扫码直连二维码，支持 4 位陌生设备连接码与随时撤销已配对设备。

---

## 快速安装与使用

### 方式一：下载 Windows 安装包（推荐）
无需配置 Node.js 或命令行环境：
1. 前往本仓库 [Releases 页面](https://github.com/Huanzhi0526/AgentSwarm/releases) 下载最新 Windows 安装向导（`*.exe`）或 `*.msi` 安装包。
2. 双击完成安装并启动 **AgentSwarm**，程序会自动在后台唤醒本地服务并打开主界面（关闭窗口默认最小化至系统托盘，右键托盘图标可随时打开浏览器视图或彻底退出）。
3. 数据默认持久化在系统本地应用目录（Windows 下为 `%LOCALAPPDATA%\AgentSwarm\data`），升级安装包不会丢失既有看板与配置。

### 方式二：接入桌面 AI 客户端（Antigravity / CodeX / CodeBuddy / Claude Code）
1. 在左侧栏或工作台点击 **「桌面端 MCP 接入」**。
2. 在弹窗中点击对应客户端的 **「一键接入 MCP」**（自动备份原有配置，安全增量写入，支持随时还原卸载；CodeX 会自动配置超长工具超时以支撑零消耗长监听）。
3. 在客户端中直接围绕项目目录对话，或调用 `cowork_setup_board` 创建看板，即可开启桌面主管与网页/手机多智能体实时协同。

---

## 源码运行与二次开发

环境要求：**Node.js 24+**、**pnpm 11+**；若需在本地打包 Windows 安装程序，还需 **Rust Stable** 与 Windows MSVC 构建工具（`.github/workflows/release.yml` 已配置自动云端构建 Release）。

```bash
# 1. 安装依赖
pnpm install

# 2. 开发模式（前后端热更新：Web http://127.0.0.1:5173 + Server http://127.0.0.1:25880）
pnpm dev

# 3. 类型检查与全量构建（输出 dist/、dist-server/ 与 dist-mcp/）
pnpm build

# 4. 运行 10 项全隔离 MCP 与工作流回归审计（不触碰正式 data/）
pnpm exec tsx scripts/mcp_bridge_audit.mjs

# 5. 整理自包含运行时并打包 Tauri 桌面安装程序
pnpm tauri:prepare
pnpm tauri build
```

Windows 仓库源码目录下也可直接双击根目录 `启动协同看板.cmd` / `停止协同看板.cmd` 无黑框启停本地服务。更多详细架构与版本演进记录请参阅 [PLAN.md](./PLAN.md)、[AGENTS.md](./AGENTS.md) 与 [HANDOFF.md](./HANDOFF.md)。

---

## 开源参考与许可证

本项目参考并致谢以下开源项目的优秀实践：`iOfficeAI/AionUi`、`claudioed/agent-blackboard`、`JialaoLiu/dsh-baton`、`jazzenchen/agent-hud-open`、`ccusage` / `agy-switch`、`@modelcontextprotocol/sdk`、`@modelcontextprotocol/ext-apps`、`Tauri` 等。

本项目基于 [MIT License](./LICENSE) 开源。
