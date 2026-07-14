import { Router, type Router as ExpressRouter } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { EntropyDomain } from '@extropy/contracts';
import { taskStore, userStore } from '../store.js';
import { emitLoopOpen, emitLoopClose, getVerticesByTask } from '../dag.js';
import { buildBaseline, buildOutcome } from '../measurement.js';
import { simulateNormalizedMeasurement } from '../simulation.js';
import type { NormalizedMeasurement, Task } from '../types.js';

export const tasksRouter: ExpressRouter = Router();

const CreateTaskSchema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(['ride', 'grocery', 'errand', 'recurring']),
  description: z.string().min(1),
  requestedBy: z.string().datetime(),
  radiusKm: z.number().positive().default(25),
  schedule: z.string().optional(),
  agreedTerms: z.string().optional(),
  expectedDurationSeconds: z.number().positive().optional(),
  domain: z.nativeEnum(EntropyDomain).optional(),
});

/**
 * POST /tasks - client opens a new task request.
 * Emits LOOPOPEN vertex to DAG and records the raw baseline observable.
 */
tasksRouter.post('/', (req, res) => {
  const parsed = CreateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const client = userStore.get(parsed.data.clientId);
  if (!client || client.role !== 'client') {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  const task: Task = {
    id: randomUUID(),
    status: 'open',
    dagVertices: [],
    zone: client.zone,
    ...parsed.data,
  };

  const loopOpenVertex = emitLoopOpen(task);
  task.dagVertices.push(loopOpenVertex.id);

  taskStore.add(task);
  res.status(201).json(task);
});

/** GET /tasks/:id */
tasksRouter.get('/:id', (req, res) => {
  const task = taskStore.get(req.params.id!);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

/** GET /tasks/open/:zone - list open tasks in a zone (drivers poll this) */
tasksRouter.get('/open/:zone', (req, res) => {
  res.json(taskStore.getOpen(req.params.zone!));
});

/**
 * PATCH /tasks/:id/accept - driver accepts a task.
 */
tasksRouter.patch('/:id/accept', (req, res) => {
  const { driverId, agreedTerms } = req.body as { driverId: string; agreedTerms?: string };

  if (!driverId) {
    res.status(400).json({ error: 'driverId required' });
    return;
  }

  const driver = userStore.get(driverId);
  if (!driver || driver.role !== 'driver') {
    res.status(404).json({ error: 'Driver not found' });
    return;
  }

  const task = taskStore.get(req.params.id!);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (task.status !== 'open') {
    res.status(409).json({ error: `Task is already ${task.status}` });
    return;
  }

  const updated = taskStore.update(task.id, {
    driverId,
    agreedTerms,
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
  });

  res.json(updated);
});

/**
 * PATCH /tasks/:id/complete - driver marks task done.
 */
tasksRouter.patch('/:id/complete', (req, res) => {
  const task = taskStore.get(req.params.id!);
  if (!task || task.status !== 'accepted') {
    res.status(409).json({ error: 'Task must be in accepted state' });
    return;
  }

  const updated = taskStore.update(task.id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  res.json(updated);
});

// Canonical, already-normalized XP formula inputs supplied by a validator.
const NormalizedInputsSchema = z.object({
  R: z.number(),
  F: z.number(),
  deltaS: z.number(),
  w: z.array(z.number()),
  E: z.array(z.number()),
  Ts: z.number(),
  Tfloor: z.number().optional(),
});

const ConfirmSchema = z
  .object({
    /**
     * Explicitly supplied, validated normalized measurement. When present, XP
     * settlement can proceed. Its absence keeps the loop pending.
     */
    normalizedMeasurement: z
      .object({
        domain: z.nativeEnum(EntropyDomain),
        inputs: NormalizedInputsSchema,
        normalizedBy: z.string().min(1),
      })
      .optional(),
    /**
     * Demo-only opt-in. Routes through the clearly-labeled simulation adapter
     * to fabricate a normalized measurement. Never a production path.
     */
    simulate: z.boolean().optional(),
  })
  .optional();

/**
 * PATCH /tasks/:id/confirm - client confirms receipt/completion.
 *
 * This is the convergence event. It always emits LOOPCLOSE + a canonical
 * MEASUREMENT vertex carrying raw baseline and outcome evidence.
 *
 * XP settlement (XPMINT_PROVISIONAL) is gated on a validated normalized
 * measurement supplied in the request body. If none is supplied, the loop
 * closes but settlement stays pending. Elapsed time is never treated as a
 * normalized entropy delta.
 */
tasksRouter.patch('/:id/confirm', (req, res) => {
  const parsedBody = ConfirmSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.flatten() });
    return;
  }

  const task = taskStore.get(req.params.id!);
  if (!task || task.status !== 'completed') {
    res.status(409).json({ error: 'Task must be in completed state' });
    return;
  }

  const confirmedAt = new Date().toISOString();
  const updated = taskStore.update(task.id, {
    status: 'confirmed',
    confirmedAt,
  });

  if (!updated) {
    res.status(500).json({ error: 'Failed to update task' });
    return;
  }

  let normalized: NormalizedMeasurement | undefined;
  const body = parsedBody.data;

  if (body?.normalizedMeasurement) {
    normalized = {
      ...body.normalizedMeasurement,
      simulated: false,
      normalizedAt: new Date().toISOString(),
    };
  } else if (body?.simulate) {
    const baseline = buildBaseline(updated);
    const outcome = buildOutcome(updated);
    normalized = simulateNormalizedMeasurement(baseline, outcome, updated.domain);
  }

  const result = emitLoopClose(updated, normalized);

  if (result) {
    const vertexIds = [updated.dagVertices, result.closeVertex.id, result.measurementVertex.id].flat();
    if (result.mintVertex) vertexIds.push(result.mintVertex.id);
    taskStore.update(task.id, { dagVertices: vertexIds });
  }

  res.json({
    task: taskStore.get(task.id),
    dag: result
      ? {
          loopClose: result.closeVertex.id,
          measurement: result.measurementVertex.id,
          settlement: result.settlement,
          xpMintProvisional: result.mintVertex?.id ?? null,
          xpProvisional: result.mintVertex?.xpProvisional ?? null,
        }
      : null,
  });
});

/**
 * GET /tasks/:id/dag - return the DAG audit trail for a task.
 * Powers internal observability without exposing XP to users.
 */
tasksRouter.get('/:id/dag', (req, res) => {
  const vertices = getVerticesByTask(req.params.id!);
  res.json(vertices);
});
