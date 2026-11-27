/**
 * Handshake HTTP app. Listening happens in index.ts so tests can bind a port.
 */

import express, { Express, Request, Response } from 'express';
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
import { loadKeyPairFromEnv, sign, verify, type NodeKeyPair } from './keys.js';
import {
  pocketsDocument,
  peerPocketEntry,
  type PocketEntry,
} from './pocket.js';

export const SERVICE_NAME = '@extropy/node-handshake';
export const NODE_VERSION = '0.1.0';
export const SPEC = 'v3.1';

const BASE_FEATURES = [
  'dag-replay',
  'claim-relay',
  'heartbeat',
  'capability-exchange',
  'epistemology-witness',
];

export interface HandshakeAppOptions {
  keyPair?: NodeKeyPair;
  role?: NodeRole;
  ownPocket?: PocketEntry | null;
}

export function createHandshakeApp(opts: HandshakeAppOptions = {}): Express {
  const keyPair = opts.keyPair ?? loadKeyPairFromEnv();
  const role = (opts.role ?? (process.env.NODE_ROLE ?? 'vps')) as NodeRole;
  const ownPocket = opts.ownPocket ?? null;
  const features = ownPocket ? [...BASE_FEATURES, 'pocket-announce'] : [...BASE_FEATURES];

  const sessions = new Map<string, { peerNodeId: string; openedAt: string; lastHeartbeat: string }>();
  const peerPockets: PocketEntry[] = [];

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  function feed() {
    const entries = [...(ownPocket ? [ownPocket] : []), ...peerPockets];
    return pocketsDocument(entries, new Date().toISOString());
  }

  app.get('/health', (_req: Request, res: Response) => {
    const body: Record<string, unknown> = {
      service: SERVICE_NAME,
      status: 'ok',
      version: NODE_VERSION,
      spec: SPEC,
      role,
      nodeId: keyPair.nodeId,
      features,
      openSessions: sessions.size,
      announcePocket: Boolean(ownPocket),
    };
    if (ownPocket) body.town = ownPocket.town;
    res.json(body);
  });

  app.get('/pocket', (_req: Request, res: Response) => {
    if (!ownPocket) return res.json({ announce: false });
    return res.json({ announce: true, entry: ownPocket });
  });

  app.get('/pockets.json', (_req: Request, res: Response) => {
    res.json(feed());
  });

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

    const announced = peerPocketEntry(env);
    if (
      announced &&
      !peerPockets.some((p) => p.node_id === announced.node_id && p.town === announced.town)
    ) {
      peerPockets.push(announced);
    }

    const sessionId = uuidv4();
    const ts = new Date().toISOString();
    const responseBody = {
      ok: true,
      peerNodeId: keyPair.nodeId,
      version: NODE_VERSION,
      spec: SPEC,
      role,
      features,
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
      acceptsInboundClaims: role === 'vps',
      acceptsInboundQuests: role === 'vps',
      ts,
    };
    return res.json({
      ...body,
      signature: sign(keyPair.privateKey, canonicalize(body as unknown as Record<string, unknown>)),
    });
  });

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
    return res.json({
      sessionId: env.sessionId,
      fromIndex: env.fromIndex,
      toIndex: env.toIndex,
      vertices: [],
      note: 'sandbox stub. wire to dag-substrate index in next iteration',
    });
  });

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

  return app;
}
