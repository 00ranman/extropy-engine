#!/usr/bin/env node
/**
 * Extropy mesh — Web3 as promised.
 * Two boxes. Signed vertices. Both edges. No bag. No gas. No chain.
 *
 *   DATA=./.mesh-a PORT=4210 node packages/mesh/mesh.mjs serve
 *   DATA=./.mesh-b PORT=4211 PEER=http://127.0.0.1:4210 node packages/mesh/mesh.mjs serve
 *   DATA=./.mesh-a node packages/mesh/mesh.mjs open --task "mow the lawn" --peer http://127.0.0.1:4211
 *   DATA=./.mesh-b node packages/mesh/mesh.mjs confirm --id <loopId>
 *   DATA=./.mesh-a node packages/mesh/mesh.mjs burn --id <loopId> --why "photo was crap"
 */
import { createServer } from "node:http";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  randomUUID,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DATA = resolve(process.env.DATA || ".mesh");
const PORT = Number(process.env.PORT || 4210);
const HOST = process.env.HOST || "127.0.0.1";
const SPKI_PREFIX = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

mkdirSync(DATA, { recursive: true });

function loadOrCreateKeys() {
  const p = resolve(DATA, "node.json");
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const rec = {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    nodeId: nodeIdFromPem(publicKey.export({ type: "spki", format: "pem" }).toString()),
  };
  writeFileSync(p, JSON.stringify(rec, null, 2));
  return rec;
}

function nodeIdFromPem(pem) {
  const pub = createPublicKey(pem);
  const der = pub.export({ format: "der", type: "spki" });
  const raw = der.subarray(der.length - 32);
  return `ed25519:${raw.toString("base64")}`;
}

function pubFromNodeId(nodeId) {
  const b64 = nodeId.slice("ed25519:".length);
  const raw = Buffer.from(b64, "base64");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

const keys = loadOrCreateKeys();
const priv = createPrivateKey(keys.privateKeyPem);
const NODE_ID = keys.nodeId;

function canonicalize(obj) {
  const { signature: _s, hash: _h, ...rest } = obj;
  return JSON.stringify(
    Object.keys(rest)
      .sort()
      .reduce((a, k) => {
        a[k] = rest[k];
        return a;
      }, {}),
  );
}

function sign(obj) {
  const payload = canonicalize(obj);
  return cryptoSign(null, Buffer.from(payload), priv).toString("base64");
}

function verify(nodeId, obj) {
  try {
    const payload = canonicalize(obj);
    return cryptoVerify(null, Buffer.from(payload), pubFromNodeId(nodeId), Buffer.from(obj.signature, "base64"));
  } catch {
    return false;
  }
}

function hashVertex(v) {
  return createHash("sha256").update(canonicalize(v)).digest("hex");
}

function loadJson(name, fallback) {
  const p = resolve(DATA, name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveJson(name, value) {
  writeFileSync(resolve(DATA, name), JSON.stringify(value, null, 2));
}

function loadDag() {
  return loadJson("dag.json", []);
}

function saveDag(dag) {
  saveJson("dag.json", dag);
}

function loadPeers() {
  const fromFile = loadJson("peers.json", []);
  const env = process.env.PEER ? [process.env.PEER] : [];
  return [...new Set([...fromFile, ...env].filter(Boolean))];
}

function addPeer(url) {
  if (!url) return;
  const cur = loadJson("peers.json", []);
  if (!cur.includes(url)) {
    cur.push(url);
    saveJson("peers.json", cur);
  }
}

function append(vertex) {
  const dag = loadDag();
  if (dag.some((x) => x.id === vertex.id && x.state === vertex.state)) return vertex;
  dag.push(vertex);
  saveDag(dag);
  return vertex;
}

function makeVertex(fields) {
  const parents = loadDag()
    .slice(-3)
    .map((v) => v.hash)
    .filter(Boolean);
  const body = {
    id: fields.id || randomUUID(),
    loopId: fields.loopId || fields.id || randomUUID(),
    actor: NODE_ID,
    task: fields.task || "",
    state: fields.state,
    parents,
    evidence: fields.evidence || "",
    why: fields.why || "",
    ts: new Date().toISOString(),
  };
  const signed = { ...body, signature: sign(body) };
  signed.hash = hashVertex(signed);
  return signed;
}

async function postJson(url, path, body) {
  const r = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`${path} ${r.status} ${text}`);
  return json;
}

async function gossip(vertex) {
  for (const peer of loadPeers()) {
    try {
      await postJson(peer, "/ingest", vertex);
    } catch (e) {
      console.error("[gossip]", peer, e.message);
    }
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          nodeId: NODE_ID,
          vertices: loadDag().length,
          peers: loadPeers(),
          note: "loop not bag. no gas.",
        });
      }
      if (req.method === "GET" && url.pathname === "/dag") {
        return json(res, 200, { nodeId: NODE_ID, vertices: loadDag() });
      }
      if (req.method === "POST" && url.pathname === "/hello") {
        const env = await readBody(req);
        if (!env.nodeId || !verify(env.nodeId, env)) return json(res, 401, { error: "bad hello" });
        addPeer(env.listen);
        const body = { nodeId: NODE_ID, ts: new Date().toISOString(), listen: `http://${HOST}:${PORT}` };
        return json(res, 200, { ...body, signature: sign(body) });
      }
      if (req.method === "POST" && url.pathname === "/ingest") {
        const v = await readBody(req);
        if (!v.actor || !verify(v.actor, v)) return json(res, 401, { error: "bad vertex" });
        append(v);
        return json(res, 200, { ok: true, id: v.id, state: v.state });
      }
      if (req.method === "POST" && url.pathname === "/loop/open") {
        const { task, evidence } = await readBody(req);
        const v = makeVertex({ state: "OPEN", task, evidence });
        append(v);
        await gossip(v);
        return json(res, 200, v);
      }
      if (req.method === "POST" && url.pathname === "/loop/done") {
        const { loopId, evidence } = await readBody(req);
        const open = loadDag().find((x) => x.loopId === loopId && x.state === "OPEN");
        if (!open) return json(res, 404, { error: "no OPEN" });
        const v = makeVertex({ id: randomUUID(), loopId, state: "DONE", task: open.task, evidence });
        append(v);
        await gossip(v);
        return json(res, 200, v);
      }
      if (req.method === "POST" && url.pathname === "/loop/confirm") {
        const { loopId } = await readBody(req);
        const done = loadDag().find((x) => x.loopId === loopId && x.state === "DONE");
        if (!done) return json(res, 404, { error: "no DONE" });
        if (done.actor === NODE_ID) return json(res, 400, { error: "other edge confirms" });
        const v = makeVertex({
          id: randomUUID(),
          loopId,
          state: "CONFIRM",
          task: done.task,
          evidence: done.evidence,
        });
        append(v);
        await gossip(v);
        return json(res, 200, v);
      }
      if (req.method === "POST" && url.pathname === "/loop/burn") {
        const { loopId, why } = await readBody(req);
        const v = makeVertex({ id: randomUUID(), loopId, state: "BURN", why, task: "" });
        append(v);
        await gossip(v);
        return json(res, 200, v);
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`[mesh] ${NODE_ID}`);
    console.log(`[mesh] http://${HOST}:${PORT}  data=${DATA}`);
    console.log(`[mesh] peers`, loadPeers());
    console.log(`[mesh] OPEN → DONE → CONFIRM. Other edge confirms. Later BURN. No bag.`);
  });
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : "";
}

async function helloPeer(peer) {
  const body = {
    nodeId: NODE_ID,
    ts: new Date().toISOString(),
    listen: process.env.LISTEN || "",
  };
  const env = { ...body, signature: sign(body) };
  const resp = await postJson(peer, "/hello", env);
  if (resp.nodeId) addPeer(peer);
  console.log("[hello]", resp.nodeId || resp);
}

async function main() {
  const cmd = process.argv[2] || "serve";
  if (cmd === "serve") return serve();
  if (cmd === "id") {
    console.log(NODE_ID);
    return;
  }
  if (cmd === "hello") {
    const peer = arg("peer") || process.env.PEER;
    if (!peer) throw new Error("--peer required");
    await helloPeer(peer);
    return;
  }
  if (cmd === "open") {
    const peer = arg("peer") || `http://127.0.0.1:${PORT}`;
    const task = arg("task") || "untitled loop";
    const v = await postJson(peer, "/loop/open", { task, evidence: arg("evidence") });
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  if (cmd === "done") {
    const peer = arg("peer") || `http://127.0.0.1:${PORT}`;
    const v = await postJson(peer, "/loop/done", { loopId: arg("id"), evidence: arg("evidence") });
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  if (cmd === "confirm") {
    const peer = arg("peer") || `http://127.0.0.1:${PORT}`;
    const v = await postJson(peer, "/loop/confirm", { loopId: arg("id") });
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  if (cmd === "burn") {
    const peer = arg("peer") || `http://127.0.0.1:${PORT}`;
    const v = await postJson(peer, "/loop/burn", { loopId: arg("id"), why: arg("why") || "crap evidence" });
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  if (cmd === "dag") {
    console.log(JSON.stringify(loadDag(), null, 2));
    return;
  }
  console.error("serve | id | hello | open | done | confirm | burn | dag");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
