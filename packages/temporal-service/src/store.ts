/*
 * File-backed persistence for the Universal Times service.
 *
 * Mirrors the atomic-rename pattern from
 * packages/homeflow/src/services/file-db.service.ts. We store:
 *   - subscribers: list of active callback registrations
 *   - lastFired: per (subscriberId, unit) integer counter that we last
 *                fired a callback for, so a restart never duplicates a
 *                transition that already shipped, and never skips one
 *                that should fire while the service was down. (We fire
 *                all missed transitions on startup, but coalesce them
 *                into a single oldValue->newValue callback.)
 *   - retryQueue: callbacks that failed and are awaiting backoff retry.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AnyUnitName } from './universaltimes.js';

export interface Subscriber {
  id: string;
  subscriberId: string;
  callbackUrl: string;
  unit: AnyUnitName;
  hmacSecret?: string;
  createdAt: string;
}

export interface RetryItem {
  id: string;
  subscriberId: string;
  callbackUrl: string;
  unit: AnyUnitName;
  payload: unknown;
  hmacSecret?: string;
  attempt: number;
  nextAttemptAt: number;
}

interface Snapshot {
  subscribers: Subscriber[];
  lastFired: Record<string, number>;
  retryQueue: RetryItem[];
}

const EMPTY = (): Snapshot => ({ subscribers: [], lastFired: {}, retryQueue: [] });

export interface StoreOptions {
  dataDir: string;
  fileName?: string;
}

export class TemporalStore {
  private readonly filePath: string;
  private snap: Snapshot = EMPTY();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: StoreOptions) {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.filePath = path.join(opts.dataDir, opts.fileName ?? 'temporal.json');
  }

  get path(): string {
    return this.filePath;
  }

  load(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      this.snap = {
        subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
        lastFired: parsed.lastFired && typeof parsed.lastFired === 'object' ? parsed.lastFired : {},
        retryQueue: Array.isArray(parsed.retryQueue) ? parsed.retryQueue : [],
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.snap = EMPTY();
      } else {
        throw err;
      }
    }
    this.loaded = true;
  }

  private persist(): Promise<void> {
    const next = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
      const data = JSON.stringify(this.snap, null, 2);
      const fh = await fs.promises.open(tmp, 'w');
      try {
        await fh.writeFile(data, 'utf-8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fs.promises.rename(tmp, this.filePath);
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  listSubscribers(): Subscriber[] {
    if (!this.loaded) this.load();
    return [...this.snap.subscribers];
  }

  getSubscriber(id: string): Subscriber | undefined {
    if (!this.loaded) this.load();
    return this.snap.subscribers.find((s) => s.id === id);
  }

  async addSubscriber(s: Subscriber): Promise<void> {
    if (!this.loaded) this.load();
    this.snap.subscribers.push(s);
    await this.persist();
  }

  async removeSubscriber(id: string): Promise<boolean> {
    if (!this.loaded) this.load();
    const before = this.snap.subscribers.length;
    this.snap.subscribers = this.snap.subscribers.filter((s) => s.id !== id);
    /*
     * Drop any pending lastFired and retry rows for this subscriber so
     * a re-add with the same subscriberId starts cleanly.
     */
    for (const k of Object.keys(this.snap.lastFired)) {
      if (k.startsWith(`${id}|`)) delete this.snap.lastFired[k];
    }
    this.snap.retryQueue = this.snap.retryQueue.filter((r) => r.id !== id);
    if (this.snap.subscribers.length !== before) {
      await this.persist();
      return true;
    }
    return false;
  }

  getLastFired(subId: string, unit: AnyUnitName): number | undefined {
    if (!this.loaded) this.load();
    return this.snap.lastFired[`${subId}|${unit}`];
  }

  async setLastFired(subId: string, unit: AnyUnitName, value: number): Promise<void> {
    if (!this.loaded) this.load();
    this.snap.lastFired[`${subId}|${unit}`] = value;
    await this.persist();
  }

  listRetryQueue(): RetryItem[] {
    if (!this.loaded) this.load();
    return [...this.snap.retryQueue];
  }

  async enqueueRetry(item: RetryItem): Promise<void> {
    if (!this.loaded) this.load();
    this.snap.retryQueue.push(item);
    await this.persist();
  }

  async removeRetry(predicate: (r: RetryItem) => boolean): Promise<void> {
    if (!this.loaded) this.load();
    const before = this.snap.retryQueue.length;
    this.snap.retryQueue = this.snap.retryQueue.filter((r) => !predicate(r));
    if (this.snap.retryQueue.length !== before) {
      await this.persist();
    }
  }

  async replaceRetry(item: RetryItem): Promise<void> {
    if (!this.loaded) this.load();
    const idx = this.snap.retryQueue.findIndex(
      (r) => r.id === item.id && r.unit === item.unit && r.attempt < item.attempt,
    );
    if (idx >= 0) {
      this.snap.retryQueue[idx] = item;
    } else {
      this.snap.retryQueue.push(item);
    }
    await this.persist();
  }
}

export function resolveDataDir(): string {
  const explicit = process.env.TEMPORAL_DATA_DIR ?? process.env.HOMEFLOW_DATA_DIR;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  const systemDir = '/var/lib/temporal';
  try {
    fs.accessSync(systemDir, fs.constants.W_OK);
    return systemDir;
  } catch {
    return path.join(process.cwd(), '.data');
  }
}
