#!/usr/bin/env node
// Update the GitHub Pages multi-channel catalog (builds.json + builds/index.html).
// Invoked by .github/workflows/deploy.yml after a channel build is copied into
// the persistent `site/` tree. Channels:
//   live     → site root (only `main` writes here)
//   preview  → site/b/<slug>/ (claude/**, cursor/**, and workflow_dispatch)
//
// Usage:
//   node tools/pages-catalog.mjs --site=./site --branch=... --sha=... --slug=... --channel=live|preview

import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));

const site = path.resolve(args.site || "site");
const branch = String(args.branch || "");
const sha = String(args.sha || "");
const slug = String(args.slug || "main");
const channel = String(args.channel || "preview"); // live | preview
const builtAt = new Date().toISOString();

if (!branch || !sha) {
  console.error("pages-catalog: --branch and --sha are required");
  process.exit(1);
}

fs.mkdirSync(site, { recursive: true });
const catalogPath = path.join(site, "builds.json");
let catalog = { live: null, previews: [] };
if (fs.existsSync(catalogPath)) {
  try { catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")); }
  catch { /* start fresh if corrupt */ }
}
if (!Array.isArray(catalog.previews)) catalog.previews = [];

const entry = { branch, sha, slug, builtAt, channel };

if (channel === "live") {
  catalog.live = { ...entry, path: "/" };
  // Keep a preview slot named after main too? No — live is enough.
} else {
  const i = catalog.previews.findIndex((p) => p.slug === slug || p.branch === branch);
  const preview = { ...entry, path: `/b/${slug}/` };
  if (i >= 0) catalog.previews[i] = preview;
  else catalog.previews.push(preview);
  catalog.previews.sort((a, b) => String(b.builtAt).localeCompare(String(a.builtAt)));
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");

const buildsDir = path.join(site, "builds");
fs.mkdirSync(buildsDir, { recursive: true });
fs.writeFileSync(path.join(buildsDir, "index.html"), pickerHtml());

// If nothing has claimed the live root yet, leave a stub so /Simman-/ itself
// is useful (sends you to the picker) instead of a blank 404.
const rootIndex = path.join(site, "index.html");
if (!catalog.live && !fs.existsSync(rootIndex)) {
  fs.writeFileSync(rootIndex, `<!doctype html><meta charset="utf-8"/>
<title>Simman</title>
<meta http-equiv="refresh" content="0; url=./builds/"/>
<p><a href="./builds/">Simman builds</a></p>
`);
}

console.log(`[pages-catalog] ${channel} · ${branch} @ ${sha.slice(0, 8)} · ${catalog.previews.length} preview(s)`);

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function pickerHtml() {
  // Self-contained picker. Fetches ../builds.json at runtime so a stale
  // cached HTML still lists whatever the latest deploy wrote.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Simman · builds</title>
<style>
  :root {
    --bg: #14110d;
    --paper: #1c1812;
    --ink: #d8cdb8;
    --fade: #8a8070;
    --gold: #c4a35a;
    --line: rgba(200,180,140,0.14);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    font: 14px/1.45 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    color: var(--ink); background:
      radial-gradient(ellipse at 30% 0%, #221c14 0%, var(--bg) 55%);
  }
  main { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
  h1 { font-size: 28px; font-weight: 600; letter-spacing: 0.02em; margin: 0 0 8px; }
  .lede { color: var(--fade); margin: 0 0 28px; max-width: 40em; }
  section { margin: 0 0 28px; }
  h2 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--fade); margin: 0 0 10px; font-weight: 600;
  }
  ul { list-style: none; padding: 0; margin: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--paper); }
  li { border-top: 1px solid var(--line); }
  li:first-child { border-top: 0; }
  a.row {
    display: grid; grid-template-columns: 1fr auto; gap: 8px 16px;
    padding: 14px 16px; color: inherit; text-decoration: none;
  }
  a.row:hover { background: rgba(196,163,90,0.08); }
  .name { font-weight: 600; word-break: break-all; }
  .meta { color: var(--fade); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tag {
    align-self: center; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--gold); border: 1px solid rgba(196,163,90,0.35); border-radius: 3px;
    padding: 3px 7px; white-space: nowrap;
  }
  .empty { color: var(--fade); padding: 14px 16px; border: 1px dashed var(--line); border-radius: 6px; }
  footer { margin-top: 36px; color: var(--fade); font-size: 12px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>Simman builds</h1>
  <p class="lede">Pick which deployed branch to open. <strong>Live</strong> is <code>main</code>.
  Feature branches publish beside it under <code>/b/…</code> and no longer overwrite each other.</p>
  <section>
    <h2>Live</h2>
    <div id="live"><p class="empty">Loading…</p></div>
  </section>
  <section>
    <h2>Preview channels</h2>
    <div id="previews"><p class="empty">Loading…</p></div>
  </section>
  <footer>Catalog: <code id="when">—</code></footer>
</main>
<script>
const BASE = new URL("..", location.href); // /Simman-/
function shortSha(s){ return (s||"").slice(0,8) || "—"; }
function when(iso){
  if(!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function hrefFor(p) {
  if (!p.path || p.path === "/") return new URL("./", BASE).href;
  return new URL(String(p.path).replace(/^\//, ""), BASE).href;
}
function row(p, tag){
  const href = hrefFor(p);
  return '<li><a class="row" href="'+href+'">'
    + '<div><div class="name">'+esc(p.branch||p.slug||"build")+'</div>'
    + '<div class="meta">'+esc(shortSha(p.sha))+' · '+esc(when(p.builtAt))+'</div></div>'
    + (tag ? '<span class="tag">'+esc(tag)+'</span>' : '')
    + '</a></li>';
}
function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
}
fetch(new URL("builds.json", BASE), { cache: "no-store" })
  .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
  .then(cat => {
    const live = document.getElementById("live");
    const prev = document.getElementById("previews");
    if (cat.live) live.innerHTML = "<ul>"+row(cat.live, "live")+"</ul>";
    else live.innerHTML = '<p class="empty">No live build yet — push to <code>main</code>.</p>';
    const list = Array.isArray(cat.previews) ? cat.previews : [];
    if (!list.length) prev.innerHTML = '<p class="empty">No preview channels yet. Pushes to <code>claude/**</code> or <code>cursor/**</code> appear here.</p>';
    else prev.innerHTML = "<ul>"+list.map(p => row(p, "preview")).join("")+"</ul>";
    const latest = [cat.live, ...list].filter(Boolean).map(x => x.builtAt).sort().pop();
    document.getElementById("when").textContent = when(latest);
  })
  .catch(err => {
    document.getElementById("live").innerHTML = '<p class="empty">Could not load builds.json ('+esc(err.message)+').</p>';
    document.getElementById("previews").innerHTML = "";
  });
</script>
</body>
</html>
`;
}
