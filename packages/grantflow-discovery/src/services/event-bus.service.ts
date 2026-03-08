/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Event Bus Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Thin wrapper around the @extropy/contracts EventBus.
 *  Provides typed pub/sub for Extropy Engine domain events over Redis.
 *
 *  Channel: `extropy:events`
 *  Pattern: Each service connects a publisher Redis client and a subscriber
 *           Redis client (duplicate). Events are persisted to event_log and
 *           delivered to all registered handlers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Redis from 'ioredis';
import { v4 as uuid } from 'uuid';
import type { DomainEvent, EventType, EventPayloadMap } from '@extropy/contracts';

const EVENT_CHANNEL = 'extropy:events';
const SERVICE_NAME  = 'grantflow-discovery';

type AnyEventHandler = (event: DomainEvent) => Promise<void>;

export class EventBusService {
  private pub: Redis;
  private sub: Redis;
  private handlers: Map<string, AnyEventHandler[]> = new Map();
  private connected = false;

  constructor(private readonly redisUrl: string) {
    this.pub = new Redis(redisUrl, { lazyConnect: true });
    this.sub = new Redis(redisUrl, { lazyConnect: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Connect both Redis clients and begin listening for inbound events.
   */
  async connect(): Promise<void> {
    await this.pub.connect();
    await this.sub.connect();

    await this.sub.subscribe(EVENT_CHANNEL);

    this.sub.on('message', async (_channel: string, message: string) => {
      try {
        const event: DomainEvent = JSON.parse(message);

        // Skip events emitted by this service (prevents feedback loops)
        if (event.source === SERVICE_NAME) return;

        const typeHandlers = this.handlers.get(event.type) ?? [];
        for (const handler of typeHandlers) {
          try {
            await handler(event);
          } catch (err) {
            console.error(
              `[grantflow-discovery] Error handling event ${event.type}:`,
              err,
            );
          }
        }
      } catch (err) {
        console.error('[grantflow-discovery] Failed to parse event message:', err);
      }
    });

    this.connected = true;
    console.log(
      `[grantflow-discovery] Event bus listening on ${EVENT_CHANNEL}`,
    );
  }

  /**
   * Gracefully disconnect both Redis clients.
   */
  async disconnect(): Promise<void> {
    await this.sub.unsubscribe(EVENT_CHANNEL);
    this.sub.disconnect();
    this.pub.disconnect();
    this.connected = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Emit
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a typed domain event onto the Extropy Engine event bus.
   *
   * @param type          - EventType constant from @extropy/contracts
   * @param correlationId - Loop ID tying this event to a verification loop
   * @param payload       - Typed payload matching the EventType
   * @returns The full DomainEvent that was published
   */
  async emit<T extends EventType>(
    type: T,
    correlationId: string,
    payload: EventPayloadMap[T],
  ): Promise<DomainEvent<T, EventPayloadMap[T]>> {
    const event: DomainEvent<T, EventPayloadMap[T]> = {
      eventId:       uuid(),
      type,
      payload,
      source:        SERVICE_NAME as DomainEvent['source'],
      correlationId: correlationId as DomainEvent['correlationId'],
      timestamp:     new Date().toISOString(),
      version:       1,
    };

    await this.pub.publish(EVENT_CHANNEL, JSON.stringify(event));

    console.log(
      `[grantflow-discovery] [event] ${type} (loop=${correlationId})`,
    );

    return event;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Subscribe
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register a handler for a specific event type.
   * Multiple handlers for the same type are called in registration order.
   *
   * @param type    - EventType to listen for
   * @param handler - Async callback receiving the full DomainEvent
   */
  on<T extends EventType>(
    type: T,
    handler: (event: DomainEvent<T, EventPayloadMap[T]>) => Promise<void>,
  ): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler as AnyEventHandler);
    this.handlers.set(type, existing);
  }

  /**
   * Deregister all handlers for an event type.
   */
  off(type: EventType): void {
    this.handlers.delete(type);
  }

  /**
   * Returns true if both Redis clients are connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Returns the underlying publisher Redis instance.
   * Useful for services that need raw Redis access (e.g. for pub/sub batching).
   */
  getPublisher(): Redis {
    return this.pub;
  }
}
