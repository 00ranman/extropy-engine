/**
 * Integration tests for the Family Pilot v1 API.
 *
 * Covers:
 *   - auth gating (401 when no session) on each route
 *   - happy-path setup wizard, household + members CRUD, chores, recipes,
 *     meal plan + shopping list generation, pantry, shopping list
 *     mutations, dashboard endpoint.
 *
 * Uses the in-memory FakeDb stand-in for users + sessions and the real
 * FamilyStore over a temp dir for the family-pilot data.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { UserService } from '../../src/services/user.service.js';
import { PSLLService } from '../../src/services/psll.service.js';
import { FamilyStore } from '../../src/services/family-store.service.js';
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

let tmpDir: string;
let db: FakeDb;
let userService: UserService;
let psllService: PSLLService;
let store: FamilyStore;

async function buildApp() {
  db = new FakeDb();
  userService = new UserService(db as never);
  await userService.ensureSchema();
  psllService = new PSLLService(db as never);
  await psllService.ensureSchema();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-fam-'));
  store = new FamilyStore({ dataDir: tmpDir, fileName: 'family.json' });
  await store.initialize();

  const app = createApp({
    ...makeStubServices(db),
    userService,
    psllService,
    familyStore: store,
    authConfig: {
      googleClientId: undefined,
      googleClientSecret: undefined,
      baseUrl: 'http://localhost:0',
    },
    sessionSecret: 'test-secret',
    staticFrontendDir: null,
    dagAnchor: {
      async recordGenesisVertex() {
        return { vertexId: 'vtx-test' };
      },
    },
  });
  return app;
}

async function login(app: ReturnType<typeof createApp>, sub = 'sub-1'): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent.post('/auth/_test/login').send({ googleSub: sub, email: sub + '@example.com', displayName: 'Test User' });
  expect(res.status).toBe(200);
  return agent;
}

describe('Family Pilot v1 API', () => {
  beforeAll(() => { process.env.HOMEFLOW_TEST_AUTH = '1'; });
  afterAll(() => {
    delete process.env.HOMEFLOW_TEST_AUTH;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    app = await buildApp();
  });

  it('rejects unauthenticated calls with 401', async () => {
    const routes: Array<[string, string]> = [
      ['get', '/api/family/bootstrap'],
      ['post', '/api/family/setup'],
      ['get', '/api/family/household'],
      ['get', '/api/family/members'],
      ['get', '/api/family/chores'],
      ['get', '/api/family/recipes'],
      ['get', '/api/family/meal-plan'],
      ['get', '/api/family/pantry'],
      ['get', '/api/family/shopping'],
      ['get', '/api/family/dashboard'],
    ];
    for (const [method, p] of routes) {
      const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](p);
      expect(r.status).toBe(401);
    }
  });

  it('bootstrap returns null household for a fresh user', async () => {
    const agent = await login(app);
    const r = await agent.get('/api/family/bootstrap');
    expect(r.status).toBe(200);
    expect(r.body.household).toBeNull();
    expect(r.body.user.id).toBeTruthy();
  });

  it('setup creates household + owner member + seeds data', async () => {
    const agent = await login(app);
    const r = await agent.post('/api/family/setup').send({
      household: { name: 'Test Family', timezone: 'America/Chicago' },
      members: [{ name: 'Kid One', role: 'kid' }, { name: 'Teen Two', role: 'teen' }],
      seed: { chores: true, recipes: true, pantry: true },
    });
    expect(r.status).toBe(201);
    expect(r.body.household.name).toBe('Test Family');
    expect(r.body.members.length).toBe(3); // owner + 2

    const choresRes = await agent.get('/api/family/chores');
    expect(choresRes.status).toBe(200);
    expect(choresRes.body.length).toBe(6);

    const recipesRes = await agent.get('/api/family/recipes');
    expect(recipesRes.body.length).toBe(4);

    const pantryRes = await agent.get('/api/family/pantry');
    expect(pantryRes.body.length).toBe(8);
  });

  it('household scoping: a second user without a household gets 404 on /household', async () => {
    const agent = await login(app, 'sub-A');
    await agent.post('/api/family/setup').send({
      household: { name: 'A Family' },
      members: [],
      seed: { chores: false, recipes: false, pantry: false },
    });

    const otherAgent = await login(app, 'sub-B');
    const r = await otherAgent.get('/api/family/household');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('no_household');
  });

  it('chore create + complete awards XP and increments member total', async () => {
    const agent = await login(app);
    await agent.post('/api/family/setup').send({
      household: { name: 'Fam' },
      members: [{ name: 'Sam', role: 'kid' }],
      seed: { chores: false, recipes: false, pantry: false },
    });
    const members = (await agent.get('/api/family/members')).body;
    const sam = members.find((m: { name: string }) => m.name === 'Sam');
    const create = await agent.post('/api/family/chores').send({
      name: 'Test chore', frequency: 'daily', assignee: sam.id, xpReward: 7,
    });
    expect(create.status).toBe(201);
    const choreId = create.body.id;
    const complete = await agent.post('/api/family/chores/' + choreId + '/complete').send({ memberId: sam.id });
    expect(complete.status).toBe(201);
    expect(complete.body.completion.xpAwarded).toBe(7);
    expect(complete.body.member.xpTotal).toBe(7);

    const history = await agent.get('/api/family/chores/' + choreId + '/history');
    expect(history.body.length).toBe(1);
  });

  it('meal plan slot + generate-shopping-list pulls from recipes minus pantry', async () => {
    const agent = await login(app);
    await agent.post('/api/family/setup').send({
      household: { name: 'Cook Fam' },
      members: [],
      seed: { chores: false, recipes: false, pantry: false },
    });

    // Create one recipe + a pantry item that satisfies one ingredient.
    const recipe = await agent.post('/api/family/recipes').send({
      title: 'Eggs',
      ingredients: [{ name: 'eggs', qty: 4, unit: 'each' }, { name: 'butter', qty: 1, unit: 'tbsp' }],
      steps: '', prepMinutes: 1, cookMinutes: 5, tags: [],
    });
    expect(recipe.status).toBe(201);

    await agent.post('/api/family/pantry').send({
      name: 'eggs', qty: 6, unit: 'each', location: 'fridge', lowStockThreshold: 1,
    });

    const today = new Date().toISOString().slice(0, 10);
    const slot = await agent.put('/api/family/meal-plan/slot').send({
      date: today, slot: 'breakfast', entry: { recipeId: recipe.body.id },
    });
    expect(slot.status).toBe(200);

    const gen = await agent.post('/api/family/meal-plan/generate-shopping-list').send({});
    expect(gen.status).toBe(200);
    // butter is missing entirely so it should be added; eggs are covered.
    const names = gen.body.items.map((i: { name: string }) => i.name);
    expect(names).toContain('butter');
    expect(names).not.toContain('eggs');
  });

  it('pantry low-stock items appear on shopping list automatically', async () => {
    const agent = await login(app);
    await agent.post('/api/family/setup').send({
      household: { name: 'Stock Fam' },
      members: [],
      seed: { chores: false, recipes: false, pantry: false },
    });
    await agent.post('/api/family/pantry').send({
      name: 'salt', qty: 0, unit: 'box', location: 'pantry', lowStockThreshold: 1,
    });
    const list = await agent.get('/api/family/shopping');
    expect(list.status).toBe(200);
    const names = list.body.map((i: { name: string }) => i.name);
    expect(names).toContain('salt');
  });

  it('dashboard returns today, low stock, and recent completions', async () => {
    const agent = await login(app);
    await agent.post('/api/family/setup').send({
      household: { name: 'Dash Fam' },
      members: [],
      seed: { chores: true, recipes: false, pantry: true },
    });
    const r = await agent.get('/api/family/dashboard');
    expect(r.status).toBe(200);
    expect(r.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(r.body.lowStock)).toBe(true);
    expect(Array.isArray(r.body.recentCompletions)).toBe(true);
    expect(Array.isArray(r.body.todayChoresPerMember)).toBe(true);
  });

  it('member CRUD: add, edit, remove', async () => {
    const agent = await login(app);
    await agent.post('/api/family/setup').send({
      household: { name: 'Members Fam' },
      members: [],
      seed: { chores: false, recipes: false, pantry: false },
    });
    const created = await agent.post('/api/family/members').send({ name: 'Alice', role: 'parent' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const edited = await agent.patch('/api/family/members/' + id).send({ name: 'Alice B' });
    expect(edited.body.name).toBe('Alice B');
    const del = await agent.delete('/api/family/members/' + id);
    expect(del.body.ok).toBe(true);
  });
});
