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
 * Tiles with no owner (or owned by a settlement with an empty mix) are reset
 * to empty. O(N·K) — the shape of the existing per-tile solvers — so it runs
 * on an interval, not per tick.
 */
export function mirrorIdentityField(world) {
  ensureIdentityField(world);
  const owner = world._territoryOwner;
  const N = world.N, K = IDENTITY_K;
  const culId = world.tileCulId, culShr = world.tileCulShr;
  const faiId = world.tileFaithId, faiShr = world.tileFaithShr;
  const lanId = world.tileLangId, lanShr = world.tileLangShr;
  // No territory computed yet → leave the (empty) field as-is.
  if (!owner) return;
  const byId = world._byId;
  for (let ti = 0; ti < N; ti++) {
    const base = ti * K;
    const oid = owner[ti];
    const s = oid >= 0 && byId ? byId.get(oid) : null;
    if (!s || s.mode !== "settled") {
      // unowned / dead — clear slot 0 (cheap sentinel; the rest is stale but
      // unread, and a re-mirror with an owner overwrites all K slots anyway)
      culId[base] = -1; faiId[base] = -1; lanId[base] = -1;
      culShr[base] = 0; faiShr[base] = 0; lanShr[base] = 0;
      continue;
    }
    writeMix(culId, culShr, base, s.culMix);
    writeMix(faiId, faiShr, base, s.faithMix);
    writeMix(lanId, lanShr, base, s.langMix);
  }
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
