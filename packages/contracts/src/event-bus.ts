/**
 * ══════════════════════════════════════════════════════════════════════════════
 * @extropy/contracts — Event Bus (Redis pub/sub)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { createClient } from 'redis';
import type { ExtropyEvent } from './types.js';

const CHANNEL = 'extropy:events';

export class EventBus {
  private publisher;
  private subscriber;

  constructor() {
    this.publisher = createClient({ url: process.env.REDIS_URL });
    this.subscriber = createClient({ url: process.env.REDIS_URL });
  }

  async connect(): Promise<void> {
    await this.publisher.connect();
    await this.subscriber.connect();
  }

  async publish(event: ExtropyEvent): Promise<void> {
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
  }

  async subscribe(
    handler: (event: ExtropyEvent) => Promise<void>
  ): Promise<void> {
    await this.subscriber.subscribe(CHANNEL, async (message) => {
      const event = JSON.parse(message) as ExtropyEvent;
      await handler(event);
    });
  }

  async disconnect(): Promise<void> {
    await this.publisher.disconnect();
    await this.subscriber.disconnect();
  }
}
