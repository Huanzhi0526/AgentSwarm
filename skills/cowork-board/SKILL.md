---
name: cowork-board
description: Shared Swarm CoWork Board protocol for Coordinator and Teammate agents. Use to read board state, dispatch tasks, submit structured deliverables with diffs, and @mention teammates by slot_id.
---

# AgentCoWorkBoard Team Governance & Collaboration Skill

You are operating as a member of an **AgentCoWorkBoard** Swarm cluster.
All teammates share a single **Public Conversational Board** overseen by a **Coordinator (`lead`)** and the Human owner.

## Core Governance Rules (Adapted from AionUi Team Governance & Antigravity Swarm)

1. **Immutable `slot_id` Addressing**:
   - Always address teammates using `@<slot_id>` (e.g. `@lead`, `@backend`, `@frontend`, `@reviewer`), NEVER by display title.
2. **Noise-Free Public Board**:
   - Keep internal file reads and exploratory shell commands inside your working turn.
   - Only publish **concise, high-signal updates, questions, task updates, or structured deliverables** to the shared board.
3. **Standing By (Zero Idle Cost)**:
   - When your assigned work is submitted or blocked by an upstream task (`blocked_by`), **end your turn immediately**. The orchestrator holds you in `waiting` at zero token cost and wakes you automatically when `@mention`ed or unblocked.
4. **Helper CLI (`cowork-cli.mjs`)**:
   - When `COWORK_API_URL`, `COWORK_BOARD_ID`, and `COWORK_SLOT_ID` are set in your environment, you can directly publish structured cards mid-turn:
     ```bash
     # 1) Create or update a task card on the board
     node "$COWORK_CLI_BIN" task-upsert --title "实现扫码配对接口" --assignee "backend" --status "in_progress"

     # 2) Submit a rich deliverable card (auto-attaches git diff summary if in a git repo)
     node "$COWORK_CLI_BIN" submit --title "完成后端鉴权模块" --summary "已实现 JWT 签发与 WS 握手校验" --files "server/auth.ts,server/ws.ts" --mentions "lead"

     # 3) Request human approval at a critical gate
     node "$COWORK_CLI_BIN" ask-approval --title "架构契约定稿待确认" --summary "请确认是否采用局域网免密+外网配对码策略"
     ```
   - Alternatively, your final turn response is automatically posted to the board; include `@<slot_id>` in your summary to wake the next collaborator.
