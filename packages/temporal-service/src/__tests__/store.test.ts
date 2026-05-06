/*
 * Persistence tests for the temporal store.
 *
 * Verify that writes survive a process-style "restart" (a new TemporalStore
 * pointed at the same file) and that the atomic-rename pattern does not
 * corrupt the file under concurrent persist calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TemporalStore } from '../store.js';

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'temporal-test-'));
  return d;
}

describe('TemporalStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  it('round trips a subscriber across restart', async () => {
    const a = new TemporalStore({ dataDir: dir });
    a.load();
    await a.addSubscriber({
      id: 'sub-1',
      subscriberId: 'homeflow',
      callbackUrl: 'http://localhost:9999/cb',
      unit: 'Season',
      createdAt: new Date().toISOString(),
    });
    await a.flush();

    const b = new TemporalStore({ dataDir: dir });
    b.load();
    expect(b.listSubscribers()).toHaveLength(1);
    expect(b.listSubscribers()[0].subscriberId).toBe('homeflow');
  });

  it('removeSubscriber wipes lastFired and retry rows', async () => {
    const s = new TemporalStore({ dataDir: dir });
    s.load();
    await s.addSubscriber({
      id: 'sub-1',
      subscriberId: 'homeflow',
      callbackUrl: 'http://localhost:9999/cb',
      unit: 'Season',
      createdAt: new Date().toISOString(),
    });
    await s.setLastFired('sub-1', 'Season', 42);
    await s.enqueueRetry({
      id: 'sub-1',
      subscriberId: 'homeflow',
      callbackUrl: 'http://localhost:9999/cb',
      unit: 'Season',
      payload: {},
      attempt: 1,
      nextAttemptAt: Date.now(),
    });

    expect(s.getLastFired('sub-1', 'Season')).toBe(42);
    expect(s.listRetryQueue()).toHaveLength(1);

    expect(await s.removeSubscriber('sub-1')).toBe(true);
    expect(s.getLastFired('sub-1', 'Season')).toBeUndefined();
    expect(s.listRetryQueue()).toHaveLength(0);
  });

  it('survives concurrent persist calls without corruption', async () => {
    const s = new TemporalStore({ dataDir: dir });
    s.load();
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 25; i++) {
      tasks.push(
        s.addSubscriber({
          id: `id-${i}`,
          subscriberId: `sub-${i}`,
          callbackUrl: `http://x/${i}`,
          unit: 'Season',
          createdAt: new Date().toISOString(),
        }),
      );
    }
    await Promise.all(tasks);
    await s.flush();

    const restored = new TemporalStore({ dataDir: dir });
    restored.load();
    expect(restored.listSubscribers()).toHaveLength(25);
  });
});
