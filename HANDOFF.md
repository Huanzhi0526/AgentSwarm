# AgentSwarm 维护交接

## 当前状态（2026-11-23 · v1.4.1 安全默认值收紧、无终端闪窗、多实例隔离与文档完善已验收）

- **版本号与运行状态**：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 与 `/api/health` 版本号统一为 `1.4.1`（Node.js `24.16.0`、pnpm `11.7.0`），本机服务运行于 `http://127.0.0.1:25880`（`dist-server/index.js`）。既有本地 `data/` 中的用户正式看板与会话数据完整保留并受 `.gitignore` 保护。
- **v1.4.1 重点修复与升级（对照 v1.4.0 审阅建议全面落地）**：
  1. **Windows 终端黑框闪现根治**：修复 `server/mcp/index.ts`、`workspaceExplorer.ts`、`cliRunner.ts` 中的 `detached: true` 在 Windows 跳过 `CREATE_NO_WINDOW` 导致的闪窗，文件默认打开改用原生 GUI `rundll32.exe url.dll,FileProtocolHandler`，`quotaFetcher.ts` 取消 10 分钟被动后台拉起 `agy.exe`（改用 6 小时被动缓存 + 显式刷新触发），`scripts/start-server.ps1` 切换为无窗口且无管道 `EPIPE` 的独立句柄启动。
  2. **P0 跨设备默认安全边界**：`server/index.ts` 默认严格监听 `127.0.0.1`；`server/auth/pairingGuard.ts` 新增 `remoteAccessEnabled`（新库默认 `false`）、`requirePinOnLan`（默认 `true`）、SHA-256 持久化设备清单及按单台/全量撤销令牌；远程打开时若未开启共享将明确引导在电脑端开启，手机二维码仅显示实际可用的局域网/组网地址。
  3. **P1 桌面实例身份核验、端口隔离与启动可恢复性**：`/api/health` 输出 `service: 'agent-swarm'`、`version` 与本机 `dataDir`；`src-tauri/src/lib.rs` 探测 25880 为其他目录实例时自动隔离启动至 `25881+`（`server/mcp/utils.ts` 通过 `server.pid.json` 自动追踪动态端口），服务输出落盘 `desktop-server.*.log`，`boot-ui/index.html` 支持真实调用宿主 `restart_embedded_server` 重启服务、冲突选择以及查看/复制脱敏诊断。
  4. **P1/P2 新手流程、引擎检查、安全选目录与撤回明确结果**：`NewBoardModal.tsx` 调整为「选目录 → 查主管状态 → 发需求」递进流程并校验安全目录；建板时若主管引擎未安装自动保留 `pendingInitialDraft` 至输入框草稿箱；`cliRunner.ts` / `swarmBus.ts` 区分未安装 / 需登录 / 执行失败三态并提供「重新编辑发送」；`snapshotManager.ts` + `DiffCompareModal.tsx` 持久化并直显 `lastRevertOutcome` 与保护快照跳转；导览页首屏增加「内置离线导览」四步引导卡；`DesktopMcpModal.tsx` 全面转为基于实际检测条件的四维状态表达。
  5. **文档与社区完善**：新增 [docs/USAGE_GUIDE.md](./docs/USAGE_GUIDE.md)、实际界面与对比截图（`docs/images/`）、[SECURITY.md](./SECURITY.md)、[Issue 模板](./.github/ISSUE_TEMPLATE/bug_report.yml)，重写发布版 [README.md](./README.md) 与置顶化 [release.yml](./.github/workflows/release.yml)（增加安装包静默安装烟雾自测门禁）。

## 本轮实测与验收结果（2026-11-23）

1. **全量构建（`pnpm tauri:prepare`）**：
   - `tsc --noEmit && vite build && node scripts/build-mcp.mjs` 退出码 `0`（`1899` 模块，`6.38s`），成功整理 `src-tauri/bundle-stage/`。
2. **11 项全隔离自动化回归审计（`pnpm exec tsx scripts/mcp_bridge_audit.mjs`）**：
   - Check 1–11 与正式 `data/` 零触碰守卫全部 `[PASS]`（新增 Check 7 `skip_conflicts` / `overwrite_all` 明细校验，以及 Check 11 的默认仅本机、远程拒绝、令牌配对与单设备移除、`busy` 目录拦截与未装引擎首条消息草稿保留验证）。
3. **真实浏览器双视口复测（`1440×900` & `375×812`）**：
   - 在 `127.0.0.1:25880`（保留正式 6 会话）与全新隔离实例 `127.0.0.1:25889` 完成全量交互与截图验证：导览四步引导卡、分栏对比窗口、默认 `仅本机`、条件式 MCP 状态、`NewBoardModal` 默认定位用户 `Documents` 目录，以及 `375×812` 窄屏 `right = 365 <= 375` 与可访问 `aria-label` 全通过，`0` 失败请求、`0` 控制台报错。

## 接手入口

- 用户说明书见 [docs/USAGE_GUIDE.md](./docs/USAGE_GUIDE.md)，开源首页见 [README.md](./README.md)，安全政策见 [SECURITY.md](./SECURITY.md)，工程架构见 [AGENTS.md](./AGENTS.md)，历史演进见 [PLAN.md](./PLAN.md)。
- 常用命令：`pnpm dev`（开发联调）、`pnpm build`（全量构建）、`pnpm exec tsx scripts/mcp_bridge_audit.mjs`（11 项全隔离审计）、`pnpm tauri:prepare`（整理桌面打包舞台）、`pnpm tauri build`（构建桌面安装程序）。
