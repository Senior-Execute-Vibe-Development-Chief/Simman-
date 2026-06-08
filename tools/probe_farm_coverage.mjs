// How much of the land — and of each country — is actually FARMED (owned by a
// tier-0 Farming Region) vs claimed-but-unfarmed vs wild? Answers: do Farming
// Regions cover the majority of a country's farmable land, leaving only the
// truly unfarmable blank?   node tools/probe_farm_coverage.mjs [step] [seed]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

const STEP = +(process.argv[2] || "10000");
const SEED = +(process.argv[3] || "8817");
const W = 480, H = 240, N = W * H;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tE = new Float32Array(N), tT = new Float32Array(N), tM = new Float32Array(N), tC = new Uint8Array(N), tCrop = new Float32Array(N);
for (let i = 0; i < N; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; }
const rivers = computeRivers(W, H, tE, tM, tT); w.rivers = rivers;
const rmag = rivers.riverMag;
for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tT[i], tM[i], tE[i], tC[i], rmag ? rmag[i] : 0);
w.deposits = generateResources(W, H, tE, tT, tM, tC, w, SEED, rivers);
const world = initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits: w.deposits });
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);
console.log(`[stats]`, peopleSimStats(world));

const tier = new Map();
for (const s of world.settlements) if (s.mode === "settled") tier.set(s.id, s.tier | 0);
const own = world._territoryOwner;        // per-tile SETTLEMENT owner (-1 = none)
const co  = world._countryOwner;          // per-tile COUNTRY owner (political, incl. gap-fill)
const fert = world.fert, elev = world.elev;
const NT = world.N;                        // people-sim TILE resolution (downsampled, TILE_RES=2)

// "Farmable" = crop fertility at/above the plantable floor. The sim's floor is
// 0.30 − 0.20×agriculture, so a developed region plants down to ~0.10; report a
// few thresholds. A tile is FARMED if its settlement owner is a tier-0 Farming
// Region (FARM_MAX_TIER=0 → only tier-0 works the land).
const THRESH = [0.30, 0.20, 0.10];
let land = 0, inCountry = 0, farmed = 0, urbanOwned = 0;
const farmable = THRESH.map(() => 0);
// breakdown of FARMABLE(≥0.20) land
let fб = 0, f_farmed = 0, f_urban = 0, f_countryGap = 0, f_wild = 0;
for (let i = 0; i < NT; i++) {
  if (!(elev[i] > 0)) continue;
  land++;
  const f = fert[i] || 0;
  THRESH.forEach((t, j) => { if (f >= t) farmable[j]++; });
  const oid = own ? own[i] : -1;
  const ot = oid >= 0 ? (tier.has(oid) ? tier.get(oid) : -1) : -1;
  const inC = co && co[i] >= 0;
  if (inC) inCountry++;
  if (ot === 0) farmed++;
  else if (ot >= 1) urbanOwned++;
  if (f >= 0.20) {
    fб++;
    if (ot === 0) f_farmed++;
    else if (ot >= 1) f_urban++;
    else if (inC) f_countryGap++;   // inside a country's borders but owned by no settlement
    else f_wild++;                  // no country at all
  }
}
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + "%";
console.log(`\n── land use @ step ${STEP} (earth ${SEED}) ──`);
console.log(`land tiles ............ ${land}`);
console.log(`farmable  (fert≥0.30) . ${pct(farmable[0], land)}   (≥0.20) ${pct(farmable[1], land)}   (≥0.10) ${pct(farmable[2], land)}`);
console.log(`in a country (claimed)  ${pct(inCountry, land)}`);
console.log(`farmed (Farming Region) ${pct(farmed, land)} of all land`);
console.log(`urban-owned (town/city) ${pct(urbanOwned, land)} of all land`);
console.log(`\n── of FARMABLE land (fert≥0.20, ${fб} tiles): where does it go? ──`);
console.log(`farmed by a Farming Region .......... ${pct(f_farmed, fб)}`);
console.log(`owned by a town/city (NOT farmed) ... ${pct(f_urban, fб)}`);
console.log(`inside borders, owned by nobody ..... ${pct(f_countryGap, fб)}`);
console.log(`wild (no country reached it yet) .... ${pct(f_wild, fб)}`);
console.log(`\n── WITHIN the settled world (farmable land that IS in a country) ──`);
const inCountryFarmable = f_farmed + f_urban + f_countryGap;
console.log(`of a country's farmable land, % actually farmed by Farming Regions: ${pct(f_farmed, inCountryFarmable)}`);
console.log(`(the rest is urban-owned hinterland ${pct(f_urban, inCountryFarmable)} or unclaimed gaps ${pct(f_countryGap, inCountryFarmable)})`);
