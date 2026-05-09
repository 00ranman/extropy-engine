/*
 * Clock loop unit tests using a fake fetch and a fake clock.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TemporalClock } from '../clock.js';
import { TemporalStore } from '../store.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'temporal-clock-'));
}

interface Call {
  url: string;
  body: unknown;
}

function makeFakeFetch() {
  const calls: Call[] = [];
  let next = 200;
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = init && typeof init === 'object' && 'body' in init ? (init as { body: string }).body : '';
    calls.push({ url: String(url), body: typeof body === 'string' ? JSON.parse(body) : body });
    return new Response('ok', { status: next });
  };
  return {
    fetchImpl,
    calls,
    setStatus: (s: number) => {
      next = s;
    },
  };
}

describe('TemporalClock', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
  });

  it('does not fire on the first tick after subscribe (priming)', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    await store.addSubscriber({
      id: 'sub-1',
      subscriberId: 'homeflow',
      callbackUrl: 'http://x/cb',
      unit: 'Tick',
      createdAt: new Date().toISOString(),
    });
    const fake = makeFakeFetch();
    const t0 = new Date('2026-05-06T12:00:00.000Z');
    const clock = new TemporalClock({
      store,
      fetchImpl: fake.fetchImpl,
      now: () => t0,
    });
    clock.primeLastFired();
    await clock.tick();
    expect(fake.calls).toHaveLength(0);
  });

  it('fires when the unit counter advances', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    await store.addSubscriber({
      id: 'sub-1',
      subscriberId: 'homeflow',
      callbackUrl: 'http://x/cb',
      unit: 'Tick',
      createdAt: new Date().toISOString(),
    });
    const fake = makeFakeFetch();
    let now = new Date('2026-05-06T12:00:00.000Z');
    const clock = new TemporalClock({
      store,
      fetchImpl: fake.fetchImpl,
      now: () => now,
    });
    clock.primeLastFired();
    await clock.tick();
    now = new Date('2026-05-06T12:00:01.000Z');
    await clock.tick();
    expect(fake.calls).toHaveLength(1);
    const body = fake.calls[0].body as { unit: string; oldValue: number; newValue: number };
    expect(body.unit).toBe('Tick');
    expect(body.newValue).toBeGreaterThan(body.oldValue);
  });

  it('queues a retry on delivery failure and clears it on success', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    await store.addSubscriber({
      id: 'sub-1',
      subscriberId: 'homeflow',
      callbackUrl: 'http://x/cb',
      unit: 'Tick',
      createdAt: new Date().toISOString(),
    });
    const fake = makeFakeFetch();
    fake.setStatus(500);
    let now = new Date('2026-05-06T12:00:00.000Z');
    const clock = new TemporalClock({
      store,
      fetchImpl: fake.fetchImpl,
      now: () => now,
    });
    clock.primeLastFired();
    now = new Date('2026-05-06T12:00:01.000Z');
    await clock.tick();
    expect(store.listRetryQueue()).toHaveLength(1);
    expect(store.listRetryQueue()[0].attempt).toBe(1);

    fake.setStatus(200);
    now = new Date('2026-05-06T12:00:05.000Z');
    await clock.tick();
    expect(store.listRetryQueue()).toHaveLength(0);
  });

  it('drops the retry after the max attempt count', async () => {
    const store = new TemporalStore({ dataDir: dir });
    store.load();
    /*
     * Use Loop (period 8640s) so the subscriber only fires once across
     * the simulated 13 minute test span. With Tick (0.864s) each
     * synthetic clock advance would queue another delivery and the
     * retry-budget assertion would race with new transitions.
     */
    await store.addSubscriber({
      id: 'sub-1',
      subscriberId: 'homeflow',
      callbackUrl: 'http://x/cb',
      unit: 'Loop',
      createdAt: new Date().toISOString(),
    });
    const fake = makeFakeFetch();
    fake.setStatus(500);
    /*
     * Force one initial transition: prime lastFired from a "yesterday"
     * counter, then jump to today so the loop counter advances on the
     * first real tick.
     */
    await store.setLastFired('sub-1', 'Loop', -1);
    let now = new Date('2026-05-06T12:00:01.000Z');
    const errors: string[] = [];
    const clock = new TemporalClock({
      store,
      fetchImpl: fake.fetchImpl,
      now: () => now,
      onError: (msg) => errors.push(msg),
    });
    await clock.tick();
    expect(store.listRetryQueue()).toHaveLength(1);

    const t0 = new Date('2026-05-06T12:00:01.000Z');
    const windows = [1, 6, 36, 156, 756];
    for (const seconds of windows) {
      now = new Date(t0.getTime() + seconds * 1000);
      await clock.tick();
    }
    expect(store.listRetryQueue()).toHaveLength(0);
    expect(errors.some((m) => m.includes('failed after'))).toBe(true);
  });
});
