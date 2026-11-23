# AgentSwarm 维护交接

## 当前状态（2026-11-23 · v1.4.0 Tauri v2 桌面化封装、MCP 自动挂起监听与 4 色主题已验收）

- **版本号与运行状态**：`package.json` 与 `src-tauri/tauri.conf.json` 版本号均为 `1.4.0`（Node.js `24.16.0`、pnpm `11.7.0`），生产服务运行于 `http://127.0.0.1:25880`（`dist-server/index.js`）。既有本地 `data/` 中的用户正式看板与会话数据完整保留（并通过 `.gitignore` 严格隔离，不进入 Git 仓库）。
- **v1.4.0 核心增量（2026-11-23）**：
  1. **MCP 自动挂起监听（零轮询待命）与一键停止**：
     - `server/mcp/index.ts`、`server/index.ts` 与 `server/orchestrator/swarmBus.ts` 为支持 `wait` 的响应注入 `autoStandby` 结构化指引、升级 `McpServer` (`agent-swarm-board` `1.4.0`) `instructions` 与 `cowork_standby_mode` Prompt，引导 Antigravity / CodeX / CodeBuddy / Claude Code 主管在常规收尾时自动挂起 `cowork_wait_board(waitForNewActivity=true)`。
     - 数据库新增 `boards.host_auto_standby`（默认 `1`），看板与 MCP App 侧栏提供 **「自动监听：开/关」** 切换与用户自然语言停止指令（`结束监听 / 停止监听 / 关闭监听`），关闭瞬间释放所有 `standby` 等待句柄（实测耗时 `7ms`）。
  2. **4 套主软件 + 插件同步主题色与发布级文案润色**：
     - 新增 **薰衣草紫（`purple`，默认）/ 雾霭蓝（`blue`）/ 鼠尾草绿（`green`）/ 樱花粉（`pink`）** 四色主题，`GET/PUT /api/settings/theme` 持久化至 `app_settings` (`ui_theme`) 并经由 WebSocket `theme.updated` 与 MCP App `set_theme` 双向实时同步；全站图标与品牌 Logo 随 CSS 变量动态着色，移动端 `< 640px` 协同看板将主题切换置入左侧抽屉以免挤压顶栏额度胶囊与网络按钮。
     - 全站统一定名为 **AgentSwarm**，消除早期测试性文案与原始备份后缀暴露，优化导览会话（`快速上手：多智能体协同导览` / `导览`）与跨端连接锁屏说明。
  3. **Tauri v2 桌面端打包与自包含 Node 24 运行时**：
     - `scripts/build-mcp.mjs` 将 Express / WebSocket / MCP SDK / Zod / QRCode 等全部运行时 npm 依赖内联构建入 `dist-server/index.js`、`dist-mcp/index.js` 与 `dist-mcp/preInvocationHook.js`（仅依赖 Node 24 内置 `node:sqlite` 与系统标准库，脱离 `node_modules/` 独立启动实测 `200 OK`）。
     - `server/mcp/utils.ts` 升级 `resolveDefaultDataDir`：源码目录运行延续 `./data`；安装态只读目录运行自动将数据持久化至系统应用数据目录（Windows `%LOCALAPPDATA%\AgentSwarm\data`）。
     - `src-tauri/` 完整实现 Tauri v2 宿主（`tray-icon`、单实例聚焦、关闭最小化到托盘、`CREATE_NO_WINDOW = 0x08000000` 后台拉起内置 `runtime/node.exe`、退出自动回收子进程），并配套 `.github/workflows/release.yml` 在 `windows-latest` 上自动运行 `pnpm build`、10 项审计及 `pnpm tauri build` 输出 NSIS `.exe` 与 WiX `.msi` GitHub Release。

## 本轮实测与验收结果（2026-11-23）

1. **全量构建与 Tauri 舞台整理（`pnpm tauri:prepare`）**：
   - 最终代码后执行 `tsc --noEmit && vite build && node scripts/build-mcp.mjs` 与运行时打包全部退出码 `0`（`1899` 模块，`5.50s`，最大分包 `223.23 kB`，同步刷新 `dist/`、`dist-server/`、`dist-mcp/` 与 `src-tauri/bundle-stage/`）。
2. **10 项全隔离自动化回归审计（`pnpm exec tsx scripts/mcp_bridge_audit.mjs`）**：
   - Check 1–10 与正式 `data/` 零触碰守卫全部 `[PASS]`（新增 Check 10 覆盖 `autoStandby` 指令生成、切换关闭后 `7ms` 立即释放挂起等待以及 4 色主题在 `/api/workbench` 与 `/api/mcp/panel-state` 中的跨端同步）。
3. **真实浏览器双视口实测（`1440×900` 与 `375×812`）**：
   - 桌面端四色主题切换、看板自动监听开/关、Antigravity MCP App 面板交互与持久化复位均通过，零控制台/HTTP 错误。
   - 针对初次移动端 `375×812` 看板顶栏溢出问题完成修复后二次复测：`协同看板` 顶栏配额胶囊与「异地组网」右侧边距 `365 <= 375` 零裁切；左侧滑出抽屉新增「界面主题」4 色行正常显示；`工作台` 宽度 `375px` 零溢出，`0` 失败请求、`0` 控制台报错。

## 接手入口

- 开源发布与用户说明见 [README.md](./README.md)，完整产品规划见 [PLAN.md](./PLAN.md)，工程规范见 [AGENTS.md](./AGENTS.md)，v1.3 MCP 细化方案见 [PLAN_v1.3.md](./PLAN_v1.3.md)。
- 常用命令：`pnpm dev`（开发联调）、`pnpm build`（全量构建）、`pnpm exec tsx scripts/mcp_bridge_audit.mjs`（10 项全隔离审计）、`pnpm tauri:prepare`（整理桌面打包舞台）、`pnpm tauri build`（构建桌面安装程序）。
