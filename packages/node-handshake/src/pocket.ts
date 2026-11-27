/**
 * Opt-in public pocket hello.
 *
 * Default is off. The node emits a public entry only when the operator
 * turns the flag on AND types a town name. A town sitting in the
 * environment with the flag off is not published.
 */

export const POCKETS_SCHEMA = 'extropy.pockets.v1';

export interface PocketEntry {
  town: string;
  node_id: string;
  announced_at: string;
  spec: string;
}

export interface PocketsDocument {
  schema: typeof POCKETS_SCHEMA;
  updated_at: string | null;
  note: string;
  entries: PocketEntry[];
}

const POCKETS_NOTE =
  'Each entry is a node whose operator turned announce on and typed a town. A fork is not a pocket. The town is a name they typed, not a checked location.';

export function announceFlagOn(value: string | undefined | null): boolean {
  if (value == null) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Plain place name. No URLs, no handles, no blank. */
export function validTown(town: string | undefined | null): string | null {
  if (typeof town !== 'string') return null;
  const trimmed = town.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  if (/[\r\n\t]/.test(trimmed)) return null;
  if (/https?:|www\.|@/i.test(trimmed)) return null;
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’-]*$/u.test(trimmed)) return null;
  if (!/\p{L}/u.test(trimmed)) return null;
  return trimmed;
}

export function helloAnnounceFields(input: {
  flag?: string | null;
  town?: string | null;
}): { announcePocket: true; town: string } | Record<string, never> {
  const town = validTown(input.town);
  if (!announceFlagOn(input.flag) || !town) return {};
  return { announcePocket: true, town };
}

export function resolvePocketAnnounce(input: {
  flag?: string | null;
  town?: string | null;
  nodeId: string;
  announcedAt: string;
  spec: string;
}): { emit: false; reason: string } | { emit: true; entry: PocketEntry } {
  if (!announceFlagOn(input.flag)) {
    return { emit: false, reason: 'flag is off' };
  }
  if (input.town == null || input.town.trim() === '') {
    return { emit: false, reason: 'no town typed' };
  }
  const town = validTown(input.town);
  if (!town) {
    return { emit: false, reason: 'town is not a plain place name' };
  }
  return {
    emit: true,
    entry: {
      town,
      node_id: input.nodeId,
      announced_at: input.announcedAt,
      spec: input.spec,
    },
  };
}

export function pocketsDocument(entries: PocketEntry[], updatedAt: string | null): PocketsDocument {
  return {
    schema: POCKETS_SCHEMA,
    updated_at: updatedAt,
    note: POCKETS_NOTE,
    entries,
  };
}

/**
 * Flag off: do not ask. Flag on and a town is already typed: use it.
 * Flag on, no town, and a terminal is attached: read one line.
 * A blank line keeps the pocket quiet.
 */
export async function townFromOperator(input: {
  flag?: string | null;
  town?: string | null;
  isTty: boolean;
  readLine?: () => Promise<string>;
}): Promise<string | undefined> {
  if (!announceFlagOn(input.flag)) return undefined;
  if (input.town != null && input.town.trim() !== '') return input.town;
  if (!input.isTty || !input.readLine) return undefined;
  const line = await input.readLine();
  return line;
}

export function peerPocketEntry(hello: {
  announcePocket?: boolean;
  town?: string;
  nodeId: string;
  ts: string;
  spec: string;
}): PocketEntry | null {
  if (hello.announcePocket !== true) return null;
  const town = validTown(hello.town);
  if (!town) return null;
  return {
    town,
    node_id: hello.nodeId,
    announced_at: hello.ts,
    spec: hello.spec,
  };
}
