/**
 * HomeFlow Family Pilot, auth middleware tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { requireSession, requireOnboarded } from '../../src/auth/auth.middleware.js';
import { UserService } from '../../src/services/user.service.js';
import { FakeDb } from './fake-db.js';

function makeReq(session: { userId?: string }) {
  return { session } as unknown as Parameters<ReturnType<typeof requireSession>>[0];
}
function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

describe('auth middleware', () => {
  let db: FakeDb;
  let userService: UserService;

  beforeEach(async () => {
    db = new FakeDb();
    userService = new UserService(db as never);
    await userService.ensureSchema();
  });

  it('requireSession returns 401 when no userId in session', async () => {
    const mw = requireSession(userService);
    const req = makeReq({});
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res as never, () => { nextCalled = true; });
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
    expect((res.body as { error: string }).error).toBe('not_authenticated');
  });

  it('requireSession returns 401 when session userId points at missing user', async () => {
    const mw = requireSession(userService);
    const req = makeReq({ userId: 'nope' });
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res as never, () => { nextCalled = true; });
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
    expect((res.body as { error: string }).error).toBe('session_user_not_found');
  });

  it('requireSession passes through and attaches hfUser when user exists', async () => {
    const u = await userService.upsertFromGoogle({
      googleSub: 'g-1', email: 'a@b.c', displayName: 'A', avatarUrl: null,
    });
    const mw = requireSession(userService);
    const req = makeReq({ userId: u.id });
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect((req as { hfUser?: { id: string } }).hfUser?.id).toBe(u.id);
  });

  it('requireOnboarded returns 403 when user has no DID yet', async () => {
    const u = await userService.upsertFromGoogle({
      googleSub: 'g-2', email: 'b@b.c', displayName: 'B', avatarUrl: null,
    });
    const mw = requireOnboarded(userService);
    const req = makeReq({ userId: u.id });
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res as never, () => { nextCalled = true; });
    expect(res.statusCode).toBe(403);
    expect(nextCalled).toBe(false);
    expect((res.body as { error: string }).error).toBe('not_onboarded');
  });

  it('requireOnboarded passes through once user has a DID', async () => {
    const u = await userService.upsertFromGoogle({
      googleSub: 'g-3', email: 'c@b.c', displayName: 'C', avatarUrl: null,
    });
    await userService.setIdentity(u.id, {
      did: 'did:extropy:' + 'a'.repeat(64),
      publicKeyMultibase: 'zABC',
      publicKeyHex: 'a'.repeat(64),
      vcJwt: 'vc.jwt.here',
      genesisVertexId: 'v-1',
    });
    const mw = requireOnboarded(userService);
    const req = makeReq({ userId: u.id });
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
