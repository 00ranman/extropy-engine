/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Event Bus Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Wraps Redis pub/sub for type-safe event publishing and subscribing.
 *  Publishes to the shared `extropy:events` channel and subscribes to
 *  both core EventPayloadMap and HomeFlow-specific events.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createClient, type RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import type { DomainEvent, LoopId } from '@extropy/contracts';
import type { HomeFlowEventType, HomeFlowEventPayloadMap } from '../types/index.js';

const CHANNEL = 'extropy:events';

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export class EventBusService {
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
        this.dispatch(event);
      } catch (err) {
        console.error('[homeflow:event-bus] Failed to parse event:', err);
      }
    });

    console.log('[homeflow:event-bus] Connected and subscribed to', CHANNEL);
  }

  async disconnect(): Promise<void> {
    await this.subscriber.unsubscribe(CHANNEL);
    await this.subscriber.quit();
    await this.publisher.quit();
  }

  /**
   * Publish a typed event to the shared bus.
   */
  async publish<T extends HomeFlowEventType>(
    type: T,
    correlationId: LoopId | string,
    payload: HomeFlowEventPayloadMap[T],
  ): Promise<string> {
    const eventId = uuidv4();
    const event: DomainEvent = {
      eventId,
      type: type as string,
      payload: payload as unknown,
      source: 'homeflow' as any,
      correlationId: correlationId as LoopId,
      timestamp: new Date().toISOString(),
      version: 1,
    };
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
    return eventId;
  }

  /**
   * Publish a raw event (for forwarding core events).
   */
  async publishRaw(type: string, correlationId: string, payload: unknown): Promise<string> {
    const eventId = uuidv4();
    const event: DomainEvent = {
      eventId,
      type: type as any,
      payload,
      source: 'homeflow' as any,
      correlationId: correlationId as LoopId,
      timestamp: new Date().toISOString(),
      version: 1,
    };
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
    return eventId;
  }

  /**
   * Subscribe to a specific event type.
   */
  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Subscribe to multiple event types.
   */
  onMany(eventTypes: string[], handler: EventHandler): void {
    for (const et of eventTypes) {
      this.on(et, handler);
    }
  }

  private dispatch(event: DomainEvent): void {
    const handlers = this.handlers.get(event.type as string) ?? [];
    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch(err => console.error(`[homeflow:event-bus] Handler error for ${event.type}:`, err));
        }
      } catch (err) {
        console.error(`[homeflow:event-bus] Sync handler error for ${event.type}:`, err);
      }
    }

    // Also dispatch to wildcard handlers
    const wildcardHandlers = this.handlers.get('*') ?? [];
    for (const handler of wildcardHandlers) {
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
}
