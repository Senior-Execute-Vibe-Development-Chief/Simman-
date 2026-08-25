// WHERE ARE THE CITIES, AND WHO MADE THEM? (owner 2026-08-23)
//
//   "the majority of cities are created outside of a nation. very early, all of
//    europe, india, sahel, are very quickly carpeted with nationless cities,
//    hundreds of them. then nations have to fight and steal EVERY SINGLE city.
//    historically, werent most cities made WITHIN a nation, BY the nation? and
//    bronze, early classical age, it seems highly unlikely that all of europe,
//    india and sahel were covered with cities but no nations?"
//
// Two claims, and they need separating because they have different fixes:
//
//   A. GEOGRAPHY. docs/city-count-vs-age-2026-08-21.md established the register's
//      global COUNT is on history's band age for age (dawn 16, bronze 71-155,
//      classical 607-851). A count can be on band while the DISTRIBUTION is
//      badly wrong — 155 bronze cities is right, 100 of them in temperate Europe
//      is not. History's bronze world: Sumer ~20-30, Egypt ~5-10, the Indus five,
//      Erlitou/Shang a handful, and temperate Europe and the Sahel at essentially
//      ZERO (Europe's first towns are late-Iron-Age oppida, ~150 BCE; Jenne-jeno
//      ~250 BCE). So this bins the register by region and prints history beside it.
//
//   B. WHO MINTS. The first city of a cradle genuinely precedes its state — Uruk
//      and Harappa were not founded by kingdoms. But after that first generation
//      history inverts: Alexandria, Antioch, Chang'an, every Roman colonia and
//      every Han commandery seat were planted BY a state inside its own territory.
//      So the share of mints coming from the state-plantation channel should RISE
//      with the eras. This reads the sim's own mint funnels (siteCity, peerSeat,
//      plantation, colony) per window and prints the trend.
//
//   node tools/probe_wherecities.mjs [steps] [W] [seed] [window]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { techState } from "../src/sim/peopleSim/tech.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const WIN = +(process.argv[5] || 2000);

const world = buildSim({ W, H, seed: SEED });
telEnable(world);
const tw = world.tw, th = world.th;
const lonOf = (x) => (x / tw) * 360 - 180;
const latOf = (y) => 90 - (y / th) * 180;

// Regions the owner named, plus the cradles they should be compared against.
// `hist` is history's own bronze-age city count for that box (cities >= ~10k),
// from the sources in docs/city-count-vs-age-2026-08-21.md.
const REGIONS = [
  { k: "Mesopotamia", lon: [38, 50], lat: [29, 38], hist: "20-30" },
  { k: "Egypt/Nile",  lon: [24, 36], lat: [15, 32], hist: "5-10" },
  { k: "Indus+India", lon: [66, 92], lat: [8, 35],  hist: "~5 (Indus only)" },
  { k: "China",       lon: [100, 123], lat: [20, 42], hist: "a handful" },
  { k: "Levant/Anat", lon: [26, 45], lat: [30, 42], hist: "~10" },
  { k: "Mediterran.", lon: [-8, 26], lat: [30, 45], hist: "~5 (Aegean)" },
  { k: "EUROPE temp", lon: [-10, 40], lat: [45, 62], hist: "**0**" },
  { k: "SAHEL",       lon: [-18, 40], lat: [8, 18],  hist: "**0**" },
  { k: "Steppe",      lon: [40, 110], lat: [43, 58], hist: "**0**" },
  { k: "SE Asia",     lon: [95, 130], lat: [-10, 20], hist: "**0**" },
  { k: "Americas",    lon: [-170, -35], lat: [-56, 72], hist: "**0**" },
  { k: "Afr. south",  lon: [10, 42], lat: [-35, 5],  hist: "**0**" },
];
const regionOf = (x, y) => {
  const lo = lonOf(x), la = latOf(y);
  for (const r of REGIONS) if (lo >= r.lon[0] && lo <= r.lon[1] && la >= r.lat[0] && la <= r.lat[1]) return r.k;
  return "elsewhere";
};

// Section B measures BIRTHS directly rather than by funnel PASS: the siteCity
// lane tallies only its rejections (no telPass), so a channel census read off
// the funnel would silently miss the dominant mint. Watching the settlement set
// cannot miss one.
const seen = new Set();
const snaps = [];
for (let done = 0; done < STEPS; done += WIN) {
  telReset(world);
  const bornInto = { n: 0 }, bornOutside = { n: 0 };
  stepPeopleSim(world, Math.min(WIN, STEPS - done));
  for (const s of world.settlements) {
    if (s.mode !== "settled" || seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.countryId >= 0) bornInto.n++; else bornOutside.n++;
  }
  const per = new Map();
  let cities = 0, stateless = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || (s.tier | 0) < 2) continue;
    cities++;
    const k = regionOf(s.pos.x | 0, s.pos.y | 0);
    let e = per.get(k); if (!e) per.set(k, e = { n: 0, free: 0 });
    e.n++;
    if (s.countryId < 0) { e.free++; stateless++; }
  }
  // leading era, by the same read the app's headline uses
  let era = 0;
  for (const s of world.settlements) if (s.mode === "settled" && s.knowledge) { const e = techState(s.knowledge).era; if (e > era) era = e; }
  const f = telReport(world);
  snaps.push({ step: world.step, era, cities, stateless, per, f, bornInto: bornInto.n, bornOutside: bornOutside.n });
}

const ERA = ["Stone", "Bronze", "Classical", "Medieval", "Renaissance", "Industrial", "Modern", "Atomic", "Information"];
console.log(`\n=== WHERE ARE THE CITIES  ${W}x${H} (tw=${tw})  seed ${SEED} ===`);

console.log(`\n-- A. the register by REGION (cities = tier>=2; "free" = stateless) -------`);
const cols = snaps.filter(s => s.cities > 0);
const head = cols.map(s => String(s.step / 1000).padStart(7));
console.log(`   region        history(bronze) |${head.join("")}`);
console.log(`                                 |${cols.map(s => (ERA[s.era] || "?").slice(0, 6).padStart(7)).join("")}`);
for (const r of REGIONS) {
  const cells = cols.map(s => { const e = s.per.get(r.k); return e ? `${String(e.n).padStart(4)}/${String(e.free).padStart(2)}` : "     -"; });
  console.log(`   ${r.k.padEnd(13)} ${r.hist.padStart(15)} |${cells.map(c => c.padStart(7)).join("")}`);
}
{
  const cells = cols.map(s => { const e = s.per.get("elsewhere"); return e ? `${String(e.n).padStart(4)}/${String(e.free).padStart(2)}` : "     -"; });
  console.log(`   ${"elsewhere".padEnd(13)} ${"".padStart(15)} |${cells.map(c => c.padStart(7)).join("")}`);
}
console.log(`   (each cell: cities / of which stateless)`);

console.log(`\n-- B. is a new city born INTO a nation, or outside every one? -------------`);
console.log(`   step    era          new cities   born INTO a nation   born OUTSIDE   outside share`);
for (const s of snaps) {
  const tot = s.bornInto + s.bornOutside;
  if (!tot) continue;
  console.log(`  ${String(s.step).padStart(6)}  ${(ERA[s.era] || "?").padEnd(12)} ${String(tot).padStart(10)}   ${String(s.bornInto).padStart(18)}   ${String(s.bornOutside).padStart(12)}   ${(100 * s.bornOutside / tot).toFixed(0).padStart(11)}%`);
}
console.log(`   (history inverts this: the FIRST city of a cradle precedes its state — Uruk,`);
console.log(`    Harappa — but after that generation cities are planted BY states inside their`);
console.log(`    own ground: Alexandria, Antioch, Chang'an, every colonia and commandery seat.`);
console.log(`    So the spontaneous share should FALL across the eras, not hold.)`);
console.log("");
