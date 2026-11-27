import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { emptyForks, logFork } from "./fork-log.mjs";
import { betFromSources, renderBetHtml, summarizeIssues, supporterCountFrom } from "./bet-board.mjs";
import { appendStatsHistory, buildStats, loadStatsSources, statsCsvLine } from "./nightly-stats.mjs";
import { applyManifest, planLabelCalls } from "./open-problem-label.mjs";
import { renderReceiptPage, writeReceipts } from "./render-receipts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("fork log keeps the public login and does not keep an email", async () => {
  const event = {
    forkee: {
      created_at: "2026-11-27T01:00:00Z",
      owner: { login: "someone", email: "hidden@example.com" },
    },
    repository: { forks_count: 2 },
  };
  const doc = await logFork({
    event,
    doc: emptyForks(),
    fetchRepo: async () => {
      throw new Error("down");
    },
  });
  assert.equal(doc.entries.length, 1);
  assert.deepEqual(doc.entries[0], {
    forker: "someone",
    created_at: "2026-11-27T01:00:00Z",
    fork_count: 2,
    fork_count_source: "fork_event",
  });
  assert.equal(JSON.stringify(doc).includes("hidden@example.com"), false);

  const fromApi = await logFork({
    event,
    doc: emptyForks(),
    fetchRepo: async () => ({ forks_count: 9 }),
  });
  assert.equal(fromApi.entries[0].fork_count, 9);
  assert.equal(fromApi.entries[0].fork_count_source, "github_api");

  const again = await logFork({ event, doc: fromApi, fetchRepo: async () => ({ forks_count: 9 }) });
  assert.equal(again.entries.length, 1);

  const unknown = await logFork({
    event: { forkee: { created_at: "2026-11-27T02:00:00Z", owner: { login: "other" } }, repository: {} },
    doc: emptyForks(),
    fetchRepo: async () => {
      throw new Error("down");
    },
  });
  assert.equal(unknown.entries[0].fork_count, null);
  assert.equal(unknown.entries[0].fork_count_source, undefined);
});

test("bet board counts labeled issues and leaves a missing supporter count null", () => {
  const summary = summarizeIssues([
    { number: 6, state: "open", title: "speed", labels: [{ name: "open-problem" }] },
    { number: 40, state: "open", title: "density" },
    { number: 2, state: "closed", title: "old", closed_at: "2026-01-01T00:00:00Z", html_url: "https://example.test/2" },
    { number: 9, state: "closed", title: "newer", closed_at: "2026-06-01T00:00:00Z", html_url: "https://example.test/9" },
    { number: 15, state: "open", pull_request: { url: "x" }, title: "a pr" },
  ]);
  assert.equal(summary.open_problem_count, 2);
  assert.equal(summary.last_closed_problem.number, 9);
  assert.equal(supporterCountFrom({ count: null }), null);
  assert.equal(supporterCountFrom({ count: "3" }), null);
  assert.equal(supporterCountFrom({ count: 0 }), 0);
  const bet = betFromSources(
    { issues: null, milestones: null, supporterCount: null },
    null,
  );
  assert.equal(bet.open_problem_count, null);
  assert.equal(bet.last_closed_problem, null);
  assert.equal(bet.supporter_count, null);
  const html = renderBetHtml(bet);
  assert.match(html, /not counted yet/);
  assert.doesNotMatch(html, /\u2014/);
  assert.doesNotMatch(html, /\bdonation\b|\binvestment\b|\bcrypto\b|\btoken\b/i);
});

test("nightly stats record null for every missing source and zero only for an empty list", async () => {
  const down = await loadStatsSources({
    repo: "00ranman/extropy-engine",
    token: "",
    recordUrl: "https://example.test/record.json",
    supportersUrl: "https://example.test/supporters.json",
    pocketsUrl: "https://example.test/pockets.json",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  const stats = buildStats({ ...down, updated_at: "2026-11-27T06:00:00Z" });
  for (const key of ["stars", "forks", "open_problems", "loops", "supporters", "pockets"]) {
    assert.equal(stats[key], null, key);
  }
  assert.match(statsCsvLine(stats), /null,null,null,null,null,null$/);

  const live = await loadStatsSources({
    repo: "00ranman/extropy-engine",
    token: "",
    recordUrl: "https://example.test/record.json",
    supportersUrl: "https://example.test/supporters.json",
    pocketsUrl: "https://example.test/pockets.json",
    fetchImpl: async (url) => {
      const table = {
        "https://api.github.com/repos/00ranman/extropy-engine": { stargazers_count: 3, forks_count: 0 },
        "https://api.github.com/search/issues?q=repo%3A00ranman%2Fextropy-engine%20is%3Aissue%20is%3Aopen%20label%3Aopen-problem&per_page=1":
          { total_count: 2 },
        "https://example.test/record.json": { loops: [] },
        "https://example.test/supporters.json": { count: null },
        "https://example.test/pockets.json": { entries: [] },
      };
      if (!table[url]) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => table[url] };
    },
  });
  assert.equal(live.stars, 3);
  assert.equal(live.forks, 0);
  assert.equal(live.open_problems, 2);
  assert.equal(live.loops, 0);
  assert.equal(live.supporters, null);
  assert.equal(live.pockets, 0);
  const csv = appendStatsHistory("recorded_at,stars,forks,open_problems,loops,supporters,pockets\n", "2026-11-27T06:00:00Z,3,0,2,0,null,0");
  assert.match(csv, /null,0\n$/);
  assert.doesNotMatch(buildStats({ updated_at: null }).note, /\u2014/);
});

test("open-problem label plan applies 6 and 40 and skips chores", async () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "docs/open-problem-issues.json"), "utf8"));
  const numbers = manifest.apply.map((issue) => issue.number);
  assert.deepEqual(numbers, [6, 40]);
  const skipped = manifest.not_applied.map((issue) => issue.number);
  for (const number of [3, 4, 12, 14, 28]) assert.ok(skipped.includes(number));
  const calls = planLabelCalls(manifest, "00ranman/extropy-engine");
  const paths = calls.map((call) => call.path);
  assert.ok(paths.some((path) => path.endsWith("/issues/6/labels")));
  assert.ok(paths.some((path) => path.endsWith("/issues/40/labels")));
  assert.equal(paths.some((path) => path.includes("/issues/3/")), false);

  const seen = [];
  const result = await applyManifest({
    manifest,
    repo: "00ranman/extropy-engine",
    dryRun: false,
    request: async (method, path) => {
      seen.push(`${method} ${path}`);
      if (method === "POST" && path === "/repos/00ranman/extropy-engine/labels") return { status: 422, body: {} };
      return { status: 200, body: {} };
    },
  });
  assert.equal(result.dryRun, false);
  assert.ok(seen.some((line) => line.startsWith("PATCH ") && line.includes("/labels/open-problem")));
});

test("receipt page is envelope A with an OpenGraph card", () => {
  const hash = "ab".repeat(32);
  const loop = {
    id: hash,
    loop_id: "loop-1",
    class: "ad-check",
    delta_s: null,
    state: "CONFIRM",
    hashes: { confirm: hash, open: "cd".repeat(32), parents: [] },
    poster_mint: 0,
    ok_to_feature: false,
    task: "private claim text",
    why: "sealed reason",
  };
  const page = renderReceiptPage(loop, "https://extropyengine.com");
  assert.match(page.html, /property="og:title"/);
  assert.match(page.html, /property="og:image" content="https:\/\/extropyengine\.com\/r\/ab/);
  assert.match(page.html, /not measured/);
  assert.match(page.html, /Ok to feature/);
  assert.match(page.html, />no</);
  assert.match(page.html, /Poster meter on this ad-check: 0/);
  assert.match(page.html, /not finished/);
  assert.equal(page.html.includes("private claim text"), false);
  assert.equal(page.html.includes("sealed reason"), false);
  assert.equal(page.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.doesNotMatch(page.html, /\u2014/);
  assert.doesNotMatch(page.svg, /\u2014|\bdonation\b|\btoken\b/i);
  const dir = mkdtempSync(resolve(tmpdir(), "receipts-"));
  try {
    const written = writeReceipts({ loops: [loop] }, dir);
    assert.deepEqual(written, [hash]);
    assert.equal(readFileSync(join(dir, hash, "index.html"), "utf8").includes("private claim text"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("public copy in the new feeds does not use the banned words", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(resolve(root, "site-drop"));
  files.push(resolve(root, "docs/OPEN_PROBLEM_LABEL.md"));
  files.push(resolve(root, "docs/open-problem-issues.json"));
  files.push(resolve(root, "packages/mesh/README.md"));
  files.push(resolve(root, "packages/node-handshake/README.md"));
  const banned = [/\u2014/, /\bdonation\b/i, /\binvestment\b/i, /\bcrypto\b/i, /\btoken\b/i];
  for (const path of files) {
    if (path.endsWith(".png")) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(text), false, `${path} matched ${pattern}`);
    }
  }
  for (const name of readdirSync(resolve(root, ".github/workflows"))) {
    const text = readFileSync(resolve(root, ".github/workflows", name), "utf8");
    assert.doesNotMatch(text, /TWITTER|X_API|api\.x\.com|bearer_token/i, name);
  }
});
