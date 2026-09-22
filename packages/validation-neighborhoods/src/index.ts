import express, { Request, Response } from 'express';
import { DEFAULT_SLICE_DENOMINATOR, lookSlice } from './lib.js';

export { DEFAULT_SLICE_DENOMINATOR, lookSlice } from './lib.js';

const PORT = Number(process.env.PORT ?? 4104);
const SERVICE_NAME = '@extropy/validation-neighborhoods';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ service: SERVICE_NAME, status: 'ok', version: '0.1.0', spec: 'v3.1' });
});

app.post('/slices', (_req: Request, res: Response) => {
  res.json({ slice: lookSlice(), spec: 'volunteer 1/10th blind slices' });
});

app.get('/slices/available', (_req: Request, res: Response) => {
  res.json({ denominator: DEFAULT_SLICE_DENOMINATOR, class: false });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] looking is a vertex. slices=${DEFAULT_SLICE_DENOMINATOR}`);
});
