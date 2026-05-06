/*
 * Internal clock loop. Every tick we:
 *   1. Compute the integer counter for every unit that has at least one
 *      subscriber.
 *   2. For each subscription, compare to the last fired counter we
 *      persisted. If it advanced, POST a callback and update lastFired.
 *   3. Drain the retry queue: any item whose nextAttemptAt has passed
 *      gets re-sent, with exponential backoff up to 5 attempts.
 *
 * Tick interval is min(1 second, smallest-subscribed-period / 100). If
 * someone subscribes to Tick (0.864 s) the loop runs at ~9 ms. In practice
 * the smallest period anyone will subscribe to is Loop or larger.
 */

import { createHmac } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  type AnyUnitName,
  nowSnapshot,
  periodSec,
  unitCounter,
  ALL_UNITS,
} from './universaltimes.js';
import type { TemporalStore, Subscriber, RetryItem } from './store.js';

export interface CallbackPayload {
  subscriberId: string;
  subscriptionId: string;
  unit: AnyUnitName;
  oldValue: number;
  newValue: number;
  timestamp: string;
  utUnits: ReturnType<typeof nowSnapshot>['utUnits'];
  solarUnits: ReturnType<typeof nowSnapshot>['solarUnits'];
  calendar: ReturnType<typeof nowSnapshot>['calendar'];
}

export interface ClockOptions {
  store: TemporalStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  onError?: (msg: string, err: unknown) => void;
}

const BACKOFFS_MS = [1_000, 5_000, 30_000, 120_000, 600_000];
const MAX_ATTEMPTS = BACKOFFS_MS.length;

export class TemporalClock {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly fetchImpl: typeof fetch;
  private readonly nowFn: () => Date;
  private readonly onError: (msg: string, err: unknown) => void;

  constructor(private opts: ClockOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.nowFn = opts.now ?? (() => new Date());
    this.onError =
      opts.onError ??
      ((msg, err) => {
        console.warn(`[temporal] ${msg}`, err);
      });
  }

  /*
   * Initialize lastFired for any subscriber that does not have one yet,
   * so the first tick after subscribe does not fire a spurious callback
   * for the current period.
   */
  primeLastFired(): void {
    const now = this.nowFn();
    for (const sub of this.opts.store.listSubscribers()) {
      const existing = this.opts.store.getLastFired(sub.id, sub.unit);
      if (existing === undefined) {
        void this.opts.store.setLastFired(sub.id, sub.unit, unitCounter(sub.unit, now));
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.primeLastFired();
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private currentTickIntervalMs(): number {
    const subs = this.opts.store.listSubscribers();
    let minPeriod = 1;
    for (const s of subs) {
      const p = periodSec(s.unit);
      if (p < minPeriod) minPeriod = p;
    }
    const ms = Math.max(50, Math.min(1000, (minPeriod / 100) * 1000));
    return Math.round(ms);
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.tick().finally(() => this.scheduleNext());
    }, this.currentTickIntervalMs());
  }

  async tick(): Promise<void> {
    const now = this.nowFn();
    const subs = this.opts.store.listSubscribers();
    const counters = new Map<AnyUnitName, number>();

    for (const sub of subs) {
      if (!counters.has(sub.unit)) {
        counters.set(sub.unit, unitCounter(sub.unit, now));
      }
      const newValue = counters.get(sub.unit)!;
      const oldValue = this.opts.store.getLastFired(sub.id, sub.unit);
      if (oldValue === undefined) {
        await this.opts.store.setLastFired(sub.id, sub.unit, newValue);
        continue;
      }
      if (newValue > oldValue) {
        await this.fireTransition(sub, oldValue, newValue, now);
        await this.opts.store.setLastFired(sub.id, sub.unit, newValue);
      }
    }

    await this.drainRetryQueue(now);
  }

  /*
   * Public so the admin /transition/:unit/test endpoint can force one.
   * Fires for every subscriber matching the unit, treating the current
   * counter as "newValue" and lastFired (or current - 1) as "oldValue".
   */
  async fireUnitNow(unit: AnyUnitName): Promise<number> {
    const now = this.nowFn();
    const newValue = unitCounter(unit, now);
    const subs = this.opts.store.listSubscribers().filter((s) => s.unit === unit);
    for (const sub of subs) {
      const oldValue = this.opts.store.getLastFired(sub.id, sub.unit) ?? newValue - 1;
      await this.fireTransition(sub, oldValue, newValue, now);
      await this.opts.store.setLastFired(sub.id, sub.unit, newValue);
    }
    return subs.length;
  }

  private async fireTransition(
    sub: Subscriber,
    oldValue: number,
    newValue: number,
    at: Date,
  ): Promise<void> {
    const snap = nowSnapshot(at);
    const payload: CallbackPayload = {
      subscriberId: sub.subscriberId,
      subscriptionId: sub.id,
      unit: sub.unit,
      oldValue,
      newValue,
      timestamp: at.toISOString(),
      utUnits: snap.utUnits,
      solarUnits: snap.solarUnits,
      calendar: snap.calendar,
    };
    const ok = await this.deliver(sub.callbackUrl, payload, sub.hmacSecret);
    if (!ok) {
      const item: RetryItem = {
        id: sub.id,
        subscriberId: sub.subscriberId,
        callbackUrl: sub.callbackUrl,
        unit: sub.unit,
        payload,
        ...(sub.hmacSecret ? { hmacSecret: sub.hmacSecret } : {}),
        attempt: 1,
        nextAttemptAt: at.getTime() + BACKOFFS_MS[0],
      };
      await this.opts.store.enqueueRetry(item);
    }
  }

  private async drainRetryQueue(now: Date): Promise<void> {
    const queue = this.opts.store.listRetryQueue();
    for (const item of queue) {
      if (item.nextAttemptAt > now.getTime()) continue;
      const ok = await this.deliver(item.callbackUrl, item.payload, item.hmacSecret);
      if (ok) {
        await this.opts.store.removeRetry(
          (r) => r.id === item.id && r.unit === item.unit && r.attempt === item.attempt,
        );
        continue;
      }
      const nextAttempt = item.attempt + 1;
      if (nextAttempt > MAX_ATTEMPTS) {
        this.onError(
          `delivery to ${item.callbackUrl} for sub ${item.subscriberId} failed after ${MAX_ATTEMPTS} attempts, dropping`,
          null,
        );
        await this.opts.store.removeRetry(
          (r) => r.id === item.id && r.unit === item.unit && r.attempt === item.attempt,
        );
        continue;
      }
      const delay = BACKOFFS_MS[nextAttempt - 1];
      const updated: RetryItem = {
        ...item,
        attempt: nextAttempt,
        nextAttemptAt: now.getTime() + delay,
      };
      await this.opts.store.removeRetry(
        (r) => r.id === item.id && r.unit === item.unit && r.attempt === item.attempt,
      );
      await this.opts.store.enqueueRetry(updated);
    }
  }

  private async deliver(url: string, payload: unknown, hmacSecret?: string): Promise<boolean> {
    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Temporal-Delivery-Id': uuidv4(),
      };
      if (hmacSecret) {
        const sig = createHmac('sha256', hmacSecret).update(body).digest('hex');
        headers['X-Temporal-Signature'] = `sha256=${sig}`;
      }
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 5_000);
      try {
        const resp = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body,
          signal: ctrl.signal,
        });
        return resp.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      this.onError(`delivery to ${url} threw`, err);
      return false;
    }
  }
}

/*
 * Re-export ALL_UNITS so the server can validate request bodies without
 * pulling in two modules.
 */
export { ALL_UNITS };
