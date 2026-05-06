/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow Family Pilot, User Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Stores Google OAuth profiles and the resulting Extropy DIDs for family
 *  members. The server never holds private key material; per spec section 3
 *  (Digital Autarky) the keypair stays in the browser.
 *
 *  Schema is created lazily by ensureSchema(). It is safe to call repeatedly.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './database.service.js';

export interface User {
  id: string;
  googleSub: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  did: string | null;
  publicKeyMultibase: string | null;
  publicKeyHex: string | null;
  vcJwt: string | null;
  genesisVertexId: string | null;
  createdAt: number;
  onboardedAt: number | null;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS hf_users (
  id                    TEXT PRIMARY KEY,
  google_sub            TEXT UNIQUE NOT NULL,
  email                 TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  avatar_url            TEXT,
  did                   TEXT UNIQUE,
  public_key_multibase  TEXT,
  public_key_hex        TEXT,
  vc_jwt                TEXT,
  genesis_vertex_id     TEXT,
  created_at            BIGINT NOT NULL,
  onboarded_at          BIGINT
);
CREATE INDEX IF NOT EXISTS idx_hf_users_google_sub ON hf_users(google_sub);
CREATE INDEX IF NOT EXISTS idx_hf_users_did        ON hf_users(did);
`;

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    googleSub: row.google_sub as string,
    email: row.email as string,
    displayName: row.display_name as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    did: (row.did as string | null) ?? null,
    publicKeyMultibase: (row.public_key_multibase as string | null) ?? null,
    publicKeyHex: (row.public_key_hex as string | null) ?? null,
    vcJwt: (row.vc_jwt as string | null) ?? null,
    genesisVertexId: (row.genesis_vertex_id as string | null) ?? null,
    createdAt: Number(row.created_at),
    onboardedAt: row.onboarded_at == null ? null : Number(row.onboarded_at),
  };
}

export class UserService {
  constructor(private db: DatabaseService) {}

  async ensureSchema(): Promise<void> {
    await this.db.query(SCHEMA_SQL);
  }

  async findByGoogleSub(googleSub: string): Promise<User | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM hf_users WHERE google_sub = $1',
      [googleSub],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM hf_users WHERE id = $1',
      [id],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findByDid(did: string): Promise<User | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM hf_users WHERE did = $1',
      [did],
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async upsertFromGoogle(profile: {
    googleSub: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  }): Promise<User> {
    const existing = await this.findByGoogleSub(profile.googleSub);
    if (existing) {
      await this.db.query(
        `UPDATE hf_users
         SET email = $2, display_name = $3, avatar_url = $4
         WHERE google_sub = $1`,
        [profile.googleSub, profile.email, profile.displayName, profile.avatarUrl ?? null],
      );
      return (await this.findByGoogleSub(profile.googleSub)) as User;
    }
    const id = uuidv4();
    const now = Date.now();
    await this.db.query(
      `INSERT INTO hf_users (id, google_sub, email, display_name, avatar_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, profile.googleSub, profile.email, profile.displayName, profile.avatarUrl ?? null, now],
    );
    return (await this.findById(id)) as User;
  }

  async setIdentity(
    userId: string,
    fields: {
      did: string;
      publicKeyMultibase: string;
      publicKeyHex: string;
      vcJwt: string;
      genesisVertexId: string;
    },
  ): Promise<User> {
    await this.db.query(
      `UPDATE hf_users
       SET did = $2, public_key_multibase = $3, public_key_hex = $4,
           vc_jwt = $5, genesis_vertex_id = $6, onboarded_at = $7
       WHERE id = $1`,
      [
        userId,
        fields.did,
        fields.publicKeyMultibase,
        fields.publicKeyHex,
        fields.vcJwt,
        fields.genesisVertexId,
        Date.now(),
      ],
    );
    return (await this.findById(userId)) as User;
  }
}
