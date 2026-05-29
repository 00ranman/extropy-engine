import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { userStore } from '../store.js';
import type { User } from '../types.js';

export const usersRouter = Router();

const CreateUserSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['client', 'driver']),
  zone: z.string().min(1),
});

/** POST /users — register a client or driver */
usersRouter.post('/', (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user: User = {
    id: randomUUID(),
    ...parsed.data,
    createdAt: new Date().toISOString(),
  };

  userStore.add(user);
  res.status(201).json(user);
});

/** GET /users/:id */
usersRouter.get('/:id', (req, res) => {
  const user = userStore.get(req.params.id!);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

/** GET /users/zone/:zone/drivers — find available drivers in a zone */
usersRouter.get('/zone/:zone/drivers', (req, res) => {
  const drivers = userStore.getDriversByZone(req.params.zone!);
  res.json(drivers);
});
