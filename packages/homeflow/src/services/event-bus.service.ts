/**
 * HomeFlow, Event Bus Service
 *
 * Provides a typed publish/subscribe surface that the rest of HomeFlow uses
 * regardless of whether Redis is available. Two backends:
 *
 *   1. RedisEventBus (createClient from the redis package). Used when the
 *      operator opts in via ENABLE_REDIS=1 and supplies REDIS_URL.
 *   2. InMemoryEventBus (Node EventEmitter). Default for the family pilot
 *      where the server is a dumb registry and edge devices hold truth.
 *
 * The createEventBus factory picks a backend at runtime and falls back to
 * the in memory bus if Redis is enabled but cannot be reached, so HomeFlow
 * boot never fails because Redis is offline.
 */

import { EventEmitter } from 'node:events';
import { createClient, type RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import type { DomainEvent, LoopId } from '@extropy/contracts';

const CHANNEL = 'extropy:events';

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * Surface area used by every HomeFlow caller. Both the Redis and in process
 * implementations satisfy this interface so callers do not need to know
 * which backend is active.
 */
export interface EventBus {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(
    type: string,
    correlationIdOrPayload: LoopId | string | Record<string, unknown>,
    maybePayload?: unknown,
  ): Promise<string>;
  publishRaw(type: string, correlationId: string, payload: unknown): Promise<string>;
  on(eventType: string, handler: EventHandler): void;
  onMany(eventTypes: string[], handler: EventHandler): void;
}

function buildEvent(
  type: string,
  correlationId: string,
  payload: unknown,
): DomainEvent {
  return {
    eventId: uuidv4(),
    type: type as DomainEvent['type'],
    payload: payload as DomainEvent['payload'],
    source: 'homeflow' as DomainEvent['source'],
    correlationId: correlationId as LoopId,
    timestamp: new Date().toISOString(),
    version: 1,
  };
}

function dispatch(handlers: Map<string, EventHandler[]>, event: DomainEvent): void {
  const direct = handlers.get(event.type as string) ?? [];
  for (const handler of direct) {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        result.catch(err => console.error(`[homeflow:event-bus] Handler error for ${event.type}:`, err));
      }
    } catch (err) {
      console.error(`[homeflow:event-bus] Sync handler error for ${event.type}:`, err);
    }
  }

  const wildcards = handlers.get('*') ?? [];
  for (const handler of wildcards) {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        result.catch(err => console.error('[homeflow:event-bus] Wildcard handler error:', err));
      }
    } catch (err) {
      console.error('[homeflow:event-bus] Wildcard sync handler error:', err);
    }
  }
}

/**
 * Redis backed bus. Mirrors the original implementation: one publisher
 * client and a duplicated subscriber client, both pointed at the same
 * channel. Connect failures bubble up so the caller can fall back to the
 * in process bus.
 */
export class RedisEventBus implements EventBus {
  private publisher: RedisClientType;
  private subscriber: RedisClientType;
  private handlers: Map<string, EventHandler[]> = new Map();

  constructor(redisUrl: string) {
    this.publisher = createClient({ url: redisUrl }) as RedisClientType;
    this.subscriber = this.publisher.duplicate() as RedisClientType;
  }

  async connect(): Promise<void> {
    await this.publisher.connect();
    await this.subscriber.connect();

    await this.subscriber.subscribe(CHANNEL, (message: string) => {
      try {
        const event = JSON.parse(message) as DomainEvent;
        dispatch(this.handlers, event);
      } catch (err) {
        console.error('[homeflow:event-bus] Failed to parse event:', err);
      }
    });

    console.log('[homeflow:event-bus] Connected to Redis and subscribed to', CHANNEL);
  }

  async disconnect(): Promise<void> {
    await this.subscriber.unsubscribe(CHANNEL);
    await this.subscriber.quit();
    await this.publisher.quit();
  }

  async publish(
    type: string,
    correlationIdOrPayload: LoopId | string | Record<string, unknown>,
    maybePayload?: unknown,
  ): Promise<string> {
    let correlationId: string;
    let payload: unknown;
    if (maybePayload !== undefined) {
      correlationId = correlationIdOrPayload as string;
      payload = maybePayload;
    } else {
      correlationId = '';
      payload = correlationIdOrPayload;
    }
    const event = buildEvent(type, correlationId, payload);
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
    return event.eventId;
  }

  async publishRaw(type: string, correlationId: string, payload: unknown): Promise<string> {
    const event = buildEvent(type, correlationId, payload);
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
    return event.eventId;
  }

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  onMany(eventTypes: string[], handler: EventHandler): void {
    for (const et of eventTypes) {
      this.on(et, handler);
    }
  }
}

/**
 * In process bus backed by Node's EventEmitter. Same publish/subscribe API
 * as the Redis bus. Family pilot default per the Extropy spec where the
 * server is a dumb registry and the edge holds truth, so cross process
 * fan out is not needed.
 */
export class InMemoryEventBus implements EventBus {
  private emitter = new EventEmitter();
  private handlers: Map<string, EventHandler[]> = new Map();

  constructor() {
    this.emitter.setMaxListeners(0);
    this.emitter.on(CHANNEL, (event: DomainEvent) => {
      dispatch(this.handlers, event);
    });
  }

  async connect(): Promise<void> {
    console.log('[homeflow:event-bus] In memory bus active (Redis disabled)');
  }

  async disconnect(): Promise<void> {
    this.emitter.removeAllListeners();
    this.handlers.clear();
  }

  async publish(
    type: string,
    correlationIdOrPayload: LoopId | string | Record<string, unknown>,
    maybePayload?: unknown,
  ): Promise<string> {
    let correlationId: string;
    let payload: unknown;
    if (maybePayload !== undefined) {
      correlationId = correlationIdOrPayload as string;
      payload = maybePayload;
    } else {
      correlationId = '';
      payload = correlationIdOrPayload;
    }
    const event = buildEvent(type, correlationId, payload);
    // Fire async so subscribers cannot reentrantly block the publisher.
    setImmediate(() => this.emitter.emit(CHANNEL, event));
    return event.eventId;
  }

  async publishRaw(type: string, correlationId: string, payload: unknown): Promise<string> {
    const event = buildEvent(type, correlationId, payload);
    setImmediate(() => this.emitter.emit(CHANNEL, event));
    return event.eventId;
  }

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  onMany(eventTypes: string[], handler: EventHandler): void {
    for (const et of eventTypes) {
      this.on(et, handler);
    }
  }
}

export interface CreateEventBusOptions {
  enableRedis?: boolean;
  redisUrl?: string;
}

/**
 * Pick a bus implementation based on env. Behaviour:
 *   ENABLE_REDIS unset or "0": use the in process bus.
 *   ENABLE_REDIS=1 with REDIS_URL set: try Redis, fall back to in process
 *     on any connect error so boot never crashes because Redis is offline.
 */
export async function createEventBus(opts: CreateEventBusOptions = {}): Promise<EventBus> {
  const enableRedis =
    opts.enableRedis ?? (process.env.ENABLE_REDIS === '1' || process.env.ENABLE_REDIS === 'true');
  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL ?? '';

  if (!enableRedis || !redisUrl) {
    const bus = new InMemoryEventBus();
    await bus.connect();
    return bus;
  }

  try {
    const bus = new RedisEventBus(redisUrl);
    await bus.connect();
    return bus;
  } catch (err) {
    console.warn(
      `[homeflow:event-bus] Redis at ${redisUrl} unreachable, falling back to in memory bus:`,
      err instanceof Error ? err.message : err,
    );
    const bus = new InMemoryEventBus();
    await bus.connect();
    return bus;
  }
}

/**
 * Backwards compatible alias used across the codebase. Now an interface so
 * either backend (Redis or in process) satisfies the dependency. Existing
 * code that constructs `new EventBusService(redisUrl)` keeps working
 * because the value side resolves to RedisEventBus.
 */
export type EventBusService = EventBus;
export const EventBusService = RedisEventBus;
