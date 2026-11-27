import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createHandshakeApp } from '../app.js';
import { generateNodeKeyPair, sign } from '../keys.js';
import { canonicalize } from '../protocol.js';
import {
  announceFlagOn,
  helloAnnounceFields,
  pocketsDocument,
  resolvePocketAnnounce,
  townFromOperator,
} from '../pocket.js';

const NOW = '2026-11-27T02:00:00.000Z';
const NODE = 'ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function decision(flag: string | undefined, town: string | undefined) {
  return resolvePocketAnnounce({
    flag,
    town,
    nodeId: NODE,
    announcedAt: NOW,
    spec: 'v3.1',
  });
}

describe('announce my pocket', () => {
  it('defaults off even when a town is present', () => {
    expect(announceFlagOn(undefined)).toBe(false);
    expect(announceFlagOn('')).toBe(false);
    expect(announceFlagOn('0')).toBe(false);
    expect(announceFlagOn('false')).toBe(false);
    const off = decision(undefined, 'Iowa City');
    expect(off.emit).toBe(false);
    expect(helloAnnounceFields({ town: 'Iowa City' })).toEqual({});
  });

  it('stays quiet when the flag is on but no town was typed', () => {
    const none = decision('1', undefined);
    expect(none.emit).toBe(false);
    if (!none.emit) expect(none.reason).toBe('no town typed');
    expect(decision('on', '   ').emit).toBe(false);
    expect(helloAnnounceFields({ flag: 'yes', town: '' })).toEqual({});
  });

  it('emits a public entry only after the flag and a typed town', () => {
    const on = decision('1', '  Iowa City  ');
    expect(on.emit).toBe(true);
    if (!on.emit) return;
    expect(on.entry).toEqual({
      town: 'Iowa City',
      node_id: NODE,
      announced_at: NOW,
      spec: 'v3.1',
    });
    expect(on.entry).not.toHaveProperty('signature');
    expect(on.entry).not.toHaveProperty('host');
    expect(JSON.stringify(on.entry)).not.toMatch(/10\.\d+\.\d+\.\d+/);
    expect(helloAnnounceFields({ flag: 'true', town: 'Iowa City' })).toEqual({
      announcePocket: true,
      town: 'Iowa City',
    });
  });

  it('rejects urls, handles, and blank-looking names', () => {
    expect(decision('1', 'https://example.com').emit).toBe(false);
    expect(decision('1', 'hello@town').emit).toBe(false);
    expect(decision('1', 'town\nname').emit).toBe(false);
    expect(decision('1', '12345').emit).toBe(false);
  });

  it('does not ask for a town when the flag is off', async () => {
    let asked = false;
    const town = await townFromOperator({
      flag: undefined,
      town: undefined,
      isTty: true,
      readLine: async () => {
        asked = true;
        return 'Nowhere';
      },
    });
    expect(asked).toBe(false);
    expect(town).toBeUndefined();
  });

  it('reads one typed line only when the flag is on and no town was given', async () => {
    const town = await townFromOperator({
      flag: '1',
      town: undefined,
      isTty: true,
      readLine: async () => 'Ames',
    });
    expect(town).toBe('Ames');
    const skipped = await townFromOperator({
      flag: '1',
      town: undefined,
      isTty: false,
      readLine: async () => 'Ames',
    });
    expect(skipped).toBeUndefined();
  });

  it('writes a pockets document with no invented count', () => {
    const doc = pocketsDocument([], null);
    expect(doc.entries).toEqual([]);
    expect(doc.updated_at).toBeNull();
    expect(doc).not.toHaveProperty('count');
    expect(doc.note).not.toMatch(/\u2014|token|donation|crypto/i);
  });
});

describe('hello route pocket announce', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  async function listen(ownPocket: { town: string; node_id: string; announced_at: string; spec: string } | null) {
    const keyPair = generateNodeKeyPair();
    const app = createHandshakeApp({ keyPair, role: 'local', ownPocket });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    return { keyPair, base: `http://127.0.0.1:${addr.port}` };
  }

  function signedHello(
    keyPair: ReturnType<typeof generateNodeKeyPair>,
    extra: Record<string, unknown> = {},
  ) {
    const body = {
      nodeId: keyPair.nodeId,
      version: '0.1.0',
      spec: 'v3.1',
      role: 'local' as const,
      features: ['heartbeat'],
      nonce: '11111111-1111-4111-8111-111111111111',
      ts: '2026-11-27T03:00:00.000Z',
      ...extra,
    };
    return {
      ...body,
      signature: sign(keyPair.privateKey, canonicalize(body as unknown as Record<string, unknown>)),
    };
  }

  it('serves no town when this node did not opt in', async () => {
    const { base } = await listen(null);
    const pocket = await fetch(`${base}/pocket`).then((r) => r.json());
    expect(pocket).toEqual({ announce: false });
    const health = await fetch(`${base}/health`).then((r) => r.json());
    expect(health.announcePocket).toBe(false);
    expect(health).not.toHaveProperty('town');
    const feed = await fetch(`${base}/pockets.json`).then((r) => r.json());
    expect(feed.entries).toEqual([]);
  });

  it('serves the typed town when this node opted in', async () => {
    const entry = {
      town: 'Cedar Rapids',
      node_id: NODE,
      announced_at: NOW,
      spec: 'v3.1',
    };
    const { base } = await listen(entry);
    const pocket = await fetch(`${base}/pocket`).then((r) => r.json());
    expect(pocket).toEqual({ announce: true, entry });
    const health = await fetch(`${base}/health`).then((r) => r.json());
    expect(health.town).toBe('Cedar Rapids');
    expect(health.features).toContain('pocket-announce');
  });

  it('keeps a signed hello valid when announce fields are absent', async () => {
    const { base } = await listen(null);
    const peer = generateNodeKeyPair();
    const res = await fetch(`${base}/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedHello(peer)),
    });
    expect(res.status).toBe(200);
    const feed = await fetch(`${base}/pockets.json`).then((r) => r.json());
    expect(feed.entries).toEqual([]);
  });

  it('records a peer town only when that peer opted in inside the signature', async () => {
    const { base } = await listen(null);
    const peer = generateNodeKeyPair();
    const quiet = signedHello(peer, { town: 'Hidden' });
    const quietRes = await fetch(`${base}/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(quiet),
    });
    expect(quietRes.status).toBe(200);
    let feed = await fetch(`${base}/pockets.json`).then((r) => r.json());
    expect(feed.entries).toEqual([]);

    const opted = signedHello(peer, { announcePocket: true, town: 'Dubuque' });
    const optedRes = await fetch(`${base}/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opted),
    });
    expect(optedRes.status).toBe(200);
    feed = await fetch(`${base}/pockets.json`).then((r) => r.json());
    expect(feed.entries).toEqual([
      {
        town: 'Dubuque',
        node_id: peer.nodeId,
        announced_at: '2026-11-27T03:00:00.000Z',
        spec: 'v3.1',
      },
    ]);

    const tampered = signedHello(peer, { announcePocket: true, town: 'Dubuque' });
    tampered.town = 'Not Dubuque';
    const tamperRes = await fetch(`${base}/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tampered),
    });
    expect(tamperRes.status).toBe(401);
  });
});
