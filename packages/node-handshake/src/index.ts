/**
 * EXTROPY ENGINE. Node Handshake Server (v3.1 sandbox)
 *
 * Exposes /hello, /capabilities, /dag/replay, /heartbeat over signed JSON.
 * Pocket announce is off unless ANNOUNCE_POCKET is set and a town is typed.
 *
 * See README.md and docs/VPS_NODE.md.
 */

import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { createHandshakeApp, SERVICE_NAME, SPEC } from './app.js';
import { loadKeyPairFromEnv } from './keys.js';
import {
  announceFlagOn,
  pocketsDocument,
  resolvePocketAnnounce,
  townFromOperator,
} from './pocket.js';
import type { NodeRole } from './protocol.js';

const PORT = Number(process.env.PORT ?? 4200);
// Default-deny remote access. Bind to loopback only so the listener is
// reachable from localhost (e.g. via SSH tunnel `-L 4200:localhost:4200`).
// Explicitly set HOST=0.0.0.0 to expose on all interfaces (only do this
// behind a firewall + reverse proxy with TLS).
const HOST = process.env.HOST ?? '127.0.0.1';
const NODE_ROLE = (process.env.NODE_ROLE ?? 'vps') as NodeRole;

async function readTownLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const line = await new Promise<string>((resolve) => {
    rl.question('Town name to publish (empty line keeps this pocket quiet): ', resolve);
  });
  rl.close();
  return line;
}

async function main() {
  const keyPair = loadKeyPairFromEnv();
  const typedTown = await townFromOperator({
    flag: process.env.ANNOUNCE_POCKET,
    town: process.env.POCKET_TOWN,
    isTty: Boolean(process.stdin.isTTY),
    readLine: readTownLine,
  });
  const decision = resolvePocketAnnounce({
    flag: process.env.ANNOUNCE_POCKET,
    town: typedTown,
    nodeId: keyPair.nodeId,
    announcedAt: new Date().toISOString(),
    spec: SPEC,
  });

  if (decision.emit) {
    // eslint-disable-next-line no-console
    console.log(`[${SERVICE_NAME}] pocket announce on. town=${decision.entry.town}`);
    if (process.env.POCKETS_OUT) {
      const doc = pocketsDocument([decision.entry], decision.entry.announced_at);
      writeFileSync(process.env.POCKETS_OUT, JSON.stringify(doc, null, 2));
      // eslint-disable-next-line no-console
      console.log(`[${SERVICE_NAME}] wrote ${process.env.POCKETS_OUT}`);
    }
  } else if (announceFlagOn(process.env.ANNOUNCE_POCKET)) {
    // eslint-disable-next-line no-console
    console.log(`[${SERVICE_NAME}] pocket announce stayed off: ${decision.reason}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[${SERVICE_NAME}] pocket announce off`);
  }

  const app = createHandshakeApp({
    keyPair,
    role: NODE_ROLE,
    ownPocket: decision.emit ? decision.entry : null,
  });

  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[${SERVICE_NAME}] listening on ${HOST}:${PORT} role=${NODE_ROLE} nodeId=${keyPair.nodeId}`,
    );
    if (HOST === '127.0.0.1' || HOST === 'localhost') {
      // eslint-disable-next-line no-console
      console.log(
        `[${SERVICE_NAME}] loopback-only. To reach from another machine, use:\n` +
          `    ssh -L ${PORT}:localhost:${PORT} <user>@<this-host>\n` +
          `  Or set HOST=0.0.0.0 to expose on all interfaces (firewall + TLS strongly advised).`,
      );
    }
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[node-handshake] failed to start', err);
  process.exit(1);
});
