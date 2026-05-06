/**
 * Smoke tests for the PWA static assets served by the homeflow app.
 *
 * Verifies that the manifest is served as JSON with the right MIME type
 * and that the service worker payload is reachable and contains the
 * Cache Storage API call we depend on for offline support.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { UserService } from '../src/services/user.service.js';
import { PSLLService } from '../src/services/psll.service.js';
import { FakeDb } from './family-pilot/fake-db.js';

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

async function buildApp() {
  const db = new FakeDb();
  const userService = new UserService(db as never);
  await userService.ensureSchema();
  const psllService = new PSLLService(db as never);
  await psllService.ensureSchema();
  const frontendDir = path.resolve(__dirname, '..', '..', '..', 'frontends', 'homeflow-ui');
  return createApp({
    ...makeStubServices(db),
    userService,
    psllService,
    authConfig: {
      googleClientId: undefined,
      googleClientSecret: undefined,
      baseUrl: 'http://localhost:0',
    },
    sessionSecret: 'test-secret',
    staticFrontendDir: frontendDir,
    dagAnchor: {
      async recordGenesisVertex() {
        return { vertexId: 'vtx-test' };
      },
    },
  });
}

describe('PWA static assets', () => {
  it('serves /manifest.webmanifest as parseable JSON with the right MIME type', async () => {
    const app = await buildApp();
    const res = await request(app).get('/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/manifest\+json/);
    const manifest = JSON.parse(res.text);
    expect(manifest.name).toBe('HomeFlow');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('serves /sw.js with a body that uses the Cache Storage API', async () => {
    const app = await buildApp();
    const res = await request(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('caches.open');
  });
});
