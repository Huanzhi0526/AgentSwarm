#!/usr/bin/env node
/**
 * Lightweight AgentCoWorkBoard helper CLI (inspired by AionUi auto-inject $AIONUI_HELPER_BIN).
 * Allows any local coding CLI (Codex, Antigravity agy, CodeBuddy) to publish structured
 * tasks, deliverables, and approval gates to the shared Swarm board over localhost HTTP.
 */
import { execSync } from 'node:child_process';

const apiUrl = process.env.COWORK_API_URL || 'http://127.0.0.1:25880';
const boardId = process.env.COWORK_BOARD_ID;
const slotId = process.env.COWORK_SLOT_ID || 'lead';

function parseArgs(argv) {
  const [, , subcmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key.startsWith('--')) {
      const name = key.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) {
        opts[name] = 'true';
      } else {
        opts[name] = next;
        i++;
      }
    }
  }
  return { subcmd, opts };
}

function captureGitDiffSnippet(cwd) {
  try {
    const stat = execSync('git status --short', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    const diff = execSync('git diff --stat', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return [stat, diff].filter(Boolean).join('\n\n').slice(0, 3000);
  } catch {
    return '';
  }
}

async function postJson(path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('[cowork-cli] Error:', data);
    process.exit(1);
  }
  console.log(JSON.stringify(data));
}

async function main() {
  const { subcmd, opts } = parseArgs(process.argv);
  if (!boardId) {
    console.error('[cowork-cli] Missing COWORK_BOARD_ID in environment.');
    process.exit(1);
  }

  if (subcmd === 'task-upsert') {
    await postJson(`/api/boards/${boardId}/agent-callback`, {
      slotId,
      action: 'task-upsert',
      taskId: opts.id,
      title: opts.title || '未命名子任务',
      description: opts.desc || '',
      assigneeSlotId: opts.assignee || slotId,
      status: opts.status || 'pending',
      blockedBy: opts.blockedBy ? opts.blockedBy.split(',').map((s) => s.trim()).filter(Boolean) : [],
    });
    return;
  }

  if (subcmd === 'submit') {
    const files = opts.files ? opts.files.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const mentions = opts.mentions ? opts.mentions.split(',').map((s) => s.trim()).filter(Boolean) : ['lead'];
    const diffSnippet = opts.diff || captureGitDiffSnippet(process.cwd());
    await postJson(`/api/boards/${boardId}/agent-callback`, {
      slotId,
      action: 'submit-deliverable',
      title: opts.title || '提交阶段性成果',
      content: opts.summary || '',
      filesChanged: files,
      diffSnippet,
      mentions,
      taskId: opts.taskId,
    });
    return;
  }

  if (subcmd === 'ask-approval') {
    await postJson(`/api/boards/${boardId}/agent-callback`, {
      slotId,
      action: 'ask-approval',
      title: opts.title || '需要人类老板确认',
      content: opts.summary || '',
    });
    return;
  }

  console.log('Usage: cowork-cli <task-upsert | submit | ask-approval> [--title ...] [--summary ...]');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
