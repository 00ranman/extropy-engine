/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Identity Layer (v3.1)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Hybrid identity: OAuth + on-device KYC + W3C DID + ZKP wrapper.
 *
 *  The network never sees raw identity material. KYC happens on-device.
 *  The DID is generated locally. Network verification operates on ZKPs only.
 *
 *  See docs/IDENTITY.md for the full spec.
 *
 *  STATUS: Skeleton — interface contract is the source of truth; implementation
 *  is incremental. Endpoints below are stubbed and return 501 until the
 *  underlying primitives (BBS+, KYC drivers, escrow) are wired in.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Request, Response } from 'express';

const PORT = Number(process.env.PORT ?? 4101);
const SERVICE_NAME = '@extropy/identity';

const app = express();
app.use(express.json({ limit: '1mb' }));

// ────────────────────────────────────────────────────────────────────────────
//  Health
// ────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    service: SERVICE_NAME,
    status: 'ok',
    version: '0.1.0',
    spec: 'v3.1',
    note: 'skeleton — endpoints stubbed pending implementation',
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  Onboarding
// ────────────────────────────────────────────────────────────────────────────

app.post('/onboard/oauth', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/IDENTITY.md §canonical-flow step 1' });
});

app.post('/onboard/kyc', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/IDENTITY.md §canonical-flow step 2' });
});

// ────────────────────────────────────────────────────────────────────────────
//  DID + Credentials
// ────────────────────────────────────────────────────────────────────────────

app.post('/did/generate', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/IDENTITY.md §canonical-flow step 3' });
});

// ────────────────────────────────────────────────────────────────────────────
//  ZKP
// ────────────────────────────────────────────────────────────────────────────

app.post('/zkp/prove', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/IDENTITY.md §canonical-flow step 4' });
});

app.post('/zkp/verify', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented' });
});

app.post('/nullifier/derive', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented' });
});

// ────────────────────────────────────────────────────────────────────────────
//  Reveal escrow (governance-gated)
// ────────────────────────────────────────────────────────────────────────────

app.post('/reveal/initiate', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/IDENTITY.md §threshold-reveal-escrow' });
});

// ────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[${SERVICE_NAME}] listening on :${PORT} (skeleton, v3.1)`);
});
