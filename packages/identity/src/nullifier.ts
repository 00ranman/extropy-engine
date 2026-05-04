/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity — Nullifier registry
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  A nullifier is the unforgeable, per-context handle a participant emits when
 *  they prove a credential. It enables anti-double-vote / anti-double-claim
 *  enforcement WITHOUT requiring the verifier to know the participant's DID.
 *
 *  Property we want from nullifiers:
 *
 *    1. Determinism: same (holder, contextTag) → same nullifier, always.
 *    2. Unforgeability: only the holder can produce the nullifier for their
 *       (holder, contextTag) pair.
 *    3. Per-context unlinkability: nullifiers from the same holder under
 *       different contextTags reveal nothing about each other to a verifier
 *       who only sees one of them.
 *
 *  This file is the *registry* side of the contract — verifiers register
 *  observed nullifiers and detect collisions. Production verifiers will store
 *  these in a per-DFAO database; the v3.1 sandbox uses in-memory.
 * ════════════════════════════════════════════════════════════════════════════════
 */

export interface NullifierRecord {
  nullifier: string;
  contextTag: string;
  /** What action this nullifier is bound to (e.g. "vote:proposal-42"). */
  action: string;
  /** ISO 8601 timestamp of first observation. */
  observedAt: string;
  /** Holder DID. Stored only because the proof carries it; verifiers may discard if they want stronger anonymity. */
  holderDid?: string;
}

export class NullifierRegistry {
  private byNullifier = new Map<string, NullifierRecord>();
  private byContext = new Map<string, Set<string>>();

  has(nullifier: string): boolean {
    return this.byNullifier.has(nullifier);
  }

  /**
   * Record a nullifier. Returns the existing record if a collision is
   * detected (i.e. this nullifier has already been used in this context),
   * or null if the registration is new.
   */
  record(rec: NullifierRecord): NullifierRecord | null {
    const existing = this.byNullifier.get(rec.nullifier);
    if (existing) return existing;
    this.byNullifier.set(rec.nullifier, rec);
    let bucket = this.byContext.get(rec.contextTag);
    if (!bucket) {
      bucket = new Set();
      this.byContext.set(rec.contextTag, bucket);
    }
    bucket.add(rec.nullifier);
    return null;
  }

  countForContext(contextTag: string): number {
    return this.byContext.get(contextTag)?.size ?? 0;
  }

  listForContext(contextTag: string): NullifierRecord[] {
    const set = this.byContext.get(contextTag);
    if (!set) return [];
    return Array.from(set)
      .map((n) => this.byNullifier.get(n)!)
      .filter(Boolean);
  }

  size(): number {
    return this.byNullifier.size;
  }

  clear(): void {
    this.byNullifier.clear();
    this.byContext.clear();
  }
}
