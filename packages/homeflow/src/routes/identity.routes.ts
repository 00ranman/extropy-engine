/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow Family Pilot, DID Registration Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  POST /api/v1/identity/register
 *    Body: { publicKeyHex, publicKeyMultibase, did }
 *    Server validates the DID matches did:extropy:<publicKeyHex>, issues a
 *    self issued OnboardingCredential bound to the user's Google sub, anchors
 *    a Genesis vertex on the DAG substrate, and stores the resulting
 *    materials on the user row.
 *
 *  GET /api/v1/identity/me
 *    Returns the current user's DID, vc_jwt and genesis vertex if onboarded.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Response, type NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  generateIdentityKeyPair,
  encodeDid,
  isExtropyDid,
  publicKeyHexFromDid,
  publicKeyMultibase as deriveMultibase,
  issueCredential,
  sha256Hex,
} from '@extropy/identity/lib';
import type { UserService } from '../services/user.service.js';
import { requireSession, type AuthedRequest } from '../auth/auth.middleware.js';

export interface DAGAnchor {
  recordGenesisVertex(payload: {
    userId: string;
    did: string;
    vcHash: string;
    ts: number;
  }): Promise<{ vertexId: string }>;
}

export function createIdentityRoutes(
  userService: UserService,
  dagAnchor: DAGAnchor,
): Router {
  const router = Router();

  router.post(
    '/register',
    requireSession(userService),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.hfUser!;
        if (user.did) {
          res.status(409).json({
            error: 'already_onboarded',
            did: user.did,
            genesisVertexId: user.genesisVertexId,
          });
          return;
        }

        const body = req.body as {
          publicKeyHex?: string;
          publicKeyMultibase?: string;
          did?: string;
        };

        if (!body.publicKeyHex || !/^[0-9a-f]{64}$/i.test(body.publicKeyHex)) {
          res.status(400).json({ error: 'publicKeyHex must be 64 hex chars' });
          return;
        }
        if (!body.did || !isExtropyDid(body.did)) {
          res.status(400).json({ error: 'did must be a valid did:extropy:<hex>' });
          return;
        }
        if (publicKeyHexFromDid(body.did) !== body.publicKeyHex.toLowerCase()) {
          res.status(400).json({ error: 'did does not match publicKeyHex' });
          return;
        }
        const expectedDid = encodeDid(body.publicKeyHex);
        if (expectedDid !== body.did.toLowerCase()) {
          res.status(400).json({ error: 'did mismatch with canonical encoding' });
          return;
        }
        const expectedMultibase = deriveMultibase(body.publicKeyHex);
        if (body.publicKeyMultibase && body.publicKeyMultibase !== expectedMultibase) {
          res.status(400).json({ error: 'publicKeyMultibase does not match publicKeyHex' });
          return;
        }

        const existingByDid = await userService.findByDid(body.did);
        if (existingByDid && existingByDid.id !== user.id) {
          res.status(409).json({ error: 'did already registered to another user' });
          return;
        }

        // Self issued OnboardingCredential. The HomeFlow server holds an
        // ephemeral issuer key for the family pilot; in production each
        // participant's personal AI signs their own credential per spec
        // section 8. For the pilot we trust Google as proof of personhood.
        const issuerKey = generateIdentityKeyPair();
        const vcJwt = issueCredential({
          type: 'OnboardingCredential',
          issuerKey,
          subjectDid: body.did,
          subjectClaims: {
            googleSub: user.googleSub,
            email: user.email,
            displayName: user.displayName,
          },
          evidenceDigest: sha256Hex(`google:${user.googleSub}`),
        });
        const vcHash = sha256Hex(vcJwt);
        const ts = Date.now();

        const { vertexId } = await dagAnchor.recordGenesisVertex({
          userId: user.id,
          did: body.did,
          vcHash,
          ts,
        });

        const updated = await userService.setIdentity(user.id, {
          did: body.did,
          publicKeyMultibase: expectedMultibase,
          publicKeyHex: body.publicKeyHex.toLowerCase(),
          vcJwt,
          genesisVertexId: vertexId,
        });

        res.status(201).json({
          did: updated.did,
          publicKeyMultibase: updated.publicKeyMultibase,
          vcJwt: updated.vcJwt,
          genesisVertexId: updated.genesisVertexId,
          onboardedAt: updated.onboardedAt,
        });
      } catch (err) { next(err); }
    },
  );

  router.get(
    '/me',
    requireSession(userService),
    (req: AuthedRequest, res: Response) => {
      const user = req.hfUser!;
      res.json({
        did: user.did,
        publicKeyMultibase: user.publicKeyMultibase,
        vcJwt: user.vcJwt,
        genesisVertexId: user.genesisVertexId,
        onboarded: !!user.did,
      });
    },
  );

  return router;
}

/**
 * Default DAG anchor implementation. Records a Genesis vertex through the
 * DAG substrate HTTP API, then writes a local reference row. We do not use
 * DAGIntegration.recordVertex because that requires a household_id foreign
 * key; the Genesis vertex predates household creation.
 */
export class GenesisAnchor implements DAGAnchor {
  constructor(
    private dagSubstrateUrl: string,
    private dbQuery: (text: string, params: unknown[]) => Promise<unknown>,
  ) {}

  async recordGenesisVertex(payload: {
    userId: string;
    did: string;
    vcHash: string;
    ts: number;
  }): Promise<{ vertexId: string }> {
    const vertexId = uuidv4();
    try {
      await fetch(`${this.dagSubstrateUrl}/vertices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertexType: 'GENESIS',
          payload: {
            source: 'homeflow',
            userId: payload.userId,
            did: payload.did,
            vcHash: payload.vcHash,
            ts: payload.ts,
          },
        }),
      });
    } catch (err) {
      console.warn('[homeflow:identity] DAG anchor failed, continuing with local vertex id:', err);
    }
    await this.dbQuery(
      `CREATE TABLE IF NOT EXISTS hf_user_genesis (
        user_id     TEXT PRIMARY KEY,
        vertex_id   TEXT NOT NULL,
        did         TEXT NOT NULL,
        vc_hash     TEXT NOT NULL,
        ts          BIGINT NOT NULL
      )`,
      [],
    );
    await this.dbQuery(
      `INSERT INTO hf_user_genesis (user_id, vertex_id, did, vc_hash, ts)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO NOTHING`,
      [payload.userId, vertexId, payload.did, payload.vcHash, payload.ts],
    );
    return { vertexId };
  }
}
