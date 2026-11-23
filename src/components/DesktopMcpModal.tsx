import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Check, Plug, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type {
  DesktopMcpClientId,
  DesktopMcpClientStatus,
  McpSelfTestResult,
} from '../types';
import { EngineIcon } from './BrandIcon';
import { apiFetch } from '../utils/api';

interface DesktopMcpModalProps {
  open: boolean;
  isLocalhost?: boolean;
  onClose: () => void;
}

export const DesktopMcpModal: React.FC<DesktopMcpModalProps> = ({
  open,
  isLocalhost = true,
  onClose,
}) => {
  const [clients, setClients] = useState<DesktopMcpClientStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<DesktopMcpClientId | null>(null);
  const [enableAgyHook, setEnableAgyHook] = useState(true);
  const [selfTesting, setSelfTesting] = useState(false);
  const [selfTest, setSelfTest] = useState<McpSelfTestResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const syncAgyHookToggle = (list: DesktopMcpClientStatus[]) => {
    const agy = list.find((c) => c.id === 'antigravity');
    if (agy) {
      setEnableAgyHook(agy.registered ? Boolean(agy.hookRegistered) : true);
    }
  };

  const loadClients = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/mcp/clients');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || '无法读取桌面端接入状态');
      }
      const data = (await res.json()) as { clients?: DesktopMcpClientStatus[] };
      const list = data.clients || [];
      setClients(list);
      syncAgyHookToggle(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setErrorMsg(null);
    setSelfTest(null);
    void loadClients();
  }, [open, loadClients]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleToggleRegister = async (
    client: DesktopMcpClientStatus,
    action: 'register' | 'unregister',
    overrideHook?: boolean
  ) => {
    if (!isLocalhost || busyId) return;
    setBusyId(client.id);
    setErrorMsg(null);
    setNotice(null);
    const targetHook = overrideHook !== undefined ? overrideHook : enableAgyHook;
    try {
      const res = await apiFetch(`/api/mcp/clients/${client.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'register' && client.id === 'antigravity'
            ? { enableHook: targetHook }
            : {}
        ),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        clients?: DesktopMcpClientStatus[];
      };
      if (!res.ok) {
        throw new Error(body.error || '配置写入失败');
      }
      if (Array.isArray(body.clients)) {
        setClients(body.clients);
        syncAgyHookToggle(body.clients);
      } else {
        await loadClients();
      }

      if (action === 'unregister') {
        setNotice(`已从 ${client.name} 安全移除协同看板 MCP 配置（保留第三方项）。`);
      } else if (client.id === 'antigravity' && overrideHook !== undefined) {
        setNotice(
          targetHook
            ? '已为 Antigravity 启用闲置留言自动注入 Hook（下次发起对话时自动带入）。'
            : '已停用 Antigravity 闲置留言 Hook（MCP 接入与第三方 Hook 完整保留）。'
        );
      } else {
        setNotice(`已更新 ${client.name} 配置（原配置已自动备份）。`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRunSelfTest = async () => {
    if (!isLocalhost || selfTesting) return;
    setSelfTesting(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/mcp/self-test', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as McpSelfTestResult & { error?: string };
      if (!res.ok) {
        throw new Error(body.error || '自检执行失败');
      }
      setSelfTest(body);
      await loadClients();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSelfTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 sm:p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[690px] max-h-[calc(100vh-24px)] flex flex-col overflow-hidden rounded-3xl border border-[#EAEAEF] bg-white p-4 sm:p-6 shadow-2xl gap-3.5"
      >
        <div className="flex items-start justify-between gap-2.5 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--ac-soft)] text-[var(--ac-primary)]">
              <Plug className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[16px] sm:text-[17px] font-bold text-[#1F2024]">
                桌面端 MCP 一键接入与诊断
              </h3>
              <p className="text-[12px] sm:text-[12.5px] text-[#7A7D89] mt-0.5">
                在桌面客户端与主管对话并调度看板团队；原有第三方 MCP 配置与注释完整保留。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isLocalhost && (
              <button
                type="button"
                disabled={selfTesting}
                onClick={() => void handleRunSelfTest()}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-tint)] px-3 text-[12px] font-semibold text-[var(--ac-text)] hover:bg-[var(--ac-soft-hover)] disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Activity className="h-3.5 w-3.5" />
                <span>{selfTesting ? '探活中...' : '一键自检'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭桌面端 MCP 接入弹窗"
              className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5">
          {/* Condition-based explanation of the 3 wakeup & delivery modes */}
          <div className="rounded-2xl border border-[var(--ac-border-soft)] bg-[var(--ac-tint)] px-3.5 py-2.5 text-[12px] text-[#555866] grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <span className="font-semibold text-[#3B7A57]">1. 自动挂起监听（支持端）</span>
              <p className="text-[11.5px] text-[#6E717C] mt-0.5">
                在 CodeX / Claude Code 等开启「自动监听」且宿主支持长工具调用时，汇报后可挂起等待新留言。
              </p>
            </div>
            <div>
              <span className="font-semibold text-[var(--ac-text)]">2. 侧栏与 Hook 直通</span>
              <p className="text-[11.5px] text-[#6E717C] mt-0.5">
                Antigravity 打开右侧看板分栏可自动转入左侧对话；未开侧栏时下次发起对话可由 Hook 带入留言。
              </p>
            </div>
            <div>
              <span className="font-semibold text-[#4B4D57]">3. 后台 CLI 兜底代答</span>
              <p className="text-[11.5px] text-[#6E717C] mt-0.5">
                当桌面宿主未在监听或尚未接入时，可一键由后台 CLI 成员直接接管答复。
              </p>
            </div>
          </div>

          {!isLocalhost && (
            <div className="rounded-2xl border border-[#EFE2CE] bg-[#FCF7EF] px-4 py-3 text-[12.5px] text-[#8E5F24]">
              当前处于远程/手机访问视图，读写桌面客户端本地配置与探活仅限在电脑本机操作。
            </div>
          )}

          {selfTest && (
            <div className="rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-tint)] px-3.5 py-2.5 text-[12px] text-[#4B4D57] space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    1. 本地服务：
                    <strong className={selfTest.serverHealth.ok ? 'text-[#3B7A57]' : 'text-[#A65850]'}>
                      {selfTest.serverHealth.ok ? `正常 (${selfTest.serverHealth.latencyMs}ms)` : '异常'}
                    </strong>
                  </span>
                  <span>
                    2. MCP 工具清单：
                    <strong className={selfTest.mcpStdio.ok ? 'text-[#3B7A57]' : 'text-[#A65850]'}>
                      {selfTest.mcpStdio.ok
                        ? `${selfTest.mcpStdio.toolsCount} 项可用 (${selfTest.mcpStdio.latencyMs}ms)`
                        : '未就绪'}
                    </strong>
                  </span>
                  <span>
                    3. Hook 脚本响应：
                    <strong className={selfTest.hookProbe.ok ? 'text-[#3B7A57]' : 'text-[#A65850]'}>
                      {selfTest.hookProbe.ok ? `正常 (${selfTest.hookProbe.latencyMs}ms)` : '未就绪'}
                    </strong>
                  </span>
                </div>
                <span className="text-[11px] text-[#8A8D98]">仅测本机进程</span>
              </div>
              <div className="text-[11px] text-[#7A7D89]">
                提示：自检验证本地服务与脚本本身可用；在宿主客户端中是否加载成功，请刷新对应客户端 MCP 列表并新开对话确认。
              </div>
            </div>
          )}

          {notice && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#CBE6D5] bg-[#EAF5EE] px-3.5 py-2.5 text-[12.5px] font-medium text-[#3B7A57]">
              <Check className="h-4 w-4 flex-shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-2xl border border-[#EED7D4] bg-[#FDF5F4] px-3.5 py-2.5 text-[12.5px] text-[#A65850]">
              {errorMsg}
            </div>
          )}

          <div className="space-y-3">
          {loading && clients.length === 0 ? (
            <div className="py-10 text-center text-[13.5px] text-[#8A8D98]">正在检测桌面端配置...</div>
          ) : (
            clients.map((client) => {
              const isBusy = busyId === client.id;
              const diag = selfTest?.clients.find((d) => d.clientId === client.id);
              const unreadCount = client.unreadForClientCount || 0;

              return (
                <div
                  key={client.id}
                  className={`rounded-2xl border p-3.5 sm:p-4 transition ${
                    client.registered
                      ? 'border-[var(--ac-border)] bg-[var(--ac-tint)]'
                      : 'border-[#EAEAEF] bg-[#FCFCFD]'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white border border-[#ECECF2]">
                        <EngineIcon engine={client.engine} size={22} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[15px] font-bold text-[#1F2024] whitespace-nowrap">
                            {client.name}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                              client.installed
                                ? 'bg-[#EAF5EE] text-[#458964]'
                                : 'bg-[#F1F1F5] text-[#8E919C]'
                            }`}
                          >
                            {client.installed ? '客户端已检测' : '未检测到客户端'}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                              client.registered
                                ? 'bg-[var(--ac-soft-hover)] text-[var(--ac-text)]'
                                : 'bg-[#F4F4F7] text-[#7A7D89]'
                            }`}
                          >
                            {client.registered ? '配置已写入' : '未写入配置'}
                          </span>
                          {diag && (
                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                                diag.toolsReady
                                  ? 'bg-[#EAF5EE] text-[#3B7A57]'
                                  : 'bg-[#FDF5F4] text-[#A65850]'
                              }`}
                            >
                              {diag.toolsReady ? '本地脚本就绪' : '工具异常'}
                            </span>
                          )}
                          {client.supportsHook && client.registered && (
                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                                client.hookRegistered
                                  ? 'bg-[#EBF6F0] text-[#3B7A57]'
                                  : 'bg-[#F3F3F7] text-[#7A7D89]'
                              }`}
                            >
                              {client.hookRegistered ? 'Hook 已启用' : 'Hook 已停用'}
                            </span>
                          )}
                        </div>

                        {/* Live Session & Delivery Status Pills (P2-04) */}
                        {client.registered && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                            <span
                              className={`rounded-lg border px-2 py-0.5 font-medium ${
                                client.sessionBindingState === 'waiting'
                                  ? 'border-[#CBE6D5] bg-[#EAF5EE] text-[#3B7A57]'
                                  : client.sessionBindingState === 'bound_idle'
                                    ? 'border-[var(--ac-border)] bg-[var(--ac-soft)] text-[var(--ac-text)]'
                                    : 'border-[#E6E6EE] bg-white text-[#6E717C]'
                              }`}
                            >
                              {client.sessionBindingLabel || '尚未建立桌面端看板'}
                            </span>
                            {client.deliveryModeLabel && (
                              <span className="rounded-lg border border-[#EAEAEF] bg-white px-2 py-0.5 text-[#5E616D]">
                                {client.deliveryModeLabel}
                              </span>
                            )}
                            {unreadCount > 0 && (
                              <span className="rounded-lg border border-[var(--ac-border)] bg-[var(--ac-soft)] px-2 py-0.5 font-semibold text-[var(--ac-text)] whitespace-nowrap">
                                待同步留言 {unreadCount} 条
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-1 text-[12px] text-[#6E717C]">
                          {diag ? diag.actionHint : client.hint}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#9A9DA8] font-mono break-all">
                          <span>{client.configPath}</span>
                          {client.backupExists && (
                            <span className="inline-flex items-center gap-1 font-sans text-[#6E717C] whitespace-nowrap">
                              <ShieldCheck className="h-3 w-3 text-[#5BA97B]" /> 已备份原配置
                            </span>
                          )}
                        </div>

                        {client.id === 'antigravity' && (
                          <div className="mt-2 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="inline-flex items-start sm:items-center gap-2 text-[12px] text-[#4B4D57] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={enableAgyHook}
                                  onChange={(e) => setEnableAgyHook(e.target.checked)}
                                  className="mt-0.5 sm:mt-0 rounded border-[var(--ac-border-strong)] accent-[var(--ac-primary)] flex-shrink-0"
                                />
                                <span>
                                  挂载 PreInvocation Hook（闲置时网页 @主管 留言自动带入下次对话）
                                </span>
                              </label>
                              {client.registered && (
                                <button
                                  type="button"
                                  disabled={!isLocalhost || isBusy}
                                  onClick={() =>
                                    void handleToggleRegister(
                                      client,
                                      'register',
                                      !client.hookRegistered
                                    )
                                  }
                                  className="rounded-lg border border-[var(--ac-border)] bg-white px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-soft)] disabled:opacity-45 whitespace-nowrap cursor-pointer"
                                >
                                  {client.hookRegistered ? '停用 Hook' : '启用 Hook'}
                                </button>
                              )}
                            </div>
                            <p className="pl-5 text-[11px] text-[#8A8D98]">
                              用途说明：仅在 Antigravity 内发出提问前快速检查一次本机未读留言并附加到上下文；无未读留言时直接放行，可随时单独停用。
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 w-full sm:w-auto flex-shrink-0 pt-2 sm:pt-0 border-t border-[#EFEFF5] sm:border-t-0">
                      {client.registered ? (
                        <>
                          <button
                            type="button"
                            disabled={!isLocalhost || isBusy}
                            onClick={() => void handleToggleRegister(client, 'register')}
                            className="inline-flex h-8.5 items-center gap-1 rounded-xl border border-[var(--ac-border)] bg-white px-3 text-[12.5px] font-medium text-[var(--ac-text)] hover:bg-[var(--ac-soft)] disabled:opacity-45 whitespace-nowrap cursor-pointer"
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> 更新
                          </button>
                          <button
                            type="button"
                            disabled={!isLocalhost || isBusy}
                            onClick={() => void handleToggleRegister(client, 'unregister')}
                            className="inline-flex h-8.5 items-center rounded-xl border border-[#E5D7D5] bg-[#FDF8F7] px-3 text-[12.5px] font-medium text-[#A65850] hover:bg-[#F9ECEA] disabled:opacity-45 whitespace-nowrap cursor-pointer"
                          >
                            {isBusy ? '处理中...' : '一键取消'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={!isLocalhost || isBusy}
                          onClick={() => void handleToggleRegister(client, 'register')}
                          className={`inline-flex h-8.5 items-center rounded-xl px-4 text-[12.5px] font-semibold disabled:opacity-45 whitespace-nowrap cursor-pointer ${
                            client.installed
                              ? 'bg-[var(--ac-primary)] text-white hover:bg-[var(--ac-hover)]'
                              : 'border border-[var(--ac-border)] bg-white text-[var(--ac-text)] hover:bg-[var(--ac-soft)]'
                          }`}
                        >
                          {isBusy ? '写入中...' : client.installed ? '一键接入' : '预写入配置'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#F1F1F5] text-[12px] text-[#8E919C] flex-shrink-0">
          <span className="min-w-0">
            每次触发 MCP 工具时若后台服务未运行，将自动静默拉起无窗口守护进程。
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-[#E4E4EC] bg-white px-4 text-[13px] font-medium text-[#4B4D57] hover:bg-[#F5F5F9] whitespace-nowrap flex-shrink-0 cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
