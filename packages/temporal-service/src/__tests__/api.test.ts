/*
 * End to end tests for the Express app: subscribe lifecycle, /now and
 * /health surfaces, transition test endpoint with HMAC signing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { createApp } from '../app.js';
import { TemporalClock } from '../clock.js';
import { TemporalStore } from '../store.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'temporal-api-'));
}

interface Captured {
  body: unknown;
  headers: http.IncomingHttpHeaders;
}

function startCapture(): Promise<{ url: string; received: Captured[]; close: () => void; reject: boolean; setReject: (v: boolean) => void }> {
  const received: Captured[] = [];
  let reject = false;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          received.push({ body: JSON.parse(body), headers: req.headers });
        } catch {
          received.push({ body, headers: req.headers });
        }
        if (reject) {
          res.statusCode = 500;
          res.end('nope');
          return;
        }
        res.statusCode = 200;
        res.end('ok');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({
          url: `http://127.0.0.1:${addr.port}/cb`,
          received,
          close: () => server.close(),
          reject,
          setReject: (v: boolean) => {
            reject = v;
          },
        });
      }
    });
  });
}

describe('temporal API', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
  });

  it('GET /health returns healthy', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    const clock = new TemporalClock({ store });
    const app = createApp({ store, clock });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.subscribers).toBe(0);
  });

  it('GET /now returns full snapshot', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    const clock = new TemporalClock({ store });
    const app = createApp({ store, clock });
    const res = await request(app).get('/now?at=2026-05-06T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body.calendar.year).toBe(2026);
    expect(res.body.calendar.month).toBe(4);
    expect(res.body.utUnits).toHaveProperty('eon');
    expect(res.body.solarUnits).toEqual({ loop: 0, arc: 0, tick: 0 });
  });

  it('subscribe lifecycle plus duplicate dedupe', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    const clock = new TemporalClock({ store });
    const app = createApp({ store, clock });

    const r1 = await request(app)
      .post('/subscribe')
      .send({
        subscriberId: 'homeflow',
        callbackUrl: 'http://127.0.0.1:1/cb',
        unit: 'Season',
      });
    expect(r1.status).toBe(201);
    const id = r1.body.subscriptionId;
    expect(id).toBeTruthy();

    const r2 = await request(app)
      .post('/subscribe')
      .send({
        subscriberId: 'homeflow',
        callbackUrl: 'http://127.0.0.1:1/cb',
        unit: 'Season',
      });
    expect(r2.status).toBe(200);
    expect(r2.body.deduplicated).toBe(true);
    expect(r2.body.subscriptionId).toBe(id);

    const list = await request(app).get('/subscribers');
    expect(list.body.subscribers).toHaveLength(1);

    const del = await request(app).delete(`/subscribe/${id}`);
    expect(del.status).toBe(204);

    const list2 = await request(app).get('/subscribers');
    expect(list2.body.subscribers).toHaveLength(0);
  });

  it('rejects invalid unit names', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    const clock = new TemporalClock({ store });
    const app = createApp({ store, clock });
    const r = await request(app)
      .post('/subscribe')
      .send({ subscriberId: 'x', callbackUrl: 'http://127.0.0.1:1/cb', unit: 'NotAUnit' });
    expect(r.status).toBe(400);
  });

  it('test transition fires callback with HMAC signature', async () => {
    const cap = await startCapture();
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    const clock = new TemporalClock({ store });
    const app = createApp({ store, clock });

    const sub = await request(app)
      .post('/subscribe')
      .send({
        subscriberId: 'homeflow',
        callbackUrl: cap.url,
        unit: 'Season',
        hmacSecret: 'shhh',
      });
    expect(sub.status).toBe(201);

    const r = await request(app).post('/transition/Season/test');
    expect(r.status).toBe(200);
    expect(r.body.fired).toBe(1);

    // Wait for the deliver to land
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(cap.received.length).toBe(1);
    const got = cap.received[0];
    expect(got.headers['x-temporal-signature']).toBeDefined();
    const sig = String(got.headers['x-temporal-signature']);
    const expected =
      'sha256=' +
      createHmac('sha256', 'shhh').update(JSON.stringify(got.body)).digest('hex');
    expect(sig).toBe(expected);
    cap.close();
  });

  it('admin token gates the test endpoint when set', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    const clock = new TemporalClock({ store });
    const app = createApp({ store, clock, adminToken: 'secret' });
    const r = await request(app).post('/transition/Season/test');
    expect(r.status).toBe(401);
    const r2 = await request(app)
      .post('/transition/Season/test')
      .set('X-Admin-Token', 'secret');
    expect(r2.status).toBe(200);
  });
});
