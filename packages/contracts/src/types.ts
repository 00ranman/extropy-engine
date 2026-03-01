/**
 * ══════════════════════════════════════════════════════════════════════════════
 * @extropy/contracts — Shared Type Definitions
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ──────────────────────────────────────────────────────────────────────────────
// Core Domain Types
// ──────────────────────────────────────────────────────────────────────────────

export interface Belief {
  id: string;
  userId: string;
  content: string;
  confidence: number;        // 0–1 float
  domain: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  handle: string;
  email: string;
  createdAt: Date;
}

export interface Signal {
  id: string;
  sourceBeliefId: string;
  type: 'convergence' | 'divergence' | 'novel' | 'reinforcement';
  strength: number;          // 0–1 float
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Loop {
  id: string;
  userId: string;
  beliefId: string;
  signalId: string;
  status: 'open' | 'closed' | 'abandoned';
  openedAt: Date;
  closedAt: Date | null;
}

export interface ReputationScore {
  userId: string;
  score: number;
  delta: number;
  computedAt: Date;
}

export interface XPEntry {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  mintedAt: Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Event Types
// ──────────────────────────────────────────────────────────────────────────────

export type ExtropyEventType =
  | 'belief.created'
  | 'belief.updated'
  | 'signal.fired'
  | 'loop.closed'
  | 'reputation.updated'
  | 'xp.minted';

export interface ExtropyEvent {
  type: ExtropyEventType;
  payload: Record<string, unknown>;
  timestamp: string;         // ISO 8601
  serviceId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// HTTP Request/Response Shapes
// ──────────────────────────────────────────────────────────────────────────────

export interface CreateBeliefRequest {
  userId: string;
  content: string;
  confidence: number;
  domain: string;
}

export interface CreateSignalRequest {
  sourceBeliefId: string;
  type: Signal['type'];
  strength: number;
  metadata?: Record<string, unknown>;
}

export interface CreateLoopRequest {
  userId: string;
  beliefId: string;
  signalId: string;
}

export interface MintXPRequest {
  userId: string;
  amount: number;
  reason: string;
}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
