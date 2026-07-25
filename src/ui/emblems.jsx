// ── Realm heraldry, surfaced (plan §5.2) ────────────────────────────────────
//
// The emblem engine (sim/emblemGenome + sim/emblemRender) is pure and
// deterministic; here the UI finally WEARS it. Each realm's genome is founded
// from its own EMERGENT state — the terrain its capital sits on, the ports it
// keeps, its temperament, the shape of its polity — via the engine's semantic
// axes (never an identity label, never a time gate). Axes are QUANTIZED to
// coarse steps and the genome is cached per realm for the whole session, so a
// realm's arms are stable while it lives; re-derivation after a reload feeds
// the same near-static inputs and reproduces the same arms.
//
// This is v1 of the plan's heraldry pass: render-side only, zero sim state.
// The evolutionary layer (cadency on succession, marshalling on union —
// engine support already exists) needs the genome persisted on the polity
// entity and is future sim-side work (plan §14.2).

import { foundGenome } from "../sim/emblemGenome.js";
import { emblemSVG } from "../sim/emblemRender.js";

const genomes = new Map();   // realmId → genome
const urls = new Map();      // realmId → svg data URL
const imgs = new Map();      // realmId → HTMLImageElement (decoded async; draw when .complete)

/** Forget everything — call when a different world is generated/loaded. */
export function resetEmblems() { genomes.clear(); urls.clear(); imgs.clear(); }

const q = (v) => Math.max(0, Math.min(1, Math.round(v * 4) / 4));   // quantize: stable under slow drift

// Derive the semantic axes from the realm's mirror record + terrain. Every
// input is emergent world state; each axis is a soft bias inside the engine.
function axesFor(psw, c, ter) {
  const cap = c.capital || (c.members && c.members[0]);
  const a = {};
  // ENVIRONMENT — read the capital's ground
  if (cap && ter && ter.tElev) {
    const TR = psw.tileRes || 1;
    const tx = Math.max(0, Math.min(ter.tw - 1, (cap.pos.x * TR) | 0));
    const ty = Math.max(0, Math.min(ter.th - 1, (cap.pos.y * TR) | 0));
    const ti = ty * ter.tw + tx;
    const e = ter.tElev[ti] || 0;
    const m = ter.tMoist ? ter.tMoist[ti] || 0 : 0.5;
    let eMax = ter._eMax;
    if (!eMax) { eMax = 0; const el = ter.tElev; for (let i = 0; i < el.length; i += 97) if (el[i] > eMax) eMax = el[i]; ter._eMax = eMax || 1; eMax = ter._eMax; }
    a.montane = q(Math.max(0, e / eMax - 0.25) * 1.6);
    a.arid = q(Math.max(0, 0.30 - m) / 0.30);
    a.sylvan = q(Math.max(0, m - 0.55) * 2.0);
  }
  // ports among members → a sea-facing people
  let ports = 0, n = 0;
  for (const s of (c.members || [])) { n++; if (s._isPort) ports++; }
  a.maritime = q(n ? ports / n * 1.4 : 0);
  // ETHOS — temperament the realm actually expresses
  const p = c.personality;
  if (p) {
    a.martial = q(Math.max(0, p.aggression || 0));
    a.mercantile = q(Math.max(0, p.commerce || 0));
    a.austere = q(Math.max(0, -(p.commerce || 0)) * 0.7 + Math.max(0, -(p.expansionism || 0)) * 0.3);
  }
  // STRUCTURE — the polity's shape
  a.imperial = q(Math.min(1, (c.memberIds ? c.memberIds.length : n) / 30));
  a.tribal = q(c._nomadic ? 0.8 : (c.ruler ? 0 : 0.4));
  a.regal = q(c.ruler ? Math.min(1, 0.35 + (c.memberIds ? c.memberIds.length : n) / 40) : 0);
  if (c.ruler && c.ruler.gov === "theocracy") a.devout = 0.9;
  if (c.ruler && c.ruler.gov === "republic") a.mercantile = Math.max(a.mercantile || 0, 0.5);
  return a;
}

/** The realm's genome — founded once per session, then permanent. */
export function realmGenome(psw, c, ter, worldSeed) {
  let g = genomes.get(c.id);
  if (g) return g;
  // Seed from stable identity: realm id + founding culture + the world's seed.
  const culId = c.capital ? (c.capital.cultureId ?? 0) : 0;
  const seed = ((c.id * 2654435761) ^ ((culId + 1) * 0x9e3779b9) ^ ((worldSeed || 0) * 0x85ebca6b)) >>> 0;
  g = foundGenome(seed, axesFor(psw, c, ter));
  genomes.set(c.id, g);
  return g;
}

const VB_W = 46, VB_H = 52;   // shield-ish viewBox the renderer composes into

/** Data-URL of the realm's emblem (cached). */
export function realmEmblemURL(psw, c, ter, worldSeed) {
  let u = urls.get(c.id);
  if (u) return u;
  const svg = emblemSVG(realmGenome(psw, c, ter, worldSeed), VB_W, VB_H);
  u = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  urls.set(c.id, u);
  return u;
}

/** Image for canvas drawing. Decodes async — first frame may skip. */
export function realmEmblemImg(psw, c, ter, worldSeed) {
  let im = imgs.get(c.id);
  if (im) return im;
  im = new Image();
  im.src = realmEmblemURL(psw, c, ter, worldSeed);
  imgs.set(c.id, im);
  return im;
}

/** Draw the emblem centred at (x, y) with height h (canvas px). No-op until decoded. */
export function drawRealmEmblem(ctx, img, x, y, h) {
  if (!img || !img.complete || !img.naturalWidth) return false;
  const w = h * (VB_W / VB_H);
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  return true;
}

/** React <img> chip for panels. */
export function Emblem({ psw, country, ter, worldSeed, size = 18, style, title }) {
  if (!psw || !country) return null;
  return (
    <img src={realmEmblemURL(psw, country, ter, worldSeed)} alt=""
      title={title}
      style={{ height: size, width: size * (VB_W / VB_H), objectFit: "contain",
        filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))", flexShrink: 0, ...style }} />
  );
}
