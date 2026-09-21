/**
 * HomeFlow user service — node DID identity.
 *
 * Stores Extropy DIDs for household members. The server never holds private
 * key material. Google OAuth / google_sub are gone; DID is the identity key.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './database.service.js';

export interface User {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  did: string;
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
  email                 TEXT,
  display_name          TEXT NOT NULL,
  avatar_url            TEXT,
  did                   TEXT UNIQUE NOT NULL,
  public_key_multibase  TEXT,
  public_key_hex        TEXT,
  vc_jwt                TEXT,
  genesis_vertex_id     TEXT,
  created_at            BIGINT NOT NULL,
  onboarded_at          BIGINT
);
CREATE INDEX IF NOT EXISTS idx_hf_users_did ON hf_users(did);

-- Scrub legacy Google Auth column if an older schema left it behind.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hf_users' AND column_name = 'google_sub'
  ) THEN
    ALTER TABLE hf_users ALTER COLUMN google_sub DROP NOT NULL;
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;
`;

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: (row.email as string | null) ?? null,
    displayName: row.display_name as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    did: row.did as string,
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

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query('SELECT * FROM hf_users WHERE id = $1', [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findByDid(did: string): Promise<User | null> {
    const { rows } = await this.db.query('SELECT * FROM hf_users WHERE did = $1', [did]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async upsertFromDid(profile: {
    did: string;
    displayName: string;
    email?: string | null;
  }): Promise<User> {
    const existing = await this.findByDid(profile.did);
    if (existing) {
      await this.db.query(
        `UPDATE hf_users SET display_name = $2, email = COALESCE($3, email) WHERE did = $1`,
        [profile.did, profile.displayName, profile.email ?? null],
      );
      return (await this.findByDid(profile.did)) as User;
    }
    const id = uuidv4();
    const now = Date.now();
    await this.db.query(
      `INSERT INTO hf_users (id, email, display_name, did, created_at, onboarded_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, profile.email ?? null, profile.displayName, profile.did, now],
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
