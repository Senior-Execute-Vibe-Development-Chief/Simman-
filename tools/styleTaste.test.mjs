// Style taste genome (`src/sim/styleTaste.js`). No UI, no save fields.
import { styleOf } from "../src/sim/peopleStyle.js";
import {
  foundTasteGenome, mutateTasteGenome, blendTasteGenome,
  expressTaste, styleWithTaste, tasteFingerprint,
} from "../src/sim/styleTaste.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

const silkCtx = {
  temp: 0.76, moist: 0.55, wealth: 0.70,
  homeland: { temp: 0.76, moist: 0.55, lat: 32, facialHair: 0.55 },
  materials: { fibres: [{ id: "silk" }, { id: "wool" }], trees: [{ id: "oak" }], dyes: [{ id: "indigo" }] },
};

{
  const g = foundTasteGenome(4242, { ornament: 0.8, colour: 0.7 });
  ok(g.genes.length === 15, `genome has ${g.genes.length} taste genes`);
  const a = foundTasteGenome(4242, { ornament: 0.8, colour: 0.7 });
  ok(JSON.stringify(g) === JSON.stringify(a), "foundTasteGenome is deterministic");
  const austere = foundTasteGenome(4242, { austerity: 0.9 });
  ok(austere.genes[3] < g.genes[3], "austerity lowers embroidery gene");
}

{
  const env = styleOf(silkCtx);
  const ornate = expressTaste(env, foundTasteGenome(1, { ornament: 0.9, colour: 0.8 }));
  const plain = expressTaste(env, foundTasteGenome(2, { austerity: 0.92 }));
  ok(ornate.dress.embroidery !== "none" || ornate.dress.pattern !== "plain",
    `ornate taste decorates silk (${ornate.dress.embroidery}/${ornate.dress.pattern})`);
  ok(plain.dress.embroidery === "none" || plain.dress.pattern === "plain",
    `austere taste stays plain (${plain.dress.embroidery}/${plain.dress.pattern})`);
  ok(tasteFingerprint(ornate) !== tasteFingerprint(plain),
    "same envelope, different taste genomes → different fingerprint");
}

{
  const bare = styleOf({ temp: 0.86, moist: 0.72, wealth: 0.15 });
  const t = expressTaste(bare, foundTasteGenome(9, { ornament: 0.95 }));
  ok(t.dress.embroidery === "none" && t.dress.pattern === "plain",
    `bare envelope cannot embroider (${t.dress.embroidery}/${t.dress.pattern})`);
}

{
  const lowBeard = styleOf({
    temp: 0.76, moist: 0.55, wealth: 0.70,
    homeland: { temp: 0.76, moist: 0.55, lat: 32, facialHair: 0.05 },
  });
  const t = expressTaste(lowBeard, foundTasteGenome(3, { ornament: 0.5 }));
  ok(t.dress.beard === "none", `low facialHair capacity → no beard (${t.dress.beard})`);
}

{
  const tent = styleOf({
    temp: 0.62, moist: 0.28, horses: 0.4, open: true, wealth: 0.25,
  });
  ok(tent.built.roof === "tent", `steppe is tent (${tent.built.roof})`);
  const t = expressTaste(tent, foundTasteGenome(4, { ornament: 0.95 }));
  ok(t.built.cornerFlare === "none", `tent has no corner flare (${t.built.cornerFlare})`);
}

{
  const parent = foundTasteGenome(100, { ornament: 0.2 });
  const child = mutateTasteGenome(parent, 101, 1);
  ok(child.gen === parent.gen + 1, "mutate bumps generation");
  const blended = blendTasteGenome(parent, foundTasteGenome(200, { ornament: 0.9 }), 0.5);
  const mid = parent.genes[3] < blended.genes[3] && blended.genes[3] < 0.95;
  ok(mid, `blend sits between parents (${blended.genes[3].toFixed(2)})`);
}

{
  const fp = s => tasteFingerprint(styleWithTaste(silkCtx, foundTasteGenome(s.seed, s.axes)).taste);
  const courts = [
    { seed: 11, axes: { regal: 0.85, ornament: 0.8, colour: 0.7 } },
    { seed: 22, axes: { austerity: 0.88, pastoral: 0.5 } },
    { seed: 33, axes: { pattern: 0.9, colour: 0.75 } },
    { seed: 44, axes: { arid: 0.7, ornament: 0.55 } },
    { seed: 55, axes: { regal: 0.4, pattern: 0.85, colour: 0.4 } },
  ];
  const prints = courts.map(fp);
  ok(new Set(prints).size === 5,
    `five silk courts split by taste (${prints.join(" || ")})`);
  const envOnly = tasteFingerprint(expressTaste(styleOf(silkCtx), foundTasteGenome(11, courts[0].axes)));
  ok(prints[0] === envOnly, "styleWithTaste taste matches expressTaste");
}

if (fails) {
  console.error(`styleTaste: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`styleTaste: ${checks} checks ok`);
