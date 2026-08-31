// Aesthetic identity bundle (`src/sim/aestheticIdentity.js`). No UI, no save fields.
import { styleOf, lookFromHomeland, RAIL_B_GENES } from "../src/sim/peopleStyle.js";
import {
  foundAestheticIdentity, blendAestheticIdentity, mutateAestheticIdentity,
  expressAesthetic, aestheticFingerprint, formatAestheticLine, AESTHETIC_AXES,
} from "../src/sim/aestheticIdentity.js";
import { buildWorld as pipelineBuild } from "../src/sim/pipeline.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

const equator = { temp: 0.86, moist: 0.70, lat: 2, elev: 0.02 };
const scandi  = { temp: 0.56, moist: 0.48, lat: 62, elev: 0.04 };

const silkCtx = {
  temp: 0.76, moist: 0.55, wealth: 0.70,
  ancMix: [[0, 1]],
  world: null,
  materials: { fibres: [{ id: "silk" }, { id: "wool" }], trees: [{ id: "oak" }], dyes: [{ id: "indigo" }] },
};

{
  const id = foundAestheticIdentity(4242, { ornament: 0.8, colour: 0.7 });
  ok(id.taste && id.taste.genes.length === 18, `identity carries 18-gene taste (${id.taste?.genes?.length})`);
  ok(id.seed === 4242, "identity preserves seed");
  ok(AESTHETIC_AXES.includes("regal"), "aesthetic axes enumerated");
  const again = foundAestheticIdentity(4242, { ornament: 0.8, colour: 0.7 });
  ok(JSON.stringify(id) === JSON.stringify(again), "foundAestheticIdentity is deterministic");
}

{
  const { ter } = pipelineBuild({ W: 240, H: 120, seed: 7, preset: "earth_sim" });
  silkCtx.world = { ancHomelands: ter.ancHomelands };
  silkCtx.ancMix = [[0, 1]];
  for (const gene of RAIL_B_GENES) {
    const v = ter.ancHomelands[0][gene];
    ok(v >= 0 && v <= 1, `lineage #0 ${gene} stamped (${v?.toFixed?.(2) ?? v})`);
  }
}

{
  const ornate = foundAestheticIdentity(1, { ornament: 0.9, colour: 0.8, regal: 0.85 });
  const austere = foundAestheticIdentity(2, { austerity: 0.92 });
  const a = expressAesthetic(silkCtx, ornate);
  const b = expressAesthetic(silkCtx, austere);
  ok(a.look && a.dress && a.built && a.taste, "expressAesthetic returns all four layers");
  ok(a.dress.fibre === "silk" && a.dress.layers && a.dress.sleeve && a.built.roofForm,
    `envelope has structural dress/built axes (${a.dress.layers}/${a.dress.sleeve}/${a.built.roofForm})`);
  ok(a.look.hairHue != null && a.look.epicanthic != null && a.look.jawWidth != null,
    `look carries Rail B genes (hue ${a.look.hairHue?.toFixed(2)} ep ${a.look.epicanthic?.toFixed(2)})`);
  ok(a.taste.dress.headdressStyle && a.taste.dress.cosmetics != null,
    `taste has cosmetics + headdress (${a.taste.dress.cosmetics}/${a.taste.dress.headdressStyle})`);
  ok(aestheticFingerprint(a) !== aestheticFingerprint(b),
    "same place, different identities → different fingerprint");
}

{
  const coldCtx = {
    temp: 0.56, moist: 0.50, wealth: 0.70, elev: 0.12,
    ancMix: [[0, 1]], world: silkCtx.world,
    materials: { fibres: [{ id: "wool" }], trees: [{ id: "oak" }] },
  };
  const warmCtx = {
    temp: 0.86, moist: 0.62, wealth: 0.15,
    ancMix: [[0, 1]], world: silkCtx.world,
    materials: { fibres: [{ id: "cotton" }], trees: [{ id: "palm" }] },
  };
  const id = foundAestheticIdentity(99, { pastoral: 0.6 });
  const cold = expressAesthetic(coldCtx, id);
  const warm = expressAesthetic(warmCtx, id);
  ok(cold.dress.fibre === "wool" && warm.dress.cut === "bare",
    `same taste, different tiles → different dress envelope (${cold.dress.fibre}/${warm.dress.cut})`);
  ok(cold.look.skin === warm.look.skin,
    `same ancestry → same look regardless of tile (${cold.look.skin?.toFixed(2)})`);
  ok(cold.built.roof !== warm.built.roof || cold.built.wall !== warm.built.wall,
    "built envelope follows local climate");
}

{
  const parent = foundAestheticIdentity(100, { ornament: 0.2 });
  const child = mutateAestheticIdentity(parent, 101, 1);
  ok(child.taste.gen === parent.taste.gen + 1, "mutate bumps taste generation");
  const blended = blendAestheticIdentity(
    parent, foundAestheticIdentity(200, { ornament: 0.9 }), 0.5);
  ok(blended.taste.genes[3] > parent.taste.genes[3], "blend moves embroidery toward ornate parent");
}

{
  const fp = axes => aestheticFingerprint(expressAesthetic({
    temp: 0.76, moist: 0.55, wealth: 0.70,
    ancMix: [[0, 1]], world: silkCtx.world,
    materials: { fibres: [{ id: "silk" }], trees: [{ id: "oak" }], dyes: [{ id: "indigo" }] },
  }, foundAestheticIdentity(500 + axes.seed, axes)));
  const bags = [
    { seed: 1, ornament: 0.85, colour: 0.8, regal: 0.9 },
    { seed: 2, austerity: 0.9, pastoral: 0.7 },
    { seed: 3, pattern: 0.9, colour: 0.75 },
    { seed: 4, arid: 0.8, ornament: 0.5 },
    { seed: 5, regal: 0.4, pattern: 0.85 },
  ];
  const prints = bags.map(fp);
  ok(new Set(prints).size === 5, `five aesthetic identities stay distinct (${prints.length} prints)`);
  ok(formatAestheticLine(expressAesthetic(silkCtx, foundAestheticIdentity(1, {}))).includes("skin="),
    "format line includes look summary");
}

{
  const override = lookFromHomeland(scandi);
  for (const gene of RAIL_B_GENES) override[gene] = 0.5;
  const id = foundAestheticIdentity(77, { colour: 0.6 });
  id.lookOverride = override;
  const a = expressAesthetic({ temp: 0.86, moist: 0.7, homeland: equator }, id);
  ok(a.look.skin < 0.45, "lookOverride bypasses tile homeland for creator mode");
}

if (fails) {
  console.error(`aestheticIdentity: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`aestheticIdentity: ${checks} checks ok`);
