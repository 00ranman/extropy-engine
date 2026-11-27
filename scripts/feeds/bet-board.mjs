/**
 * Regenerate the static bet page from public GitHub issues and supporters.json.
 * Missing sources stay null. Does not post to X.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BET_SCHEMA = "extropy.bet.v1";
export const BET_NOTE =
  "open_problem_count is the number of open GitHub issues labeled open-problem. last_closed_problem is the latest of those issues GitHub shows as closed. supporter_count is the count field from supporters.json. Null means that source could not be read. It is not zero.";

export function countOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function issuesFromPayload(items) {
  return (Array.isArray(items) ? items : []).filter((item) => item && !item.pull_request && Number.isInteger(item.number));
}

export function summarizeIssues(items) {
  const issues = issuesFromPayload(items);
  const open = issues.filter((item) => item.state === "open");
  const closed = issues.filter((item) => item.state === "closed" && typeof item.closed_at === "string");
  closed.sort((a, b) => (a.closed_at < b.closed_at ? 1 : a.closed_at > b.closed_at ? -1 : 0));
  const last = closed[0];
  return {
    open_problem_count: open.length,
    last_closed_problem: last
      ? {
          number: last.number,
          title: typeof last.title === "string" ? last.title : null,
          closed_at: last.closed_at,
          url: typeof last.html_url === "string" ? last.html_url : null,
        }
      : null,
  };
}

export function buildBet({ updatedAt, openProblemCount, lastClosed, supporterCount, milestones }) {
  return {
    schema: BET_SCHEMA,
    updated_at: updatedAt,
    open_problem_count: countOrNull(openProblemCount),
    last_closed_problem: lastClosed ?? null,
    supporter_count: countOrNull(supporterCount),
    milestones: milestones ?? null,
    note: BET_NOTE,
  };
}

export function supporterCountFrom(json) {
  if (!json || typeof json !== "object") return null;
  return countOrNull(json.count);
}

export function milestonesFrom(items) {
  if (!Array.isArray(items)) return null;
  return items.map((item) => ({
    number: countOrNull(item.number),
    title: typeof item.title === "string" ? item.title : null,
    state: typeof item.state === "string" ? item.state : null,
    open_issues: countOrNull(item.open_issues),
    closed_issues: countOrNull(item.closed_issues),
  }));
}

function showCount(value, empty) {
  return countOrNull(value) == null ? empty : String(value);
}

export function renderBetHtml(bet) {
  const open = showCount(bet.open_problem_count, "not counted yet");
  const supporters = showCount(bet.supporter_count, "not counted yet");
  let last = "No labeled problem has been closed yet.";
  if (bet.last_closed_problem == null && bet.open_problem_count == null) {
    last = "not counted yet";
  } else if (bet.last_closed_problem) {
    const row = bet.last_closed_problem;
    const title = row.title || "untitled";
    const when = row.closed_at || "";
    last = row.url
      ? `<a href="${escapeHtml(row.url)}">#${row.number} ${escapeHtml(title)}</a> (${escapeHtml(when)})`
      : `#${row.number} ${escapeHtml(title)}`;
  }
  let milestones = "not counted yet";
  if (Array.isArray(bet.milestones)) {
    milestones =
      bet.milestones.length === 0
        ? "none"
        : bet.milestones
            .map((item) => {
              const openIssues = showCount(item.open_issues, "unknown");
              const closedIssues = showCount(item.closed_issues, "unknown");
              return `<li>${escapeHtml(item.title || "untitled")} (${escapeHtml(item.state || "unknown")}). Open issues ${openIssues}. Closed issues ${closedIssues}.</li>`;
            })
            .join("");
    milestones = `<ul>${milestones}</ul>`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The bet</title>
<style>
  body { margin: 0; background: #14120b; color: #f4efe4; font: 18px/1.45 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  a { color: #e2b657; }
</style>
</head>
<body>
<main>
<h1>The bet</h1>
<p>Open problems are GitHub issues labeled open-problem. The numbers below are that list and the public supporter file. "Not counted yet" means the source could not be read. It is not a guess, and it is not zero.</p>
<p><strong>Open problems left:</strong> ${escapeHtml(open)}</p>
<p><strong>Last closed problem:</strong> ${last}</p>
<p><strong>Supporters:</strong> ${escapeHtml(supporters)}</p>
<p><strong>Milestones:</strong> ${milestones}</p>
<p>The dollar gates nothing. <a href="https://extropyengine.com/dollar">extropyengine.com/dollar</a></p>
<p><a href="https://github.com/00ranman/extropy-engine/issues?q=label%3Aopen-problem">Issues labeled open-problem</a></p>
<p><a href="bet.json">bet.json</a></p>
</main>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function githubJson(url, token, fetchImpl) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "extropy-feeds" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

export async function loadLabeledIssues(repo, token, fetchImpl = fetch) {
  const all = [];
  for (const state of ["open", "closed"]) {
    for (let page = 1; page <= 10; page++) {
      const url = `https://api.github.com/repos/${repo}/issues?state=${state}&labels=open-problem&per_page=100&page=${page}`;
      const batch = await githubJson(url, token, fetchImpl);
      if (!Array.isArray(batch)) throw new Error("issues payload was not a list");
      all.push(...batch);
      if (batch.length < 100) break;
      if (page === 10 && batch.length === 100) throw new Error("issue list did not end");
    }
  }
  return all;
}

export async function loadBetSources({ repo, token, supportersUrl, fetchImpl = fetch }) {
  const out = {
    issues: null,
    milestones: null,
    supporterCount: null,
  };
  try {
    out.issues = await loadLabeledIssues(repo, token, fetchImpl);
  } catch {
    out.issues = null;
  }
  try {
    out.milestones = milestonesFrom(await githubJson(`https://api.github.com/repos/${repo}/milestones?state=all&per_page=100`, token, fetchImpl));
  } catch {
    out.milestones = null;
  }
  try {
    const res = await fetchImpl(supportersUrl, { headers: { accept: "application/json", "user-agent": "extropy-feeds" } });
    if (!res.ok) throw new Error(String(res.status));
    out.supporterCount = supporterCountFrom(await res.json());
  } catch {
    out.supporterCount = null;
  }
  return out;
}

export function betFromSources(sources, updatedAt) {
  if (!sources.issues) {
    return buildBet({
      updatedAt,
      openProblemCount: null,
      lastClosed: null,
      supporterCount: sources.supporterCount,
      milestones: sources.milestones,
    });
  }
  const summary = summarizeIssues(sources.issues);
  return buildBet({
    updatedAt,
    openProblemCount: summary.open_problem_count,
    lastClosed: summary.last_closed_problem,
    supporterCount: sources.supporterCount,
    milestones: sources.milestones,
  });
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const repo = process.env.GITHUB_REPOSITORY || "00ranman/extropy-engine";
  const token = process.env.GITHUB_TOKEN || "";
  const supportersUrl = process.env.SUPPORTERS_URL || "https://extropyengine.com/supporters.json";
  const sources = await loadBetSources({ repo, token, supportersUrl });
  const bet = betFromSources(sources, new Date().toISOString());
  const dir = resolve(process.cwd(), "site-drop/public/bet");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "bet.json"), JSON.stringify(bet, null, 2) + "\n");
  writeFileSync(resolve(dir, "index.html"), renderBetHtml(bet));
  console.log(JSON.stringify({ open_problem_count: bet.open_problem_count, supporter_count: bet.supporter_count }));
}

export function writeBetFiles(bet, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "bet.json"), JSON.stringify(bet, null, 2) + "\n");
  writeFileSync(resolve(dir, "index.html"), renderBetHtml(bet));
}
