/**
 * LocalFlow prototype server.
 *
 * Port 4030 — consistent with extropy-engine service port conventions.
 *
 * Endpoints:
 *   POST   /users                     register client or driver
 *   GET    /users/:id                 get user
 *   GET    /users/zone/:zone/drivers  list drivers in zone
 *
 *   POST   /tasks                     client opens task (emits LOOPOPEN)
 *   GET    /tasks/:id                 get task
 *   GET    /tasks/open/:zone          open tasks in zone (drivers poll)
 *   PATCH  /tasks/:id/accept          driver accepts
 *   PATCH  /tasks/:id/complete        driver marks done
 *   PATCH  /tasks/:id/confirm         client confirms (emits LOOPCLOSE + XPMINT)
 *   GET    /tasks/:id/dag             DAG audit trail
 *
 *   GET    /health                    liveness check
 *   GET    /mesh/vertices             all DAG vertices (internal observability)
 */

import express, { type Express } from 'express';
import { usersRouter } from './routes/users.js';
import { tasksRouter } from './routes/tasks.js';
import { getAllVertices } from './dag.js';

const app: Express = express();
app.use(express.json());

app.use('/users', usersRouter);
app.use('/tasks', tasksRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'localflow', version: '0.1.0' });
});

/** Internal observability — returns all DAG vertices. Never expose this publicly. */
app.get('/mesh/vertices', (_req, res) => {
  res.json(getAllVertices());
});

const PORT = Number(process.env.LOCALFLOW_PORT ?? 4030);
app.listen(PORT, () => {
  console.log(`[localflow] listening on :${PORT}`);
});

export default app;
