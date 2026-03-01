/**
 * ===============================================================================
 *  Shared Event Bus -- Redis Pub/Sub + HTTP Webhook Delivery
 * ===============================================================================
 *
 *  Every inter-service event flows through this bus:
 *    1. Publisher calls emit() -> event written to Redis + event_log table
 *    2. Subscribers registered via on() receive events from Redis
 *    3. HTTP webhooks deliver events to downstream services' /events endpoints
 *
 *  Usage:
 *    const bus = new EventBus(redis, pool, 'epistemology-engine');
 *    bus.registerWebhook('ledger.loop.opened', 'http://loop-ledger:4003/events');
 *    await bus.emit(EventType.CLAIM_SUBMITTED, loopId, payload);
 */

import Redis from 'ioredis';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import type {
  DomainEvent,
  EventType,
  EventPayloadMap,
  ServiceName,
  LoopId,
} from './types.js';

const EVENT_CHANNEL = 'extropy:events';

export class EventBus {
  private redis: Redis;
  private sub: Redis;
  private pool: Pool;
  private service: ServiceName;
  private handlers: Map<string, Array<(event: DomainEvent) => Promise<void>>> = new Map();
  private webhooks: Map<string, string[]> = new Map();

  constructor(redis: Redis, pool: Pool, service: ServiceName) {
    this.redis = redis;
    this.sub = redis.duplicate();
    this.pool = pool;
    this.service = service;
  }

  async start(): Promise<void> {
    await this.sub.subscribe(EVENT_CHANNEL);
    this.sub.on('message', async (_channel: string, message: string) => {
      try {
        const event: DomainEvent = JSON.parse(message);
        // Don't process events emitted by this service
        if (event.source === this.service) return;

        const typeHandlers = this.handlers.get(event.type) || [];
        for (const handler of typeHandlers) {
          try {
            await handler(event);
          } catch (err) {
            console.error(`[${this.service}] Error handling event ${event.type}:`, err);
          }
        }
      } catch (err) {
        console.error(`[${this.service}] Error parsing event:`, err);
      }
    });
    console.log(`[${this.service}] Event bus listening on ${EVENT_CHANNEL}`);
  }

  async stop(): Promise<void> {
    await this.sub.unsubscribe(EVENT_CHANNEL);
    this.sub.disconnect();
  }

  /**
   * Emit a typed event. Writes to event_log and publishes to Redis.
   * Also delivers via HTTP webhook to registered endpoints.
   */
  async emit<T extends EventType>(
    type: T,
    correlationId: LoopId,
    payload: EventPayloadMap[T],
  ): Promise<DomainEvent<T, EventPayloadMap[T]>> {
    const event: DomainEvent<T, EventPayloadMap[T]> = {
      eventId: uuid(),
      type,
      payload,
      source: this.service,
      correlationId,
      timestamp: new Date().toISOString(),
      version: 1,
    };

    // Persist to event_log
    try {
      await this.pool.query(
        `INSERT INTO public.event_log (event_id, type, payload, source, correlation_id, version)\n         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event.eventId, event.type, JSON.stringify(event.payload), event.source, event.correlationId, event.version],
      );
    } catch (err) {
      console.error(`[${this.service}] Failed to persist event:`, err);
    }

    // Publish to Redis
    await this.redis.publish(EVENT_CHANNEL, JSON.stringify(event));

    // Deliver via HTTP webhooks
    const urls = this.webhooks.get(type) || [];
    for (const url of urls) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });
      } catch (err) {
        console.error(`[${this.service}] Webhook delivery failed to ${url}:`, err);
      }
    }

    console.log(`[${this.service}] [event] ${type} (loop=${correlationId})`);
    return event;
  }

  /**
   * Register a handler for a specific event type (via Redis pub/sub).
   */
  on<T extends EventType>(
    type: T,
    handler: (event: DomainEvent<T, EventPayloadMap[T]>) => Promise<void>,
  ): void {
    const existing = this.handlers.get(type) || [];
    existing.push(handler as (event: DomainEvent) => Promise<void>);
    this.handlers.set(type, existing);
  }

  /**
   * Register a webhook URL for a specific event type.
   * Events matching this type will be POSTed to the URL.
   */
  registerWebhook(type: EventType, url: string): void {
    const existing = this.webhooks.get(type) || [];
    existing.push(url);
    this.webhooks.set(type, existing);
  }
}
