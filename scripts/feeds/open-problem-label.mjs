/**
 * Create the open-problem label and apply it to the issues listed in
 * docs/open-problem-issues.json. Does not invent issues. Does not post to X.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function planLabelCalls(manifest, repo) {
  const name = manifest.label.name;
  const calls = [
    {
      method: "POST",
      path: `/repos/${repo}/labels`,
      body: {
        name,
        color: manifest.label.color,
        description: manifest.label.description,
      },
    },
  ];
  for (const issue of manifest.apply) {
    calls.push({
      method: "POST",
      path: `/repos/${repo}/issues/${issue.number}/labels`,
      body: { labels: [name] },
    });
  }
  return calls;
}

export async function applyManifest({ manifest, repo, request, dryRun }) {
  const calls = planLabelCalls(manifest, repo);
  if (dryRun) return { dryRun: true, calls };
  const results = [];
  for (const call of calls) {
    let response = await request(call.method, call.path, call.body);
    const creatingLabel = call.path.endsWith("/labels") && !call.path.includes("/issues/");
    if (creatingLabel && response.status === 422) {
      response = await request("PATCH", `/repos/${repo}/labels/${encodeURIComponent(manifest.label.name)}`, {
        color: manifest.label.color,
        description: manifest.label.description,
      });
    }
    if (response.status >= 300) {
      throw new Error(`${call.method} ${call.path} -> ${response.status} ${JSON.stringify(response.body)}`);
    }
    results.push({ path: call.path, status: response.status });
  }
  return { dryRun: false, results };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const apply = process.argv.includes("--apply");
  const repo = process.env.GITHUB_REPOSITORY || "00ranman/extropy-engine";
  const token = process.env.GITHUB_TOKEN || "";
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "docs/open-problem-issues.json"), "utf8"));
  if (!apply || !token) {
    const planned = await applyManifest({ manifest, repo, dryRun: true });
    console.log(JSON.stringify({ mode: "dry-run", calls: planned.calls.map((c) => `${c.method} ${c.path}`) }, null, 2));
    if (apply && !token) {
      console.error("GITHUB_TOKEN is required for --apply");
      process.exit(2);
    }
    process.exit(0);
  }
  const request = async (method, path, body) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "extropy-feeds",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed };
  };
  const result = await applyManifest({ manifest, repo, request, dryRun: false });
  console.log(JSON.stringify(result, null, 2));
}
