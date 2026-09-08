#!/usr/bin/env node
/** Two nodes, one loop, one burn. Run from repo root: node packages/mesh/demo.mjs */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mesh = resolve(here, "mesh.mjs");
const dirA = resolve(here, ".demo-a");
const dirB = resolve(here, ".demo-b");
rmSync(dirA, { recursive: true, force: true });
rmSync(dirB, { recursive: true, force: true });
mkdirSync(dirA);
mkdirSync(dirB);

function run(env) {
  const child = spawn(process.execPath, [mesh, "serve"], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${env.PORT}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${env.PORT}] ${d}`));
  return child;
}

const a = run({ DATA: dirA, PORT: "4210", HOST: "127.0.0.1", PEER: "http://127.0.0.1:4211" });
const b = run({ DATA: dirB, PORT: "4211", HOST: "127.0.0.1", PEER: "http://127.0.0.1:4210" });

await new Promise((r) => setTimeout(r, 400));

async function cli(data, port, args) {
  const r = spawn(process.execPath, [mesh, ...args], {
    env: { ...process.env, DATA: data, PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  r.stdout.on("data", (d) => {
    out += d;
  });
  r.stderr.on("data", (d) => {
    out += d;
  });
  const code = await new Promise((res) => r.on("close", res));
  if (code !== 0) throw new Error(out || `exit ${code}`);
  return out;
}

const opened = JSON.parse(await cli(dirA, "4210", ["open", "--task", "mow the lawn", "--peer", "http://127.0.0.1:4210"]));
console.log("OPEN", opened.loopId);
await new Promise((r) => setTimeout(r, 200));
const done = JSON.parse(await cli(dirB, "4211", ["done", "--id", opened.loopId, "--peer", "http://127.0.0.1:4211"]));
console.log("DONE", done.state, done.actor);
await new Promise((r) => setTimeout(r, 200));
const conf = JSON.parse(await cli(dirA, "4210", ["confirm", "--id", opened.loopId, "--peer", "http://127.0.0.1:4210"]));
console.log("CONFIRM", conf.state, conf.actor);
await new Promise((r) => setTimeout(r, 200));
const burn = JSON.parse(
  await cli(dirA, "4210", ["burn", "--id", opened.loopId, "--why", "photo was crap", "--peer", "http://127.0.0.1:4210"]),
);
console.log("BURN", burn.state, burn.why);

const ha = await fetch("http://127.0.0.1:4210/health").then((r) => r.json());
const hb = await fetch("http://127.0.0.1:4211/health").then((r) => r.json());
console.log("A vertices", ha.vertices, "B vertices", hb.vertices);
if (ha.vertices < 4 || hb.vertices < 4) {
  console.error("FAIL: both dags should have the gossiped loop");
  process.exit(1);
}
console.log("OK two boxes settled a loop and burned it. No bag.");
a.kill();
b.kill();
process.exit(0);
