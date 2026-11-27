import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  adCheckConfirmError,
  adCheckDoneError,
  exportRecord,
  posterMint,
  readOpenFields,
  sha256,
} from "./record.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const mesh = resolve(here, "mesh.mjs");

test("open fields default consent off and do not invent a proxy", () => {
  const fields = readOpenFields({ task: "check the ad" });
  assert.equal(fields.class, null);
  assert.equal(fields.deltaS, null);
  assert.equal(fields.okToFeature, false);
  assert.deepEqual(fields.parties, []);
  assert.equal(readOpenFields({ delta_s: 0 }).deltaS, 0);
  assert.equal(readOpenFields({ ok_to_feature: "true" }).okToFeature, false);
  assert.equal(readOpenFields({ ok_to_feature: true }).okToFeature, true);
});

test("public strip is envelope A and leaves envelope C out", () => {
  const dag = [
    {
      loopId: "loop-1",
      state: "OPEN",
      hash: "openhash",
      class: "lawn",
      deltaS: 1.25,
      task: "mow the private lawn",
      evidence: "photo-bytes",
      why: "secret why",
      actor: "ed25519:poster",
      signature: "sig-open",
      ts: "2026-11-27T00:00:00.000Z",
      parties: ["ed25519:poster"],
      okToFeature: false,
      parents: [],
    },
    {
      loopId: "loop-1",
      state: "DONE",
      hash: "donehash",
      actor: "ed25519:worker",
      task: "mow the private lawn",
      evidence: "photo-bytes",
      okToFeature: true,
    },
    {
      loopId: "loop-1",
      state: "CONFIRM",
      hash: "confirmhash",
      parents: ["openhash"],
      actor: "ed25519:poster",
      signature: "sig-confirm",
      ts: "2026-11-27T01:00:00.000Z",
      why: "looks good",
      okToFeature: true,
    },
  ];
  const record = exportRecord(dag, "2026-11-27T02:00:00.000Z");
  assert.equal(record.loops.length, 1);
  const loop = record.loops[0];
  assert.equal(loop.class, "lawn");
  assert.equal(loop.delta_s, 1.25);
  assert.equal(loop.state, "CONFIRM");
  assert.equal(loop.hashes.confirm, "confirmhash");
  assert.equal(loop.hashes.evidence, sha256("photo-bytes"));
  assert.equal(loop.ok_to_feature, false);
  assert.equal(loop.poster_mint, null);
  const blob = JSON.stringify(record);
  for (const secret of ["mow the private lawn", "photo-bytes", "secret why", "looks good", "ed25519:poster", "sig-open"]) {
    assert.equal(blob.includes(secret), false, secret);
  }
  assert.match(record.note, /not finished/i);
  assert.doesNotMatch(record.note, /\u2014/);
});

test("ok to feature stays false unless open, done, and confirm all say yes", () => {
  const base = (ok) => ({
    loopId: "loop-2",
    hash: ok.state,
    class: "errand",
    deltaS: null,
    okToFeature: ok.yes,
    parents: [],
    ...ok,
  });
  const no = exportRecord([
    base({ state: "OPEN", yes: true }),
    base({ state: "DONE", yes: false }),
    base({ state: "CONFIRM", yes: true, hash: "c" }),
  ]);
  assert.equal(no.loops[0].ok_to_feature, false);
  assert.equal(no.loops[0].delta_s, null);
  const yes = exportRecord([
    base({ state: "OPEN", yes: true }),
    base({ state: "DONE", yes: true }),
    base({ state: "CONFIRM", yes: true, hash: "c2" }),
  ]);
  assert.equal(yes.loops[0].ok_to_feature, true);
});

test("unsettled loops are omitted and a later burn stays on the strip", () => {
  const openOnly = exportRecord([{ loopId: "x", state: "OPEN", hash: "h", task: "hidden" }]);
  assert.equal(openOnly.loops.length, 0);
  const burned = exportRecord([
    { loopId: "y", state: "OPEN", hash: "o", class: "lawn" },
    { loopId: "y", state: "CONFIRM", hash: "c", parents: ["o"] },
    { loopId: "y", state: "BURN", hash: "b", why: "photo was crap", task: "still private" },
  ]);
  assert.equal(burned.loops[0].state, "BURN");
  assert.equal(burned.loops[0].hashes.burn, "b");
  assert.equal(JSON.stringify(burned).includes("photo was crap"), false);
  assert.equal(JSON.stringify(burned).includes("still private"), false);
});

test("ad-check mints 0 for the poster and rejects a party verifier", () => {
  assert.equal(posterMint("ad-check"), 0);
  assert.equal(posterMint("lawn"), null);
  const open = { class: "ad-check", actor: "poster", parties: ["poster", "page"] };
  assert.equal(
    adCheckDoneError(open, "poster"),
    "ad-check verifier cannot be the poster or a party to the post",
  );
  assert.equal(adCheckDoneError(open, "page"), "ad-check verifier cannot be the poster or a party to the post");
  assert.equal(adCheckDoneError(open, "stranger"), null);
  assert.equal(adCheckConfirmError(open, "stranger"), "ad-check confirm is the poster's signature");
  assert.equal(adCheckConfirmError(open, "poster"), null);
  assert.equal(adCheckDoneError({ class: "lawn", actor: "poster", parties: [] }, "poster"), null);

  const record = exportRecord([
    { loopId: "ad", state: "OPEN", hash: "o", class: "ad-check", actor: "poster", task: "check this ad", deltaS: null },
    { loopId: "ad", state: "DONE", hash: "d", actor: "stranger" },
    { loopId: "ad", state: "CONFIRM", hash: "c", actor: "poster" },
  ]);
  assert.equal(record.loops[0].poster_mint, 0);
  assert.equal(record.loops[0].delta_s, null);
  assert.equal(record.loops[0].ok_to_feature, false);
  assert.equal(JSON.stringify(record).includes("check this ad"), false);
});

test("mesh http enforces ad-check parties and exports a public strip", async () => {
  const dirA = mkdtempSync(resolve(tmpdir(), "mesh-a-"));
  const dirB = mkdtempSync(resolve(tmpdir(), "mesh-b-"));
  const portA = 4510;
  const portB = 4511;
  const a = spawn(process.execPath, [mesh, "serve"], {
    env: { ...process.env, DATA: dirA, PORT: String(portA), HOST: "127.0.0.1", PEER: `http://127.0.0.1:${portB}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const b = spawn(process.execPath, [mesh, "serve"], {
    env: { ...process.env, DATA: dirB, PORT: String(portB), HOST: "127.0.0.1", PEER: `http://127.0.0.1:${portA}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitFor(`http://127.0.0.1:${portA}/health`);
    await waitFor(`http://127.0.0.1:${portB}/health`);
    const healthB = await fetch(`http://127.0.0.1:${portB}/health`).then((r) => r.json());

    const opened = await post(`http://127.0.0.1:${portA}/loop/open`, {
      task: "check this ad: count, link, nothing gated",
      class: "ad-check",
      evidence: "claims-list",
    });
    assert.equal(opened.class, "ad-check");
    assert.equal(opened.okToFeature, false);

    const selfDone = await post(`http://127.0.0.1:${portA}/loop/done`, { loopId: opened.loopId }, false);
    assert.equal(selfDone.status, 403);

    const partyOpen = await post(`http://127.0.0.1:${portA}/loop/open`, {
      task: "second ad",
      class: "ad-check",
      parties: [healthB.nodeId],
    });
    const partyDone = await post(`http://127.0.0.1:${portB}/loop/done`, { loopId: partyOpen.loopId }, false);
    assert.equal(partyDone.status, 403);

    const strangerDone = await post(`http://127.0.0.1:${portB}/loop/done`, {
      loopId: opened.loopId,
      evidence: "walked the three claims",
    });
    assert.equal(strangerDone.state, "DONE");

    const strangerConfirm = await post(`http://127.0.0.1:${portB}/loop/confirm`, { loopId: opened.loopId }, false);
    assert.equal(strangerConfirm.status, 400);

    const confirmed = await post(`http://127.0.0.1:${portA}/loop/confirm`, { loopId: opened.loopId });
    assert.equal(confirmed.state, "CONFIRM");

    const record = await fetch(`http://127.0.0.1:${portA}/record`).then((r) => r.json());
    const loop = record.loops.find((item) => item.loop_id === opened.loopId);
    assert.ok(loop);
    assert.equal(loop.class, "ad-check");
    assert.equal(loop.poster_mint, 0);
    assert.equal(loop.ok_to_feature, false);
    assert.equal(loop.delta_s, null);
    const blob = JSON.stringify(record);
    assert.equal(blob.includes("check this ad"), false);
    assert.equal(blob.includes("walked the three claims"), false);
    assert.equal(blob.includes(healthB.nodeId), false);
  } finally {
    a.kill();
    b.kill();
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

async function waitFor(url) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 4000) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = String(res.status);
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout ${url} ${last}`);
}

async function post(url, body, expectOk = true) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!expectOk) return { status: res.status, ...json };
  if (!res.ok) throw new Error(`${url} ${res.status} ${JSON.stringify(json)}`);
  return json;
}
