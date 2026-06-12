/**
 * In-memory task and user store for prototype.
 * Replace with Postgres via Prisma or the existing extropy-engine DB layer in production.
 */

import type { Task, TaskId, User, UserId } from './types.js';

const users = new Map<UserId, User>();
const tasks = new Map<TaskId, Task>();

export const userStore = {
  add(user: User): User {
    users.set(user.id, user);
    return user;
  },
  get(id: UserId): User | undefined {
    return users.get(id);
  },
  getByZone(zone: string): User[] {
    return Array.from(users.values()).filter(u => u.zone === zone);
  },
  getDriversByZone(zone: string): User[] {
    return Array.from(users.values()).filter(u => u.zone === zone && u.role === 'driver');
  },
  all(): User[] {
    return Array.from(users.values());
  },
};

export const taskStore = {
  add(task: Task): Task {
    tasks.set(task.id, task);
    return task;
  },
  get(id: TaskId): Task | undefined {
    return tasks.get(id);
  },
  update(id: TaskId, patch: Partial<Task>): Task | undefined {
    const task = tasks.get(id);
    if (!task) return undefined;
    const updated = { ...task, ...patch };
    tasks.set(id, updated);
    return updated;
  },
  getByClient(clientId: UserId): Task[] {
    return Array.from(tasks.values()).filter(t => t.clientId === clientId);
  },
  getByDriver(driverId: UserId): Task[] {
    return Array.from(tasks.values()).filter(t => t.driverId === driverId);
  },
  getOpen(zone: string): Task[] {
    return Array.from(tasks.values()).filter(t => t.status === 'open' && t.zone === zone);
  },
  all(): Task[] {
    return Array.from(tasks.values());
  },
};
