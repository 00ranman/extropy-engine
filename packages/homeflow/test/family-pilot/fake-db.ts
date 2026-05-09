/**
 * Tiny in process Postgres stand in for the family pilot tests.
 *
 * Implements only the SQL shapes used by UserService, PSLLService, and
 * GenesisAnchor. The DatabaseService surface is .query(text, params) which
 * returns { rows, rowCount }. We dispatch on a regex of the statement.
 *
 * The goal is high signal integration coverage of the family pilot routes
 * without spinning up a real Postgres in CI.
 */

interface Row { [k: string]: unknown }

export class FakeDb {
  users = new Map<string, Row>();              // by id
  usersByGoogle = new Map<string, string>();   // googleSub -> id
  usersByDid = new Map<string, string>();      // did -> id
  pslls: Row[] = [];                           // hf_psll_entries
  genesis = new Map<string, Row>();            // user_id -> row

  // Used as a constructor stand in for DatabaseService.
  pool = { end: async () => {} };

  async query(text: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    const t = text.trim();
    // CREATE TABLE / CREATE INDEX, no op
    if (/^CREATE\s+(TABLE|INDEX)/i.test(t)) return { rows: [], rowCount: 0 };
    if (/^SELECT 1$/i.test(t)) return { rows: [{ '?column?': 1 }], rowCount: 1 };

    // ── hf_users ────────────────────────────────────────────────────────
    if (/^INSERT INTO hf_users/i.test(t)) {
      const [id, google_sub, email, display_name, avatar_url, created_at] = params as [
        string, string, string, string, string | null, number,
      ];
      const row: Row = {
        id, google_sub, email, display_name, avatar_url,
        did: null, public_key_multibase: null, public_key_hex: null,
        vc_jwt: null, genesis_vertex_id: null, created_at, onboarded_at: null,
      };
      this.users.set(id, row);
      this.usersByGoogle.set(google_sub, id);
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE hf_users\s+SET email/i.test(t)) {
      const [google_sub, email, display_name, avatar_url] = params as [
        string, string, string, string | null,
      ];
      const id = this.usersByGoogle.get(google_sub);
      if (id) {
        const row = this.users.get(id)!;
        row.email = email;
        row.display_name = display_name;
        row.avatar_url = avatar_url;
      }
      return { rows: [], rowCount: id ? 1 : 0 };
    }
    if (/^UPDATE hf_users\s+SET did/i.test(t)) {
      const [userId, did, mb, pkh, vc, vid, ts] = params as [
        string, string, string, string, string, string, number,
      ];
      const row = this.users.get(userId);
      if (row) {
        row.did = did;
        row.public_key_multibase = mb;
        row.public_key_hex = pkh;
        row.vc_jwt = vc;
        row.genesis_vertex_id = vid;
        row.onboarded_at = ts;
        this.usersByDid.set(did, userId);
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT \* FROM hf_users WHERE google_sub/i.test(t)) {
      const id = this.usersByGoogle.get(params[0] as string);
      const row = id ? this.users.get(id) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT \* FROM hf_users WHERE id/i.test(t)) {
      const row = this.users.get(params[0] as string);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT \* FROM hf_users WHERE did/i.test(t)) {
      const id = this.usersByDid.get(params[0] as string);
      const row = id ? this.users.get(id) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    // ── hf_psll_entries ─────────────────────────────────────────────────
    if (/^INSERT INTO hf_psll_entries/i.test(t)) {
      const [id, user_id, seq, entry_json, signature, hash, prev_hash, ts] = params as [
        string, string, number, string, string, string, string, number,
      ];
      this.pslls.push({
        id, user_id, seq, entry_json: JSON.parse(entry_json),
        signature, hash, prev_hash, ts,
      });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM hf_psll_entries\s+WHERE user_id = \$1\s+ORDER BY seq DESC/i.test(t)) {
      const userId = params[0] as string;
      const rows = this.pslls
        .filter(r => r.user_id === userId)
        .sort((a, b) => Number(b.seq) - Number(a.seq))
        .slice(0, 1);
      return { rows, rowCount: rows.length };
    }
    if (/FROM hf_psll_entries\s+WHERE user_id = \$1 AND seq > \$2/i.test(t)) {
      const userId = params[0] as string;
      const since = Number(params[1]);
      const limit = Number(params[2]);
      const rows = this.pslls
        .filter(r => r.user_id === userId && Number(r.seq) > since)
        .sort((a, b) => Number(a.seq) - Number(b.seq))
        .slice(0, limit);
      return { rows, rowCount: rows.length };
    }
    if (/FROM hf_psll_entries\s+WHERE user_id = \$1 AND seq <= \$2/i.test(t)) {
      const userId = params[0] as string;
      const through = Number(params[1]);
      const rows = this.pslls
        .filter(r => r.user_id === userId && Number(r.seq) <= through)
        .sort((a, b) => Number(a.seq) - Number(b.seq));
      return { rows, rowCount: rows.length };
    }

    // ── hf_user_genesis ──────────────────────────────────────────────────
    if (/^INSERT INTO hf_user_genesis/i.test(t)) {
      const [user_id, vertex_id, did, vc_hash, ts] = params as [
        string, string, string, string, number,
      ];
      if (!this.genesis.has(user_id)) {
        this.genesis.set(user_id, { user_id, vertex_id, did, vc_hash, ts });
      }
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  async getClient() { throw new Error('not implemented'); }
  async close() {}
  async initialize() {}
}
