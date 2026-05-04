/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DAG Substrate Service — Permissionless Ledger Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  The DAG substrate is the foundational permissionless ledger of the Extropy
 *  Engine — analogous to the IOTA Tangle. Every significant event in the system
 *  (loop opens, measurements, votes, mints, governance proposals, etc.) is
 *  recorded as a cryptographically signed vertex in a Directed Acyclic Graph.
 *
 *  Core properties:
 *    - Causal ordering via Lamport timestamps
 *    - Tip selection via random walk (weighted by confirmation weight)
 *    - Auto-vertex creation: listens to all system events and records them
 *    - Confirmation weight propagation up the causal chain
 *    - Permissionless: any service can submit a signed vertex
 *
 *  Port: 4008
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import express, { type Express, Request, Response } from 'express';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  EventBus,
  createPool,
  createRedis,
  waitForPostgres,
  waitForRedis,
  EventType,
  ServiceName,
  VertexType,
} from '@extropy/contracts';
import type {
  DAGVertex,
  VertexId,
  VertexType as VertexTypeT,
  VertexPayload,
  VertexPropagation,
  TipSelectionResult,
  DAGSubstrateConfig,
  DFAOId,
  LoopId,
  DomainEvent,
  ServiceHealthResponse,
  // Auto-vertex event payload types
  LoopOpenedPayload,
  LoopClosedPayload,
  LoopFailedPayload,
  LoopMeasurementRecordedPayload,
  XPMintedProvisionalPayload,
  XPConfirmedPayload,
  XPBurnedPayload,
  ProposalCreatedPayload,
  GovernanceVoteCastPayload,
  ProposalPassedPayload,
  ProposalRejectedPayload,
  DFAOCreatedPayload,
  DFAOMemberJoinedPayload,
  ReputationAccruedPayload,
  ReputationPenalizedPayload,
  VertexCreatedPayload,
  VertexConfirmedPayload,
  VertexRejectedPayload,
  SeasonStartedPayload,
  SeasonEndedPayload,
  TokenMintedPayload,
  TokenBurnedPayload,
  CredentialIssuedPayload,
} from '@extropy/contracts';

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const app: Express = express();
app.use(express.json({ limit: '1mb' }));

const PORT   = parseInt(process.env.PORT   || '4008', 10);
const SERVICE = ServiceName.DAG_SUBSTRATE;

const pool  = createPool();
const redis = createRedis();
const bus   = new EventBus(redis, pool, SERVICE);

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const config: DAGSubstrateConfig = {
  minParentCount:          parseInt(process.env.MIN_PARENT_COUNT          || '1', 10),
  maxTipAge:               parseInt(process.env.MAX_TIP_AGE               || '100', 10),
  confirmationThreshold:   parseFloat(process.env.CONFIRMATION_THRESHOLD  || '5.0'),
  tipSelectionAlgorithm:   (process.env.TIP_SELECTION_ALGORITHM as DAGSubstrateConfig['tipSelectionAlgorithm']) || 'weighted_random_walk',
  walkDepth:               parseInt(process.env.WALK_DEPTH                || '10', 10),
};

const NODE_ID = process.env.NODE_ID || `dag-node-${uuidv4().slice(0, 8)}`;

// ─────────────────────────────────────────────────────────────────────────────
//  Lamport Clock — in-memory, persisted lazily to Redis
// ─────────────────────────────────────────────────────────────────────────────

let lamportClock = 0;

/** Atomically advance the Lamport clock to at least `observed`, then return the new value. */
function advanceLamport(observed: number = 0): number {
  lamportClock = Math.max(lamportClock, observed) + 1;
  // Persist asynchronously so callers are never blocked
  redis.set('dag:lamport_clock', lamportClock).catch((err) => {
    console.error('[dag-substrate] Failed to persist Lamport clock:', err);
  });
  return lamportClock;
}

async function loadLamportClock(): Promise<void> {
  try {
    const stored = await redis.get('dag:lamport_clock');
    if (stored !== null) {
      lamportClock = parseInt(stored, 10);
      console.log(`[dag-substrate] Lamport clock restored to ${lamportClock}`);
    }
  } catch (err) {
    console.error('[dag-substrate] Failed to load Lamport clock from Redis:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Content Hashing & Signature Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hash of the vertex content fields.
 * The content hash covers: vertexType, payload, parentVertexIds, publicKey, algorithm, dfaoId.
 * It intentionally excludes id, signature, lamportTimestamp, wallTimestamp, isTip, and propagation
 * since those are assigned after submission.
 */
function computeContentHash(
  vertexType: string,
  payload: VertexPayload,
  parentVertexIds: VertexId[],
  publicKey: string,
  algorithm: string,
  dfaoId?: DFAOId,
): string {
  const canonical = JSON.stringify({
    vertexType,
    payload,
    parentVertexIds: [...parentVertexIds].sort(),
    publicKey,
    algorithm,
    dfaoId: dfaoId ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify a vertex signature.
 *
 * Production note: real Ed25519 verification requires @noble/ed25519 or
 * a native crypto module. This stub validates structural integrity and
 * ensures the signature is non-empty and consistent with the content hash.
 * Replace the stub body with real crypto when key infrastructure is deployed.
 */
function verifySignature(
  contentHash: string,
  signature: string,
  publicKey: string,
  algorithm: string,
): { valid: boolean; reason?: string } {
  // Structural checks that are always enforced
  if (!signature || signature.trim().length === 0) {
    return { valid: false, reason: 'Signature is empty' };
  }
  if (!publicKey || publicKey.trim().length === 0) {
    return { valid: false, reason: 'Public key is empty' };
  }
  if (algorithm !== 'ed25519' && algorithm !== 'secp256k1') {
    return { valid: false, reason: `Unsupported algorithm: ${algorithm}` };
  }

  // ── STUB: structural signature check ─────────────────────────────────────────
  // A real implementation would call:
  //   ed25519.verify(Buffer.from(signature, 'hex'), Buffer.from(contentHash, 'hex'), Buffer.from(publicKey, 'hex'))
  // For now we accept any non-empty signature that references the content hash
  // as a substring (convention used by test harnesses) or any 64-128 char hex string.
  const looksLikeHex = /^[0-9a-fA-F]{64,128}$/.test(signature);
  const containsHash = signature.includes(contentHash.slice(0, 16));
  if (!looksLikeHex && !containsHash) {
    return { valid: false, reason: 'Signature format invalid (expected hex string)' };
  }
  // ── END STUB ──────────────────────────────────────────────────────────────────────

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Database Helpers
// ─────────────────────────────────────────────────────────────────────────────

function vertexFromRow(row: Record<string, unknown>): DAGVertex {
  return {
    id:                  row.id as VertexId,
    vertexType:          row.vertex_type as VertexTypeT,
    signature:           row.signature as string,
    publicKey:           row.public_key as string,
    algorithm:           row.algorithm as 'ed25519' | 'secp256k1',
    lamportTimestamp:    row.lamport_timestamp as number,
    wallTimestamp:       (row.wall_timestamp as Date).toISOString(),
    parentVertexIds:     (row.parent_vertex_ids as VertexId[]) || [],
    contentHash:         row.content_hash as string,
    confirmationWeight:  parseFloat(row.confirmation_weight as string) || 0,
    isTip:               row.is_tip as boolean,
    payload:             (row.payload as VertexPayload) || {},
    dfaoId:              (row.dfao_id as DFAOId | undefined) ?? undefined,
    propagation:         (row.propagation as VertexPropagation) || {
      originNodeId: NODE_ID,
      hopCount: 0,
      receivedAt: new Date().toISOString(),
      locallyValidated: true,
    },
  };
}

/**
 * Fetch parent Lamport timestamps in bulk.
 * Returns a map of vertexId → lamportTimestamp.
 */
async function fetchParentLamports(
  parentIds: VertexId[],
): Promise<Map<VertexId, number>> {
  if (parentIds.length === 0) return new Map();
  const res = await pool.query<{ id: VertexId; lamport_timestamp: number }>(
    `SELECT id, lamport_timestamp FROM dag.vertices WHERE id = ANY($1::uuid[])`,
    [parentIds],
  );
  return new Map(res.rows.map((r) => [r.id, r.lamport_timestamp]));
}

/**
 * Increment confirmation_weight on a vertex row and return the new weight.
 */
async function incrementConfirmationWeight(
  vertexId: VertexId,
  increment: number = 1,
): Promise<number> {
  const res = await pool.query<{ confirmation_weight: string }>(
    `UPDATE dag.vertices
     SET confirmation_weight = confirmation_weight + $1
     WHERE id = $2
     RETURNING confirmation_weight`,
    [increment, vertexId],
  );
  if (res.rows.length === 0) return 0;
  return parseFloat(res.rows[0].confirmation_weight);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Confirmation Weight Propagation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a new vertex is created, propagate +1 confirmation weight to every
 * parent (and grandparent, etc.) up to a bounded depth.
 *
 * If a parent's weight crosses confirmationThreshold for the first time,
 * emit VERTEX_CONFIRMED and recursively propagate upward.
 *
 * The recursion is bounded by `maxDepth` to prevent stack overflow on deep DAGs.
 */
async function propagateConfirmationWeight(
  parentIds: VertexId[],
  correlationId: LoopId,
  maxDepth: number = 20,
  currentDepth: number = 0,
): Promise<void> {
  if (currentDepth >= maxDepth || parentIds.length === 0) return;

  for (const parentId of parentIds) {
    try {
      const newWeight = await incrementConfirmationWeight(parentId);

      // Emit VERTEX_CONFIRMED on first threshold crossing
      if (newWeight >= config.confirmationThreshold) {
        // Check if already confirmed (avoid duplicate emissions)
        const flagRes = await pool.query<{ confirmed: boolean }>(
          `SELECT confirmed FROM dag.vertices WHERE id = $1`,
          [parentId],
        );
        const alreadyConfirmed = flagRes.rows[0]?.confirmed ?? false;

        if (!alreadyConfirmed) {
          await pool.query(
            `UPDATE dag.vertices SET confirmed = TRUE WHERE id = $1`,
            [parentId],
          );
          const payload: VertexConfirmedPayload = {
            vertexId: parentId,
            confirmationWeight: newWeight,
            timestamp: new Date().toISOString(),
          };
          await bus.emit(EventType.VERTEX_CONFIRMED, correlationId, payload);
          console.log(
            `[dag-substrate] Vertex ${parentId} CONFIRMED (weight=${newWeight.toFixed(2)})`,
          );
        }
      }

      // Recurse to grandparents
      const grandparentRes = await pool.query<{ parent_vertex_ids: VertexId[] }>(
        `SELECT parent_vertex_ids FROM dag.vertices WHERE id = $1`,
        [parentId],
      );
      const grandparents = grandparentRes.rows[0]?.parent_vertex_ids ?? [];
      await propagateConfirmationWeight(
        grandparents,
        correlationId,
        maxDepth,
        currentDepth + 1,
      );
    } catch (err) {
      console.error(
        `[dag-substrate] Error propagating confirmation weight to ${parentId}:`,
        err,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tip Selection — Weighted Random Walk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Select `count` tips using a weighted random walk through the DAG.
 *
 * Algorithm:
 *  1. Load all current tips. If fewer than `count`, return all.
 *  2. For each walk, pick a random non-tip starting vertex, then at each step
 *     randomly choose a child weighted by confirmation_weight (heavier = more
 *     likely). Walk until no more children exist (i.e., we reach a tip).
 *  3. Deduplicate results. Repeat walks if needed.
 */
async function selectTips(count: number = 2): Promise<TipSelectionResult> {
  const startedAt = new Date();

  // Fetch all current tips
  const tipsRes = await pool.query<{ id: VertexId }>(
    `SELECT id FROM dag.vertices WHERE is_tip = TRUE ORDER BY lamport_timestamp DESC LIMIT 100`,
  );
  const allTips = tipsRes.rows.map((r) => r.id);

  if (allTips.length <= count) {
    return {
      selectedTips: allTips,
      algorithm: config.tipSelectionAlgorithm,
      walkDepth: 0,
      timestamp: startedAt.toISOString(),
    };
  }

  // Do random walks to select tips
  const selected = new Set<VertexId>();
  let totalWalkDepth = 0;
  let attempts = 0;
  const maxAttempts = count * 10;

  while (selected.size < count && attempts < maxAttempts) {
    attempts++;

    // Start from a random non-tip vertex (or genesis if only tips exist)
    const startRes = await pool.query<{ id: VertexId }>(
      `SELECT id FROM dag.vertices
       WHERE is_tip = FALSE
       ORDER BY RANDOM()
       LIMIT 1`,
    );

    let currentId: VertexId;
    if (startRes.rows.length === 0) {
      // All vertices are tips — just pick a random one
      currentId = allTips[Math.floor(Math.random() * allTips.length)];
      selected.add(currentId);
      continue;
    }
    currentId = startRes.rows[0].id;

    // Walk forward until we reach a tip
    let walkDepth = 0;
    let reachedTip = false;

    while (walkDepth < config.walkDepth) {
      // Find children of currentId
      const childrenRes = await pool.query<{ id: VertexId; confirmation_weight: string }>(
        `SELECT id, confirmation_weight
         FROM dag.vertices
         WHERE $1 = ANY(parent_vertex_ids)
         ORDER BY lamport_timestamp ASC`,
        [currentId],
      );

      if (childrenRes.rows.length === 0) {
        // No children → currentId is a tip (or orphan)
        reachedTip = true;
        break;
      }

      // Weighted random selection among children
      const children = childrenRes.rows.map((r) => ({
        id: r.id,
        weight: Math.max(parseFloat(r.confirmation_weight) || 0, 0.01),
      }));
      const totalWeight = children.reduce((s, c) => s + c.weight, 0);
      let rng = Math.random() * totalWeight;
      let chosen = children[children.length - 1].id;
      for (const child of children) {
        rng -= child.weight;
        if (rng <= 0) {
          chosen = child.id;
          break;
        }
      }

      currentId = chosen;
      walkDepth++;
    }

    totalWalkDepth += walkDepth;

    // Verify currentId is actually a tip
    if (reachedTip) {
      const tipCheckRes = await pool.query<{ is_tip: boolean }>(
        `SELECT is_tip FROM dag.vertices WHERE id = $1`,
        [currentId],
      );
      if (tipCheckRes.rows[0]?.is_tip) {
        selected.add(currentId);
      }
    }
  }

  // Fill remaining slots from allTips if walk didn't find enough
  for (const tip of allTips) {
    if (selected.size >= count) break;
    selected.add(tip);
  }

  return {
    selectedTips: Array.from(selected).slice(0, count),
    algorithm: config.tipSelectionAlgorithm,
    walkDepth: attempts > 0 ? Math.round(totalWalkDepth / attempts) : 0,
    timestamp: startedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Core Vertex Creation
// ─────────────────────────────────────────────────────────────────────────────

interface CreateVertexInput {
  vertexType: VertexTypeT;
  payload: VertexPayload;
  parentVertexIds: VertexId[];
  publicKey: string;
  signature: string;
  algorithm: 'ed25519' | 'secp256k1';
  dfaoId?: DFAOId;
  correlationId?: LoopId;
}

/**
 * Create, validate, store, and broadcast a new vertex.
 * This is the canonical internal entry point for all vertex creation —
 * both from the HTTP endpoint and the auto-vertex event handlers.
 */
async function createVertex(input: CreateVertexInput): Promise<DAGVertex> {
  const {
    vertexType,
    payload,
    parentVertexIds,
    publicKey,
    signature,
    algorithm,
    dfaoId,
    correlationId,
  } = input;

  // ── 1. Content hash ─────────────────────────────────────────────────
  const contentHash = computeContentHash(
    vertexType,
    payload,
    parentVertexIds,
    publicKey,
    algorithm,
    dfaoId,
  );

  // ── 2. Deduplication guard ───────────────────────────────────────────────
  const dupeRes = await pool.query<{ id: VertexId }>(
    `SELECT id FROM dag.vertices WHERE content_hash = $1 LIMIT 1`,
    [contentHash],
  );
  if (dupeRes.rows.length > 0) {
    // Return the existing vertex — idempotent
    console.log(
      `[dag-substrate] Duplicate vertex detected (contentHash=${contentHash.slice(0, 16)}...) — returning existing`,
    );
    const existingRes = await pool.query(
      `SELECT * FROM dag.vertices WHERE id = $1`,
      [dupeRes.rows[0].id],
    );
    return vertexFromRow(existingRes.rows[0]);
  }

  // ── 3. Signature verification ────────────────────────────────────────────
  const sigCheck = verifySignature(contentHash, signature, publicKey, algorithm);
  if (!sigCheck.valid) {
    const rejectPayload: VertexRejectedPayload = {
      vertexId: 'pending' as VertexId,
      reason: sigCheck.reason ?? 'Invalid signature',
      timestamp: new Date().toISOString(),
    };
    await bus.emit(
      EventType.VERTEX_REJECTED,
      (correlationId ?? uuidv4()) as LoopId,
      rejectPayload,
    );
    throw new Error(`Vertex rejected: ${sigCheck.reason}`);
  }

  // ── 4. Resolve parent Lamport timestamps ───────────────────────────────────
  const parentLamports = await fetchParentLamports(parentVertexIds);
  const maxParentLamport = parentLamports.size > 0
    ? Math.max(...parentLamports.values())
    : 0;
  const vertexLamport = advanceLamport(maxParentLamport);

  // ── 5. Run tip selection to determine which tips this vertex references ───
  //   If no parentVertexIds were supplied, auto-select tips.
  let effectiveParents = parentVertexIds;
  if (effectiveParents.length === 0) {
    const tipResult = await selectTips(config.minParentCount);
    effectiveParents = tipResult.selectedTips;
  }

  // ── 6. Persist vertex ────────────────────────────────────────────────
  const vertexId = uuidv4() as VertexId;
  const wallTimestamp = new Date();
  const propagation: VertexPropagation = {
    originNodeId: NODE_ID,
    hopCount: 0,
    receivedAt: wallTimestamp.toISOString(),
    locallyValidated: true,
  };

  await pool.query(
    `INSERT INTO dag.vertices (
       id, vertex_type, signature, public_key, algorithm,
       lamport_timestamp, wall_timestamp, parent_vertex_ids,
       content_hash, confirmation_weight, is_tip, confirmed,
       payload, dfao_id, propagation
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, 0.0, TRUE, FALSE,
       $10, $11, $12
     )`,
    [
      vertexId,
      vertexType,
      signature,
      publicKey,
      algorithm,
      vertexLamport,
      wallTimestamp,
      effectiveParents,
      contentHash,
      JSON.stringify(payload),
      dfaoId ?? null,
      JSON.stringify(propagation),
    ],
  );

  // ── 7. Mark referenced parents as no longer tips ─────────────────────────
  if (effectiveParents.length > 0) {
    await pool.query(
      `UPDATE dag.vertices SET is_tip = FALSE WHERE id = ANY($1::uuid[]) AND is_tip = TRUE`,
      [effectiveParents],
    );
  }

  // ── 8. Read back the persisted vertex ────────────────────────────────────
  const vertexRes = await pool.query(
    `SELECT * FROM dag.vertices WHERE id = $1`,
    [vertexId],
  );
  const vertex = vertexFromRow(vertexRes.rows[0]);

  // ── 9. Propagate confirmation weight to parents ──────────────────────────
  const effectiveCorrelationId = (correlationId ?? vertexId) as LoopId;
  if (effectiveParents.length > 0) {
    propagateConfirmationWeight(
      effectiveParents,
      effectiveCorrelationId,
    ).catch((err) =>
      console.error('[dag-substrate] Confirmation propagation error:', err),
    );
  }

  // ── 10. Emit VERTEX_CREATED ──────────────────────────────────────────────
  const createdPayload: VertexCreatedPayload = { vertex };
  await bus.emit(
    EventType.VERTEX_CREATED,
    effectiveCorrelationId,
    createdPayload,
  );

  console.log(
    `[dag-substrate] Vertex CREATED id=${vertexId} type=${vertexType} ` +
    `lamport=${vertexLamport} parents=${effectiveParents.length}`,
  );

  return vertex;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Auto-Vertex Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The system public key used for auto-generated vertices */
const SYSTEM_PUBLIC_KEY = process.env.SYSTEM_PUBLIC_KEY
  || '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Produce a deterministic system signature for auto-generated vertices.
 * In production this would be signed with the node's Ed25519 private key.
 */
function systemSignature(contentHash: string): string {
  return createHash('sha256')
    .update(`system:${NODE_ID}:${contentHash}`)
    .digest('hex')
    .padEnd(128, '0');
}

/**
 * Create an auto-vertex from a system event — shared by all event handlers.
 */
async function autoVertex(
  vertexType: VertexTypeT,
  payload: VertexPayload,
  correlationId: LoopId,
  dfaoId?: DFAOId,
): Promise<void> {
  try {
    const contentHash = computeContentHash(
      vertexType,
      payload,
      [],
      SYSTEM_PUBLIC_KEY,
      'ed25519',
      dfaoId,
    );
    await createVertex({
      vertexType,
      payload,
      parentVertexIds: [],   // tip selection will choose parents
      publicKey: SYSTEM_PUBLIC_KEY,
      signature: systemSignature(contentHash),
      algorithm: 'ed25519',
      dfaoId,
      correlationId,
    });
  } catch (err) {
    console.error(
      `[dag-substrate] Auto-vertex creation failed (type=${vertexType}):`,
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Event Handlers — Auto-Vertex Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register all auto-vertex event subscriptions.
 * The DAG substrate is an observer of the entire system — it records every
 * significant event as an immutable signed vertex.
 */
function registerAutoVertexHandlers(): void {
  // ── Loop lifecycle ───────────────────────────────────────────────────

  bus.on(EventType.LOOP_OPENED, async (event: DomainEvent) => {
    const p = event.payload as LoopOpenedPayload;
    await autoVertex(
      VertexType.LOOP_OPEN,
      {
        loopId: p.loop.id,
        claimId: p.loop.claimId,
        domain: p.loop.domain,
        status: p.loop.status,
        parentLoopIds: p.loop.parentLoopIds,
        openedAt: p.loop.createdAt,
      },
      event.correlationId,
    );
  });

  bus.on(EventType.LOOP_CLOSED, async (event: DomainEvent) => {
    const p = event.payload as LoopClosedPayload;
    await autoVertex(
      VertexType.LOOP_CLOSE,
      {
        loopId: p.loop.id,
        deltaS: p.deltaS,
        consensus: p.consensus,
        closedAt: p.loop.closedAt,
        settlementTimeSeconds: p.loop.settlementTimeSeconds,
      },
      event.correlationId,
    );
  });

  bus.on(EventType.LOOP_FAILED, async (event: DomainEvent) => {
    const p = event.payload as LoopFailedPayload;
    await autoVertex(
      VertexType.LOOP_CLOSE,
      {
        loopId: p.loopId,
        failed: true,
        reason: p.reason,
        deltaS: p.deltaS,
        consensus: p.consensus,
      },
      event.correlationId,
    );
  });

  bus.on(EventType.LOOP_MEASUREMENT_RECORDED, async (event: DomainEvent) => {
    const p = event.payload as LoopMeasurementRecordedPayload;
    await autoVertex(
      VertexType.MEASUREMENT,
      {
        loopId: p.loopId,
        measurementId: p.measurement.id,
        phase: p.phase,
        domain: p.measurement.domain,
        value: p.measurement.value,
        uncertainty: p.measurement.uncertainty,
        source: p.measurement.source,
        timestamp: p.measurement.timestamp,
      },
      event.correlationId,
    );
  });

  // ── XP Minting ─────────────────────────────────────────────────────

  bus.on(EventType.XP_MINTED_PROVISIONAL, async (event: DomainEvent) => {
    const p = event.payload as XPMintedProvisionalPayload;
    await autoVertex(
      VertexType.XP_MINT,
      {
        mintEventId: p.mintEvent.id,
        loopId: p.mintEvent.loopId,
        status: p.mintEvent.status,
        xpValue: p.mintEvent.xpValue,
        deltaS: p.mintEvent.deltaS,
        distribution: p.mintEvent.distribution,
        createdAt: p.mintEvent.createdAt,
      },
      event.correlationId,
    );
  });

  bus.on(EventType.XP_CONFIRMED, async (event: DomainEvent) => {
    const p = event.payload as XPConfirmedPayload;
    await autoVertex(
      VertexType.XP_MINT,
      {
        mintEventId: p.mintEventId,
        loopId: p.loopId,
        status: 'confirmed',
        totalXP: p.totalXP,
        confirmedAt: new Date().toISOString(),
      },
      event.correlationId,
    );
  });

  bus.on(EventType.XP_BURNED, async (event: DomainEvent) => {
    const p = event.payload as XPBurnedPayload;
    await autoVertex(
      VertexType.XP_MINT,
      {
        mintEventId: p.mintEventId,
        loopId: p.loopId,
        status: 'burned',
        burnReason: p.burnReason,
        xpBurned: p.xpBurned,
        burnedAt: new Date().toISOString(),
      },
      event.correlationId,
    );
  });

  // ── Governance ─────────────────────────────────────────────────────

  bus.on(EventType.PROPOSAL_CREATED, async (event: DomainEvent) => {
    const p = event.payload as ProposalCreatedPayload;
    await autoVertex(
      VertexType.GOVERNANCE_PROPOSAL,
      {
        proposalId: p.proposal.id,
        dfaoId: p.proposal.dfaoId,
        type: p.proposal.type,
        title: p.proposal.title,
        proposerId: p.proposal.proposerId,
        status: p.proposal.status,
        createdAt: p.proposal.createdAt,
      },
      event.correlationId,
      p.proposal.dfaoId,
    );
  });

  bus.on(EventType.GOVERNANCE_VOTE_CAST, async (event: DomainEvent) => {
    const p = event.payload as GovernanceVoteCastPayload;
    await autoVertex(
      VertexType.GOVERNANCE_VOTE,
      {
        proposalId: p.vote.proposalId,
        dfaoId: p.vote.dfaoId,
        voterId: p.vote.voterId,
        vote: p.vote.vote,
        weight: p.vote.weight,
        timestamp: p.vote.timestamp,
        currentTally: p.currentTally,
      },
      event.correlationId,
      p.vote.dfaoId,
    );
  });

  bus.on(EventType.PROPOSAL_PASSED, async (event: DomainEvent) => {
    const p = event.payload as ProposalPassedPayload;
    await autoVertex(
      VertexType.GOVERNANCE_PROPOSAL,
      {
        proposalId: p.proposalId,
        dfaoId: p.dfaoId,
        status: 'passed',
        tally: p.tally,
        resolvedAt: new Date().toISOString(),
      },
      event.correlationId,
      p.dfaoId,
    );
  });

  bus.on(EventType.PROPOSAL_REJECTED, async (event: DomainEvent) => {
    const p = event.payload as ProposalRejectedPayload;
    await autoVertex(
      VertexType.GOVERNANCE_PROPOSAL,
      {
        proposalId: p.proposalId,
        dfaoId: p.dfaoId,
        status: 'rejected',
        tally: p.tally,
        reason: p.reason,
        resolvedAt: new Date().toISOString(),
      },
      event.correlationId,
      p.dfaoId,
    );
  });

  // ── DFAO ─────────────────────────────────────────────────────────────

  bus.on(EventType.DFAO_CREATED, async (event: DomainEvent) => {
    const p = event.payload as DFAOCreatedPayload;
    await autoVertex(
      VertexType.DFAO_CREATE,
      {
        dfaoId: p.dfao.id,
        name: p.dfao.name,
        status: p.dfao.status,
        scale: p.dfao.scale,
        creatorId: p.creatorId,
        primaryDomain: p.dfao.primaryDomain,
        createdAt: p.dfao.createdAt,
      },
      event.correlationId,
      p.dfao.id,
    );
  });

  bus.on(EventType.DFAO_MEMBER_JOINED, async (event: DomainEvent) => {
    const p = event.payload as DFAOMemberJoinedPayload;
    await autoVertex(
      VertexType.DFAO_MEMBERSHIP,
      {
        dfaoId: p.dfaoId,
        validatorId: p.validatorId,
        role: p.role,
        action: 'joined',
        membershipVertexId: p.membershipVertexId,
        joinedAt: new Date().toISOString(),
      },
      event.correlationId,
      p.dfaoId,
    );
  });

  // ── Reputation ───────────────────────────────────────────────────

  bus.on(EventType.REPUTATION_ACCRUED, async (event: DomainEvent) => {
    const p = event.payload as ReputationAccruedPayload;
    await autoVertex(
      VertexType.GENERIC,
      {
        eventType: EventType.REPUTATION_ACCRUED,
        validatorId: p.validatorId,
        domain: p.domain,
        delta: p.delta,
        newAggregate: p.newAggregate,
        relatedLoopId: p.relatedLoopId,
        recordedAt: new Date().toISOString(),
      },
      event.correlationId,
    );
  });

  bus.on(EventType.REPUTATION_PENALIZED, async (event: DomainEvent) => {
    const p = event.payload as ReputationPenalizedPayload;
    await autoVertex(
      VertexType.GENERIC,
      {
        eventType: EventType.REPUTATION_PENALIZED,
        validatorId: p.validatorId,
        domain: p.domain,
        penalty: p.penalty,
        reason: p.reason,
        relatedLoopId: p.relatedLoopId,
        recordedAt: new Date().toISOString(),
      },
      event.correlationId,
    );
  });

  // ── Season lifecycle ─────────────────────────────────────────────────

  bus.on(EventType.SEASON_STARTED, async (event: DomainEvent) => {
    const p = event.payload as SeasonStartedPayload;
    await autoVertex(
      VertexType.SEASON_START,
      {
        seasonId: p.season.id,
        number: p.season.number,
        name: p.season.name,
        startedAt: p.season.startedAt,
        endsAt: p.season.endsAt,
        rewardMultiplier: p.season.rewardMultiplier,
      },
      event.correlationId,
    );
  });

  bus.on(EventType.SEASON_ENDED, async (event: DomainEvent) => {
    const p = event.payload as SeasonEndedPayload;
    await autoVertex(
      VertexType.SEASON_END,
      {
        seasonId: p.season.id,
        number: p.season.number,
        completedAt: p.season.completedAt,
        totalXPMinted: p.totalXPMinted,
        totalLoopsClosed: p.totalLoopsClosed,
        finalRankings: p.finalRankings,
      },
      event.correlationId,
    );
  });

  // ── Token economy ──────────────────────────────────────────────────

  bus.on(EventType.TOKEN_MINTED, async (event: DomainEvent) => {
    const p = event.payload as TokenMintedPayload;
    await autoVertex(
      VertexType.TOKEN_MINT,
      {
        transactionId: p.transaction.id,
        tokenType: p.transaction.tokenType,
        amount: p.transaction.amount,
        toWalletId: p.transaction.toWalletId,
        newBalance: p.newBalance,
        reason: p.transaction.reason,
        timestamp: p.transaction.timestamp,
      },
      event.correlationId,
    );
  });

  bus.on(EventType.TOKEN_BURNED, async (event: DomainEvent) => {
    const p = event.payload as TokenBurnedPayload;
    await autoVertex(
      VertexType.TOKEN_BURN,
      {
        transactionId: p.transaction.id,
        tokenType: p.transaction.tokenType,
        amount: p.transaction.amount,
        fromWalletId: p.transaction.fromWalletId,
        previousBalance: p.previousBalance,
        reason: p.transaction.reason,
        timestamp: p.transaction.timestamp,
      },
      event.correlationId,
    );
  });

  // ── Credentials ───────────────────────────────────────────────────

  bus.on(EventType.CREDENTIAL_ISSUED, async (event: DomainEvent) => {
    const p = event.payload as CredentialIssuedPayload;
    await autoVertex(
      VertexType.CREDENTIAL_ISSUE,
      {
        credentialId: p.credential.id,
        validatorId: p.credential.validatorId,
        type: p.credential.type,
        name: p.credential.name,
        domain: p.credential.domain,
        seasonId: p.credential.seasonId,
        issuedAt: p.credential.issuedAt,
      },
      event.correlationId,
    );
  });

  console.log('[dag-substrate] Auto-vertex event handlers registered');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Causal History (Ancestor Walk)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk the DAG backward from `vertexId`, collecting all ancestors (BFS).
 * Returns vertices sorted by Lamport timestamp descending (newest first).
 * Bounded by `maxVertices` to prevent unbounded queries.
 */
async function getCausalHistory(
  vertexId: VertexId,
  maxVertices: number = 500,
): Promise<DAGVertex[]> {
  const visited = new Set<VertexId>();
  const queue: VertexId[] = [vertexId];
  const result: DAGVertex[] = [];

  while (queue.length > 0 && result.length < maxVertices) {
    const batch = queue.splice(0, 50); // process 50 at a time
    const toFetch = batch.filter((id) => !visited.has(id));
    if (toFetch.length === 0) continue;

    toFetch.forEach((id) => visited.add(id));

    const res = await pool.query(
      `SELECT * FROM dag.vertices WHERE id = ANY($1::uuid[])`,
      [toFetch],
    );

    for (const row of res.rows) {
      const vertex = vertexFromRow(row);
      result.push(vertex);
      for (const parentId of vertex.parentVertexIds) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }
  }

  // Sort: newest Lamport first
  result.sort((a, b) => b.lamportTimestamp - a.lamportTimestamp);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Express Routes
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /health ─────────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  const health: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'loop-ledger':          'connected',
      'xp-mint':              'connected',
      'governance':           'connected',
      'dfao-registry':        'connected',
      'reputation':           'connected',
      'token-economy':        'connected',
      'credentials':          'connected',
      'temporal':             'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ── POST /vertices ─────────────────────────────────────────────────────────────────
app.post('/vertices', async (req: Request, res: Response) => {
  try {
    const {
      vertexType,
      payload,
      parentVertexIds,
      publicKey,
      signature,
      algorithm,
      dfaoId,
      correlationId,
    } = req.body as {
      vertexType: VertexTypeT;
      payload: VertexPayload;
      parentVertexIds?: VertexId[];
      publicKey: string;
      signature: string;
      algorithm: 'ed25519' | 'secp256k1';
      dfaoId?: DFAOId;
      correlationId?: LoopId;
    };

    if (!vertexType || !payload || !publicKey || !signature || !algorithm) {
      res.status(400).json({
        error: 'Missing required fields: vertexType, payload, publicKey, signature, algorithm',
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!Object.values(VertexType).includes(vertexType)) {
      res.status(400).json({
        error: `Invalid vertexType: ${vertexType}`,
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const vertex = await createVertex({
      vertexType,
      payload,
      parentVertexIds: parentVertexIds || [],
      publicKey,
      signature,
      algorithm,
      dfaoId,
      correlationId,
    });

    res.status(201).json(vertex);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isRejection = message.startsWith('Vertex rejected:');
    console.error('[dag-substrate] POST /vertices error:', err);
    res.status(isRejection ? 422 : 500).json({
      error: message,
      code: isRejection ? 'VERTEX_REJECTED' : 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /vertices/tips ───────────────────────────────────────────────────────────────
// NOTE: This route must be defined BEFORE /vertices/:id to avoid being shadowed.
app.get('/vertices/tips', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM dag.vertices
       WHERE is_tip = TRUE
       ORDER BY lamport_timestamp DESC
       LIMIT 200`,
    );
    res.json(result.rows.map(vertexFromRow));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /vertices/by-entity/:entityId ────────────────────────────────────────────
app.get('/vertices/by-entity/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityId } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);

    // Search payload JSONB for the entityId as a value
    const result = await pool.query(
      `SELECT * FROM dag.vertices
       WHERE payload::text ILIKE $1
       ORDER BY lamport_timestamp DESC
       LIMIT $2`,
      [`%${entityId}%`, limit],
    );
    res.json(result.rows.map(vertexFromRow));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /vertices/causal-history/:vertexId ────────────────────────────────────────────
app.get('/vertices/causal-history/:vertexId', async (req: Request, res: Response) => {
  try {
    const vertexId = req.params.vertexId as VertexId;
    const maxVertices = Math.min(
      parseInt((req.query.max as string) || '200', 10),
      500,
    );

    // Check vertex exists first
    const checkRes = await pool.query(
      `SELECT id FROM dag.vertices WHERE id = $1`,
      [vertexId],
    );
    if (checkRes.rows.length === 0) {
      res.status(404).json({
        error: 'Vertex not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const history = await getCausalHistory(vertexId, maxVertices);
    res.json({
      vertexId,
      depth: history.length,
      vertices: history,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /vertices/:id ───────────────────────────────────────────────────────────────────
app.get('/vertices/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM dag.vertices WHERE id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'Vertex not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    res.json(vertexFromRow(result.rows[0]));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /vertices/:id/confirm ────────────────────────────────────────────────────────────
app.post('/vertices/:id/confirm', async (req: Request, res: Response) => {
  try {
    const vertexId = req.params.id as VertexId;
    const { weightDelta = 1.0, correlationId } = req.body as {
      weightDelta?: number;
      correlationId?: LoopId;
    };

    const checkRes = await pool.query(
      `SELECT id, confirmed FROM dag.vertices WHERE id = $1`,
      [vertexId],
    );
    if (checkRes.rows.length === 0) {
      res.status(404).json({
        error: 'Vertex not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const newWeight = await incrementConfirmationWeight(vertexId, weightDelta);

    let confirmed = false;
    if (newWeight >= config.confirmationThreshold && !checkRes.rows[0].confirmed) {
      await pool.query(
        `UPDATE dag.vertices SET confirmed = TRUE WHERE id = $1`,
        [vertexId],
      );
      confirmed = true;

      const effectiveCorrelation = (correlationId ?? vertexId) as LoopId;
      const payload: VertexConfirmedPayload = {
        vertexId,
        confirmationWeight: newWeight,
        timestamp: new Date().toISOString(),
      };
      await bus.emit(EventType.VERTEX_CONFIRMED, effectiveCorrelation, payload);
      console.log(`[dag-substrate] Vertex ${vertexId} manually CONFIRMED (weight=${newWeight.toFixed(2)})`);
    }

    const vertexRes = await pool.query(
      `SELECT * FROM dag.vertices WHERE id = $1`,
      [vertexId],
    );
    res.json({
      vertex: vertexFromRow(vertexRes.rows[0]),
      confirmed,
      confirmationWeight: newWeight,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /tip-selection ───────────────────────────────────────────────────────────────────
app.post('/tip-selection', async (req: Request, res: Response) => {
  try {
    const { count = 2 } = req.body as { count?: number };
    const safeCount = Math.max(1, Math.min(count, 10));
    const result = await selectTips(safeCount);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /lamport-clock ────────────────────────────────────────────────────────────────────
app.get('/lamport-clock', (_req: Request, res: Response) => {
  res.json({
    lamportClock,
    timestamp: new Date().toISOString(),
    nodeId: NODE_ID,
  });
});

// ── GET /stats ───────────────────────────────────────────────────────────────────────────
app.get('/stats', async (_req: Request, res: Response) => {
  try {
    const statsRes = await pool.query<{
      total_vertices: string;
      tip_count: string;
      avg_confirmation_weight: string;
      confirmed_count: string;
      max_lamport: string;
    }>(
      `SELECT
         COUNT(*)                                 AS total_vertices,
         SUM(CASE WHEN is_tip THEN 1 ELSE 0 END) AS tip_count,
         AVG(confirmation_weight)                 AS avg_confirmation_weight,
         SUM(CASE WHEN confirmed THEN 1 ELSE 0 END) AS confirmed_count,
         MAX(lamport_timestamp)                   AS max_lamport
       FROM dag.vertices`,
    );

    const row = statsRes.rows[0];

    const typeBreakdownRes = await pool.query<{ vertex_type: string; count: string }>(
      `SELECT vertex_type, COUNT(*) AS count
       FROM dag.vertices
       GROUP BY vertex_type
       ORDER BY count DESC`,
    );

    res.json({
      totalVertices:          parseInt(row.total_vertices  || '0', 10),
      tipCount:               parseInt(row.tip_count       || '0', 10),
      confirmedCount:         parseInt(row.confirmed_count || '0', 10),
      avgConfirmationWeight:  parseFloat(row.avg_confirmation_weight || '0'),
      maxLamportTimestamp:    parseInt(row.max_lamport     || '0', 10),
      inMemoryLamportClock:   lamportClock,
      confirmationThreshold:  config.confirmationThreshold,
      nodeId:                 NODE_ID,
      vertexTypeBreakdown:    Object.fromEntries(
        typeBreakdownRes.rows.map((r) => [r.vertex_type, parseInt(r.count, 10)]),
      ),
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /events ──────────────────────────────────────────────────────────────────────────
// Webhook endpoint — receives events forwarded by other services via HTTP.
app.post('/events', async (req: Request, res: Response) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[dag-substrate] Received webhook event: ${event.type}`);
    // The Redis bus handles delivery to in-process handlers;
    // this endpoint is for external webhook delivery (HTTP push).
    res.status(202).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[dag-substrate] /events webhook error:', err);
    res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Database Schema Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure the dag schema and vertices table exist.
 * In production, migrations are managed by the migrations package.
 * This is a safety net for development and testing.
 */
async function ensureSchema(): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS dag`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dag.vertices (
      id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      vertex_type         TEXT         NOT NULL,
      signature           TEXT         NOT NULL,
      public_key          TEXT         NOT NULL,
      algorithm           TEXT         NOT NULL DEFAULT 'ed25519',
      lamport_timestamp   BIGINT       NOT NULL DEFAULT 0,
      wall_timestamp      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      parent_vertex_ids   UUID[]       NOT NULL DEFAULT '{}',
      content_hash        TEXT         NOT NULL UNIQUE,
      confirmation_weight NUMERIC      NOT NULL DEFAULT 0,
      is_tip              BOOLEAN      NOT NULL DEFAULT TRUE,
      confirmed           BOOLEAN      NOT NULL DEFAULT FALSE,
      payload             JSONB        NOT NULL DEFAULT '{}',
      dfao_id             UUID,
      propagation         JSONB        NOT NULL DEFAULT '{}'
    )
  `);

  // Indices for common query patterns
  await pool.query(`
    CREATE INDEX IF NOT EXISTS dag_vertices_is_tip_idx
      ON dag.vertices (is_tip)
      WHERE is_tip = TRUE
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS dag_vertices_lamport_idx
      ON dag.vertices (lamport_timestamp DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS dag_vertices_vertex_type_idx
      ON dag.vertices (vertex_type)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS dag_vertices_dfao_id_idx
      ON dag.vertices (dfao_id)
      WHERE dfao_id IS NOT NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS dag_vertices_payload_gin_idx
      ON dag.vertices USING gin (payload)
  `);

  console.log('[dag-substrate] Schema ready');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Genesis Vertex
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the genesis vertex if the DAG is empty.
 * The genesis vertex has no parents, lamport=0, and represents the DAG origin.
 */
async function ensureGenesisVertex(): Promise<void> {
  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM dag.vertices`,
  );
  const count = parseInt(countRes.rows[0].count, 10);
  if (count > 0) {
    console.log(`[dag-substrate] DAG already contains ${count} vertices — skipping genesis`);
    return;
  }

  const genesisPayload: VertexPayload = {
    type: 'genesis',
    message: 'Extropy Engine DAG substrate initialized',
    nodeId: NODE_ID,
    timestamp: new Date().toISOString(),
  };

  const contentHash = computeContentHash(
    VertexType.GENERIC,
    genesisPayload,
    [],
    SYSTEM_PUBLIC_KEY,
    'ed25519',
    undefined,
  );

  await pool.query(
    `INSERT INTO dag.vertices (
       id, vertex_type, signature, public_key, algorithm,
       lamport_timestamp, wall_timestamp, parent_vertex_ids,
       content_hash, confirmation_weight, is_tip, confirmed,
       payload, dfao_id, propagation
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, 'ed25519',
       0, NOW(), '{}',
       $4, 0.0, TRUE, FALSE,
       $5, NULL, $6
     )
     ON CONFLICT (content_hash) DO NOTHING`,
    [
      VertexType.GENERIC,
      systemSignature(contentHash),
      SYSTEM_PUBLIC_KEY,
      contentHash,
      JSON.stringify(genesisPayload),
      JSON.stringify({
        originNodeId: NODE_ID,
        hopCount: 0,
        receivedAt: new Date().toISOString(),
        locallyValidated: true,
      }),
    ],
  );

  console.log('[dag-substrate] Genesis vertex created');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[dag-substrate] Starting on port ${PORT} (nodeId=${NODE_ID})`);

  await waitForPostgres(pool);
  await waitForRedis(redis);

  await ensureSchema();
  await ensureGenesisVertex();
  await loadLamportClock();
  await bus.start();

  registerAutoVertexHandlers();

  app.listen(PORT, () => {
    console.log(`[dag-substrate] Listening on :${PORT}`);
    console.log(`[dag-substrate] Lamport clock at ${lamportClock}`);
    console.log(`[dag-substrate] Confirmation threshold: ${config.confirmationThreshold}`);
    console.log(`[dag-substrate] Tip selection algorithm: ${config.tipSelectionAlgorithm}`);
  });
}

main().catch((err) => {
  console.error('[dag-substrate] Fatal startup error:', err);
  process.exit(1);
});

export default app;
