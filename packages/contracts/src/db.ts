/**
 * ══════════════════════════════════════════════════════════════════════════════
 * @extropy/contracts — Database Client
 * ══════════════════════════════════════════════════════════════════════════════
 */

import pg from 'pg';
const { Pool } = pg;

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export type { Pool };
