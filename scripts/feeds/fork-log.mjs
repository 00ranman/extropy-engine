/**
 * Append a public fork to nodes/forks.json.
 * Uses the fork event's login and created_at, plus GitHub's fork count.
 * Does not read email. Does not post to X.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FORKS_SCHEMA = "extropy.forks.v1";
export const FORKS_NOTE =
  "A fork is a public GitHub fork. It is not a pocket and it is not a node. fork_count is GitHub's number when the event was logged. Null means GitHub did not give a number.";

export function emptyForks() {
  return { schema: FORKS_SCHEMA, note: FORKS_NOTE, entries: [] };
}

export function readForkEvent(event) {
  const forker = event?.forkee?.owner?.login;
  if (typeof forker !== "string" || forker.trim() === "") {
    throw new Error("fork event has no public login");
  }
  const created_at = event?.forkee?.created_at;
  if (typeof created_at !== "string" || created_at.trim() === "") {
    throw new Error("fork event has no created_at");
  }
  return {
    forker: forker.trim(),
    created_at,
    eventForkCount: event?.repository?.forks_count,
  };
}

export async function resolveForkCount(eventForkCount, fetchRepo) {
  if (typeof fetchRepo === "function") {
    try {
      const repo = await fetchRepo();
      if (Number.isInteger(repo?.forks_count) && repo.forks_count >= 0) {
        return { fork_count: repo.forks_count, fork_count_source: "github_api" };
      }
    } catch {
      /* public API missed. Fall through to the event payload, then null. */
    }
  }
  if (Number.isInteger(eventForkCount) && eventForkCount >= 0) {
    return { fork_count: eventForkCount, fork_count_source: "fork_event" };
  }
  return { fork_count: null, fork_count_source: null };
}

export function appendForkEntry(doc, entry) {
  const base = doc && doc.schema ? doc : emptyForks();
  const entries = Array.isArray(base.entries) ? base.entries : [];
  const dup = entries.some((row) => row.forker === entry.forker && row.created_at === entry.created_at);
  if (dup) return { ...base, note: FORKS_NOTE, entries };
  return { ...base, note: FORKS_NOTE, entries: [...entries, entry] };
}

export async function logFork({ event, fetchRepo, doc }) {
  const parsed = readForkEvent(event);
  const count = await resolveForkCount(parsed.eventForkCount, fetchRepo);
  const entry = {
    forker: parsed.forker,
    created_at: parsed.created_at,
    fork_count: count.fork_count,
  };
  if (count.fork_count_source) entry.fork_count_source = count.fork_count_source;
  if (entry.email || event?.forkee?.owner?.email) {
    delete entry.email;
  }
  return appendForkEntry(doc, entry);
}

export async function fetchPublicRepo(repo, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "extropy-feeds",
    },
  });
  if (!res.ok) throw new Error(`github repo ${res.status}`);
  return res.json();
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!eventPath) {
    console.error("GITHUB_EVENT_PATH is required");
    process.exit(2);
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const out = resolve(process.cwd(), "nodes/forks.json");
  const doc = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : emptyForks();
  const fetchRepo = repo ? () => fetchPublicRepo(repo) : null;
  const next = await logFork({ event, fetchRepo, doc });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(next, null, 2) + "\n");
  console.log(JSON.stringify({ entries: next.entries.length }));
}
