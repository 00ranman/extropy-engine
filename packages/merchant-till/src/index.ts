import express from 'express';
import { ringTill } from '@extropy/signalflow';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: '@extropy/merchant-till', face: 'merchant-till', status: 'ok' });
});

app.post('/sale', (req, res) => {
  const body = req.body ?? {};
  const result = ringTill({
    xpStanding: Number(body.xpStanding) || 0,
    standing: {
      H_cap: Number(body.H_cap) || 0.5,
      S: Number(body.S) || 1,
      CT: Number(body.CT) || 0,
      kappa: Number(body.kappa) || 1,
      beta: Number(body.beta) || 1,
      listPrice: Number(body.listPrice) || 0,
    },
  });
  res.json(result);
});

const PORT = Number(process.env.PORT ?? 4031);
app.listen(PORT, () => {
  console.log(`[merchant-till] cash still rings. EP dies in the sale. :${PORT}`);
});
