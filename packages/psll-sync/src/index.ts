/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — PSLL Sync (v3.1)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Personal Signed Local Log maintenance, anchoring, and selective disclosure.
 *
 *  PSLL is local-first and never gossips raw entries. The network sees only
 *  periodic Merkle root commitments anchored as DAG vertices. Inclusion proofs
 *  and ZKP-based selective disclosures handle dispute scenarios.
 *
 *  See docs/PSLL.md for the full spec.
 *
 *  STATUS: Skeleton.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Request, Response } from 'express';

const PORT = Number(process.env.PORT ?? 4102);
const SERVICE_NAME = '@extropy/psll-sync';

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    service: SERVICE_NAME,
    status: 'ok',
    version: '0.1.0',
    spec: 'v3.1',
    note: 'skeleton — endpoints stubbed pending implementation',
  });
});

app.post('/log/append', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/PSLL.md §entry-schema' });
});

app.get('/log/length', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented' });
});

app.post('/anchor/now', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/PSLL.md §anchoring-model' });
});

app.post('/proof/inclusion', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented', spec: 'docs/PSLL.md §disclosure-under-dispute' });
});

app.post('/proof/zkp-disclosure', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'not implemented' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[${SERVICE_NAME}] listening on :${PORT} (skeleton, v3.1)`);
});
