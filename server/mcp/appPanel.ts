import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { getBoardApiBaseUrl, resolveMcpRepoRoot } from './utils.js';

export const PANEL_RESOURCE_URI = 'ui://cowork-board/panel.html';

const REPO_ROOT = resolveMcpRepoRoot();

function loadPanelHtml(): string {
  const htmlPath = process.env.COWORK_APP_HTML || path.join(REPO_ROOT, 'dist-mcp', 'panel.html');
  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, 'utf8');
  }
  return `<!doctype html><html lang="zh-CN"><body><div style="font-family:sans-serif;padding:16px">未找到 dist-mcp/panel.html，请先运行 pnpm build。</div></body></html>`;
}

async function fetchPanelState(boardId?: string, bridgeActive?: boolean) {
  const baseUrl = getBoardApiBaseUrl();
  const cleanId = boardId?.trim() || '';

  const qs = new URLSearchParams();
  if (cleanId) qs.set('boardId', cleanId);
  if (bridgeActive !== undefined) qs.set('bridgeActive', bridgeActive ? '1' : '0');
  const qStr = qs.toString();

  // Primary path: lightweight pure-SQLite /api/mcp/panel-state (< 5ms, zero CLI/quota scan)
  const panelRes = await fetch(
    `${baseUrl}/api/mcp/panel-state${qStr ? `?${qStr}` : ''}`,
    { signal: AbortSignal.timeout(4000) }
  );
  if (panelRes.ok) {
    return (await panelRes.json()) as {
      webUrl: string;
      boards: Array<{
        id: string;
        title: string;
        leaderMode: string;
        hostWaiting: boolean;
        hostPanelBridgeActive?: boolean;
        turnCount: number;
      }>;
      modelsByEngine?: Record<string, unknown[]>;
      board: Record<string, unknown> | null;
      agents: unknown[];
      tasks: unknown[];
      snapshots: unknown[];
      posts: unknown[];
    };
  }

  // Fallback path: lightweight /api/boards + direct /api/boards/:id/snapshot
  const boardsRes = await fetch(`${baseUrl}/api/boards`, {
    signal: AbortSignal.timeout(3500),
  });
  if (!boardsRes.ok) {
    throw new Error(`看板服务响应异常 (${boardsRes.status})`);
  }
  const rawBoards = (await boardsRes.json()) as Array<{
    id: string;
    title: string;
    leaderMode: string;
    hostWaiting: boolean;
    hostPanelBridgeActive?: boolean;
    turnCount: number;
  }>;
  const boards = rawBoards.map((b) => ({
    id: b.id,
    title: b.title,
    leaderMode: b.leaderMode,
    hostWaiting: b.hostWaiting,
    hostPanelBridgeActive: b.hostPanelBridgeActive,
    turnCount: b.turnCount,
  }));

  const targetBoardId =
    cleanId ||
    boards.find((b) => b.leaderMode === 'mcp_host')?.id ||
    boards[0]?.id ||
    '';

  const webUrl = baseUrl;
  if (!targetBoardId) {
    return {
      webUrl,
      boards,
      modelsByEngine: {},
      board: null,
      agents: [],
      tasks: [],
      snapshots: [],
      posts: [],
    };
  }

  const snapRes = await fetch(
    `${baseUrl}/api/boards/${encodeURIComponent(targetBoardId)}/snapshot`,
    { signal: AbortSignal.timeout(4000) }
  );
  if (!snapRes.ok) {
    return {
      webUrl,
      boards,
      modelsByEngine: {},
      board: null,
      agents: [],
      tasks: [],
      snapshots: [],
      posts: [],
    };
  }
  const snap = (await snapRes.json()) as Record<string, unknown>;
  return {
    webUrl,
    boards,
    modelsByEngine: {},
    board: (snap.board as Record<string, unknown>) ?? null,
    agents: (snap.agents as unknown[]) ?? [],
    tasks: (snap.tasks as unknown[]) ?? [],
    snapshots: (snap.snapshots as unknown[]) ?? [],
    posts: (snap.posts as unknown[]) ?? [],
  };
}

export function registerPanelApp(
  server: McpServer,
  ensureServerRunning: () => Promise<void>
): void {
  registerAppResource(
    server,
    'AgentSwarm 协同看板面板',
    PANEL_RESOURCE_URI,
    {
      description: 'AgentSwarm 实时团队成员、任务进度、文件改动与双向对话面板',
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: false,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: PANEL_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadPanelHtml(),
          _meta: {
            ui: {
              prefersBorder: false,
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    'cowork_panel',
    {
      title: '打开协同看板面板',
      description: '在侧边栏或右侧分栏展示 AgentSwarm 协同看板实时状态、任务进度、文件快照并向左侧对话注入指令。',
      inputSchema: {
        boardId: z.string().optional().describe('可选：指定要显示的看板 ID；留空自动选择最近活跃看板'),
      },
      _meta: {
        ui: {
          resourceUri: PANEL_RESOURCE_URI,
          visibility: ['model', 'app'],
        },
        'com.google.antigravity/ui': {
          entrypoints: [
            { type: 'aux_pane', title: 'AgentSwarm 协同看板' },
            { type: 'global', title: 'AgentSwarm 协同看板' },
          ],
        },
      },
    },
    async (args) => {
      await ensureServerRunning();
      const state = await fetchPanelState(args?.boardId);
      const summary = state.board
        ? `已在侧边面板打开协同看板「${(state.board as { title?: string }).title || ''}」(${(state.board as { id?: string }).id || ''})，当前共 ${(state.agents as unknown[]).length} 名成员、${(state.tasks as unknown[]).length} 项任务。`
        : '已在侧边面板打开协同看板（当前暂无活跃看板，可先调用 cowork_setup_board 创建）。';

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: state as unknown as Record<string, unknown>,
      };
    }
  );

  registerAppTool(
    server,
    'cowork_app_poll_state',
    {
      title: '刷新面板状态',
      description: 'App-only: 读取最新看板状态快照并上报侧栏自动转接心跳',
      inputSchema: {
        boardId: z.string().optional(),
        bridgeActive: z.boolean().optional(),
      },
      _meta: {
        ui: {
          resourceUri: PANEL_RESOURCE_URI,
          visibility: ['app'],
        },
      },
    },
    async (args) => {
      await ensureServerRunning();
      const state = await fetchPanelState(args?.boardId, args?.bridgeActive);
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: state as unknown as Record<string, unknown>,
      };
    }
  );

  registerAppTool(
    server,
    'cowork_app_action',
    {
      title: '执行面板快捷操作',
      description: 'App-only: 在面板中操作任务、调整成员模型/思考、管理快照、发消息及自动转交网页留言',
      inputSchema: {
        boardId: z.string(),
        action: z.enum([
          'toggle_task',
          'add_task',
          'update_agent',
          'checkpoint',
          'adopt_snapshot',
          'revert_snapshot',
          'toggle_cli_fallback',
          'toggle_auto_standby',
          'set_theme',
          'send_human_message',
          'claim_forward_inbox',
          'confirm_forward_inbox',
        ]),
        taskId: z.string().optional(),
        nextStatus: z.string().optional(),
        title: z.string().optional(),
        assigneeSlotId: z.string().optional(),
        slotId: z.string().optional(),
        modelId: z.string().optional(),
        reasoningEffort: z.string().optional(),
        label: z.string().optional(),
        snapshotId: z.string().optional(),
        hostCliFallback: z.boolean().optional(),
        hostAutoStandby: z.boolean().optional(),
        uiTheme: z.string().optional(),
        content: z.string().optional(),
        deliveryId: z.string().optional(),
        ok: z.boolean().optional(),
        bridgeActive: z.boolean().optional(),
      },
      _meta: {
        ui: {
          resourceUri: PANEL_RESOURCE_URI,
          visibility: ['app'],
        },
      },
    },
    async (args) => {
      await ensureServerRunning();
      const baseUrl = getBoardApiBaseUrl();

      if (args.action === 'claim_forward_inbox') {
        const r = await fetch(
          `${baseUrl}/api/mcp/boards/${encodeURIComponent(args.boardId)}/panel-claim-inbox`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(4000),
          }
        );
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
        const claimResult = (await r.json()) as Record<string, unknown>;
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { claimResult },
        };
      }

      if (args.action === 'confirm_forward_inbox') {
        const r = await fetch(`${baseUrl}/api/mcp/host-inbox/ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: args.deliveryId,
            boardId: args.boardId,
            stage: args.ok ? 'acked' : 'failed',
            deliveryTag: args.ok ? 'panel_forwarded' : undefined,
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
        const fresh = await fetchPanelState(args.boardId, args.bridgeActive ?? true);
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: fresh as unknown as Record<string, unknown>,
        };
      }

      if (args.action === 'toggle_task' && args.taskId) {
        const r = await fetch(
          `${baseUrl}/api/mcp/boards/${encodeURIComponent(args.boardId)}/manage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upsert_task',
              taskId: args.taskId,
              status: args.nextStatus || 'completed',
            }),
          }
        );
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'add_task' && args.title?.trim()) {
        const r = await fetch(
          `${baseUrl}/api/mcp/boards/${encodeURIComponent(args.boardId)}/manage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upsert_task',
              title: args.title.trim(),
              assigneeSlotId: args.assigneeSlotId || 'lead',
              status: 'pending',
            }),
          }
        );
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'update_agent' && args.slotId) {
        const r = await fetch(
          `${baseUrl}/api/mcp/boards/${encodeURIComponent(args.boardId)}/manage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_agent',
              slotId: args.slotId,
              modelId: args.modelId,
              reasoningEffort: args.reasoningEffort,
            }),
          }
        );
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'checkpoint') {
        const r = await fetch(
          `${baseUrl}/api/mcp/boards/${encodeURIComponent(args.boardId)}/manage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'checkpoint',
              label: args.label || '侧边栏手动检查点',
            }),
          }
        );
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'adopt_snapshot' && args.snapshotId) {
        const r = await fetch(
          `${baseUrl}/api/mcp/boards/${encodeURIComponent(args.boardId)}/manage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'adopt_snapshot', snapshotId: args.snapshotId }),
          }
        );
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'revert_snapshot' && args.snapshotId) {
        const r = await fetch(
          `${baseUrl}/api/mcp/boards/${encodeURIComponent(args.boardId)}/manage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'revert_snapshot',
              snapshotId: args.snapshotId,
              mode: 'strict',
            }),
          }
        );
        if (!r.ok) {
          const msg =
            r.status === 409
              ? '检测到较新文件编辑冲突，请前往网页看板使用三向对比处理'
              : await r.text();
          return { isError: true, content: [{ type: 'text', text: msg }] };
        }
      } else if (args.action === 'toggle_cli_fallback') {
        const r = await fetch(`${baseUrl}/api/boards/${encodeURIComponent(args.boardId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostCliFallback: Boolean(args.hostCliFallback) }),
        });
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'toggle_auto_standby') {
        const r = await fetch(`${baseUrl}/api/boards/${encodeURIComponent(args.boardId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostAutoStandby: Boolean(args.hostAutoStandby) }),
        });
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'set_theme' && args.uiTheme) {
        const r = await fetch(`${baseUrl}/api/settings/theme`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uiTheme: args.uiTheme }),
        });
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      } else if (args.action === 'send_human_message' && args.content?.trim()) {
        const r = await fetch(
          `${baseUrl}/api/boards/${encodeURIComponent(args.boardId)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: args.content.trim(),
              targetSlotId: args.assigneeSlotId || 'lead',
            }),
          }
        );
        if (!r.ok) {
          return { isError: true, content: [{ type: 'text', text: await r.text() }] };
        }
      }

      const fresh = await fetchPanelState(args.boardId, args.bridgeActive);
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: fresh as unknown as Record<string, unknown>,
      };
    }
  );
}
