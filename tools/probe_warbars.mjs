// War-throughput probe: WHY does no serial conqueror (Rome) emerge? The hegemon
// diagnostic (this session) measured: top realm at ZERO fronts at every checkpoint,
// dominance pinned 1.0-1.9, one war per polity per ~millennium, top1 land share
// never past 18% — the incorporation flywheel (manpower pool + garrisons + TILE_WAR
// national field armies all count conquered members) EXISTS but gets no revolutions.
// This probe attributes the bottleneck with opt-in counters (armies.js mkWarDebug):
//   INITIATION — every candidate attacker→defender pair per war pass, its most
//     permissive tile kept; rejections attributed to the single PIVOTAL bar factor
//     (agg = attacker temperament, trade = trade-peace, exhaust = war-weariness bar,
//     casus = identity kinship, claim = succession claims, dom = dominance discount,
//     coalition = balance-of-power backing), or "parity" (raw might short even bare),
//     or "stack" (only the combination rejects), plus truce-blocked pairs.
//   TERMINATION — every war ending: how (truce = exhaustion treaty, stalemate =
//     frozen-front settlement, faded = fronts dissolved), duration of the signed
//     peace, war age, exhaustion split at signing.
//   node tools/probe_warbars.mjs [steps=24000] [seed=8817]
// [RESOLVED — kept for the record] A gap surfaced while reading the code: at the
// time, amphibious fronts were disabled under the default TILE_WAR mode (armies.js
// "restore in a later slice") — populated enemy shores were unconquerable by sea.
// That gap HAS SINCE BEEN CLOSED: nation-level beachheads run under TILE_WAR
// (armies.js, the `T.AMPHIB_BAR > 0 && TILE_WAR` block; see "AMPHIB RESTORED"
// in the findings below). Do not re-diagnose it from this header.
//
// FINDINGS (24k, seed 8817, 480x240) — the funnel, measured:
//   INITIATION IS NOT THE BOTTLENECK: 4118 candidate pair-passes, 2275 opened
//     (55%). Rejection attribution: parity 58% (the power compression — nobody
//     out-mights the local tile bar), coalition 18% (spiking to ~30% exactly when
//     a power rises, e.g. 100 in one window at t=18k), trade-peace 12%, stack 8%,
//     exhaustion 4%; aggression/casus/claim ~0 and the great-power discounts (dom)
//     NEVER fire — dominance (fiscal-surplus-over-peers) stays 1.0-1.9 among
//     institutionally-similar antiquity peers, so DOM_ATTACK/DOM_CAPTURE are dead
//     letters in exactly the era that made hegemons by conquest.
//   THE TRUCE CYCLE IS THE BOTTLENECK: 7684 truce-blocked pair-passes — nearly 2x
//     the whole candidate stream. 9-24 simultaneous truces among ~24 realms lock a
//     top realm's entire neighbourhood (measured elsewhere: the top realm sits at
//     ZERO fronts at every checkpoint). Wars are short (age 325-1667t) but every
//     treaty locks the pair for 3075-4500t — 770-1125 DYN-YEARS: the trade-scaled
//     duration saturates because tradeW is measured against the self-relative pair-
//     trade MEDIAN, so the documented intent ("subsistence antiquity stays endemic-
//     warlike") never happens — antiquity signs millennium peaces.
//   AND THE TREATY PROTECTS THE LOSER: exhaustion at signing = winner 0.06-0.24 vs
//     loser 0.15-0.40 — the LOSER's exhaustion bar ends the war at the winner's
//     moment of victory; the beaten side pays a one-time indemnity, KEEPS its land,
//     and is shielded for a millennium. Victory resets the board instead of
//     compounding — the exact inverse of deditio, by which most ancient wars ended
//     (the loser became a CLIENT whose power joined the victor's next war). The
//     sim's only road from victory to permanent network growth is peacetime
//     submission at 5x network odds within punitive reach — nearly unreachable at
//     the measured power parity, so it never cascades.
//   THE ROME-SHAPED HOLE, in one line: the incorporation flywheel exists (manpower,
//     garrisons, TILE_WAR national armies, dependency power all count conquered/
//     submitted members) but every revolution is braked to zero at the treaty
//     table. Fix built from this finding: CAPITULATION (T.CAPITULATE, deditio) —
//     a decisively one-sided exhaustion treaty (gap ≥ CAPIT_GAP) whose victor's
//     live network might out-scales the loser ≥ CAPIT_RATIO × the coalition bar
//     ends in the loser bending the knee (conquest.js bendTheKnee) instead of a
//     protective truce. Secondary gaps still open: the truce-duration trade
//     reference, and the amphib gap above.
//   AMPHIB RESTORED (nation-level beachheads under TILE_WAR — armies.js): once
//     navigation matures (~t=21k, seed 8817) the war system changes regime: the
//     candidate stream goes ~10x (5271 pair-passes in one window), 238 wars start
//     and 198 end in a single 3000-tick window (114 truces, 9 CAPITULATIONS — the
//     deditio cascade now works at sea against island/coastal statelets), 117
//     truces run live, and the landing bar is pivotal in 9% of rejections. The
//     world stays coherent through the whole naval era: 42k endgame pop 2.0M,
//     colonate intact, era anchors within the single-seed noise band (classical
//     0.4-0.6x across builds). Stylized per-seed verdicts are IDENTICAL to the
//     pre-amphib build (nav spreads after the 15k horizon). AMPHIB_BAR=0 recovers
//     the sea-blind war byte-identically; the 2500-step hashbase pair is again
//     unchanged at defaults (no port has real seacraft that early).
//   CAPITULATION A/B (24k, seed 8817): capitulations are RARE AND DECISIVE — ~4
//     per era-span, exactly the deditio rhythm — yet the landscape transforms:
//     NETWORK top1 (suzerain + clients) reaches 27-29% of the claimed world with
//     3-4 vassals vs the baseline's flat 11-18% ceiling; top-realm capacity 26→58,
//     and fiscal dominance breaks 2.0 for the first time in any measured run
//     (vassal tribute feeding the treasury), waking the DOM great-power machinery
//     that was pivotal in 0 rejections before. The balance answers emergently:
//     coalition attribution rises 18%→25% of rejections (187 in the window the
//     hegemon surged). Worlds are byte-identical until the first capitulation
//     fires (~t=10k here; the 2500-step hashbase pair is unchanged at defaults).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { mkWarDebug, foldWarDebug } from "../src/sim/peopleSim/armies.js";

const STEPS = parseInt(process.argv[2] || "24000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
if (!world.debug) world.debug = {};
const W = world.debug.war = mkWarDebug();

let prev = null, seenSigned = 0;
for (let t = 0; t < STEPS; t += 3000) {
  stepPeopleSim(world, 3000);
  foldWarDebug(W);
  const win = {}; for (const k in W.tot) win[k] = W.tot[k] - (prev ? prev[k] : 0);
  prev = { ...W.tot };
  const sg = W.signed.slice(seenSigned); seenSigned = W.signed.length;
  const byHow = {}; let durS = 0, ageS = 0, exhHiS = 0, exhLoS = 0, nTreaty = 0;
  for (const s of sg) {
    byHow[s.how] = (byHow[s.how] || 0) + 1;
    if (s.how !== "faded") { durS += s.dur || 0; ageS += s.age || 0; exhHiS += s.exhHi || 0; exhLoS += s.exhLo || 0; nTreaty++; }
  }
  const activeTruces = world._truces ? [...world._truces.values()].filter((u) => u > world.step).length : 0;
  console.log(`step ${String(world.step).padStart(5)}: cand ${String(win.cand).padStart(4)} opened ${String(win.opened).padStart(4)} | rej: parity ${win.parity} agg ${win.agg} trade ${win.trade} amphib ${win.amphib || 0} exhaust ${win.war} casus ${win.casus} claim ${win.claim} dom ${win.dom} coalition ${win.coal} stack ${win.stack} | truce-blocked ${win.truceBlocked} (live truces ${activeTruces})`);
  console.log(`         wars started ${win.warsStarted}  ended ${sg.length} [${Object.entries(byHow).map(([k, v]) => k + " " + v).join(", ") || "-"}]`
    + (nTreaty ? `  treaty: mean peace ${Math.round(durS / nTreaty)}t, war age ${Math.round(ageS / nTreaty)}t, exhaustion winner/loser ${(exhLoS / nTreaty).toFixed(2)}/${(exhHiS / nTreaty).toFixed(2)}` : ""));
}
const T2 = W.tot;
console.log(`\nTOTALS: candidates ${T2.cand}, opened ${T2.opened} (${(T2.opened / Math.max(1, T2.cand) * 100).toFixed(1)}%), truce-blocked ${T2.truceBlocked}`);
const rej = { parity: T2.parity, agg: T2.agg, trade: T2.trade, amphib: T2.amphib || 0, exhaust: T2.war, casus: T2.casus, claim: T2.claim, dom: T2.dom, coalition: T2.coal, stack: T2.stack };
const totRej = Object.values(rej).reduce((a, b) => a + b, 0) || 1;
console.log("rejection attribution: " + Object.entries(rej).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / totRej * 100).toFixed(0)}%`).join("  "));
