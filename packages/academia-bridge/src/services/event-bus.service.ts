/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | EventBusService
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Redis pub/sub wrapper. Publishes and subscribes on the shared
 *  `extropy:events` channel. Follows the same pattern as all other
 *  Extropy Engine services.
 *
 *  Usage:
 *    const bus = new EventBusService(REDIS_URL);
 *    await bus.connect();
 *    bus.on(EventType.TASK_ASSIGNED, async (event) => { ... });
 *    await bus.emit(EventType.CLAIM_SUBMITTED, loopId, payload);
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import Redis from 'ioredis';
import { v4 as uuid } from 'uuid';
import { EventType } from '@extropy/contracts';
import type { DomainEvent } from '@extropy/contracts';

const EVENT_CHANNEL = 'extropy:events';
const SERVICE_NAME  = 'academia-bridge';

type EventHandler = (event: DomainEvent) => Promise<void>;

/**
 * Redis-backed event bus for academia-bridge.
 * Maintains separate publisher and subscriber connections (required by Redis).
 */
export class EventBusService {
  private pub: Redis;
  private sub: Redis;
  private handlers: Map<string, EventHandler[]> = new Map();
  private connected = false;

  /**
   * @param redisUrl - Redis connection URL, e.g. redis://localhost:6379
   */
  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl, { lazyConnect: true });
    this.sub = new Redis(redisUrl, { lazyConnect: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Connect both Redis clients and start listening for events.
   * Must be called before `on()` or `emit()`.
   */
  async connect(): Promise<void> {
    await this.pub.connect();
    await this.sub.connect();

    await this.sub.subscribe(EVENT_CHANNEL);

    this.sub.on('message', async (_channel: string, message: string) => {
      let event: DomainEvent;
      try {
        event = JSON.parse(message) as DomainEvent;
      } catch {
        console.error('[academia-bridge] Failed to parse event message:', message);
        return;
      }

      // Do not process events emitted by this service (avoid self-loops)
      if (event.source === SERVICE_NAME) return;

      const handlers = this.handlers.get(event.type) ?? [];
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (err) {
          console.error(`[academia-bridge] Error in handler for ${event.type}:`, err);
        }
      }
    });

    this.connected = true;
    console.log(`[academia-bridge] Event bus connected (channel: ${EVENT_CHANNEL})`);
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
  //  Pub/Sub
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register a handler for a specific event type.
   * Multiple handlers can be registered for the same event type.
   *
   * @param type    - EventType to listen for
   * @param handler - Async handler called for each matching event
   */
  on(type: EventType, handler: EventHandler): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler);
    this.handlers.set(type, existing);
  }

  /**
   * Publish a domain event to the shared event channel.
   *
   * @param type          - EventType to emit
   * @param correlationId - Loop ID or correlation ID for this event
   * @param payload       - Event-specific payload
   * @returns The emitted DomainEvent
   */
  async emit(
    type: EventType,
    correlationId: string,
    payload: Record<string, unknown>,
  ): Promise<DomainEvent> {
    const event: DomainEvent = {
      eventId: uuid(),
      type,
      payload,
      source: SERVICE_NAME as DomainEvent['source'],
      correlationId: correlationId as DomainEvent['correlationId'],
      timestamp: new Date().toISOString(),
      version: 1,
    };

    await this.pub.publish(EVENT_CHANNEL, JSON.stringify(event));
    console.log(`[academia-bridge] [event] ${type} (loop=${correlationId})`);
    return event;
  }

  /**
   * Check whether the event bus is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
