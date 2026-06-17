// ── Money provenance ────────────────────────────────────────────────
// Tracks, per settlement, WHERE its coin comes from and WHERE it goes, by
// category, as a smoothed per-tick rate. The economy passes call recordIn /
// recordOut next to every wealth mutation; once per tick stepPeopleSim folds
// the tick's raw totals into an EMA (foldMoney) so the info panel can show a
// stable "$/tick" breakdown ("selling food +2.1, buying lumber -0.8, tribute
// to liege -0.4, …") instead of a single opaque wealth number.

// Income channels.
export const IN_MINING    = 0;   // precious extracted from local reserves
export const IN_GOODS     = 1;   // sold its goods (exports) to trade partners
export const IN_FOOD      = 2;   // sold surplus grain (hierarchy) + farm produce traded on roads (agrarian export sector)
export const IN_MATERIALS = 3;   // sold timber/stone to a building neighbour
export const IN_TOLLS     = 4;   // transit tolls — trade routes passing through it
export const IN_TARIFFS   = 5;   // taxes & customs a CAPITAL lives on (court share of state revenue)
export const IN_TRIBUTE   = 6;   // tribute received from its vassals
export const IN_AID       = 7;   // colonial support received from the mother country
export const IN_LUXURY    = 8;   // sold luxury goods (spices/furs/incense/dyes) to wealthy buyers
export const IN_STATE_PAY  = 9;   // received from the state treasury (army pay / public works / dole)
const N_IN = 10;

// Spending channels.
export const OUT_GOODS    = 0;   // bought goods (imports)
export const OUT_FOOD     = 1;   // bought grain (hierarchy) + farm produce on roads (agrarian sector)
export const OUT_MATERIALS= 2;   // bought timber/stone for construction
export const OUT_TOLLS    = 3;   // tolls + freight paid moving its imports
export const OUT_TARIFFS  = 4;   // import duties paid to a foreign state
export const OUT_TRIBUTE  = 5;   // tribute paid up to its liege
export const OUT_MILITARY = 6;   // army upkeep
export const OUT_AID      = 7;   // colonial support sent to its colonies
export const OUT_COLONY   = 8;   // endowment for a departing colony ship
export const OUT_LUXURY   = 9;   // bought luxury goods (elite consumption)
const N_OUT = 10;

export const IN_LABELS = [
  "mining", "goods sold", "food & farm goods", "materials sold",
  "transit tolls", "taxes & customs", "tribute received", "colonial aid",
  "luxuries sold", "state pay",
];
export const OUT_LABELS = [
  "goods bought", "food & farm goods", "construction", "freight & tolls",
  "import duties", "tribute paid", "army upkeep", "colonial aid", "colony ship",
  "luxuries bought",
];

const DECAY = 0.95;   // EMA smoothing (~20-tick window)

export function recordIn(s, cat, amt) {
  if (!(amt > 0)) return;
  let a = s._mIn; if (!a) a = s._mIn = new Float32Array(N_IN);
  a[cat] += amt;
}
export function recordOut(s, cat, amt) {
  if (!(amt > 0)) return;
  let a = s._mOut; if (!a) a = s._mOut = new Float32Array(N_OUT);
  a[cat] += amt;
}

// Fold this tick's raw flows into the smoothed rate, then clear the tick
// accumulators. Called once per settlement per tick at end of step.
export function foldMoney(s) {
  const ti = s._mIn;
  if (ti) {
    let e = s._mInRate; if (!e) e = s._mInRate = new Float32Array(N_IN);
    for (let i = 0; i < N_IN; i++) { e[i] = e[i] * DECAY + ti[i] * (1 - DECAY); ti[i] = 0; }
  }
  const to = s._mOut;
  if (to) {
    let e = s._mOutRate; if (!e) e = s._mOutRate = new Float32Array(N_OUT);
    for (let i = 0; i < N_OUT; i++) { e[i] = e[i] * DECAY + to[i] * (1 - DECAY); to[i] = 0; }
  }
}
