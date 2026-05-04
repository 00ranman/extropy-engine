/**
 * Sandbox client for /hello, /capabilities, /dag/replay, /heartbeat.
 *
 * Usage:
 *   PEER_URL=https://your-vps:4200 NODE_ROLE=local pnpm client:hello
 *   PEER_URL=https://your-vps:4200 NODE_ROLE=local pnpm client:replay
 */

import { v4 as uuidv4 } from 'uuid';
import { canonicalize, type NodeRole } from './protocol.js';
import { loadKeyPairFromEnv, sign, verify } from './keys.js';

const PEER_URL = process.env.PEER_URL ?? 'http://localhost:4200';
const NODE_ROLE = (process.env.NODE_ROLE ?? 'local') as NodeRole;
const NODE_VERSION = '0.1.0';
const SPEC = 'v3.1';
const NODE_FEATURES = ['dag-replay', 'claim-relay', 'heartbeat'];

const keyPair = loadKeyPairFromEnv();

async function hello(): Promise<{ sessionId: string; peerNodeId: string }> {
  const body = {
    nodeId: keyPair.nodeId,
    version: NODE_VERSION,
    spec: SPEC,
    role: NODE_ROLE,
    features: NODE_FEATURES,
    nonce: uuidv4(),
    ts: new Date().toISOString(),
  };
  const env = { ...body, signature: sign(keyPair.privateKey, canonicalize(body as unknown as Record<string, unknown>)) };

  const r = await fetch(`${PEER_URL}/hello`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(env),
  });
  if (!r.ok) throw new Error(`hello failed: ${r.status} ${await r.text()}`);
  const resp = (await r.json()) as Record<string, unknown>;
  // Verify the peer's signature over their canonicalized response
  const peerCanonical = canonicalize(resp);
  const sig = String(resp.signature ?? '');
  const peerNodeId = String(resp.peerNodeId ?? '');
  if (!verify(peerNodeId, peerCanonical, sig)) {
    throw new Error('peer signature failed verification');
  }
  // eslint-disable-next-line no-console
  console.log('[hello] verified peer:', peerNodeId);
  // eslint-disable-next-line no-console
  console.log('[hello] session:', resp.sessionId);
  // eslint-disable-next-line no-console
  console.log('[hello] role:', resp.role, 'features:', resp.features);
  return { sessionId: String(resp.sessionId), peerNodeId };
}

async function replay(sessionId: string): Promise<void> {
  const body = {
    sessionId,
    fromIndex: 0,
    toIndex: 100,
    ts: new Date().toISOString(),
  };
  const env = { ...body, signature: sign(keyPair.privateKey, canonicalize(body as unknown as Record<string, unknown>)) };
  const r = await fetch(`${PEER_URL}/dag/replay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(env),
  });
  // eslint-disable-next-line no-console
  console.log('[replay] status:', r.status);
  // eslint-disable-next-line no-console
  console.log('[replay] body:', await r.text());
}

async function main() {
  const cmd = process.argv[2] ?? 'hello';
  if (cmd === 'hello') {
    await hello();
  } else if (cmd === 'replay') {
    const { sessionId } = await hello();
    await replay(sessionId);
  } else {
    // eslint-disable-next-line no-console
    console.error(`unknown command: ${cmd}. Use "hello" or "replay".`);
    process.exit(2);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[client] error:', err);
  process.exit(1);
});
