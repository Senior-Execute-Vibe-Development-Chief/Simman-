// People-style decider (`src/sim/peopleStyle.js`). No UI, no save fields.
import { lookFromHomeland, mixLook, lookOf, dressOf, builtOf, styleOf, homelandsFrom, ancMixAtTile } from "../src/sim/peopleStyle.js";
import { buildWorld as pipelineBuild } from "../src/sim/pipeline.js";
import { buildSim } from "./_harness.mjs";
import { lonLatToIndex } from "../src/sim/earthPlates.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, `${msg} (${a.toFixed(3)} vs ${b.toFixed(3)})`);
}

const equator = { temp: 0.86, moist: 0.70, lat: 2, elev: 0.02 };
const scandi  = { temp: 0.56, moist: 0.48, lat: 62, elev: 0.04 };
const andes   = { temp: 0.62, moist: 0.38, lat: -16, elev: 0.32 };
const sahara  = { temp: 0.88, moist: 0.10, lat: 22, elev: 0.04 };

{
  const a = lookFromHomeland(equator);
  const b = lookFromHomeland(scandi);
  ok(a.skin > b.skin + 0.15, `equator darker than high-lat (${a.skin.toFixed(2)} vs ${b.skin.toFixed(2)})`);
  ok(b.build > a.build + 0.12, `cold stockier than tropic (${b.build.toFixed(2)} vs ${a.build.toFixed(2)})`);
  ok(a.limbs > b.limbs + 0.12, `Allen: warm longer limbs (${a.limbs.toFixed(2)} vs ${b.limbs.toFixed(2)})`);
  ok(a.noseWidth > b.noseWidth + 0.10, `Thomson: warm-wet broader nose (${a.noseWidth.toFixed(2)} vs ${b.noseWidth.toFixed(2)})`);
  ok(a.hairCurl > b.hairCurl + 0.15, `warm-wet curlier hair (${a.hairCurl.toFixed(2)} vs ${b.hairCurl.toFixed(2)})`);
}

{
  const low = lookFromHomeland({ ...andes, elev: 0.02 });
  const high = lookFromHomeland(andes);
  ok(high.skin >= low.skin, `Andean UV from altitude does not lighten (${high.skin.toFixed(2)} vs ${low.skin.toFixed(2)})`);
}

{
  const mix = mixLook([
    { look: lookFromHomeland(equator), share: 0.5 },
    { look: lookFromHomeland(scandi), share: 0.5 },
  ]);
  const a = lookFromHomeland(equator);
  const b = lookFromHomeland(scandi);
  near(mix.skin, (a.skin + b.skin) / 2, 1e-6, "50/50 skin is the mean");
}

{
  const here = { temp: 0.86, moist: 0.2, flood: false, homeland: scandi };
  const look = lookOf(here);
  const fromHome = lookFromHomeland(scandi);
  near(look.skin, fromHome.skin, 1e-6, "look follows homeland, not the hot tile");
  ok(dressOf(here).weight === "light", `hot tile is light dress (${dressOf(here).weight})`);
  ok(dressOf({ temp: 0.54, moist: 0.5 }).weight === "heavy", "cold tile is heavy dress");
}

{
  const mixed = lookOf({
    temp: 0.90,
    ancMix: [[1, 0.7], [2, 0.3]],
    homelands: { 1: equator, 2: scandi },
  });
  ok(mixed && mixed.skin > lookFromHomeland(scandi).skin, "admixture leans toward majority homeland");
  ok(lookOf({ temp: 0.90 }) === null, "no homeland → no look (does not fake it from the tile)");
}

{
  ok(dressOf({ temp: 0.86 }).cut === "drape", "heat (not humid) → drape");
  ok(dressOf({ temp: 0.58, livestock: 0.6, horses: 0.2, open: true }).cut === "trousers",
    "cold + riding stock → trousers");
  ok(dressOf({ temp: 0.64 }).cut === "tailored" || dressOf({ temp: 0.64 }).cut === "trousers",
    "cool temperate is cut, not drape");
}

{
  const poor = dressOf({ temp: 0.86, moist: 0.72, wealth: 0.15 });
  ok(poor.cut === "bare" && poor.weight === "bare" && poor.silhouette === "minimal",
    `hot-humid plain is bare (${poor.cut}/${poor.weight})`);
  ok(poor.head === "none" && poor.foot === "none",
    `bare has no covering (${poor.head}/${poor.foot})`);
  const rich = dressOf({ temp: 0.86, moist: 0.72, wealth: 0.65 });
  ok(rich.cut === "robe" && rich.weight === "light" && rich.station === "fine",
    `hot-humid surplus is a light robe, silk not required (${rich.cut}/${rich.fibre})`);
  ok(rich.head === "none" && rich.foot === "sandal",
    `hot-humid robe is sandal, not a wrap (${rich.head}/${rich.foot})`);
  const arid = dressOf({ temp: 0.86, moist: 0.12, wealth: 0.65 });
  ok(arid.head === "wrap" && arid.cut === "drape" && arid.foot === "sandal",
    `hot-dry surplus wraps the head (${arid.head}/${arid.cut})`);
  const cold = dressOf({ temp: 0.54, moist: 0.50, wealth: 0.40 });
  ok(cold.head === "hood" && cold.foot === "boot" && cold.weight === "heavy",
    `cold sedentary is hood + boot (${cold.head}/${cold.foot}/${cold.weight})`);
}

{
  const wool = dressOf({
    temp: 0.55, livestock: 0.6,
    materials: { fibres: [{ id: "wool" }, { id: "cotton" }] },
  });
  ok(wool.fibre === "wool", `cold prefers wool (${wool.fibre})`);
  const hot = dressOf({
    temp: 0.84,
    materials: { fibres: [{ id: "wool" }, { id: "cotton" }, { id: "flax" }] },
  });
  ok(hot.fibre === "cotton" || hot.fibre === "linen", `heat prefers cotton/linen (${hot.fibre})`);
}

{
  const snow = builtOf({ temp: 0.56, moist: 0.50, elev: 0.12 });
  ok(snow.roof === "steep" && snow.pitch > 0.6, `snow country steep roof (${snow.roof} ${snow.pitch.toFixed(2)})`);
  ok(snow.plan === "compact", `cold plan is compact (${snow.plan})`);
  const dry = builtOf({ temp: 0.86, moist: 0.12, elev: 0.04, materials: { earths: [{ id: "clay" }] } });
  ok(dry.roof === "flat" && dry.pitch < 0.25, `arid roof is flat (${dry.roof} ${dry.pitch.toFixed(2)})`);
  ok(dry.plan === "courtyard", `arid plan is courtyard (${dry.plan})`);
  ok(dry.wall === "mudbrick", `arid + clay is mudbrick (${dry.wall})`);
  const flood = builtOf({ temp: 0.82, moist: 0.55, flood: true, materials: { trees: [{ id: "reed" }] } });
  ok(flood.plan === "raised", `flood plan is raised (${flood.plan})`);
  ok(flood.wall === "reed", `flood + reed wall (${flood.wall})`);
  const oak = builtOf({
    temp: 0.68, moist: 0.55, elev: 0.08,
    materials: { trees: [{ id: "oak" }, { id: "beech" }] },
  });
  ok(oak.wall === "timber", `temperate oak country is timber (${oak.wall})`);
  ok(oak.roof === "pitched" || oak.roof === "steep", `rain country is not flat (${oak.roof})`);
  ok(oak.cover === "shingle", `mill-timber rain is shingle (${oak.cover})`);
}

{
  const tropic = builtOf({
    temp: 0.86, moist: 0.62, wealth: 0.15,
    materials: { trees: [{ id: "palm" }] },
  });
  ok(tropic.wall === "wattle" && tropic.cover === "thatch",
    `hot-humid without mill-timber is wattle/thatch, not mudbrick (${tropic.wall}/${tropic.cover})`);
  ok(tropic.roof === "pitched" && tropic.openings === "small" && tropic.scale === "hut",
    `hot-humid hut is pitched + small openings (${tropic.roof}/${tropic.openings}/${tropic.scale})`);
  const bamboo = builtOf({
    temp: 0.86, moist: 0.62, wealth: 0.20,
    materials: { trees: [{ id: "bamboo" }] },
  });
  ok(bamboo.wall === "bamboo", `hot-wet bamboo is a bamboo wall (${bamboo.wall})`);
  const steppe = builtOf({
    temp: 0.62, moist: 0.28, horses: 0.4, open: true, wealth: 0.25,
  });
  ok(steppe.wall === "felt" && steppe.roof === "tent" && steppe.plan === "camp" && steppe.scale === "camp",
    `open pasture + horses, no mill-timber → felt tent (${steppe.wall}/${steppe.roof}/${steppe.plan})`);
  const polar = builtOf({ temp: 0.50, moist: 0.28, wealth: 0.20 });
  ok(polar.wall === "turf" && polar.roof === "low" && polar.cover === "turf",
    `cold dry without timber is turf, not a steep hall (${polar.wall}/${polar.roof})`);
  ok(polar.openings === "small", `polar openings stay small (${polar.openings})`);
  const hall = builtOf({
    temp: 0.56, moist: 0.50, elev: 0.12, wealth: 0.82,
    materials: { trees: [{ id: "oak" }] },
  });
  ok(hall.scale === "hall" && hall.openings === "large" && hall.cover === "shingle",
    `cold-wet surplus is a large-opening hall (${hall.scale}/${hall.openings})`);
}

{
  const gem = dressOf({
    temp: 0.76, wealth: 0.70,
    materials: { gems: [{ id: "lapis" }], dyes: [{ id: "indigo" }] },
  });
  ok(gem.ornament === "lapis" && gem.dye === "indigo",
    `lapis is jewelry, indigo is the cloth (${gem.ornament}/${gem.dye})`);
  const poor = dressOf({
    temp: 0.76, wealth: 0.20,
    materials: { gems: [{ id: "lapis" }], metals: [{ id: "gold" }] },
  });
  ok(poor.ornament === null, "plain station wears no gem ornament");
}

{
  const stone = builtOf({
    temp: 0.70, moist: 0.40, elev: 0.28, relief: 0.5,
    materials: { stone: [{ id: "granite" }], trees: [{ id: "oak" }] },
  });
  ok(stone.wall === "stone", `highland stone beats timber (${stone.wall})`);
}

{
  const a = styleOf({ temp: 0.56, moist: 0.5, homeland: scandi });
  const b = styleOf({ temp: 0.56, moist: 0.5, homeland: scandi });
  ok(JSON.stringify(a) === JSON.stringify(b), "same signals → identical JSON");
  ok(a.look && a.dress && a.built, "styleOf returns look, dress, built");
  ok(a.dress.weight === "heavy" && a.built.roof === "steep",
    "cold-wet homeland on a cold tile: heavy dress + steep roof");
}

{
  const moved = styleOf({
    temp: 0.86, moist: 0.14, flood: false,
    homeland: scandi,
    materials: { earths: [{ id: "clay" }] },
  });
  ok(moved.look.skin < 0.45, "migrant keeps a fair high-lat look");
  ok(moved.dress.weight === "light", "migrant takes up light dress");
  ok(moved.built.roof === "flat" && moved.built.plan === "courtyard",
    "migrant takes up flat courtyard mudbrick country");
}

// Five bags that must not collapse. Comments are the human analogy;
// the code only sees climate, wealth, fibre, and homeland.
{
  const fp = s => [
    s.look.skin > 0.55 ? "dark" : s.look.skin > 0.32 ? "mid" : "fair",
    s.dress.station, s.dress.fibre, s.dress.cut, s.dress.silhouette,
    s.built.wall, s.built.roof, s.built.plan, s.built.eaves,
  ].join("|");

  const tropicPlain = styleOf({
    temp: 0.86, moist: 0.62, wealth: 0.15, homeland: equator,
    materials: { fibres: [{ id: "cotton" }], trees: [{ id: "palm" }] },
  });
  const aridFine = styleOf({
    temp: 0.86, moist: 0.12, wealth: 0.65, homeland: sahara,
    materials: { fibres: [{ id: "flax" }], earths: [{ id: "clay" }], dyes: [{ id: "tyrian" }] },
  });
  const woolFine = styleOf({
    temp: 0.58, moist: 0.50, wealth: 0.70, homeland: scandi, elev: 0.24, relief: 0.45,
    materials: { fibres: [{ id: "wool" }], stone: [{ id: "granite" }], trees: [{ id: "oak" }] },
  });
  const silkFine = styleOf({
    temp: 0.76, moist: 0.55, wealth: 0.70, homeland: { temp: 0.76, moist: 0.55, lat: 32 },
    materials: { fibres: [{ id: "silk" }, { id: "wool" }], trees: [{ id: "oak" }], dyes: [{ id: "indigo" }] },
  });
  const hidePlain = styleOf({
    temp: 0.70, moist: 0.48, wealth: 0.18, homeland: { temp: 0.70, moist: 0.45, lat: 42 },
    materials: { fauna: [{ id: "deer" }], trees: [{ id: "oak" }] },
  });

  ok(tropicPlain.dress.station === "plain" && tropicPlain.dress.cut === "bare",
    `low-surplus hot-humid is bare (${fp(tropicPlain)})`);
  ok(tropicPlain.built.wall === "wattle" && tropicPlain.built.cover === "thatch",
    `that analog is a thatch hut, not mill timber (${tropicPlain.built.wall}/${tropicPlain.built.cover})`);
  ok(aridFine.dress.cut === "drape" && aridFine.built.plan === "courtyard" && aridFine.dress.dye === "tyrian",
    `hot-dry surplus is flowing courtyard (${fp(aridFine)})`);
  ok(woolFine.dress.fibre === "wool" && woolFine.dress.cut === "tailored" && woolFine.dress.silhouette === "structured",
    `cold surplus wool is structured tailored (${fp(woolFine)})`);
  ok(silkFine.dress.fibre === "silk" && silkFine.dress.cut === "robe" && silkFine.dress.silhouette === "flowing",
    `silk surplus is robe, not tailored wool (${fp(silkFine)})`);
  ok(silkFine.built.plan === "courtyard" && silkFine.built.eaves === "deep",
    `warm-wet surplus compound has eaves (${fp(silkFine)})`);
  ok(hidePlain.dress.fibre === "leather" && hidePlain.dress.station === "plain",
    `low-surplus hunt is leather (${fp(hidePlain)})`);
  ok(woolFine.look.skin < silkFine.look.skin && silkFine.look.skin < tropicPlain.look.skin,
    "skin cline: high-lat < mid-lat < equator");

  const prints = [tropicPlain, aridFine, woolFine, silkFine, hidePlain].map(fp);
  const uniq = new Set(prints);
  ok(uniq.size === 5, `five climate/wealth bags stay distinct (${prints.join(" || ")})`);
}

{
  const { ter } = pipelineBuild({ W: 240, H: 120, seed: 7, preset: "earth_sim" });
  ok(ter.ancHomelands && ter.ancHomelands.length === ter.ancestryCount,
    `every lineage has a genesis homeland (${ter.ancHomelands?.length}/${ter.ancestryCount})`);
  const h0 = ter.ancHomelands[0];
  ok(h0 && h0.temp > 0.65 && h0.lat > -10 && h0.lat < 25,
    `cradle lineage anchor is warm-equatorial (${h0?.temp?.toFixed(2)} t ${h0?.lat?.toFixed(1)}° lat)`);
  ok(homelandsFrom({ ancHomelands: ter.ancHomelands }) === ter.ancHomelands,
    "homelandsFrom reads world.ancHomelands");
  for (const h of ter.ancHomelands) {
    ok(h.temp >= 0 && h.temp <= 1 && h.moist >= 0 && h.moist <= 1 && typeof h.lat === "number",
      `homeland stamp is finite climate (${h.temp?.toFixed(2)} ${h.moist?.toFixed(2)} ${h.lat?.toFixed(1)}°)`);
  }
  const warmId = ter.ancHomelands.findIndex(h => h.lat < 15 && h.temp > 0.78);
  const coldId = ter.ancHomelands.findIndex(h => h.lat > 50);
  ok(warmId >= 0 && coldId >= 0, "Earth run has equatorial and high-lat lineage anchors");
  const warmLook = lookOf({ ancMix: [[warmId, 1]], world: { ancHomelands: ter.ancHomelands } });
  const coldLook = lookOf({ ancMix: [[coldId, 1]], world: { ancHomelands: ter.ancHomelands } });
  ok(warmLook.skin > coldLook.skin + 0.12,
    `stamped homelands separate warm/cold look (${warmLook.skin.toFixed(2)} vs ${coldLook.skin.toFixed(2)})`);
  const world = buildSim({ W: 240, H: 120, seed: 7, preset: "earth_sim" });
  ok(world.ancHomelands && world.ancHomelands.length === ter.ancestryCount,
    "buildSim carries ancHomelands");
  ok(world.ancHomelands[0].temp === ter.ancHomelands[0].temp,
    "homeland stamp is deterministic across builds");
  const norTi = lonLatToIndex(8, 60, world.tw, world.th);
  const mix = ancMixAtTile(world, norTi);
  ok(mix && mix.length === 1, `Norway tile has one ancestry (${mix && mix[0][0]})`);
  const tileLook = lookOf({ ancMix: mix, world });
  ok(tileLook && tileLook.skin >= 0 && tileLook.build >= 0,
    `tile look resolves through world.ancHomelands (skin ${tileLook?.skin?.toFixed(2)})`);
}

if (fails) {
  console.error(`peopleStyle: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`peopleStyle: ${checks} checks ok`);
