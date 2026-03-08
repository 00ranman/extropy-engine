// @ts-nocheck
/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Event Bus Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Redis pub/sub wrapper for inter-service event communication.
 *  Follows the same pattern as every other Extropy Engine service:
 *
 *    1. Publisher calls emit()  → event written to Redis + persisted to event_log
 *    2. Subscribers registered via on() receive events from Redis
 *    3. HTTP webhooks deliver events to downstream services' /events endpoints
 *
 *  Channel: `extropy:events` (shared across the entire ecosystem)
 *
 *  This service identifies itself as 'grantflow-proposer' and will ignore
 *  events it emitted itself to prevent processing loops.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import Redis from 'ioredis';
import { v4 as uuid } from 'uuid';
import { EventType } from '@extropy/contracts';
import type { DomainEvent, EventPayloadMap, LoopId } from '@extropy/contracts';
import type { DatabaseService } from './database.service.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_CHANNEL    = 'extropy:events';
const SERVICE_NAME     = 'grantflow-proposer';

// ─────────────────────────────────────────────────────────────────────────────
//  EventBusService
// ─────────────────────────────────────────────────────────────────────────────

export class EventBusService {
  /** Redis client used for publishing */
  private pub: Redis;

  /** Dedicated Redis subscriber client (cannot publish on same connection) */
  private sub: Redis;

  /** Per–event-type handler registry */
  private handlers: Map<string, Array<(event: DomainEvent) => Promise<void>>> = new Map();

  /** HTTP webhook registry: eventType → [url, ...] */
  private webhooks: Map<string, string[]> = new Map();

  /**
   * @param redisUrl - Redis connection URL (e.g. redis://localhost:6379)
   * @param db       - Optional DatabaseService for persisting events to event_log
   */
  constructor(
    private readonly redisUrl: string,
    private readonly db?: DatabaseService,
  ) {
    this.pub = new Redis(redisUrl, { lazyConnect: true });
    this.sub = new Redis(redisUrl, { lazyConnect: true });

    // Log Redis connection errors without crashing
    this.pub.on('error', (err) => console.error('[proposer:eventbus] Pub error:', err.message));
    this.sub.on('error', (err) => console.error('[proposer:eventbus] Sub error:', err.message));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Connect to Redis and begin listening on the shared event channel.
   * Must be called before emit() or on() can function.
   */
  async connect(): Promise<void> {
    await this.pub.connect();
    await this.sub.connect();

    await this.sub.subscribe(EVENT_CHANNEL);

    this.sub.on('message', async (_channel: string, message: string) => {
      try {
        const event: DomainEvent = JSON.parse(message);

        // Ignore events we emitted ourselves
        if (event.source === SERVICE_NAME) return;

        const typeHandlers = this.handlers.get(event.type) ?? [];
        for (const handler of typeHandlers) {
          try {
            await handler(event);
          } catch (err) {
            console.error(`[proposer:eventbus] Handler error for ${event.type}:`, err);
          }
        }
      } catch (err) {
        console.error('[proposer:eventbus] Failed to parse event:', err);
      }
    });

    console.log(`[proposer:eventbus] Connected to Redis — listening on ${EVENT_CHANNEL}`);
  }

  /**
   * Gracefully disconnect from Redis.
   * Should be called on SIGTERM / SIGINT.
   */
  async disconnect(): Promise<void> {
    await this.sub.unsubscribe(EVENT_CHANNEL);
    this.sub.disconnect();
    this.pub.disconnect();
    console.log('[proposer:eventbus] Disconnected from Redis');
  }

  // ── Publishing ─────────────────────────────────────────────────────────────

  /**
   * Emit a typed domain event.
   * Writes to the `event_log` table (if db is available) and publishes to Redis.
   * Also delivers via HTTP webhook to any registered endpoints.
   *
   * @param type          - The event type from the shared EventType catalog
   * @param correlationId - The Loop ID that ties related events together
   * @param payload       - The typed payload for this event type
   * @returns The constructed DomainEvent for downstream use
   */
  async emit<T extends EventType>(
    type: T,
    correlationId: LoopId,
    payload: EventPayloadMap[T],
  ): Promise<DomainEvent<T, EventPayloadMap[T]>> {
    const event: DomainEvent<T, EventPayloadMap[T]> = {
      eventId:       uuid(),
      type,
      payload,
      source:        SERVICE_NAME as DomainEvent['source'],
      correlationId,
      timestamp:     new Date().toISOString(),
      version:       1,
    };

    // Persist to event_log if database is available
    if (this.db) {
      try {
        await this.db.query(
          `INSERT INTO public.event_log
             (event_id, type, payload, source, correlation_id, version)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (event_id) DO NOTHING`,
          [
            event.eventId,
            event.type,
            JSON.stringify(event.payload),
            event.source,
            event.correlationId,
            event.version,
          ],
        );
      } catch (err) {
        console.error('[proposer:eventbus] Failed to persist event to log:', err);
      }
    }

    // Publish to Redis channel
    await this.pub.publish(EVENT_CHANNEL, JSON.stringify(event));

    // Deliver via HTTP webhooks
    const urls = this.webhooks.get(type) ?? [];
    for (const url of urls) {
      try {
        await fetch(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(event),
          signal:  AbortSignal.timeout(5_000),
        });
      } catch (err) {
        console.error(`[proposer:eventbus] Webhook delivery failed to ${url}:`, err);
      }
    }

    console.log(`[proposer:eventbus] Emitted ${type} (loop=${correlationId})`);
    return event;
  }

  // ── Subscribing ────────────────────────────────────────────────────────────

  /**
   * Register a handler for a specific event type.
   * Multiple handlers can be registered for the same type.
   *
   * @param type    - The EventType to listen for
   * @param handler - Async callback invoked with the full DomainEvent
   */
  on<T extends EventType>(
    type: T,
    handler: (event: DomainEvent<T, EventPayloadMap[T]>) => Promise<void>,
  ): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler as (event: DomainEvent) => Promise<void>);
    this.handlers.set(type, existing);
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /**
   * Register an HTTP webhook endpoint to receive events of a specific type.
   * Events will be POSTed as JSON to the URL within 5 seconds.
   *
   * @param type - The EventType to forward
   * @param url  - The destination HTTP endpoint
   */
  registerWebhook(type: EventType, url: string): void {
    const existing = this.webhooks.get(type) ?? [];
    existing.push(url);
    this.webhooks.set(type, existing);
    console.log(`[proposer:eventbus] Webhook registered: ${type} → ${url}`);
  }

  // ── Introspection ──────────────────────────────────────────────────────────

  /**
   * List all event types that have registered handlers.
   */
  listSubscribedTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
