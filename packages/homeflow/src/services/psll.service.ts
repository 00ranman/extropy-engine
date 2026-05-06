/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow Family Pilot, Per User Signed Local Log (PSLL)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Implements the per user append only log from spec section 9.
 *  Each entry is signed in the browser with the user's Ed25519 key. The server
 *  verifies the signature against the user's stored public key, validates the
 *  hash chain, persists the entry, and periodically anchors a Merkle root to
 *  the DAG substrate.
 *
 *  Storage is one row per entry; integrity is enforced by the (user_id, seq)
 *  uniqueness and by prev_hash matching the previous entry's hash.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { publicKeyFromHex, verify } from '@extropy/identity/lib';
import type { DatabaseService } from './database.service.js';

export interface PSLLEntry {
  userId: string;
  seq: number;
  entry: unknown;
  signature: string;
  hash: string;
  prevHash: string;
  ts: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS hf_psll_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES hf_users(id) ON DELETE CASCADE,
  seq         BIGINT NOT NULL,
  entry_json  JSONB NOT NULL,
  signature   TEXT NOT NULL,
  hash        TEXT NOT NULL,
  prev_hash   TEXT NOT NULL,
  ts          BIGINT NOT NULL,
  UNIQUE(user_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_hf_psll_user_seq ON hf_psll_entries(user_id, seq);
`;

const GENESIS_PREV_HASH = '0'.repeat(64);

function rowToEntry(row: Record<string, unknown>): PSLLEntry {
  return {
    userId: row.user_id as string,
    seq: Number(row.seq),
    entry: row.entry_json,
    signature: row.signature as string,
    hash: row.hash as string,
    prevHash: row.prev_hash as string,
    ts: Number(row.ts),
  };
}

function computeEntryHash(payload: {
  userId: string;
  seq: number;
  entry: unknown;
  prevHash: string;
  ts: number;
}): string {
  const canonical = JSON.stringify({
    userId: payload.userId,
    seq: payload.seq,
    entry: payload.entry,
    prevHash: payload.prevHash,
    ts: payload.ts,
  });
  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

function buildSigningInput(payload: {
  entry: unknown;
  prevHash: string;
  seq: number;
  ts: number;
}): string {
  return JSON.stringify({
    entry: payload.entry,
    prevHash: payload.prevHash,
    seq: payload.seq,
    ts: payload.ts,
  });
}

export interface AppendInput {
  entry: unknown;
  signature: string;
  prevHash: string;
  seq: number;
  ts: number;
}

export interface AppendResult {
  ok: true;
  hash: string;
  seq: number;
}

export class PSLLService {
  constructor(private db: DatabaseService) {}

  async ensureSchema(): Promise<void> {
    await this.db.query(SCHEMA_SQL);
  }

  async getLastEntry(userId: string): Promise<PSLLEntry | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_psll_entries
       WHERE user_id = $1
       ORDER BY seq DESC
       LIMIT 1`,
      [userId],
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async listSince(userId: string, since: number, limit = 100): Promise<PSLLEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_psll_entries
       WHERE user_id = $1 AND seq > $2
       ORDER BY seq ASC
       LIMIT $3`,
      [userId, since, limit],
    );
    return rows.map(rowToEntry);
  }

  /**
   * Append a signed entry. The user's public key (raw Ed25519 hex) verifies the
   * signature over the canonical signing input. The chain integrity check
   * compares prev_hash with the user's last stored hash, or with the genesis
   * sentinel for the first entry.
   */
  async append(
    user: { id: string; publicKeyHex: string | null },
    input: AppendInput,
  ): Promise<AppendResult> {
    if (!user.publicKeyHex) {
      throw new PSLLError('user has no registered public key', 400);
    }
    if (!Number.isInteger(input.seq) || input.seq < 1) {
      throw new PSLLError('seq must be a positive integer', 400);
    }
    if (!/^[0-9a-f]{64}$/i.test(input.prevHash)) {
      throw new PSLLError('prevHash must be 64 hex chars', 400);
    }
    if (typeof input.ts !== 'number' || !Number.isFinite(input.ts)) {
      throw new PSLLError('ts must be a finite number', 400);
    }

    const last = await this.getLastEntry(user.id);
    const expectedSeq = last ? last.seq + 1 : 1;
    if (input.seq !== expectedSeq) {
      throw new PSLLError(
        `out of order seq: expected ${expectedSeq}, got ${input.seq}`,
        409,
      );
    }
    const expectedPrev = last ? last.hash : GENESIS_PREV_HASH;
    if (input.prevHash.toLowerCase() !== expectedPrev.toLowerCase()) {
      throw new PSLLError(
        `prevHash mismatch: chain integrity broken`,
        409,
      );
    }

    const signingInput = buildSigningInput({
      entry: input.entry,
      prevHash: input.prevHash,
      seq: input.seq,
      ts: input.ts,
    });

    let pubKey;
    try {
      pubKey = publicKeyFromHex(user.publicKeyHex);
    } catch (e) {
      throw new PSLLError(`invalid stored public key: ${(e as Error).message}`, 500);
    }

    if (!verify(pubKey, signingInput, input.signature)) {
      throw new PSLLError('signature verification failed', 401);
    }

    const hash = computeEntryHash({
      userId: user.id,
      seq: input.seq,
      entry: input.entry,
      prevHash: input.prevHash,
      ts: input.ts,
    });

    await this.db.query(
      `INSERT INTO hf_psll_entries (id, user_id, seq, entry_json, signature, hash, prev_hash, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        uuidv4(),
        user.id,
        input.seq,
        JSON.stringify(input.entry),
        input.signature,
        hash,
        input.prevHash,
        input.ts,
      ],
    );

    return { ok: true, hash, seq: input.seq };
  }

  /**
   * Compute the Merkle root of the user's PSLL entries up to (and including)
   * the given seq. Used by the periodic DAG anchor job.
   */
  async computeMerkleRoot(userId: string, throughSeq: number): Promise<string | null> {
    const { rows } = await this.db.query(
      `SELECT hash FROM hf_psll_entries
       WHERE user_id = $1 AND seq <= $2
       ORDER BY seq ASC`,
      [userId, throughSeq],
    );
    if (rows.length === 0) return null;
    let layer: Buffer[] = rows.map(
      (r: { hash: string }) => Buffer.from(r.hash, 'hex') as Buffer,
    );
    while (layer.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const a = layer[i];
        const b = i + 1 < layer.length ? layer[i + 1] : layer[i];
        next.push(
          createHash('sha256')
            .update(Buffer.concat([a, b]) as unknown as Buffer)
            .digest() as Buffer,
        );
      }
      layer = next;
    }
    return (layer[0] as Buffer).toString('hex');
  }
}

export class PSLLError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const __testing = {
  buildSigningInput,
  computeEntryHash,
  GENESIS_PREV_HASH,
};
