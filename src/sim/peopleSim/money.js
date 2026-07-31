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
export const IN_PILGRIM   = 10;  // offerings & pilgrim traffic at a faith's holy see (Mecca/Rome/Varanasi)
export const IN_CARRY     = 11;  // the carrying trade — brokerage/re-export earned moving OTHERS' goods (Venice/Amsterdam)
export const IN_FINANCE   = 12;  // interest earned lending to the state — the bankers' city (Genoa/Augsburg/Amsterdam)
export const IN_SLAVE_TRADE = 13; // selling captives down the slave trade — the slaver/middleman (Crimea/Dahomey/Aro)
export const IN_CREDIT    = 14;  // bank credit CONJURED on top of specie (a banking hub's fractional money creation) — not goods sold (B17)
export const IN_CAPITAL   = 15;  // sold capital goods — mills, docks, fittings — to an investing neighbour (T.GOODS_INVEST)
// The craft sector unbundled (2026-07 Tier-B): the per-good trade path
// (roads.js GT_BOOK_IN — sellGoods knows exactly what's in the crate) books
// each craft on its own channel instead of lumping four trades into IN_GOODS.
// With them bundled, a typical realm had ~5-6 live channels and one giant
// "goods sold" — so a channel worth 5% of income landed at rank 3 and the
// slave trade read top-3 in realms that in truth ran on cloth, wares and
// metal (user-report diagnosis §3: the near-empty ranking taxonomy). Money
// rates are display EMAs, deliberately unpersisted (see below), so appending
// channels is save-safe. IN_GOODS remains the scalar-path mixed consignment
// plus the seller's own carriage fees.
export const IN_ORE       = 16;  // sold ore — the extraction district feeding distant forges
export const IN_METAL     = 17;  // sold metalware — tools, fittings, arms
export const IN_CLOTH     = 18;  // sold market cloth — the weaving towns (Flanders/Florence)
export const IN_WARES     = 19;  // sold everyday wares — pottery, leather, crafted goods
const N_IN = 20;

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
export const OUT_PILGRIM  = 10;  // offerings & the cost of pilgrimage paid by the faithful
export const OUT_SLAVE    = 11;  // coin paid to buy coerced labour off the slave trade
export const OUT_CREDIT   = 12;  // bank credit CALLED IN as commerce collapses (the money supply contracts) — not goods bought (B17)
export const OUT_CAPITAL  = 13;  // invested in productive capacity — mills, docks, workshop stock (T.GOODS_INVEST; distinct from construction so trade asymmetry reads clean)
const N_OUT = 14;

export const IN_LABELS = [
  "mining", "goods sold", "food & farm goods", "materials sold",
  "transit tolls", "taxes & customs", "tribute received", "colonial aid",
  "luxuries sold", "state pay", "pilgrim offerings", "carrying trade", "war loans",
  "slave trade", "bank credit created", "capital goods sold",
  "ore sold", "metalware sold", "cloth sold", "wares sold",
];
export const OUT_LABELS = [
  "goods bought", "food & farm goods", "construction", "freight & tolls",
  "import duties", "tribute paid", "army upkeep", "colonial aid", "colony ship",
  "luxuries bought", "pilgrimage", "slaves bought", "credit called in", "capital invested",
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

// ── Metered booking: honest rates for slow-cadence passes ────────────────
// A pass that fires every IVL ticks but books its whole take at once distorts
// the smoothed display: against the ~20-tick EMA window a 50-tick lump reads
// up to IVL×(1−DECAY) = 2.5× the true rate right after the pass, then decays
// toward zero — while the every-few-ticks channels (ordinary trade) read
// flat. recordInMetered/recordOutMetered fix the DISPLAY side of that: the
// amount accrues into a pending pot released into the tick accumulator at a
// level per-tick rate over the `ticks` the pass actually covered, so the EMA
// sees the same steady flow a per-tick channel would book. Only the
// provenance LEDGER is metered — the coin itself still moves at the pass, so
// wealth, conservation and every mechanism reading `wealth` are unchanged.
// Same true totals, honest rate. (The pots are display smoothers like
// _mIn/_mInRate — rebuilt within one pass interval, deliberately unpersisted.)
export function recordInMetered(s, cat, amt, ticks) {
  if (!(amt > 0)) return;
  let p = s._mInPend; if (!p) p = s._mInPend = new Float32Array(N_IN);
  let r = s._mInPendRate; if (!r) r = s._mInPendRate = new Float32Array(N_IN);
  p[cat] += amt;
  r[cat] = p[cat] / Math.max(1, ticks);   // drain the whole pot (incl. residue) level across the coming interval
}
export function recordOutMetered(s, cat, amt, ticks) {
  if (!(amt > 0)) return;
  let p = s._mOutPend; if (!p) p = s._mOutPend = new Float32Array(N_OUT);
  let r = s._mOutPendRate; if (!r) r = s._mOutPendRate = new Float32Array(N_OUT);
  p[cat] += amt;
  r[cat] = p[cat] / Math.max(1, ticks);
}

// Fold this tick's raw flows into the smoothed rate, then clear the tick
// accumulators. Called once per settlement per tick at end of step.
export function foldMoney(s) {
  // Release this tick's tranche of any metered pots first, so it rides the
  // fold below exactly like a per-tick booking.
  const pi = s._mInPend;
  if (pi) {
    const pr = s._mInPendRate;
    for (let i = 0; i < N_IN; i++) {
      const rel = Math.min(pi[i], pr[i]);
      if (rel > 0) { recordIn(s, i, rel); pi[i] -= rel; }
    }
  }
  const po = s._mOutPend;
  if (po) {
    const pr = s._mOutPendRate;
    for (let i = 0; i < N_OUT; i++) {
      const rel = Math.min(po[i], pr[i]);
      if (rel > 0) { recordOut(s, i, rel); po[i] -= rel; }
    }
  }
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
