/**
 * Wire protocol types for the sandbox node-handshake.
 * See packages/node-handshake/README.md for the full spec.
 */

import { z } from 'zod';

export const NodeRole = z.enum(['vps', 'local', 'validator', 'observer']);
export type NodeRole = z.infer<typeof NodeRole>;

export const NodeId = z
  .string()
  .regex(/^ed25519:[A-Za-z0-9_+/=-]+$/, 'NodeId must be ed25519:<base64-pubkey>');
export type NodeId = z.infer<typeof NodeId>;

const baseSigned = {
  ts: z.string().datetime({ offset: true }),
  signature: z.string(),
};

export const HelloRequest = z.object({
  nodeId: NodeId,
  version: z.string(),
  spec: z.string(),
  role: NodeRole,
  features: z.array(z.string()),
  nonce: z.string().uuid(),
  ...baseSigned,
});
export type HelloRequest = z.infer<typeof HelloRequest>;

export const HelloResponse = z.object({
  ok: z.boolean(),
  peerNodeId: NodeId,
  version: z.string(),
  spec: z.string(),
  role: NodeRole,
  features: z.array(z.string()),
  sessionId: z.string().uuid(),
  ...baseSigned,
});
export type HelloResponse = z.infer<typeof HelloResponse>;

export const CapabilitiesEnvelope = z.object({
  sessionId: z.string().uuid(),
  packages: z.array(z.string()),
  validatedDomains: z.array(z.string()),
  loadFactor: z.number().min(0).max(1),
  acceptsInboundClaims: z.boolean(),
  acceptsInboundQuests: z.boolean(),
  ...baseSigned,
});
export type CapabilitiesEnvelope = z.infer<typeof CapabilitiesEnvelope>;

export const DagReplayRequest = z.object({
  sessionId: z.string().uuid(),
  fromIndex: z.number().int().nonnegative(),
  toIndex: z.number().int().nonnegative(),
  ...baseSigned,
});
export type DagReplayRequest = z.infer<typeof DagReplayRequest>;

export const HeartbeatEnvelope = z.object({
  sessionId: z.string().uuid(),
  depth: z.number().int().nonnegative(),
  ...baseSigned,
});
export type HeartbeatEnvelope = z.infer<typeof HeartbeatEnvelope>;

/**
 * Canonicalize an envelope for signing/verification.
 * Sorts keys, excludes the `signature` field, returns deterministic JSON.
 */
export function canonicalize(obj: Record<string, unknown>): string {
  const { signature: _omit, ...rest } = obj as Record<string, unknown>;
  const sorted = Object.keys(rest)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (rest as Record<string, unknown>)[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}
