/**
 * SignalFlow Orchestrator — Service Entrypoint
 *
 * Packages claims. Routes LOOK slices. Does not mint. There is no consensus engine.
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { applyBaseSecurity, sanitizedErrorHandler } from '@extropy/contracts';
import { packageClaim, closeLoop } from './lib.js';

// Dashboard origins allowed to open a socket.io connection. Comma-separated.
// Falls back to localhost in non-production; required in production.
const DASHBOARD_ORIGINS = (process.env.SIGNALFLOW_DASHBOARD_ORIGINS
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && DASHBOARD_ORIGINS.length === 0) {
  throw new Error('SIGNALFLOW_DASHBOARD_ORIGINS must be set in production (socket.io CORS allowlist).');
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'expired';
type LookKind = 'looker' | 'ai';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

interface ValidationTask {
  id: string;
  subClaimId: string;
  claimId: string;
  text: string;
  lookKind: LookKind;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: string;
  complexityScore: number;
  deadline?: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskResult {
  taskId: string;
  lookerId: string;
  verdict: 'true' | 'false' | 'uncertain';
  confidence: number;
  evidence?: string;
  completedAt: string;
}

interface RoutingConfig {
  lookerThreshold: number;
  aiThreshold: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4002;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TASK_TTL = parseInt(process.env.TASK_TTL || '86400'); // 24 hours
const TASK_EXPIRY_MS = parseInt(process.env.TASK_EXPIRY_MS || '3600000'); // 1 hour

const routingConfig: RoutingConfig = {
  lookerThreshold: parseFloat(process.env.LOOKER_THRESHOLD || '0.7'),
  aiThreshold: parseFloat(process.env.AI_THRESHOLD || '0.3'),
};

// ─── Infrastructure ───────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: DASHBOARD_ORIGINS, credentials: true },
});

applyBaseSecurity(app);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function routeLook(complexityScore: number): LookKind {
  if (complexityScore >= routingConfig.lookerThreshold) return 'looker';
  return 'ai';
}

async function saveTask(task: ValidationTask): Promise<void> {
  await redis.setex(`task:${task.id}`, TASK_TTL, JSON.stringify(task));
  // Add to appropriate queue
  await redis.lpush(`queue:${task.lookKind}`, task.id);
}

async function getTask(taskId: string): Promise<ValidationTask | null> {
  const data = await redis.get(`task:${taskId}`);
  return data ? JSON.parse(data) : null;
}

async function updateTask(task: ValidationTask): Promise<void> {
  await redis.setex(`task:${task.id}`, TASK_TTL, JSON.stringify(task));
}

function nowISO(): string {
  return new Date().toISOString();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    dependencies: {
      redis: redis.status,
    },
  });
});

app.post('/claims/package', (req: Request, res: Response) => {
  const { face, class: actionClass, evidenceRoot, instrumentDeltaS } = req.body ?? {};
  if (!face || !actionClass) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'face and class are required' });
  }
  res.json(packageClaim({ face, class: actionClass, evidenceRoot, instrumentDeltaS }));
});

app.post('/claims/close', (req: Request, res: Response) => {
  const { claim, bothSigned, deltaTSeconds } = req.body ?? {};
  if (!claim) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'claim is required' });
  }
  res.json(closeLoop(claim, { bothSigned: !!bothSigned, deltaTSeconds: Number(deltaTSeconds) || 0 }));
});

// Create a new validation task
app.post('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subClaimId, claimId, text, complexityScore, priority, deadline } = req.body;

    if (!subClaimId || !claimId || !text || complexityScore === undefined) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'subClaimId, claimId, text, and complexityScore are required',
      });
    }

    if (complexityScore < 0 || complexityScore > 1) {
      return res.status(422).json({
        error: 'INVALID_COMPLEXITY',
        message: 'complexityScore must be between 0 and 1',
      });
    }

    const task: ValidationTask = {
      id: uuidv4(),
      subClaimId,
      claimId,
      text,
      lookKind: routeLook(complexityScore),
      priority: priority || 'medium',
      status: 'pending',
      complexityScore,
      deadline,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    await saveTask(task);

    // Notify connected lookers via WebSocket
    io.to(task.lookKind).emit('task:new', task);

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// List tasks (optionally filter by status/type)
app.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, lookKind, limit = '20', offset = '0' } = req.query;

    // Scan Redis for tasks
    const keys = await redis.keys('task:*');
    const tasks: ValidationTask[] = [];

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const task = JSON.parse(data) as ValidationTask;
        if (status && task.status !== status) continue;
        if (lookKind && task.lookKind !== lookKind) continue;
        tasks.push(task);
      }
    }

    // Sort by createdAt desc
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const start = parseInt(offset as string);
    const end = start + parseInt(limit as string);

    res.json({
      items: tasks.slice(start, end),
      total: tasks.length,
      limit: parseInt(limit as string),
      offset: start,
    });
  } catch (err) {
    next(err);
  }
});

// Get a specific task
app.get('/tasks/:taskId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Task not found' });
    }
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// Claim a look slice
app.post('/tasks/:taskId/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lookerId } = req.body;
    if (!lookerId) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'lookerId is required' });
    }

    const task = await getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Task not found' });
    }
    if (task.status !== 'pending') {
      return res.status(409).json({ error: 'ALREADY_CLAIMED', message: `Task is ${task.status}` });
    }

    task.status = 'assigned';
    task.assignedTo = lookerId;
    task.updatedAt = nowISO();
    if (!task.deadline) {
      task.deadline = new Date(Date.now() + TASK_EXPIRY_MS).toISOString();
    }

    await updateTask(task);
    io.to(task.lookKind).emit('task:claimed', { taskId: task.id, lookerId });

    res.json(task);
  } catch (err) {
    next(err);
  }
});

// Submit result for a task
app.post('/tasks/:taskId/result', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lookerId, verdict, confidence, evidence } = req.body;

    if (!lookerId || !verdict || confidence === undefined) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'lookerId, verdict, and confidence are required',
      });
    }

    if (!['true', 'false', 'uncertain'].includes(verdict)) {
      return res.status(422).json({ error: 'INVALID_VERDICT', message: 'verdict must be true, false, or uncertain' });
    }

    if (confidence < 0 || confidence > 1) {
      return res.status(422).json({ error: 'INVALID_CONFIDENCE', message: 'confidence must be between 0 and 1' });
    }

    const task = await getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Task not found' });
    }

    task.status = 'completed';
    task.updatedAt = nowISO();
    await updateTask(task);

    const result: TaskResult = {
      taskId: task.id,
      lookerId,
      verdict,
      confidence,
      evidence,
      completedAt: nowISO(),
    };

    // Store result separately
    await redis.setex(`result:${task.id}`, TASK_TTL, JSON.stringify(result));

    // Emit completion event
    io.emit('task:completed', result);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get task result
app.get('/tasks/:taskId/result', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await redis.get(`result:${req.params.taskId}`);
    if (!data) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Result not found' });
    }
    res.json(JSON.parse(data));
  } catch (err) {
    next(err);
  }
});

// Queue depth metrics
app.get('/metrics/queues', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [lookerDepth, aiDepth] = await Promise.all([
      redis.llen('queue:looker'),
      redis.llen('queue:ai'),
    ]);

    res.json({
      looker: lookerDepth,
      ai: aiDepth,
      total: lookerDepth + aiDepth,
    });
  } catch (err) {
    next(err);
  }
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Looker connected: ${socket.id}`);

  socket.on('join:room', (room: string) => {
    if (['looker', 'ai'].includes(room)) {
      socket.join(room);
      console.log(`${socket.id} joined room: ${room}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Looker disconnected: ${socket.id}`);
  });
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use(sanitizedErrorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`SignalFlow running on port ${PORT}`);
  console.log(`Routing config:`, routingConfig);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await redis.quit();
  httpServer.close(() => process.exit(0));
});
