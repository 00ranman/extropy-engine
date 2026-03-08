/**
 * SignalFlow Orchestrator — Service Entrypoint
 *
 * Routes validation tasks to human and AI validators based on
 * complexity scores, manages task queues, and tracks completion.
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'expired';
type ValidatorType = 'human' | 'ai' | 'consensus';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

interface ValidationTask {
  id: string;
  subClaimId: string;
  claimId: string;
  text: string;
  validatorType: ValidatorType;
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
  validatorId: string;
  verdict: 'true' | 'false' | 'uncertain';
  confidence: number;
  evidence?: string;
  completedAt: string;
}

interface RoutingConfig {
  humanThreshold: number;  // complexity >= this → human validator
  aiThreshold: number;     // complexity < this → AI validator
  consensusThreshold: number; // for high-stakes claims
}

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4002;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TASK_TTL = parseInt(process.env.TASK_TTL || '86400'); // 24 hours
const TASK_EXPIRY_MS = parseInt(process.env.TASK_EXPIRY_MS || '3600000'); // 1 hour

const routingConfig: RoutingConfig = {
  humanThreshold: parseFloat(process.env.HUMAN_THRESHOLD || '0.7'),
  aiThreshold: parseFloat(process.env.AI_THRESHOLD || '0.3'),
  consensusThreshold: parseFloat(process.env.CONSENSUS_THRESHOLD || '0.9'),
};

// ─── Infrastructure ───────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
});

app.use(express.json());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function routeToValidator(complexityScore: number): ValidatorType {
  if (complexityScore >= routingConfig.consensusThreshold) return 'consensus';
  if (complexityScore >= routingConfig.humanThreshold) return 'human';
  return 'ai';
}

async function saveTask(task: ValidationTask): Promise<void> {
  await redis.setex(`task:${task.id}`, TASK_TTL, JSON.stringify(task));
  // Add to appropriate queue
  await redis.lpush(`queue:${task.validatorType}`, task.id);
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
      validatorType: routeToValidator(complexityScore),
      priority: priority || 'medium',
      status: 'pending',
      complexityScore,
      deadline,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    await saveTask(task);

    // Notify connected validators via WebSocket
    io.to(task.validatorType).emit('task:new', task);

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// List tasks (optionally filter by status/type)
app.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, validatorType, limit = '20', offset = '0' } = req.query;

    // Scan Redis for tasks
    const keys = await redis.keys('task:*');
    const tasks: ValidationTask[] = [];

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const task = JSON.parse(data) as ValidationTask;
        if (status && task.status !== status) continue;
        if (validatorType && task.validatorType !== validatorType) continue;
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

// Claim a task (validator picks it up)
app.post('/tasks/:taskId/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { validatorId } = req.body;
    if (!validatorId) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'validatorId is required' });
    }

    const task = await getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Task not found' });
    }
    if (task.status !== 'pending') {
      return res.status(409).json({ error: 'ALREADY_CLAIMED', message: `Task is ${task.status}` });
    }

    task.status = 'assigned';
    task.assignedTo = validatorId;
    task.updatedAt = nowISO();
    if (!task.deadline) {
      task.deadline = new Date(Date.now() + TASK_EXPIRY_MS).toISOString();
    }

    await updateTask(task);
    io.to(task.validatorType).emit('task:claimed', { taskId: task.id, validatorId });

    res.json(task);
  } catch (err) {
    next(err);
  }
});

// Submit result for a task
app.post('/tasks/:taskId/result', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { validatorId, verdict, confidence, evidence } = req.body;

    if (!validatorId || !verdict || confidence === undefined) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'validatorId, verdict, and confidence are required',
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
      validatorId,
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
    const [humanDepth, aiDepth, consensusDepth] = await Promise.all([
      redis.llen('queue:human'),
      redis.llen('queue:ai'),
      redis.llen('queue:consensus'),
    ]);

    res.json({
      human: humanDepth,
      ai: aiDepth,
      consensus: consensusDepth,
      total: humanDepth + aiDepth + consensusDepth,
    });
  } catch (err) {
    next(err);
  }
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Validator connected: ${socket.id}`);

  socket.on('join:room', (room: string) => {
    if (['human', 'ai', 'consensus'].includes(room)) {
      socket.join(room);
      console.log(`${socket.id} joined room: ${room}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Validator disconnected: ${socket.id}`);
  });
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[SignalFlow Error]', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
  });
});

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
