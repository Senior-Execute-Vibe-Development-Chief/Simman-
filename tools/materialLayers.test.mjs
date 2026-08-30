// Overlay catalog + field builder for named tile materials.
import { buildMaterialFields, layerTileCount, MATERIAL_LAYERS } from "../src/sim/materialLayers.js";
import { generateWorld } from "../src/sim/worldgen.js";
import { buildTerritory } from "../src/sim/pipeline.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

{
  ok(MATERIAL_LAYERS.length >= 90, `catalog has ${MATERIAL_LAYERS.length} layers`);
  const ids = new Set(MATERIAL_LAYERS.map(l => l.id));
  ok(ids.size === MATERIAL_LAYERS.length, "layer ids unique");
  ok(ids.has("oak") && ids.has("llama") && ids.has("cloves") && ids.has("papyrus"), "key endemics listed");
  ok(ids.has("wheat") && ids.has("rice"), "crop packages listed");
}

{
  const w = generateWorld(120, 60, 42, "earth", 0.78);
  const ter = buildTerritory(w, 1);
  const fields = buildMaterialFields(w, ter);
  ok(typeof fields === "object", "buildMaterialFields returns object");
  const oakN = layerTileCount(fields, "oak");
  const fishN = layerTileCount(fields, "fish");
  ok(oakN > 0 || fishN > 0, `some layers present (oak=${oakN}, fish=${fishN})`);
  ok(layerTileCount(fields, "not-a-material") === 0, "unknown id counts 0");
}

if (fails) {
  console.error(`materialLayers: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`materialLayers: ${checks} checks ok`);
