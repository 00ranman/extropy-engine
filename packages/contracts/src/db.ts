/**
 * ===============================================================================
 *  Shared Database Helpers -- Connection Pool + Query Utilities
 * ===============================================================================
 */

import { Pool } from 'pg';
import Redis from 'ioredis';

/**
 * Create a PostgreSQL connection pool from DATABASE_URL env var.
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL
    || 'postgresql://extropy:extropy_dev@localhost:5432/extropy_engine';
  const pool = new Pool({ connectionString, max: 10 });
  pool.on('error', (err) => {
    console.error('Unexpected PG pool error:', err);
  });
  return pool;
}

/**
 * Create a Redis client from REDIS_URL env var.
 */
export function createRedis(): Redis {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      return Math.min(times * 200, 2000);
    },
  });
  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });
  return redis;
}

/**
 * Wait for PostgreSQL to be ready (useful at service startup).
 */
export async function waitForPostgres(pool: Pool, maxRetries = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('PostgreSQL connected');
      return;
    } catch {
      console.log(`Waiting for PostgreSQL... (${i + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Failed to connect to PostgreSQL');
}

/**
 * Wait for Redis to be ready (useful at service startup).
 */
export async function waitForRedis(redis: Redis, maxRetries = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await redis.ping();
      console.log('Redis connected');
      return;
    } catch {
      console.log(`Waiting for Redis... (${i + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Failed to connect to Redis');
}
