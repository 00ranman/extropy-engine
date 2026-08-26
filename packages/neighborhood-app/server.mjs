#!/usr/bin/env node
/**
 * Extropy Engine — neighborhood app (laptop node, no Docker required)
 * MESO job board + MICRO crews + DAG on disk.
 *   node server.mjs
 *   open http://localhost:4016
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateIdentity, signPayload } from "./did.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4016);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "board.json");
const PUBLIC = path.join(__dirname, "public");
const MESO = process.env.MESO_NAME || "Sunset Oaks";
const identity = loadOrCreateIdentity(DATA_DIR);

function stamp(v) {
  const body = {
    id: v.id,
    t: v.t,
    kind: v.kind,
    title: v.title,
    by: v.by,
    crew: v.crew,
    parentIds: v.parentIds,
    status: v.status ?? null,
  };
  return {
    ...v,
    did: identity.did,
    sig: signPayload(identity.privateKey, body),
  };
}

const CREWS0 = ["Grounds", "Lights", "Storm", "Garden", "Mediation"];

function emptyState() {
  return {
    meso: MESO,
    scale: "MESO",
    crews: [...CREWS0],
    dag: [
      stamp({
        id: "v0",
        t: Date.now(),
        kind: "genesis",
        title: `${MESO} MESO`,
        by: "system",
        crew: "MESO",
        parentIds: [],
      }),
    ],
  };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    const s = emptyState();
    save(s);
    return s;
  }
}

function save(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

function jobs(s) {
  return s.dag.filter((v) => v.kind === "job");
}

function json(res, code, body) {
  const raw = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end("no");
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": mime(file) });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  try {
    if (url.pathname === "/api/did" && req.method === "GET") {
      return json(res, 200, {
        did: identity.did,
        also: identity.also,
        publicKeyMultibase: identity.publicKeyMultibase,
        method: identity.method,
        curve: identity.curve,
        created: identity.created,
      });
    }
    if (url.pathname === "/api/state" && req.method === "GET") {
      const s = load();
      return json(res, 200, { ...s, jobs: jobs(s), did: identity.did });
    }
    if (url.pathname === "/api/jobs" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.title || !b.by) return json(res, 400, { error: "title and by required" });
      const s = load();
      const last = s.dag[s.dag.length - 1]?.id ?? "v0";
      const v = {
        id: `v${s.dag.length}`,
        t: Date.now(),
        kind: "job",
        title: String(b.title).slice(0, 280),
        by: String(b.by).slice(0, 80),
        crew: String(b.crew || "Grounds").slice(0, 80),
        status: "open",
        parentIds: [last],
      };
      const signed = stamp(v);
      s.dag.push(signed);
      save(s);
      return json(res, 201, signed);
    }
    const take = url.pathname.match(/^\/api\/jobs\/([^/]+)\/take$/);
    if (take && req.method === "POST") {
      const b = await readBody(req);
      const s = load();
      const job = s.dag.find((v) => v.id === take[1] && v.kind === "job");
      if (!job) return json(res, 404, { error: "no job" });
      if (job.status !== "open") return json(res, 409, { error: "not open" });
      job.status = "taken";
      s.dag.push(
        stamp({
          id: `v${s.dag.length}`,
          t: Date.now(),
          kind: "take",
          title: `took: ${job.title}`,
          by: String(b.by || "anon").slice(0, 80),
          crew: job.crew,
          parentIds: [job.id],
        }),
      );
      save(s);
      return json(res, 200, job);
    }
    const close = url.pathname.match(/^\/api\/jobs\/([^/]+)\/close$/);
    if (close && req.method === "POST") {
      const b = await readBody(req);
      const s = load();
      const job = s.dag.find((v) => v.id === close[1] && v.kind === "job");
      if (!job) return json(res, 404, { error: "no job" });
      if (job.status === "closed") return json(res, 409, { error: "already closed" });
      job.status = "closed";
      s.dag.push(
        stamp({
          id: `v${s.dag.length}`,
          t: Date.now(),
          kind: "close",
          title: `closed: ${job.title}`,
          by: String(b.by || "anon").slice(0, 80),
          crew: job.crew,
          parentIds: [job.id],
        }),
      );
      save(s);
      return json(res, 200, job);
    }
    if (url.pathname === "/api/crews" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name) return json(res, 400, { error: "name required" });
      const s = load();
      const name = String(b.name).slice(0, 80);
      if (!s.crews.includes(name)) s.crews.push(name);
      s.dag.push(
        stamp({
          id: `v${s.dag.length}`,
          t: Date.now(),
          kind: "crew",
          title: name,
          by: String(b.by || "anon").slice(0, 80),
          crew: name,
          parentIds: ["v0"],
        }),
      );
      save(s);
      return json(res, 201, { name });
    }
    if (url.pathname === "/health") return json(res, 200, { ok: true, meso: load().meso, did: identity.did });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const ifs = os.networkInterfaces();
  const lan = Object.values(ifs)
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal);
  console.log(`Extropy Engine — neighborhood app`);
  console.log(`  MESO     ${MESO}`);
  console.log(`  local    http://127.0.0.1:${PORT}`);
  if (lan) console.log(`  LAN      http://${lan.address}:${PORT}`);
  console.log(`  DID      ${identity.did}`);
  console.log(`  book     ${FILE}`);
  console.log(`  this machine is the node. next house: same repo, or hit the LAN address.`);
});
