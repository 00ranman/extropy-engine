/**
 * HomeFlow Family Pilot, PSLL append integration test.
 *
 * Drives /api/v1/psll/append against the test app, with valid signatures
 * (Ed25519 from @extropy/identity) and with invalid signatures, and confirms
 * the chain integrity check rejects out of order or stale prevHash entries.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  generateIdentityKeyPair,
  encodeDid,
  publicKeyMultibase,
  sign,
} from '@extropy/identity/lib';
import { createApp } from '../../src/app.js';
import { UserService } from '../../src/services/user.service.js';
import { PSLLService } from '../../src/services/psll.service.js';
import { FakeDb } from './fake-db.js';

function buildSigningInput(payload: { entry: unknown; prevHash: string; seq: number; ts: number }) {
  return JSON.stringify({
    entry: payload.entry,
    prevHash: payload.prevHash,
    seq: payload.seq,
    ts: payload.ts,
  });
}

describe('PSLL append flow', () => {
  beforeAll(() => { process.env.HOMEFLOW_TEST_AUTH = '1'; });
  afterAll(() => { delete process.env.HOMEFLOW_TEST_AUTH; });

  async function setup() {
    const db = new FakeDb();
    const userService = new UserService(db as never);
    await userService.ensureSchema();
    const psllService = new PSLLService(db as never);
    await psllService.ensureSchema();
    const passthrough = {} as never;
    const app = createApp({
      db: db as never,
      userService,
      psllService,
      householdService: passthrough,
      deviceService: passthrough,
      entropyService: passthrough,
      claimService: passthrough,
      integrations: {
        governance: passthrough, temporal: passthrough, token: passthrough,
        credential: passthrough, dag: passthrough, reputation: passthrough,
      },
      interopService: { listAdapters: () => [] } as never,
      authConfig: {
        googleClientId: undefined,
        googleClientSecret: undefined,
        baseUrl: 'http://localhost:0',
      },
      sessionSecret: 'test-secret',
      staticFrontendDir: null,
      dagAnchor: {
        async recordGenesisVertex() { return { vertexId: 'vtx-1' }; },
      },
    });
    const agent = request.agent(app);
    await agent.post('/auth/_test/login').send({ googleSub: 'g-psll' });
    const kp = generateIdentityKeyPair();
    const did = encodeDid(kp.publicKeyHex);
    const mb = publicKeyMultibase(kp.publicKeyHex);
    const reg = await agent
      .post('/api/v1/identity/register')
      .send({ publicKeyHex: kp.publicKeyHex, publicKeyMultibase: mb, did });
    expect(reg.status).toBe(201);
    return { app, agent, kp, did };
  }

  it('rejects 401 when not authenticated', async () => {
    const db = new FakeDb();
    const userService = new UserService(db as never);
    await userService.ensureSchema();
    const psllService = new PSLLService(db as never);
    await psllService.ensureSchema();
    const passthrough = {} as never;
    const app = createApp({
      db: db as never, userService, psllService,
      householdService: passthrough, deviceService: passthrough,
      entropyService: passthrough, claimService: passthrough,
      integrations: {
        governance: passthrough, temporal: passthrough, token: passthrough,
        credential: passthrough, dag: passthrough, reputation: passthrough,
      },
      interopService: { listAdapters: () => [] } as never,
      authConfig: { googleClientId: undefined, googleClientSecret: undefined, baseUrl: 'http://localhost:0' },
      sessionSecret: 'test-secret',
      staticFrontendDir: null,
    });
    const res = await request(app).post('/api/v1/psll/append').send({});
    expect(res.status).toBe(401);
  });

  it('accepts a valid signed entry and rejects an invalid signature', async () => {
    const { agent, kp } = await setup();

    // Genesis prev hash is 64 zeros; first seq is 1.
    const entry = { kind: 'household.create', name: 'Test Home' };
    const ts = Date.now();
    const seq = 1;
    const prevHash = '0'.repeat(64);
    const sig = sign(kp.privateKey, buildSigningInput({ entry, prevHash, seq, ts }));

    const ok = await agent.post('/api/v1/psll/append').send({
      entry, signature: sig, prevHash, seq, ts,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.seq).toBe(1);
    expect(ok.body.hash).toMatch(/^[0-9a-f]{64}$/);

    // Tampered signature: re-sign a different payload.
    const seq2 = 2;
    const prevHash2 = ok.body.hash;
    const ts2 = ts + 1;
    const entry2 = { kind: 'chore.complete', id: 'c-1' };
    const fakeSig = sign(
      kp.privateKey,
      buildSigningInput({ entry: { kind: 'something else' }, prevHash: prevHash2, seq: seq2, ts: ts2 }),
    );
    const bad = await agent.post('/api/v1/psll/append').send({
      entry: entry2, signature: fakeSig, prevHash: prevHash2, seq: seq2, ts: ts2,
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch(/signature/);
  });

  it('rejects out of order seq and stale prevHash', async () => {
    const { agent, kp } = await setup();
    const entry = { kind: 'hello' };
    const ts = Date.now();
    const goodFirst = sign(
      kp.privateKey,
      buildSigningInput({ entry, prevHash: '0'.repeat(64), seq: 1, ts }),
    );
    await agent.post('/api/v1/psll/append').send({
      entry, signature: goodFirst, prevHash: '0'.repeat(64), seq: 1, ts,
    });

    // Wrong seq.
    const sig3 = sign(
      kp.privateKey,
      buildSigningInput({ entry, prevHash: '0'.repeat(64), seq: 3, ts: ts + 1 }),
    );
    const wrongSeq = await agent.post('/api/v1/psll/append').send({
      entry, signature: sig3, prevHash: '0'.repeat(64), seq: 3, ts: ts + 1,
    });
    expect(wrongSeq.status).toBe(409);

    // Wrong prevHash.
    const sigBadPrev = sign(
      kp.privateKey,
      buildSigningInput({ entry, prevHash: 'f'.repeat(64), seq: 2, ts: ts + 1 }),
    );
    const wrongPrev = await agent.post('/api/v1/psll/append').send({
      entry, signature: sigBadPrev, prevHash: 'f'.repeat(64), seq: 2, ts: ts + 1,
    });
    expect(wrongPrev.status).toBe(409);
  });

  it('GET /api/v1/psll/me returns appended entries; /head returns last hash', async () => {
    const { agent, kp } = await setup();
    const ts = Date.now();
    const sig1 = sign(
      kp.privateKey,
      buildSigningInput({ entry: { i: 1 }, prevHash: '0'.repeat(64), seq: 1, ts }),
    );
    const r1 = await agent.post('/api/v1/psll/append').send({
      entry: { i: 1 }, signature: sig1, prevHash: '0'.repeat(64), seq: 1, ts,
    });
    expect(r1.status).toBe(201);

    const sig2 = sign(
      kp.privateKey,
      buildSigningInput({ entry: { i: 2 }, prevHash: r1.body.hash, seq: 2, ts: ts + 1 }),
    );
    const r2 = await agent.post('/api/v1/psll/append').send({
      entry: { i: 2 }, signature: sig2, prevHash: r1.body.hash, seq: 2, ts: ts + 1,
    });
    expect(r2.status).toBe(201);

    const list = await agent.get('/api/v1/psll/me');
    expect(list.status).toBe(200);
    expect(list.body.entries.length).toBe(2);
    expect(list.body.entries[0].seq).toBe(1);
    expect(list.body.entries[1].seq).toBe(2);

    const head = await agent.get('/api/v1/psll/head');
    expect(head.status).toBe(200);
    expect(head.body.seq).toBe(2);
    expect(head.body.hash).toBe(r2.body.hash);
  });
});
