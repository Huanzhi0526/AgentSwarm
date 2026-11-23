import { getBoardApiBaseUrl } from './utils.js';

async function readStdinSafe(maxWaitMs = 100): Promise<string> {
  if (process.stdin.isTTY) return '';
  return await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(done, maxWaitMs);
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    process.stdin.resume();
  });
}

async function main() {
  try {
    const raw = await readStdinSafe(100);
    let payload: {
      conversationId?: string;
      workspacePaths?: string[];
      cwd?: string;
      dryRun?: boolean;
      retryDeliveryId?: string;
    } = {};
    if (raw.trim()) {
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        payload = {};
      }
    }

    const baseUrl = getBoardApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/mcp/host-inbox/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: payload.conversationId,
        workspacePaths: payload.workspacePaths,
        cwd: payload.cwd,
        dryRun: Boolean(payload.dryRun),
        retryDeliveryId: payload.retryDeliveryId,
      }),
      signal: AbortSignal.timeout(220),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        dryRun?: boolean;
        hasUnread?: boolean;
        ambiguous?: boolean;
        deliveryId?: string;
        ephemeralText?: string;
      };
      if (data.dryRun) {
        process.stdout.write('{"dryRunOk":true}\n');
        return;
      }
      if ((data.hasUnread || data.ambiguous) && data.ephemeralText) {
        process.stdout.write(
          `${JSON.stringify({ injectSteps: [{ ephemeralMessage: data.ephemeralText }] })}\n`
        );
        if (data.deliveryId && process.env.AGENT_COWORK_SIMULATE_HOOK_DROP !== '1') {
          await fetch(`${baseUrl}/api/mcp/host-inbox/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deliveryId: data.deliveryId,
              stage: 'hook_injected',
              conversationId: payload.conversationId,
            }),
            signal: AbortSignal.timeout(120),
          }).catch(() => {});
        }
        return;
      }
    }
  } catch {
    // Fast silent no-op if board server is down or times out within 300ms budget
  }

  process.stdout.write('{}\n');
}

void main();
