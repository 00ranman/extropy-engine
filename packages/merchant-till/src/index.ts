import express from 'express';
import { sparkTill } from '@extropy/xp-formula';
import { packageClaim } from '@extropy/signalflow';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: '@extropy/merchant-till', face: 'merchant-till', status: 'ok' });
});

app.post('/sale', (req, res) => {
  packageClaim({ face: 'merchant-till', class: 'till.sale' });
  const xp = Number(req.body?.xp) || 0;
  const standing = {
    H_cap: Number(req.body?.H_cap) || 0.5,
    S: Number(req.body?.S) || 1,
    CT: Number(req.body?.CT) || 0,
    kappa: Number(req.body?.kappa) || 1,
    beta: Number(req.body?.beta) || 1,
    listPrice: Number(req.body?.listPrice) || 0,
  };
  const spark = sparkTill(xp, standing);
  res.json({ ...spark, cash: Math.max(0, (standing.listPrice ?? 0) - spark.EP) });
});

const PORT = Number(process.env.PORT ?? 4031);
app.listen(PORT, () => {
  console.log(`[merchant-till] cash still rings. EP dies in the sale. :${PORT}`);
});
