/**
 * End-to-end test for the file-backed DB adapter.
 *
 * Exercises the same SQL surface that the family-pilot golden path uses:
 *   1. Schema DDL is a no-op (no Postgres needed)
 *   2. Insert + read a user row by id, google_sub, did
 *   3. Update a user with did/keys (the setIdentity path)
 *   4. Insert a hf_user_genesis anchor row (idempotent)
 *   5. Append PSLL entries through PSLLService and read them back
 *   6. Persistence: a fresh FileBackedDb instance pointing at the same path
 *      sees the previously written data
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileBackedDb } from '../../src/services/file-db.service.js';
import { UserService } from '../../src/services/user.service.js';
import { PSLLService } from '../../src/services/psll.service.js';
import {
  generateIdentityKeyPair,
  sign,
} from '@extropy/identity/lib';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'homeflow-filedb-'));
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

describe('FileBackedDb', () => {
  it('handles the family pilot golden path end to end', async () => {
    const dir = tmpDir();
    const db = new FileBackedDb({ dataDir: dir });
    await db.initialize();

    // DDL no-ops cleanly.
    expect(await db.query('CREATE TABLE foo (id TEXT)')).toEqual({ rows: [], rowCount: 0 });
    expect((await db.query('SELECT 1')).rows).toEqual([{ '?column?': 1 }]);

    // Register a user.
    const userService = new UserService(db as never);
    await userService.ensureSchema();
    const user = await userService.upsertFromGoogle({
      googleSub: 'google-sub-001',
      email: 'pilot@example.com',
      displayName: 'Pilot User',
    });
    expect(user.googleSub).toBe('google-sub-001');

    // Lookups by all three indexes.
    expect((await userService.findByGoogleSub('google-sub-001'))?.id).toBe(user.id);
    expect((await userService.findById(user.id))?.email).toBe('pilot@example.com');
    expect(await userService.findByDid('did:extropy:nope')).toBeNull();

    // Bind a DID + public key to the user.
    const keyPair = generateIdentityKeyPair();
    const publicKeyHex = keyPair.publicKeyHex;
    const did = `did:extropy:${publicKeyHex}`;
    const updated = await userService.setIdentity(user.id, {
      did,
      publicKeyMultibase: 'z' + publicKeyHex.slice(0, 12),
      publicKeyHex,
      vcJwt: 'eyJ.fake.jwt',
      genesisVertexId: 'vertex-001',
    });
    expect(updated.did).toBe(did);
    expect(updated.publicKeyHex).toBe(publicKeyHex);
    expect((await userService.findByDid(did))?.id).toBe(user.id);

    // Genesis anchor: insert is idempotent on repeat.
    await db.query(
      `INSERT INTO hf_user_genesis (user_id, vertex_id, did, vc_hash, ts)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, 'vertex-001', did, 'abc123', Date.now()],
    );
    await db.query(
      `INSERT INTO hf_user_genesis (user_id, vertex_id, did, vc_hash, ts)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, 'vertex-002-different', did, 'abc123', Date.now()],
    );

    // Append a real PSLL entry signed with the user's key.
    const psllService = new PSLLService(db as never);
    await psllService.ensureSchema();
    const ts = Date.now();
    const entry = { kind: 'test', value: 42 };
    const prevHash = '0'.repeat(64);
    const signingInput = buildSigningInput({ entry, prevHash, seq: 1, ts });
    const signature = sign(keyPair.privateKey, signingInput);
    const result = await psllService.append(
      { id: user.id, publicKeyHex },
      { entry, signature, prevHash, seq: 1, ts },
    );
    expect(result.ok).toBe(true);
    expect(result.seq).toBe(1);

    const last = await psllService.getLastEntry(user.id);
    expect(last).not.toBeNull();
    expect(last!.seq).toBe(1);
    expect(last!.hash).toBe(result.hash);
    expect(last!.entry).toEqual(entry);

    const since = await psllService.listSince(user.id, 0, 10);
    expect(since.length).toBe(1);

    const merkleRoot = await psllService.computeMerkleRoot(user.id, 1);
    // Single-entry root equals the entry hash.
    expect(merkleRoot).toBe(result.hash);

    // Persistence round-trip: reopen against the same data dir.
    await db.close();
    const reopened = new FileBackedDb({ dataDir: dir });
    await reopened.initialize();
    const reopenedUserService = new UserService(reopened as never);
    const reFound = await reopenedUserService.findById(user.id);
    expect(reFound?.did).toBe(did);
    const reopenedPsll = new PSLLService(reopened as never);
    const reLast = await reopenedPsll.getLastEntry(user.id);
    expect(reLast?.hash).toBe(result.hash);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes are atomic (rename over tmp file)', async () => {
    const dir = tmpDir();
    const db = new FileBackedDb({ dataDir: dir });
    await db.initialize();
    await db.query(
      `INSERT INTO hf_users (id, google_sub, email, display_name, avatar_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['u1', 'g1', 'a@b.c', 'A', null, Date.now()],
    );
    const raw = fs.readFileSync(db.path, 'utf-8');
    // Must be valid JSON, not a partial write.
    const parsed = JSON.parse(raw);
    expect(parsed.users).toHaveLength(1);
    expect(parsed.users[0].id).toBe('u1');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('unknown SQL no-ops with rowCount 0 instead of throwing', async () => {
    const dir = tmpDir();
    const db = new FileBackedDb({ dataDir: dir });
    await db.initialize();
    const r1 = await db.query('SELECT * FROM hf_devices WHERE household_id = $1', ['h1']);
    expect(r1).toEqual({ rows: [], rowCount: 0 });
    const r2 = await db.query('UPDATE hf_zones SET name = $1 WHERE id = $2', ['x', 'z1']);
    expect(r2.rowCount).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
