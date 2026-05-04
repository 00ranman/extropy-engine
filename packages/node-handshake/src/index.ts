/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Node Handshake Server (v3.1 sandbox)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Exposes /hello, /capabilities, /dag/replay, /heartbeat over signed JSON.
 *
 *  This is the proof-of-concept node-to-node communication layer. It runs on
 *  both the VPS and the local laptop. Each side authenticates the other via
 *  Ed25519 signatures over canonicalized JSON envelopes.
 *
 *  See README.md and docs/VPS_NODE.md.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  HelloRequest,
  HelloResponse,
  CapabilitiesEnvelope,
  DagReplayRequest,
  HeartbeatEnvelope,
  canonicalize,
  type NodeRole,
} from './protocol.js';
import { loadKeyPairFromEnv, sign, verify } from './keys.js';

const PORT = Number(process.env.PORT ?? 4200);
const SERVICE_NAME = '@extropy/node-handshake';
const NODE_ROLE = (process.env.NODE_ROLE ?? 'vps') as NodeRole;
const NODE_VERSION = '0.1.0';
const SPEC = 'v3.1';
const NODE_FEATURES = [
  'dag-replay',
  'claim-relay',
  'heartbeat',
  'capability-exchange',
  'epistemology-witness',
];

const keyPair = loadKeyPairFromEnv();

const sessions = new Map<string, { peerNodeId: string; openedAt: string; lastHeartbeat: string }>();

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    service: SERVICE_NAME,
    status: 'ok',
    version: NODE_VERSION,
    spec: SPEC,
    role: NODE_ROLE,
    nodeId: keyPair.nodeId,
    features: NODE_FEATURES,
    openSessions: sessions.size,
  });
});

// ── /hello ──────────────────────────────────────────────────────────────────

app.post('/hello', (req: Request, res: Response) => {
  const parse = HelloRequest.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'invalid hello envelope', detail: parse.error.flatten() });
  }
  const env = parse.data;
  const canonical = canonicalize(env as unknown as Record<string, unknown>);
  if (!verify(env.nodeId, canonical, env.signature)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const sessionId = uuidv4();
  const ts = new Date().toISOString();
  const responseBody = {
    ok: true,
    peerNodeId: keyPair.nodeId,
    version: NODE_VERSION,
    spec: SPEC,
    role: NODE_ROLE,
    features: NODE_FEATURES,
    sessionId,
    ts,
  };
  const signedResp: HelloResponse = {
    ...responseBody,
    signature: sign(keyPair.privateKey, canonicalize(responseBody as unknown as Record<string, unknown>)),
  };
  sessions.set(sessionId, {
    peerNodeId: env.nodeId,
    openedAt: ts,
    lastHeartbeat: ts,
  });
  return res.json(signedResp);
});

// ── /capabilities ───────────────────────────────────────────────────────────

app.post('/capabilities', (req: Request, res: Response) => {
  const parse = CapabilitiesEnvelope.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'invalid capabilities envelope', detail: parse.error.flatten() });
  }
  const env = parse.data;
  const session = sessions.get(env.sessionId);
  if (!session) return res.status(404).json({ error: 'unknown session' });
  if (!verify(session.peerNodeId, canonicalize(env as unknown as Record<string, unknown>), env.signature)) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  // Reply with our own capabilities
  const ts = new Date().toISOString();
  const body = {
    sessionId: env.sessionId,
    packages: [
      '@extropy/contracts',
      '@extropy/xp-formula',
      '@extropy/loop-ledger',
      '@extropy/signalflow',
      '@extropy/dag-substrate',
      '@extropy/epistemology-engine',
      '@extropy/identity',
      '@extropy/psll-sync',
      '@extropy/quest-market',
      '@extropy/validation-neighborhoods',
    ],
    validatedDomains: ['cognitive', 'code', 'social', 'economic', 'thermodynamic', 'informational', 'governance', 'temporal'],
    loadFactor: 0.0,
    acceptsInboundClaims: NODE_ROLE === 'vps',
    acceptsInboundQuests: NODE_ROLE === 'vps',
    ts,
  };
  return res.json({
    ...body,
    signature: sign(keyPair.privateKey, canonicalize(body as unknown as Record<string, unknown>)),
  });
});

// ── /dag/replay ─────────────────────────────────────────────────────────────

app.post('/dag/replay', (req: Request, res: Response) => {
  const parse = DagReplayRequest.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'invalid replay request', detail: parse.error.flatten() });
  }
  const env = parse.data;
  const session = sessions.get(env.sessionId);
  if (!session) return res.status(404).json({ error: 'unknown session' });
  if (!verify(session.peerNodeId, canonicalize(env as unknown as Record<string, unknown>), env.signature)) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  // Sandbox stub: return an empty replay window with a structural envelope
  return res.json({
    sessionId: env.sessionId,
    fromIndex: env.fromIndex,
    toIndex: env.toIndex,
    vertices: [],
    note: 'sandbox stub — wire to dag-substrate index in next iteration',
  });
});

// ── /heartbeat ──────────────────────────────────────────────────────────────

app.post('/heartbeat', (req: Request, res: Response) => {
  const parse = HeartbeatEnvelope.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'invalid heartbeat', detail: parse.error.flatten() });
  }
  const env = parse.data;
  const session = sessions.get(env.sessionId);
  if (!session) return res.status(404).json({ error: 'unknown session' });
  if (!verify(session.peerNodeId, canonicalize(env as unknown as Record<string, unknown>), env.signature)) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  session.lastHeartbeat = new Date().toISOString();
  return res.json({ ok: true, sessionId: env.sessionId, observedAt: session.lastHeartbeat });
});

// ────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[${SERVICE_NAME}] listening on :${PORT} role=${NODE_ROLE} nodeId=${keyPair.nodeId}`);
});
