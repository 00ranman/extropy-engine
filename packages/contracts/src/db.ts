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
  const isProd = process.env.NODE_ENV === 'production';
  let connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    if (isProd) {
      throw new Error('DATABASE_URL must be set in production.');
    }
    // Dev-only fallback. The password here mirrors the .env.example placeholder;
    // it is NOT a usable secret. Set DATABASE_URL for any real database.
    console.warn('[db] DATABASE_URL not set, using local dev fallback. Do not use in production.');
    const devPassword = process.env.POSTGRES_PASSWORD || 'extropy_dev';
    connectionString = `postgresql://extropy:${devPassword}@localhost:5432/extropy_engine`;
  }
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
  const isProd = process.env.NODE_ENV === 'production';
  let url = process.env.REDIS_URL;
  if (!url) {
    if (isProd) {
      throw new Error('REDIS_URL must be set in production.');
    }
    console.warn('[db] REDIS_URL not set, using local dev fallback. Do not use in production.');
    const devPassword = process.env.REDIS_PASSWORD;
    url = devPassword ? `redis://:${devPassword}@localhost:6379` : 'redis://localhost:6379';
  }
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
