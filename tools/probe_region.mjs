// Compare cradle regions: largest settlement, total pop, max organisation, and
// political territory (target tiles) inside each box — to see if the Middle East
// is stunted vs other cradles, at app-relevant resolution.
//   node tools/probe_region.mjs [steps] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "14000", 10);
const W = parseInt(process.argv[3] || "960", 10), H = parseInt(process.argv[4] || "480", 10);
const world = buildSim({ W, H, seed: 8817 });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

// settlement positions live on the (downsampled) people-sim grid world.tw/th
const TW = world.tw, TH = world.th;
const xx = lon => { let x = Math.round(((lon + 180) / 360) * TW) % TW; if (x < 0) x += TW; return x; };
const yy = lat => Math.round((90 - lat) / 180 * (TH - 1));
const setts = world.settlements.filter(s => s.mode === "settled");

function region(name, lat0, lat1, lon0, lon1) {
  const x0 = xx(lon0), x1 = xx(lon1), y0 = yy(lat1), y1 = yy(lat0);
  const inBox = s => { const x = s.pos.x | 0, y = s.pos.y | 0; return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
  const rs = setts.filter(inBox);
  let pop = 0, big = 0, bigName = '', maxOrg = 0, maxTier = 0, terr = 0;
  for (const s of rs) { pop += s.people; if (s.people > big) { big = s.people; bigName = s.name || ''; } const o = (s.knowledge && s.knowledge.organization) || 0; if (o > maxOrg) maxOrg = o; if ((s.tier|0) > maxTier) maxTier = s.tier|0; terr += s._terrTiles || 0; }
  // political tiles owned by any country whose capital sits in the box
  let claimTiles = 0; const co = world._countryOwner;
  if (co) { const ids = new Set(rs.map(s => grownId(s))); for (let i = 0; i < co.length; i++) if (ids.has(co[i])) claimTiles++; }
  console.log(`${name.padEnd(13)} setts=${String(rs.length).padStart(3)} pop=${String(Math.round(pop)).padStart(6)} big=${String(Math.round(big)).padStart(6)}(T${maxTier}) maxOrg=${maxOrg.toFixed(3)} terr=${String(terr).padStart(4)} claim=${String(claimTiles).padStart(4)}  ${bigName}`);
}
function grownId(s) { return s.countryId ?? -1; }

console.log(`[${W}x${H}] step ${STEPS}\n`);
region('Mesopotamia', 30, 37, 38, 49);
region('Levant',      31, 37, 35, 39);
region('Egypt/Nile',  24, 31, 30, 34);
region('Arabia',      15, 27, 40, 52);
region('Anatolia',    37, 41, 27, 42);
region('N China',     33, 41,108,118);
region('W Europe',    44, 52,  0, 12);
region('Indus',       24, 32, 66, 74);
region('Ganges',      24, 28, 77, 88);
