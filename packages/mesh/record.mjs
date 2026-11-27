/**
 * Public record export.
 *
 * Envelope A only: class, entropy-reduction proxy, state, hashes.
 * Task text, evidence bytes, reasons, and actor ids stay off the strip.
 * Those belong to envelope C (sealed) or to the local dag, not the public feed.
 *
 * Contested confirmations are not implemented. A CONFIRM here is the happy
 * path. There is no contest vertex and no standing adjustment yet.
 */
import { createHash } from "node:crypto";

export const RECORD_SCHEMA = "extropy.record.v1";
export const AD_CHECK_CLASS = "ad-check";

export const RECORD_NOTE =
  "Public class strips only (envelope A): class, entropy-reduction proxy, state, hashes. Envelope C is not in this file. Contested confirmations are not finished. A receipt is the happy path, not a finished adversarial close. Ad-check loops mint 0 for the poster. The verifier cannot be the poster or a party to the post.";

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function normalizeClass(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) || s.length > 64) {
    const err = new Error("class must be a short slug");
    err.status = 400;
    throw err;
  }
  return s;
}

/** Missing stays null. Zero is a real measurement only when the caller passed 0. */
export function normalizeDeltaS(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) {
    const err = new Error("delta_s must be a finite number or omitted");
    err.status = 400;
    throw err;
  }
  return n;
}

export function normalizeParties(value) {
  if (value == null || value === "") return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  const out = [];
  for (const raw of list) {
    const id = String(raw).trim();
    if (!id) continue;
    if (/\s/.test(id) || id.length > 200) {
      const err = new Error("party id must be one id with no spaces");
      err.status = 400;
      throw err;
    }
    out.push(id);
  }
  return [...new Set(out)];
}

export function normalizeOk(value) {
  return value === true;
}

export function readOpenFields(body) {
  const src = body && typeof body === "object" ? body : {};
  return {
    class: normalizeClass(src.class),
    deltaS: normalizeDeltaS(src.deltaS ?? src.delta_s),
    okToFeature: normalizeOk(src.okToFeature ?? src.ok_to_feature),
    parties: normalizeParties(src.parties),
  };
}

export function posterMint(loopClass) {
  if (loopClass === AD_CHECK_CLASS) return 0;
  return null;
}

export function partiesOf(openVertex) {
  const extra = Array.isArray(openVertex?.parties) ? openVertex.parties : [];
  return [...new Set([openVertex?.actor, ...extra].filter(Boolean))];
}

export function adCheckDoneError(openVertex, verifierId) {
  if (!openVertex || openVertex.class !== AD_CHECK_CLASS) return null;
  if (partiesOf(openVertex).includes(verifierId)) {
    return "ad-check verifier cannot be the poster or a party to the post";
  }
  return null;
}

export function adCheckConfirmError(openVertex, confirmerId) {
  if (!openVertex || openVertex.class !== AD_CHECK_CLASS) return null;
  if (confirmerId !== openVertex.actor) {
    return "ad-check confirm is the poster's signature";
  }
  return null;
}

function evidenceHash(vertex) {
  if (!vertex || typeof vertex.evidence !== "string" || vertex.evidence === "") return null;
  return sha256(vertex.evidence);
}

function featureConsent(vertices) {
  const needed = vertices.filter((v) => v && (v.state === "OPEN" || v.state === "DONE" || v.state === "CONFIRM"));
  if (needed.length === 0) return false;
  return needed.every((v) => v.okToFeature === true);
}

/**
 * Settled means a CONFIRM vertex exists. A later BURN stays on the record
 * with state BURN. OPEN or DONE alone is not settled and is left out.
 */
export function exportRecord(dag, updatedAt = new Date().toISOString()) {
  const byLoop = new Map();
  for (const vertex of dag || []) {
    if (!vertex?.loopId) continue;
    if (!byLoop.has(vertex.loopId)) byLoop.set(vertex.loopId, []);
    byLoop.get(vertex.loopId).push(vertex);
  }

  const loops = [];
  for (const [loopId, vertices] of byLoop) {
    const open = vertices.find((v) => v.state === "OPEN") || null;
    const done = vertices.find((v) => v.state === "DONE") || null;
    const confirm = vertices.find((v) => v.state === "CONFIRM") || null;
    const burn = vertices.find((v) => v.state === "BURN") || null;
    if (!confirm?.hash) continue;
    const loopClass = open?.class ?? confirm.class ?? null;
    const delta = open?.deltaS ?? confirm.deltaS ?? null;
    loops.push({
      id: confirm.hash,
      loop_id: loopId,
      class: loopClass,
      delta_s: Number.isFinite(delta) ? delta : null,
      state: burn ? "BURN" : "CONFIRM",
      hashes: {
        open: open?.hash ?? null,
        done: done?.hash ?? null,
        confirm: confirm.hash,
        burn: burn?.hash ?? null,
        parents: Array.isArray(confirm.parents) ? confirm.parents : [],
        evidence: evidenceHash(open) || evidenceHash(done) || evidenceHash(confirm),
      },
      poster_mint: posterMint(loopClass),
      ok_to_feature: featureConsent(vertices),
    });
  }

  return {
    schema: RECORD_SCHEMA,
    updated_at: updatedAt,
    note: RECORD_NOTE,
    loops,
  };
}

const STRIP_KEYS = new Set([
  "id",
  "loop_id",
  "class",
  "delta_s",
  "state",
  "hashes",
  "poster_mint",
  "ok_to_feature",
]);

export function stripHasEnvelopeC(loop) {
  const banned = ["task", "evidence", "why", "actor", "signature", "ts", "parties", "node_id", "town"];
  const blob = JSON.stringify(loop);
  if (banned.some((key) => Object.prototype.hasOwnProperty.call(loop, key))) return true;
  for (const key of Object.keys(loop)) {
    if (!STRIP_KEYS.has(key)) return true;
  }
  return blob.includes('"task"') || blob.includes('"why"');
}
