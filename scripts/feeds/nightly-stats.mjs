/**
 * Nightly public stats. Missing sources are null. Nothing here is invented.
 * Does not post to X.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STATS_SCHEMA = "extropy.stats.v1";
export const CSV_HEADER = "recorded_at,stars,forks,open_problems,loops,supporters,pockets";
export const STATS_NOTE =
  "Each field is a count from a named public source. Null means that source could not be read. Null is not zero. An empty list that was actually read is zero.";

const FIELDS = ["stars", "forks", "open_problems", "loops", "supporters", "pockets"];

export function countOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function buildStats(input) {
  const stats = {
    schema: STATS_SCHEMA,
    updated_at: input.updated_at ?? null,
    note: STATS_NOTE,
  };
  for (const key of FIELDS) stats[key] = countOrNull(input[key]);
  return stats;
}

export function statsCsvLine(stats) {
  const cell = (value) => (value == null ? "null" : String(value));
  return [stats.updated_at ?? "null", ...FIELDS.map((key) => cell(stats[key]))].join(",");
}

export function appendStatsHistory(csvText, line) {
  const body = csvText == null || csvText.trim() === "" ? `${CSV_HEADER}\n` : csvText.endsWith("\n") ? csvText : `${csvText}\n`;
  return `${body}${line}\n`;
}

async function getJson(url, fetchImpl, headers) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

export async function loadStatsSources({
  repo,
  token,
  recordUrl,
  supportersUrl,
  pocketsUrl,
  fetchImpl = fetch,
}) {
  const headers = { accept: "application/json", "user-agent": "extropy-feeds" };
  const gh = { ...headers, accept: "application/vnd.github+json" };
  if (token) gh.authorization = `Bearer ${token}`;
  const out = {
    stars: null,
    forks: null,
    open_problems: null,
    loops: null,
    supporters: null,
    pockets: null,
  };
  try {
    const repoJson = await getJson(`https://api.github.com/repos/${repo}`, fetchImpl, gh);
    out.stars = countOrNull(repoJson.stargazers_count);
    out.forks = countOrNull(repoJson.forks_count);
  } catch {
    out.stars = null;
    out.forks = null;
  }
  try {
    const issues = await getJson(
      `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${repo} is:issue is:open label:open-problem`)}&per_page=1`,
      fetchImpl,
      gh,
    );
    out.open_problems = countOrNull(issues.total_count);
  } catch {
    out.open_problems = null;
  }
  try {
    const record = await getJson(recordUrl, fetchImpl, headers);
    out.loops = Array.isArray(record?.loops) ? record.loops.length : null;
  } catch {
    out.loops = null;
  }
  try {
    const supporters = await getJson(supportersUrl, fetchImpl, headers);
    out.supporters = countOrNull(supporters?.count);
  } catch {
    out.supporters = null;
  }
  try {
    const pockets = await getJson(pocketsUrl, fetchImpl, headers);
    out.pockets = Array.isArray(pockets?.entries) ? pockets.entries.length : null;
  } catch {
    out.pockets = null;
  }
  return out;
}

export function renderStatsHtml(stats) {
  const row = (label, value) => `<tr><th>${label}</th><td>${value == null ? "null" : String(value)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Record ledger</title>
<style>
  body { margin: 0; background: #14120b; color: #f4efe4; font: 18px/1.45 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  a { color: #e2b657; }
  td, th { text-align: left; padding: 0.35rem 0.8rem 0.35rem 0; }
</style>
</head>
<body>
<main>
<h1>Record ledger</h1>
<p>Nightly public counts. Null means that source was not readable. Null is not zero. Showing a null is the point.</p>
<table>
${row("Stars", stats.stars)}
${row("Forks", stats.forks)}
${row("Open problems", stats.open_problems)}
${row("Loops", stats.loops)}
${row("Supporters", stats.supporters)}
${row("Pockets", stats.pockets)}
</table>
<p>Updated: ${stats.updated_at == null ? "null" : stats.updated_at}</p>
<p><a href="/stats.json">stats.json</a></p>
<p>The dollar gates nothing. <a href="https://extropyengine.com/dollar">extropyengine.com/dollar</a></p>
</main>
</body>
</html>
`;
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const repo = process.env.GITHUB_REPOSITORY || "00ranman/extropy-engine";
  const sources = await loadStatsSources({
    repo,
    token: process.env.GITHUB_TOKEN || "",
    recordUrl: process.env.RECORD_URL || "https://extropyengine.com/record.json",
    supportersUrl: process.env.SUPPORTERS_URL || "https://extropyengine.com/supporters.json",
    pocketsUrl: process.env.POCKETS_URL || "https://extropyengine.com/pockets.json",
  });
  const stats = buildStats({ ...sources, updated_at: new Date().toISOString() });
  const jsonPath = resolve(process.cwd(), "site-drop/public/stats.json");
  const htmlPath = resolve(process.cwd(), "site-drop/public/stats/index.html");
  const csvPath = resolve(process.cwd(), "stats-history.csv");
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(stats, null, 2) + "\n");
  writeFileSync(htmlPath, renderStatsHtml(stats));
  const prior = existsSync(csvPath) ? readFileSync(csvPath, "utf8") : "";
  writeFileSync(csvPath, appendStatsHistory(prior, statsCsvLine(stats)));
  console.log(JSON.stringify(stats));
}
