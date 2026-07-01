// Count fallen polities + empire tail + top-2 territory at end of run, parameterised
// by SIM_TUNE overrides — to calibrate the balance-of-power brake so it checks the
// hegemon WITHOUT freezing the top tier (states must still die at a realistic rate).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

const lifes = [];
if (world.polities) for (const p of world.polities.values()) if (p.endedStep >= 0) lifes.push(p.endedStep - p.foundedStep);
lifes.sort((a, b) => a - b);
const med = lifes.length ? lifes[lifes.length >> 1] : 0, max = lifes.length ? lifes[lifes.length - 1] : 0;

const terr = new Map(), co = world._countryOwner;
if (co) for (let i = 0; i < co.length; i++) { const c = co[i]; if (c >= 0) terr.set(c, (terr.get(c) || 0) + 1); }
const ts = [...terr.values()].sort((a, b) => b - a);

const mem = [];
if (world.countries) for (const c of world.countries.values()) { const m = c.members ? c.members.filter(s => s.mode === "settled" && s.countryId === c.id).length : 0; if (m > 0) mem.push(m); }
mem.sort((a, b) => b - a);
const memMed = mem.length ? mem[mem.length >> 1] : 1;

console.log(`fallen=${lifes.length} lifeMed=${med} lifeMax=${max} tail=${(mem[0]/memMed).toFixed(1)} (largest ${mem[0]}, med ${memMed}) terrTop=${ts.slice(0,3).join('/')}`);
