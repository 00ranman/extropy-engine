/**
 * Static receipt pages for /r/<hash>.
 * Envelope A only. No X posting.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { receiptCard, receiptSvg } from "./card.mjs";

const SITE = "https://extropyengine.com";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function proxyLabel(delta) {
  return Number.isFinite(delta) ? String(delta) : "not measured";
}

export function featureLabel(value) {
  return value === true ? "yes" : "no";
}

export function shortHash(hash) {
  if (typeof hash !== "string" || hash.length < 16) return hash || "";
  return `${hash.slice(0, 12)}...${hash.slice(-6)}`;
}

export function renderReceiptPage(loop, baseUrl = SITE) {
  const hash = loop?.hashes?.confirm;
  if (typeof hash !== "string" || !/^[a-f0-9]{16,128}$/.test(hash)) {
    throw new Error("receipt needs a confirm hash");
  }
  const pageUrl = `${baseUrl.replace(/\/$/, "")}/r/${hash}`;
  const imageUrl = `${pageUrl}/card.png`;
  const className = loop.class || "unset";
  const state = loop.state || "unset";
  const proxy = proxyLabel(loop.delta_s);
  const feature = featureLabel(loop.ok_to_feature);
  const mint =
    loop.poster_mint === 0
      ? "Poster meter on this ad-check: 0."
      : "This page does not mint a meter.";
  const title = `Receipt: ${className}, ${state}`;
  const description = `Public class strip. Entropy-reduction proxy: ${proxy}. State: ${state}. Envelope C stays off this page.`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(imageUrl)}">
<link rel="canonical" href="${esc(pageUrl)}">
<style>
  body { margin: 0; background: #14120b; color: #f4efe4; font: 18px/1.45 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  a { color: #e2b657; }
  img { width: 100%; height: auto; background: #14120b; }
  dt { color: #e2b657; margin-top: 1rem; }
  code { word-break: break-all; }
</style>
</head>
<body>
<main>
<p>Extropy Engine receipt</p>
<h1>${esc(title)}</h1>
<img src="card.png" alt="${esc(title)}">
<dl>
  <dt>Class</dt><dd>${esc(className)}</dd>
  <dt>Entropy-reduction proxy</dt><dd>${esc(proxy)}</dd>
  <dt>State</dt><dd>${esc(state)}</dd>
  <dt>Ok to feature</dt><dd>${esc(feature)}</dd>
  <dt>Confirm hash</dt><dd><code>${esc(hash)}</code></dd>
</dl>
<p>${esc(mint)}</p>
<p>This page is the public class strip (envelope A): class, entropy-reduction proxy, state, hashes. Envelope C stays off this page.</p>
<p>Contested confirmations are not finished. This is the happy-path receipt, not a finished adversarial close.</p>
<p>The dollar gates nothing. <a href="https://extropyengine.com/dollar">extropyengine.com/dollar</a></p>
</main>
</body>
</html>
`;
  const svg = receiptSvg({
    className,
    state,
    proxy,
    feature,
    hash: shortHash(hash),
    pageUrl,
  });
  const png = receiptCard({
    className,
    state,
    proxy,
    feature,
    hash: shortHash(hash),
  });
  return { hash, html, svg, png, pageUrl };
}

export function writeReceipts(record, outDir, baseUrl = SITE) {
  const loops = Array.isArray(record?.loops) ? record.loops : [];
  const written = [];
  for (const loop of loops) {
    const page = renderReceiptPage(loop, baseUrl);
    const dir = resolve(outDir, page.hash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "index.html"), page.html);
    writeFileSync(resolve(dir, "card.svg"), page.svg);
    writeFileSync(resolve(dir, "card.png"), page.png);
    written.push(page.hash);
  }
  return written;
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const recordPath = args[args.indexOf("--record") + 1];
  const outDir = args[args.indexOf("--out") + 1] || "site-drop/public/r";
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : SITE;
  if (!recordPath) {
    console.error("usage: node scripts/feeds/render-receipts.mjs --record record.json --out site-drop/public/r");
    process.exit(2);
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const written = writeReceipts(record, outDir, base);
  console.log(JSON.stringify({ wrote: written.length }));
}

export const RECEIPT_DIR = dirname(fileURLToPath(import.meta.url));
