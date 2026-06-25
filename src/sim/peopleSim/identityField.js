// ── Per-tile identity field (Stage 0: a passive MIRROR of the entities) ──
//
// The long-range plan (docs/farming-region-dissolution.md) is to make
// culture / faith / language live on the GRID — a continuous per-tile
// mixture that diffuses — instead of on each farming-region entity. This is
// Stage 0 of that migration: it ALLOCATES the field and, after each identity
// pass, WRITES every settlement's top-k mix into the tiles of its territory.
//
// Nothing reads the field yet. It changes no behaviour, perturbs no RNG, and
// is fully derivable from the entity state, so it is NOT serialized — a loaded
// world simply re-mirrors. Its only job here is to prove the field tracks the
// entities (an invariant the smoke test asserts), so later stages can render
// from it (Stage 1) and then own the dynamics (Stage 2) with confidence.
//
// Layout (column-wise typed arrays, cache-friendly + compact for later saves):
//   <layer>Id  : Int16Array(N*K)   registry ids, slot 0 = dominant, -1 = empty
//   <layer>Shr : Uint8Array(N*K)   share quantised to 0..255 (÷255 = fraction)
// for N = tw*th tiles and K = IDENTITY_K mixture slots per tile.

import { dominantCulture, dominantLanguage } from "./cultures.js";
import { dominantFaith } from "./faiths.js";

// Mixture slots kept per tile. Matches MIX_K in cultures.js / faiths.js so the
// field carries exactly what a settlement does — no information lost in mirror.
export const IDENTITY_K = 4;

// The three mirrored layers: the field name on `world`, and the settlement
// mixture they read from. (Language has no `xMix` accessor symmetry — its mix
// is `s.langMix` — handled the same way.)
const LAYERS = [
  { id: "tileCulId",   shr: "tileCulShr",   mix: "culMix" },
  { id: "tileFaithId", shr: "tileFaithShr", mix: "faithMix" },
  { id: "tileLangId",  shr: "tileLangShr",  mix: "langMix" },
];

/** Allocate the field arrays on `world` if absent. Idempotent + cheap. */
export function ensureIdentityField(world) {
  const N = world.N, NK = N * IDENTITY_K;
  for (const L of LAYERS) {
    if (!world[L.id] || world[L.id].length !== NK) {
      const ids = world[L.id] = new Int16Array(NK);
      ids.fill(-1);
      world[L.shr] = new Uint8Array(NK);   // zero-filled
    }
  }
}

// Write one settlement's [[id,share],...] mixture into a tile's K slots.
// `mix` is already sorted dominant-first and capped at MIX_K by the identity
// passes; we copy up to K and quantise shares to bytes, padding empties with -1.
function writeMix(idArr, shrArr, base, mix) {
  let k = 0;
  if (mix) {
    const lim = mix.length < IDENTITY_K ? mix.length : IDENTITY_K;
    for (; k < lim; k++) {
      const share = mix[k][1];
      idArr[base + k] = mix[k][0];
      shrArr[base + k] = share <= 0 ? 0 : share >= 1 ? 255 : Math.round(share * 255);
    }
  }
  for (; k < IDENTITY_K; k++) { idArr[base + k] = -1; shrArr[base + k] = 0; }
}

/**
 * Mirror every settlement's identity mixtures onto the tiles it owns.
 * The field is cleared first, so unowned tiles end fully empty (all K slots
 * −1) — diffuseIdentityField reads the whole field, so a stale lower slot
 * would corrupt the spread. O(N·K) — the shape of the existing per-tile
 * solvers — so it runs on an interval, not per tick.
 */
export function mirrorIdentityField(world) {
  ensureIdentityField(world);
  const owner = world._territoryOwner;
  const K = IDENTITY_K;
  // Start clean every pass: -1 ids, 0 shares. Cheap typed-array fills.
  for (const L of LAYERS) { world[L.id].fill(-1); world[L.shr].fill(0); }
  if (!owner) return;   // no territory yet → empty field
  const N = world.N, byId = world._byId;
  const culId = world.tileCulId, culShr = world.tileCulShr;
  const faiId = world.tileFaithId, faiShr = world.tileFaithShr;
  const lanId = world.tileLangId, lanShr = world.tileLangShr;
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0) continue;
    const s = byId ? byId.get(oid) : null;
    if (!s || s.mode !== "settled") continue;
    const base = ti * K;
    writeMix(culId, culShr, base, s.culMix);
    writeMix(faiId, faiShr, base, s.faithMix);
    writeMix(lanId, lanShr, base, s.langMix);
  }
}

// ── Diffusion: the field gains its OWN dynamics ──────────────────────────
// A seeded stencil that relaxes the per-tile mixture toward its neighbours,
// while OWNED tiles stay pinned (a strong anchor) to the settlement that lives
// there. Two steps, both deterministic (no RNG):
//   1. FLOOD — a multi-source BFS over land from the owned (mirrored) tiles
//      fills each landmass continuously: every land tile takes the identity of
//      the nearest settlement, so peoples read as broad REGIONS (the inhabited
//      land, not scattered settlement dots). Ocean and landmasses with no
//      settlement stay empty (grey).
//   2. BLUR — a few vote-stencil passes soften the flood's hard Voronoi seams
//      into GRADIENT bands, while the anchor holds settled cores crisp.
// Nothing in the SIM reads the field, so this is render-only and cannot perturb
// history, determinism, or saves.
const SELF_W = 2;       // a tile's own inertia in the blur
const ANCHOR_W = 4;     // pull toward a tile's own flooded county (keeps counties; blur only softens seams)
const SEC_MIN_OUT = 51; // floor share (×255) to keep a secondary slot after a pass

const LAYER_ARRS = {
  culture:  { id: "tileCulId",   shr: "tileCulShr",   mix: "culMix" },
  faith:    { id: "tileFaithId", shr: "tileFaithShr", mix: "faithMix" },
  language: { id: "tileLangId",  shr: "tileLangShr",  mix: "langMix" },
};

// Step 1: flood the mirrored identity across each landmass. Multi-source BFS
// from every owned/mirrored tile; an unfilled LAND neighbour copies the mix of
// the tile that reached it (so each tile ends with its nearest settlement's
// identity). Each REALM is partitioned into town COUNTIES: a multi-source BFS
// seeds from every town+ (tier ≥ 1) settlement carrying its identity, and a tile
// is claimed by the nearest town OF ITS OWN COUNTRY. So every in-border tile
// belongs to some town (counties tile the realm; sizes vary with town spacing)
// and a county never crosses a national border. Identity covers NATION-ED LAND
// ONLY: the fill stays strictly inside the realm's drawn border — no bleed into
// the stateless frontier, and stateless settlements (no realm) seed nothing — so
// uninhabited / unclaimed land stays empty (grey).
// The field itself is the visited mask (slot 0 ≥ 0 = filled). Ocean is never entered.
function floodCounties(world, L) {
  const N = world.N, K = IDENTITY_K, tw = world.tw, th = world.th;
  const elev = world.elev, idA = world[L.id], shA = world[L.shr], mixKey = L.mix;
  const cc = world._countryOwner || world._countryClaim;   // per-tile realm TERRITORY (-1 = unclaimed); the nation's land, claimed frontier included
  const q = world._idfQueue && world._idfQueue.length === N ? world._idfQueue : (world._idfQueue = new Int32Array(N));
  const claimCC = world._idfClaimCC && world._idfClaimCC.length === N ? world._idfClaimCC : (world._idfClaimCC = new Int32Array(N));
  idA.fill(-1); shA.fill(0);
  let head = 0, tail = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || (s.tier | 0) < 1 || s.countryId < 0) continue;   // national towns manage the land; stateless ones colour nothing
    const mix = s[mixKey]; if (!mix || !mix.length) continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (ti < 0 || ti >= N || elev[ti] <= 0.005 || idA[ti * K] >= 0) continue;
    writeMix(idA, shA, ti * K, mix);
    claimCC[ti] = s.countryId; q[tail++] = ti;
  }
  while (head < tail) {
    const ti = q[head++], base = ti * K, myCC = claimCC[ti];
    const y = (ti / tw) | 0, x = ti - y * tw;
    const r = y * tw + (x === tw - 1 ? 0 : x + 1);
    const l = y * tw + (x === 0 ? tw - 1 : x - 1);
    const u = y > 0 ? ti - tw : -1;
    const d = y < th - 1 ? ti + tw : -1;
    for (let n = 0; n < 4; n++) {
      const nt = n === 0 ? r : n === 1 ? l : n === 2 ? u : d;
      if (nt < 0 || idA[nt * K] >= 0 || elev[nt] <= 0.005) continue;   // off-grid / filled / ocean
      if ((cc ? cc[nt] : -1) !== myCC) continue;                       // stay strictly inside this realm's border
      const nb = nt * K;
      for (let k = 0; k < K; k++) { idA[nb + k] = idA[base + k]; shA[nb + k] = shA[base + k]; }
      claimCC[nt] = myCC; q[tail++] = nt;
    }
  }
}

/**
 * Spread ONE identity layer across the land in place: flood the inhabited
 * landmass, then blur the seams over `passes` steps. Render-only: call after
 * mirrorIdentityField for the lens currently in view. Allocation-free beyond
 * reused scratch buffers.
 */
export function diffuseIdentityField(world, layerName, passes = 4) {
  const L = LAYER_ARRS[layerName];
  if (!L) return;
  ensureIdentityField(world);   // allocate the field arrays if this is the first call
  floodCounties(world, L);   // step 1: tile each realm into town counties
  const N = world.N, K = IDENTITY_K, tw = world.tw, th = world.th, NK = N * K, elev = world.elev;
  const cc = world._countryOwner || world._countryClaim;   // realm territory mask — identity stays on nation-ed land
  // anchor = the flooded county field (read-only this call); ping-pong A↔B
  const ancId = world[L.id], ancShr = world[L.shr];
  const A_id = world._idfA_id && world._idfA_id.length === NK ? world._idfA_id : (world._idfA_id = new Int16Array(NK));
  const A_shr = world._idfA_shr && world._idfA_shr.length === NK ? world._idfA_shr : (world._idfA_shr = new Uint8Array(NK));
  const B_id = world._idfB_id && world._idfB_id.length === NK ? world._idfB_id : (world._idfB_id = new Int16Array(NK));
  const B_shr = world._idfB_shr && world._idfB_shr.length === NK ? world._idfB_shr : (world._idfB_shr = new Uint8Array(NK));
  A_id.set(ancId); A_shr.set(ancShr);
  let curId = A_id, curShr = A_shr, nxtId = B_id, nxtShr = B_shr;
  const accId = new Int32Array(64), accW = new Float64Array(64);   // per-tile vote scratch
  let m = 0;   // live vote count for the tile in hand (shared with vote())
  const vote = (b, weight, idArr, shrArr) => {
    for (let k = 0; k < K; k++) {
      const id = idArr[b + k]; if (id < 0) break;
      const w = weight * (shrArr[b + k] / 255);
      if (w <= 0) continue;
      let j = 0; for (; j < m; j++) if (accId[j] === id) { accW[j] += w; break; }
      if (j === m && m < 64) { accId[m] = id; accW[m] = w; m++; }
    }
  };
  for (let p = 0; p < passes; p++) {
    for (let ti = 0; ti < N; ti++) {
      const base = ti * K;
      // Identity stays on NATION-ED LAND. The blur would otherwise bleed past the
      // border (into ocean — long coastlines wash whole basins — and into unclaimed
      // wilderness). Keep ocean and un-owned tiles empty, so the field tracks the
      // realm territory only.
      if (elev[ti] <= 0.005 || (cc && cc[ti] < 0)) { for (let k = 0; k < K; k++) { nxtId[base + k] = -1; nxtShr[base + k] = 0; } continue; }
      m = 0;
      vote(base, SELF_W, curId, curShr);
      const y = (ti / tw) | 0, x = ti - y * tw;
      vote(y * tw + (x === tw - 1 ? 0 : x + 1), 1, curId, curShr);   // right (wrap)
      vote(y * tw + (x === 0 ? tw - 1 : x - 1), 1, curId, curShr);   // left (wrap)
      if (y > 0)      vote(ti - tw, 1, curId, curShr);               // up
      if (y < th - 1) vote(ti + tw, 1, curId, curShr);               // down
      // anchor: hold the tile toward its OWN flooded county identity, so the
      // blur softens the seams between counties without eroding them
      for (let k = 0; k < K; k++) {
        const id = ancId[base + k]; if (id < 0) break;
        const w = ANCHOR_W * (ancShr[base + k] / 255);
        if (w <= 0) continue;
        let j = 0; for (; j < m; j++) if (accId[j] === id) { accW[j] += w; break; }
        if (j === m && m < 64) { accId[m] = id; accW[m] = w; m++; }
      }
      if (m === 0) {   // empty everywhere around → tile stays empty
        for (let k = 0; k < K; k++) { nxtId[base + k] = -1; nxtShr[base + k] = 0; }
        continue;
      }
      // top-K by weight (partial selection sort), then quantise to 255
      const lim = m < K ? m : K;
      let total = 0;
      for (let a = 0; a < lim; a++) {
        let bi = a; for (let b2 = a + 1; b2 < m; b2++) if (accW[b2] > accW[bi]) bi = b2;
        if (bi !== a) { const it = accId[a]; accId[a] = accId[bi]; accId[bi] = it; const wt = accW[a]; accW[a] = accW[bi]; accW[bi] = wt; }
        total += accW[a];
      }
      if (total <= 0) { for (let k = 0; k < K; k++) { nxtId[base + k] = -1; nxtShr[base + k] = 0; } continue; }
      let wrote = 0, accShr = 0;
      for (let k = 0; k < lim; k++) {
        const q = Math.round((accW[k] / total) * 255);
        if (k > 0 && q < SEC_MIN_OUT) break;   // drop negligible tail → consolidated tiles read single-identity
        nxtId[base + wrote] = accId[k]; nxtShr[base + wrote] = q; accShr += q; wrote++;
      }
      // fold the rounding remainder into the dominant (clamped to a byte); clear unused slots
      if (wrote > 0) { const dom = nxtShr[base] + (255 - accShr); nxtShr[base] = dom < 0 ? 0 : dom > 255 ? 255 : dom; }
      for (let k = wrote; k < K; k++) { nxtId[base + k] = -1; nxtShr[base + k] = 0; }
    }
    const t1 = curId; curId = nxtId; nxtId = t1;
    const t2 = curShr; curShr = nxtShr; nxtShr = t2;
  }
  // land the result back in the field arrays the renderer ships
  if (curId !== ancId) { ancId.set(curId); ancShr.set(curShr); }
}

/**
 * Stage-0 invariant: the field's dominant id at each owned tile equals its
 * owning settlement's dominant culture / faith / language. Returns a small
 * report ({ checked, mismatches: {culture,faith,language} }) for the smoke
 * test. Call right after mirrorIdentityField for an exact comparison.
 */
export function auditIdentityField(world) {
  const owner = world._territoryOwner, byId = world._byId;
  const N = world.N, K = IDENTITY_K;
  const culId = world.tileCulId, faiId = world.tileFaithId, lanId = world.tileLangId;
  let checked = 0, cul = 0, fai = 0, lan = 0;
  if (!owner || !byId || !culId) return { checked, mismatches: { culture: 0, faith: 0, language: 0 } };
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0) continue;
    const s = byId.get(oid);
    if (!s || s.mode !== "settled") continue;
    checked++;
    const base = ti * K;
    if (culId[base] !== dominantCulture(s)) cul++;
    if (faiId[base] !== dominantFaith(s)) fai++;
    if (lanId[base] !== dominantLanguage(s)) lan++;
  }
  return { checked, mismatches: { culture: cul, faith: fai, language: lan } };
}
