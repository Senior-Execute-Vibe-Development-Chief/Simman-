// ── peopleSim dev-mode invariant checks ──────────────────────────────
//
// A lightweight, opt-in sanity pass over the world state — the live-model
// counterpart to the (now-retired) tribe invariant harness. It does NOT change
// the sim; it only WATCHES it, surfacing the classes of corruption that are
// otherwise invisible until the map looks wrong hours later:
//
//   • non-finite fields   (a NaN/Infinity creeping into people/wealth/food/
//                          army — the usual symptom of a divide-by-zero or an
//                          unguarded log of a non-positive number).
//   • negative population / wealth (wealth is meant to stay ≥ 0 — every spend
//                          path gates on a reserve; a negative reading means a
//                          path skipped the gate).
//   • tier out of range   ([0,3]).
//   • money / population totals — exposed on world.debug each pass so a human
//                          (or a test) can WATCH the closed money supply for
//                          drift (e.g. the stale-weight build-payout leak this
//                          review fixed would show as total coin creeping when
//                          no mine is producing).
//
// Zero cost in production: stepPeopleSim only calls this when world._checkInvariants
// is set (tests / debugging). Warnings are throttled so a persistent violation
// doesn't flood the console, and a running tally lives on world.debug.invariantHits.

import { T } from "./tuning.js";

// Throttle: at most one warning per (key) every WARN_EVERY steps.
const WARN_EVERY = 256;
const _warned = new Map();

function warnOnce(world, key, msg) {
  const last = _warned.get(key);
  if (last !== undefined && world.step - last < WARN_EVERY) return;
  _warned.set(key, world.step);
  console.warn(`[peopleSim-invariant ${key} @${world.step}] ${msg}`);
}

function bump(world, kind) {
  const h = world.debug.invariantHits || (world.debug.invariantHits = {});
  h[kind] = (h[kind] || 0) + 1;
}

// Clear the throttle history (call on world (re)creation so a fresh run starts
// with no warning memory).
export function resetInvariantState(world) {
  _warned.clear();
  if (world && world.debug) world.debug.invariantHits = {};
}

const KTRACKS = ["agriculture", "construction", "organization", "metallurgy", "navigation", "mobility"];

export function checkPeopleSimInvariants(world) {
  let coin = 0, people = 0, alive = 0;
  for (const s of world.settlements) {
    if (s.mode === "dead") continue;
    alive++;
    const p = s.people, w = s.wealth || 0, f = s.food || 0, a = s.army || 0;
    if (!Number.isFinite(p) || !Number.isFinite(w) || !Number.isFinite(f) || !Number.isFinite(a)) {
      warnOnce(world, "nan#" + s.id, `non-finite field (people=${p} wealth=${w} food=${f} army=${a})`);
      bump(world, "nan");
    }
    if (p < 0)        { warnOnce(world, "negpop#" + s.id, `negative population ${p}`); bump(world, "negpop"); }
    if (w < -1e-6)    { warnOnce(world, "negwealth#" + s.id, `negative wealth ${w}`); bump(world, "negwealth"); }
    const t = s.tier | 0;
    if (t < 0 || t > 3) { warnOnce(world, "tier#" + s.id, `tier out of range ${s.tier}`); bump(world, "tier"); }
    // Knowledge tracks live in [0,1] by construction (clamp01 / metalCap) — a
    // value outside that, or NaN, means a learning formula leaked.
    if (s.knowledge) for (const k of KTRACKS) {
      const v = s.knowledge[k];
      if (v !== undefined && (!Number.isFinite(v) || v < -1e-9 || v > 1 + 1e-9)) {
        warnOnce(world, "know#" + s.id + k, `knowledge.${k} out of range ${v}`); bump(world, "knowledge");
      }
    }
    // Loyalty / unrest are [0,1] stocks (conquest.js).
    if (s.loyalty !== undefined && (!Number.isFinite(s.loyalty) || s.loyalty < -1e-9 || s.loyalty > 1 + 1e-9)) {
      warnOnce(world, "loyal#" + s.id, `loyalty out of range ${s.loyalty}`); bump(world, "loyalty");
    }
    if (s.unrest !== undefined && (!Number.isFinite(s.unrest) || s.unrest < -1e-9 || s.unrest > 1 + 1e-9)) {
      warnOnce(world, "unrest#" + s.id, `unrest out of range ${s.unrest}`); bump(world, "unrest");
    }
    coin += Math.max(0, w);
    people += Math.max(0, p) + Math.max(0, s._captives || 0) + Math.max(0, s._unfree || 0);   // bonded people are still people (they were moved OUT of `people` by conserved transfers)
  }
  // In-transit colony ships carry people AND an endowment for many ticks —
  // both used to vanish from the totals at launch and reappear at landing.
  if (world.ships) for (const sh of world.ships) {
    coin += Math.max(0, sh.wealth || 0);
    people += Math.max(0, sh.people || 0);
  }
  // Coin stranded in ruin hoards is out of PURSES but not out of the WORLD.
  if (world._ruinHoards) for (const v of world._ruinHoards.values()) coin += Math.max(0, v);
  // T.TILE_MONEY — coin on farm tiles (not in settlement purses).
  if (T.TILE_MONEY > 0 && world._tileWealth) {
    for (let i = 0; i < world._tileWealth.length; i++) coin += Math.max(0, world._tileWealth[i] || 0);
  }
  // (No owner-array liveness check here on purpose: territory ownership is
  // PERSISTENT, so tiles legitimately reference a dead settlement until the
  // next computeTerritory pass releases them — that transient is by design.)
  // State treasuries hold coin too — fold them into the supply total.
  if (world.polities) {
    // Alive polities only — a fallen realm's leftover chest is out of
    // circulation (it returns only on restoration).
    for (const p of world.polities.values()) if (p.endedStep < 0) coin += Math.max(0, p.treasury || 0);
  }
  // Visibility (not assertions): watch the closed money supply + headcount.
  world.debug.totalCoin = coin;
  world.debug.totalPeople = people;
  world.debug.aliveSettlements = alive;
}
