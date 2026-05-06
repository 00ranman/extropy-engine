/**
 * Event bus tests.
 *
 * 1. InMemoryEventBus round trip: publish, on, onMany, publishRaw.
 * 2. createEventBus picks the in process backend when ENABLE_REDIS is unset.
 * 3. createEventBus falls back to the in process bus if ENABLE_REDIS=1 but
 *    Redis cannot be reached (boot must never crash on Redis being offline).
 * 4. TemporalIntegration.registerForSeasonEvents succeeds against a mocked
 *    fetch when the bus is the in process backend, exercising the same path
 *    HomeFlow boot uses without Redis.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  InMemoryEventBus,
  createEventBus,
  type EventBus,
} from '../../src/services/event-bus.service.js';
import { TemporalIntegration } from '../../src/integrations/temporal.integration.js';

describe('InMemoryEventBus', () => {
  it('delivers a published event to a registered handler', async () => {
    const bus = new InMemoryEventBus();
    await bus.connect();

    const seen: unknown[] = [];
    bus.on('demo.event', event => {
      seen.push(event);
    });

    await bus.publish('demo.event', 'corr-1', { a: 1 });

    await new Promise(resolve => setImmediate(resolve));

    expect(seen.length).toBe(1);
    const evt = seen[0] as { type: string; payload: { a: number }; correlationId: string };
    expect(evt.type).toBe('demo.event');
    expect(evt.payload.a).toBe(1);
    expect(evt.correlationId).toBe('corr-1');

    await bus.disconnect();
  });

  it('delivers wildcard subscriptions in addition to typed ones', async () => {
    const bus = new InMemoryEventBus();
    await bus.connect();

    const typed: string[] = [];
    const wild: string[] = [];
    bus.on('demo.typed', () => { typed.push('hit'); });
    bus.on('*', () => { wild.push('hit'); });

    await bus.publish('demo.typed', 'corr-2', { ok: true });
    await bus.publish('demo.other', 'corr-3', { ok: true });

    await new Promise(resolve => setImmediate(resolve));

    expect(typed.length).toBe(1);
    expect(wild.length).toBe(2);

    await bus.disconnect();
  });

  it('subscribes onMany to a list of types', async () => {
    const bus = new InMemoryEventBus();
    await bus.connect();

    const seen: string[] = [];
    bus.onMany(['a.one', 'a.two'], event => { seen.push(event.type as string); });

    await bus.publish('a.one', 'c', {});
    await bus.publish('a.two', 'c', {});
    await bus.publish('a.three', 'c', {});

    await new Promise(resolve => setImmediate(resolve));

    expect(seen.sort()).toEqual(['a.one', 'a.two']);
    await bus.disconnect();
  });

  it('publishRaw goes through the same dispatch path', async () => {
    const bus = new InMemoryEventBus();
    await bus.connect();
    const seen: unknown[] = [];
    bus.on('raw.evt', event => { seen.push(event); });

    const id = await bus.publishRaw('raw.evt', 'corr-raw', { hello: 'world' });
    expect(typeof id).toBe('string');

    await new Promise(resolve => setImmediate(resolve));

    expect(seen.length).toBe(1);
    const evt = seen[0] as { eventId: string; payload: { hello: string } };
    expect(evt.eventId).toBe(id);
    expect(evt.payload.hello).toBe('world');

    await bus.disconnect();
  });

  it('async handler errors are logged but do not throw out of publish', async () => {
    const bus = new InMemoryEventBus();
    await bus.connect();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    bus.on('boom', async () => {
      throw new Error('handler exploded');
    });

    await expect(bus.publish('boom', 'c', {})).resolves.toBeTypeOf('string');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    await bus.disconnect();
  });
});

describe('createEventBus', () => {
  const origEnableRedis = process.env.ENABLE_REDIS;
  const origRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.ENABLE_REDIS;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    if (origEnableRedis === undefined) {
      delete process.env.ENABLE_REDIS;
    } else {
      process.env.ENABLE_REDIS = origEnableRedis;
    }
    if (origRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = origRedisUrl;
    }
  });

  it('returns the in process bus when ENABLE_REDIS is unset', async () => {
    const bus = await createEventBus();
    expect(bus).toBeInstanceOf(InMemoryEventBus);
    await bus.disconnect();
  });

  it('returns the in process bus when ENABLE_REDIS=1 but Redis is unreachable', async () => {
    // Use a port that should not have anything listening on it. The Redis
    // client will fail to connect; the factory must swallow that and hand
    // back an InMemoryEventBus rather than throwing.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = await createEventBus({
      enableRedis: true,
      redisUrl: 'redis://127.0.0.1:1', // port 1 is reserved, nothing listens
    });
    expect(bus).toBeInstanceOf(InMemoryEventBus);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    await bus.disconnect();
  }, 15_000);
});

describe('Temporal subscription with the in process bus (no Redis)', () => {
  it('boots and subscribes for season events without crashing', async () => {
    const bus: EventBus = new InMemoryEventBus();
    await bus.connect();

    // Mock fetch so /subscribe returns 200 with a fake subscription id.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async text() { return ''; },
      async json() { return { subscriptionId: 'sub-test' }; },
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const integration = new TemporalIntegration(
        {} as never,
        bus as never,
        {
          temporalUrl: 'http://127.0.0.1:4002',
          callbackUrl: 'http://127.0.0.1:4001/temporal/event',
          retryIntervalMs: 60_000,
        },
      );
      await expect(integration.registerForSeasonEvents()).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe('http://127.0.0.1:4002/subscribe');
      expect(calledInit.method).toBe('POST');
      const body = JSON.parse(String(calledInit.body));
      expect(body.subscriberId).toBe('homeflow');
      expect(body.unit).toBe('Season');
    } finally {
      globalThis.fetch = origFetch;
      await bus.disconnect();
    }
  });
});
