/**
 * HomeFlow Family Pilot, DID registration integration test.
 *
 * Generates a real Ed25519 keypair via the identity package, derives the
 * canonical did:extropy DID, exercises the /api/v1/identity/register endpoint
 * end to end, and asserts that the user row picks up did, vc_jwt, and
 * genesis_vertex_id.
 *
 * Auth is provided by the HOMEFLOW_TEST_AUTH stub route since the real
 * Google OAuth dance cannot run in CI.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  generateIdentityKeyPair,
  encodeDid,
  publicKeyMultibase,
  verifyCredential,
} from '@extropy/identity/lib';
import { createApp } from '../../src/app.js';
import { UserService } from '../../src/services/user.service.js';
import { PSLLService } from '../../src/services/psll.service.js';
import { FakeDb } from './fake-db.js';

function makeStubServices(db: FakeDb) {
  const passthrough = {} as unknown;
  return {
    householdService: passthrough as never,
    deviceService: passthrough as never,
    entropyService: passthrough as never,
    claimService: passthrough as never,
    integrations: {
      governance: passthrough as never,
      temporal: passthrough as never,
      token: passthrough as never,
      credential: passthrough as never,
      dag: passthrough as never,
      reputation: passthrough as never,
    },
    interopService: { listAdapters: () => [] } as never,
    db: db as never,
  };
}

describe('POST /api/v1/identity/register', () => {
  beforeAll(() => { process.env.HOMEFLOW_TEST_AUTH = '1'; });
  afterAll(() => { delete process.env.HOMEFLOW_TEST_AUTH; });

  async function buildApp() {
    const db = new FakeDb();
    const userService = new UserService(db as never);
    await userService.ensureSchema();
    const psllService = new PSLLService(db as never);
    await psllService.ensureSchema();
    const recordedAnchors: unknown[] = [];
    const app = createApp({
      ...makeStubServices(db),
      userService,
      psllService,
      authConfig: {
        googleClientId: undefined,
        googleClientSecret: undefined,
        baseUrl: 'http://localhost:0',
      },
      sessionSecret: 'test-secret',
      staticFrontendDir: null,
      dagAnchor: {
        async recordGenesisVertex(payload) {
          recordedAnchors.push(payload);
          return { vertexId: 'vtx-' + recordedAnchors.length };
        },
      },
    });
    return { app, db, userService, recordedAnchors };
  }

  it('rejects unauthenticated calls with 401', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/v1/identity/register').send({});
    expect(res.status).toBe(401);
  });

  it('accepts a real keypair, issues a VC, anchors a Genesis, persists user fields', async () => {
    const { app, userService, recordedAnchors } = await buildApp();

    const agent = request.agent(app);
    const login = await agent
      .post('/auth/_test/login')
      .send({ googleSub: 'g-real', email: 'r@example.com', displayName: 'Real User' });
    expect(login.status).toBe(200);

    const kp = generateIdentityKeyPair();
    const did = encodeDid(kp.publicKeyHex);
    const mb = publicKeyMultibase(kp.publicKeyHex);

    const res = await agent
      .post('/api/v1/identity/register')
      .send({ publicKeyHex: kp.publicKeyHex, publicKeyMultibase: mb, did });
    expect(res.status).toBe(201);
    expect(res.body.did).toBe(did);
    expect(res.body.publicKeyMultibase).toBe(mb);
    expect(typeof res.body.vcJwt).toBe('string');
    expect(res.body.genesisVertexId).toBeTruthy();

    expect(recordedAnchors.length).toBe(1);

    const stored = await userService.findByDid(did);
    expect(stored).not.toBeNull();
    expect(stored!.publicKeyHex).toBe(kp.publicKeyHex);
    expect(stored!.vcJwt).toBe(res.body.vcJwt);
    expect(stored!.genesisVertexId).toBe(res.body.genesisVertexId);

    // VC is a real EdDSA JWT and the issuer signature verifies.
    const verified = verifyCredential(res.body.vcJwt);
    expect(verified.valid).toBe(true);
    expect(verified.subjectDid).toBe(did);
  });

  it('rejects a DID that does not match the public key', async () => {
    const { app } = await buildApp();
    const agent = request.agent(app);
    await agent.post('/auth/_test/login').send({ googleSub: 'g-bad' });

    const kp = generateIdentityKeyPair();
    const wrongDid = 'did:extropy:' + 'b'.repeat(64);
    const res = await agent
      .post('/api/v1/identity/register')
      .send({
        publicKeyHex: kp.publicKeyHex,
        publicKeyMultibase: publicKeyMultibase(kp.publicKeyHex),
        did: wrongDid,
      });
    expect(res.status).toBe(400);
  });

  it('returns 409 when registering a second time', async () => {
    const { app } = await buildApp();
    const agent = request.agent(app);
    await agent.post('/auth/_test/login').send({ googleSub: 'g-twice' });
    const kp = generateIdentityKeyPair();
    const did = encodeDid(kp.publicKeyHex);
    const mb = publicKeyMultibase(kp.publicKeyHex);
    const first = await agent.post('/api/v1/identity/register').send({
      publicKeyHex: kp.publicKeyHex, publicKeyMultibase: mb, did,
    });
    expect(first.status).toBe(201);
    const second = await agent.post('/api/v1/identity/register').send({
      publicKeyHex: kp.publicKeyHex, publicKeyMultibase: mb, did,
    });
    expect(second.status).toBe(409);
  });
});
