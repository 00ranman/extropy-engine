/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — File-Backed Database Adapter
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Drop-in replacement for the Postgres-backed DatabaseService that persists
 *  the Family Pilot's working set (users, PSLL entries, genesis anchors) to
 *  a JSON file on disk. Activated when DATABASE_URL is unset or empty.
 *
 *  Per the Extropy spec the canonical truth lives on the user device: this
 *  server is a thin registry, so a JSON file is sufficient for the pilot.
 *  Postgres mode remains intact behind a runtime branch in index.ts and is
 *  the intended path for graduation.
 *
 *  Implementation note: the API surface that the rest of the homeflow
 *  package consumes is db.query(text, params) returning { rows, rowCount }.
 *  We dispatch on regexes for the SQL shapes the family pilot exercises.
 *  Unrecognized statements no-op with rowCount: 0; this means non-pilot
 *  routes (devices, households, claims, etc.) are inert in file-backed mode
 *  but the server still boots cleanly and the golden path works.
 *
 *  Atomicity: writes go to <path>.tmp.<pid>.<rand> then rename(2) into place.
 *  Reads are served from an in-memory cache loaded lazily on first query.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';

interface Row {
  [k: string]: unknown;
}

interface Snapshot {
  users: Row[];
  pslls: Row[];
  genesis: Row[];
}

const EMPTY_SNAPSHOT = (): Snapshot => ({ users: [], pslls: [], genesis: [] });

export interface FileBackedDbOptions {
  dataDir: string;
  /** Override file name. Defaults to homeflow.json. */
  fileName?: string;
}

export class FileBackedDb {
  private readonly filePath: string;
  private snapshot: Snapshot = EMPTY_SNAPSHOT();
  private loaded = false;
  // Serialize writes so concurrent appends don't race the rename.
  private writeChain: Promise<void> = Promise.resolve();

  // Stub kept for parity with DatabaseService consumers that may probe .pool.
  // Family pilot code never actually touches it.
  public pool = {
    end: async (): Promise<void> => {},
  };

  constructor(opts: FileBackedDbOptions) {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.filePath = path.join(opts.dataDir, opts.fileName ?? 'homeflow.json');
  }

  /**
   * Match the DatabaseService.initialize() contract — Postgres mode runs
   * the schema DDL here. For the file-backed adapter this is a load.
   */
  async initialize(): Promise<void> {
    this.load();
  }

  async getClient(): Promise<never> {
    throw new Error('FileBackedDb.getClient() not supported; use DATABASE_URL for Postgres mode');
  }

  async close(): Promise<void> {
    await this.writeChain;
  }

  /**
   * Public so tests can assert path resolution.
   */
  get path(): string {
    return this.filePath;
  }

  private load(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      this.snapshot = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        pslls: Array.isArray(parsed.pslls) ? parsed.pslls : [],
        genesis: Array.isArray(parsed.genesis) ? parsed.genesis : [],
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.snapshot = EMPTY_SNAPSHOT();
      } else {
        throw err;
      }
    }
    this.loaded = true;
  }

  /**
   * Atomic write: dump JSON to a sibling temp file, fsync, then rename(2)
   * over the target. rename is atomic on POSIX so a torn read is impossible.
   */
  private persist(): Promise<void> {
    const next = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
      const data = JSON.stringify(this.snapshot, null, 2);
      const fh = await fs.promises.open(tmp, 'w');
      try {
        await fh.writeFile(data, 'utf-8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fs.promises.rename(tmp, this.filePath);
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  // ── Query dispatch ──────────────────────────────────────────────────────

  async query(text: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (!this.loaded) this.load();

    const t = text.trim();

    // DDL — schemas are implicit for the JSON store.
    if (/^CREATE\s+(TABLE|INDEX)/i.test(t)) {
      return { rows: [], rowCount: 0 };
    }

    // Health-check probe.
    if (/^SELECT\s+1\s*$/i.test(t)) {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }

    // ── hf_users ──────────────────────────────────────────────────────────
    if (/^INSERT\s+INTO\s+hf_users/i.test(t)) {
      const [id, google_sub, email, display_name, avatar_url, created_at] = params as [
        string, string, string, string, string | null, number,
      ];
      const row: Row = {
        id, google_sub, email, display_name, avatar_url,
        did: null, public_key_multibase: null, public_key_hex: null,
        vc_jwt: null, genesis_vertex_id: null, created_at, onboarded_at: null,
      };
      this.snapshot.users.push(row);
      await this.persist();
      return { rows: [], rowCount: 1 };
    }

    if (/^UPDATE\s+hf_users\s+SET\s+email/i.test(t)) {
      const [google_sub, email, display_name, avatar_url] = params as [
        string, string, string, string | null,
      ];
      const row = this.snapshot.users.find(u => u.google_sub === google_sub);
      if (row) {
        row.email = email;
        row.display_name = display_name;
        row.avatar_url = avatar_url;
        await this.persist();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (/^UPDATE\s+hf_users\s+SET\s+did/i.test(t)) {
      const [userId, did, mb, pkh, vc, vid, ts] = params as [
        string, string, string, string, string, string, number,
      ];
      const row = this.snapshot.users.find(u => u.id === userId);
      if (row) {
        row.did = did;
        row.public_key_multibase = mb;
        row.public_key_hex = pkh;
        row.vc_jwt = vc;
        row.genesis_vertex_id = vid;
        row.onboarded_at = ts;
        await this.persist();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (/^SELECT\s+\*\s+FROM\s+hf_users\s+WHERE\s+google_sub/i.test(t)) {
      const row = this.snapshot.users.find(u => u.google_sub === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT\s+\*\s+FROM\s+hf_users\s+WHERE\s+id/i.test(t)) {
      const row = this.snapshot.users.find(u => u.id === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT\s+\*\s+FROM\s+hf_users\s+WHERE\s+did/i.test(t)) {
      const row = this.snapshot.users.find(u => u.did === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    // ── hf_psll_entries ──────────────────────────────────────────────────
    if (/^INSERT\s+INTO\s+hf_psll_entries/i.test(t)) {
      const [id, user_id, seq, entry_json, signature, hash, prev_hash, ts] = params as [
        string, string, number, string, string, string, string, number,
      ];
      this.snapshot.pslls.push({
        id, user_id, seq,
        entry_json: typeof entry_json === 'string' ? JSON.parse(entry_json) : entry_json,
        signature, hash, prev_hash, ts,
      });
      await this.persist();
      return { rows: [], rowCount: 1 };
    }
    if (/FROM\s+hf_psll_entries\s+WHERE\s+user_id\s*=\s*\$1\s+ORDER\s+BY\s+seq\s+DESC/i.test(t)) {
      const userId = params[0] as string;
      const rows = this.snapshot.pslls
        .filter(r => r.user_id === userId)
        .sort((a, b) => Number(b.seq) - Number(a.seq))
        .slice(0, 1);
      return { rows, rowCount: rows.length };
    }
    if (/FROM\s+hf_psll_entries\s+WHERE\s+user_id\s*=\s*\$1\s+AND\s+seq\s*>\s*\$2/i.test(t)) {
      const userId = params[0] as string;
      const since = Number(params[1]);
      const limit = Number(params[2]);
      const rows = this.snapshot.pslls
        .filter(r => r.user_id === userId && Number(r.seq) > since)
        .sort((a, b) => Number(a.seq) - Number(b.seq))
        .slice(0, limit);
      return { rows, rowCount: rows.length };
    }
    if (/FROM\s+hf_psll_entries\s+WHERE\s+user_id\s*=\s*\$1\s+AND\s+seq\s*<=\s*\$2/i.test(t)) {
      const userId = params[0] as string;
      const through = Number(params[1]);
      const rows = this.snapshot.pslls
        .filter(r => r.user_id === userId && Number(r.seq) <= through)
        .sort((a, b) => Number(a.seq) - Number(b.seq));
      return { rows, rowCount: rows.length };
    }

    // ── hf_user_genesis ──────────────────────────────────────────────────
    if (/^INSERT\s+INTO\s+hf_user_genesis/i.test(t)) {
      const [user_id, vertex_id, did, vc_hash, ts] = params as [
        string, string, string, string, number,
      ];
      const exists = this.snapshot.genesis.some(g => g.user_id === user_id);
      if (!exists) {
        this.snapshot.genesis.push({ user_id, vertex_id, did, vc_hash, ts });
        await this.persist();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // Unknown SQL: silently no-op for the family-pilot mode. Non-pilot
    // routes (devices, households, claims) read empty results and write
    // nothing. The server stays up; pilot golden path keeps working.
    return { rows: [], rowCount: 0 };
  }
}

/**
 * Resolve the on-disk data directory. Precedence:
 *   1. HOMEFLOW_DATA_DIR env var (explicit override)
 *   2. /var/lib/homeflow if it exists and is writable (deploy-managed)
 *   3. <cwd>/.data (dev fallback)
 */
export function resolveDataDir(): string {
  const explicit = process.env.HOMEFLOW_DATA_DIR;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  const systemDir = '/var/lib/homeflow';
  try {
    fs.accessSync(systemDir, fs.constants.W_OK);
    return systemDir;
  } catch {
    return path.join(process.cwd(), '.data');
  }
}
