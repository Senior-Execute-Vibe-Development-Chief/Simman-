import { buildSubstrate } from "./src/sim/substrate";
import { createTravelEngine } from "./src/sim/travel/engine";
import type { TravelMetric } from "./src/sim/travel/cost";

async function main() {
  const sub = buildSubstrate(42042, { preset: "earth_sim" }, "target");
  const W = sub.width, H = sub.height;
  const cell = (lat: number, lon: number) => {
    const x = Math.round((lon + 180) / 360 * W) % W;
    const y = Math.max(0, Math.min(H - 1, Math.round((90 - lat) / 180 * H)));
    let c = y * W + x;
    if (!sub.landMask[c]) { outer: for (let r = 1; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const t = Math.max(0, Math.min(H - 1, y + dy)) * W + ((x + dx + W) % W); if (sub.landMask[t]) { c = t; break outer; } } }
    return c;
  };
  const engine = await createTravelEngine(sub);
  const cairo = cell(29.9, 31.2), aswan = cell(24.1, 32.9);
  const share = (q: { modes: readonly number[] }) => +(q.modes.filter((m) => m === 3).length / Math.max(1, q.modes.length)).toFixed(2);
  for (const month of [0, 6]) {
    const m: TravelMetric = { month, modes: ["foot", "pack", "river"], capabilities: ["packAnimals", "boats"] };
    const up = engine.query(cairo, aswan, m);
    const down = engine.query(aswan, cairo, m);
    // Wind over the valley this month
    const mid = cell(27, 31.2);
    const v = sub.wind.v[mid * 12 + month] ?? 0;
    console.log(`month ${month}: valley wind northward ${v.toFixed(1)} m/s | south(up) ${up.days.toFixed(1)}d river ${share(up)} | north(down) ${down.days.toFixed(1)}d river ${share(down)}`);
  }
}
void main();
