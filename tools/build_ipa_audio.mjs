// Build the recorded-phone bank for the Lab's "recorded phones" voice from
// Wikimedia Commons — the openly licensed IPA recordings (largely Peter
// Isotalo's 2005 set and successors; CC BY-SA / public domain PER FILE, which
// this tool records rather than assumes).
//
//   node tools/build_ipa_audio.mjs          # resolve + download + emit
//   node tools/build_ipa_audio.mjs --dry    # resolve + coverage report only
//
// What it does, start to finish:
//   1. Enumerates the generator's own base phone space by running ipaC/ipaV
//      over the feature grids (never a hand-copied symbol list — key parity
//      with what phoneticPlan emits is by construction).
//   2. Maps each symbol to CANDIDATE Commons titles (naming there is mostly
//      systematic, but sibilants/affricates/laxes have variants; the API
//      resolves which candidate exists, so a wrong guess is a report line,
//      never a broken asset).
//   3. Downloads each file once (skips ones already on disk — re-runs are
//      cheap and resumable), throttled with a real User-Agent: Commons
//      rate-limits anonymous datacenter traffic hard.
//   4. Writes assets/ipa-audio/{<cp-hex>.ogg, SOURCES.tsv} and emits
//      src/sim/ipaAudioManifest.js (symbol → file, plus the credit line).
//      Per-file licence + author land in SOURCES.tsv; see CREDITS-ipa-audio.md.
//
// A symbol with no resolvable recording is FINE: the Lab falls back to the
// synthesizer for it. Coverage is printed so the gap is a known number.
//
// NOTE the deliberate source choice: haakonkrohn.com/ipa (the chart that
// prompted this) carries plain "©" with no reuse licence, so its WAVs cannot
// be redistributed in this repo. Commons files carry explicit per-file
// licences, which SOURCES.tsv preserves.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ipaC, ipaV } from "../src/sim/languagePhonetics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "ipa-audio");
const MANIFEST = join(ROOT, "src", "sim", "ipaAudioManifest.js");
const DRY = process.argv.includes("--dry");
const UA = "Simman-worldsim-asset-fetch/1.0 (open-source hobby worldsim; one-off asset build)";
// Commons rate-limits anonymous datacenter traffic HARD (429 storms even at
// sub-second pacing). Patience is the only fix: long gaps, long backoffs, and
// an on-disk resolution cache so an interrupted run resumes instead of
// re-asking. This tool is a one-off asset build — slow is fine.
const PACE_API_MS = 12000;           // between API batches
const PACE_DL_MS = 4000;             // between file downloads (the file host throttles too)
const API = "https://commons.wikimedia.org/w/api.php";
const CACHE = join(dirname(fileURLToPath(import.meta.url)), ".ipa-resolve-cache.json");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cpSlug = (sym) => [...sym].map(c => c.codePointAt(0).toString(16).padStart(4, "0")).join("-");

// curl, because it honors the proxy setup Node's fetch ignores (and is just as
// available on a dev machine). Sequential + throttled by design — do not
// parallelize this against Commons.
// -f is load-bearing: without it curl exits 0 on a 429/403 and the throttle
// page gets SAVED AS THE AUDIO FILE (109 of the first run's 119 files were
// HTML). With it, an HTTP error becomes a curl failure → the retry/backoff path.
function curl(url, extra = []) {
  return execFileSync("curl", ["-sSf", "--max-time", "60", "-A", UA, ...extra, url],
    { maxBuffer: 64 * 1024 * 1024 });
}
// belt to that brace: a media file must actually BE one (Ogg or RIFF magic)
const validMedia = (path) => {
  try {
    const b = readFileSync(path);
    const m = b.subarray(0, 4).toString("latin1");
    return b.length > 1024 && (m === "OggS" || m === "RIFF" || m === "fLaC");
  } catch { return false; }
};
async function curlRetry(url, extra = [], label = url) {
  for (let i = 0, wait = 60000; ; i++, wait *= 2) {
    try {
      const out = curl(url, extra);
      // the API answers 200 with an error page when throttled — sniff it
      if (out.length < 400 && /too many requests/i.test(out.toString("utf8"))) throw new Error("throttled");
      return out;
    } catch (e) {
      if (i >= 5) throw new Error(`${label}: ${e.message}`);
      process.stdout.write(`  (retry ${i + 1} after ${wait / 1000}s: ${label})\n`);
      await sleep(wait);
    }
  }
}

// ── 1. the phone space, from the generator's own tables ───────────────────
// Base consonants: every (place, manner, voicing) cell ipaC renders. The
// fallback cell is "ʔ" — accept that symbol only from its real home so
// off-grid cells don't masquerade as a glottal stop with a recording.
function enumeratePhones() {
  const syms = [];
  const seen = new Set();
  const push = (sym) => { if (sym && !seen.has(sym)) { seen.add(sym); syms.push(sym); } };
  for (let p = 0; p <= 8; p++) for (let m = 0; m <= 6; m++) for (const l of [0, 1]) {
    const sym = ipaC({ p, m, l, s: 0 });
    if (sym === "ʔ" && !(p === 7 && m === 0)) continue;
    if (sym.endsWith("̬")) continue;                 // creaky-voiced ʔ̬/ʡ̬ — synth-only
    push(sym);
  }
  for (let p = 0; p <= 8; p++) for (const m of [0, 2, 3]) for (const l of [2, 3]) {  // aspirated + ejective obstruents
    if (p === 7) continue;                            // aspirated/ejective glottals aren't a thing
    if (p === 6 && !(m === 0 && l === 3)) continue;   // pharyngeal: only the ejective stop ʡʼ
    if (l === 2 && m === 2) continue;                 // aspirated fricatives — leave to the synth
    const base = ipaC({ p, m, l: 0, s: 0 });
    if (base === "ʔ") continue;                       // off-grid cell
    push(ipaC({ p, m, l, s: 0 }));
  }
  for (const p of [8, 1, 4, 3, 0]) push(ipaC({ p, m: 7, l: 0, s: 0 }));             // the five click types
  for (let h = 0; h <= 2; h++) for (let b = 0; b <= 2; b++) for (const r of [0, 1]) for (const atr of [0, 1])
    push(ipaV({ h, b, r, atr, n: 0, lg: 0, ph: 0 }));
  return syms;
}

// ── 2. symbol → candidate Commons titles ──────────────────────────────────
// First candidate that exists wins. Misses are reported, not fatal.
const T = (...names) => names.map(n => `File:${n}.ogg`).concat(names.map(n => `File:${n}.oga`));
const CANDIDATES = {
  // stops
  "p": T("Voiceless bilabial plosive"), "b": T("Voiced bilabial plosive"),
  "t": T("Voiceless alveolar plosive"), "d": T("Voiced alveolar plosive"),
  "ʈ": T("Voiceless retroflex plosive", "Voiceless retroflex stop"),
  "ɖ": T("Voiced retroflex plosive", "Voiced retroflex stop"),
  "c": T("Voiceless palatal plosive"), "ɟ": T("Voiced palatal plosive"),
  "k": T("Voiceless velar plosive"), "ɡ": T("Voiced velar plosive"),
  "q": T("Voiceless uvular plosive"), "ɢ": T("Voiced uvular plosive"),
  "ʡ": T("Epiglottal stop", "Voiceless epiglottal plosive"), "ʔ": T("Glottal stop"),
  "t̪": T("Voiceless dental plosive", "Voiceless dental stop", "Voiceless denti-alveolar plosive"),
  "d̪": T("Voiced dental plosive", "Voiced dental stop", "Voiced denti-alveolar plosive"),
  // nasals
  "m": T("Bilabial nasal", "Voiced bilabial nasal"), "n": T("Alveolar nasal", "Voiced alveolar nasal"),
  "ɳ": T("Retroflex nasal", "Voiced retroflex nasal"), "ɲ": T("Palatal nasal", "Voiced palatal nasal"),
  "ŋ": T("Velar nasal", "Voiced velar nasal"), "ɴ": T("Uvular nasal", "Voiced uvular nasal"),
  "n̪": T("Dental nasal", "Voiced dental nasal"),
  // fricatives
  "f": T("Voiceless labiodental fricative", "Voiceless labio-dental fricative"),
  "v": T("Voiced labiodental fricative", "Voiced labio-dental fricative"),
  "s": T("Voiceless alveolar sibilant", "Voiceless alveolar fricative"),
  "z": T("Voiced alveolar sibilant", "Voiced alveolar fricative"),
  "ʂ": T("Voiceless retroflex sibilant", "Voiceless retroflex fricative"),
  "ʐ": T("Voiced retroflex sibilant", "Voiced retroflex fricative"),
  "ɕ": T("Voiceless alveolo-palatal sibilant", "Voiceless alveolo-palatal fricative"),
  "ʑ": T("Voiced alveolo-palatal sibilant", "Voiced alveolo-palatal fricative"),
  "x": T("Voiceless velar fricative"), "ɣ": T("Voiced velar fricative"),
  "χ": T("Voiceless uvular fricative"), "ʁ": T("Voiced uvular fricative"),
  "ħ": T("Voiceless pharyngeal fricative"), "ʕ": T("Voiced pharyngeal fricative"),
  "h": T("Voiceless glottal fricative"), "ɦ": T("Voiced glottal fricative"),
  "θ": T("Voiceless dental fricative"), "ð": T("Voiced dental fricative"),
  // affricates
  "p͡f": T("Voiceless labiodental affricate"), "b͡v": T("Voiced labiodental affricate"),
  "t͡s": T("Voiceless alveolar sibilant affricate", "Voiceless alveolar affricate"),
  "d͡z": T("Voiced alveolar sibilant affricate", "Voiced alveolar affricate"),
  "ʈ͡ʂ": T("Voiceless retroflex affricate"), "ɖ͡ʐ": T("Voiced retroflex affricate"),
  "t͡ɕ": T("Voiceless alveolo-palatal affricate"), "d͡ʑ": T("Voiced alveolo-palatal affricate"),
  "k͡x": T("Voiceless velar affricate"), "ɡ͡ɣ": T("Voiced velar affricate"),
  "q͡χ": T("Voiceless uvular affricate"), "ɢ͡ʁ": T("Voiced uvular affricate"),
  "t͡θ": T("Voiceless dental non-sibilant affricate", "Voiceless dental affricate"),
  "d͡ð": T("Voiced dental non-sibilant affricate", "Voiced dental affricate"),
  // laterals + rhotics + approximants
  "ɬ": T("Voiceless alveolar lateral fricative"),
  "l": T("Alveolar lateral approximant", "Voiced alveolar lateral approximant"),
  "ɭ": T("Retroflex lateral approximant", "Voiced retroflex lateral approximant"),
  "ʎ": T("Palatal lateral approximant", "Voiced palatal lateral approximant"),
  "ʟ": T("Velar lateral approximant", "Voiced velar lateral approximant"),
  "l̪": T("Dental lateral approximant", "Voiced dental lateral approximant"),
  "ʙ": T("Bilabial trill", "Voiced bilabial trill"), "r": T("Alveolar trill", "Voiced alveolar trill"),
  "ɽ": T("Retroflex flap", "Voiced retroflex flap"), "ʀ": T("Uvular trill", "Voiced uvular trill"),
  "r̥": T("Voiceless alveolar trill"), "ɽ̊": T("Voiceless retroflex flap"),
  "ɭ̊": T("Voiceless retroflex lateral approximant"), "ʎ̥": T("Voiceless palatal lateral approximant"),
  "l̪̊": T("Voiceless dental lateral approximant"),
  "w": T("Voiced labio-velar approximant", "Voiced labial-velar approximant"),
  "ɹ": T("Alveolar approximant", "Voiced alveolar approximant"),
  "ɻ": T("Retroflex approximant", "Voiced retroflex approximant"),
  "j": T("Palatal approximant", "Voiced palatal approximant"),
  "ɰ": T("Voiced velar approximant", "Velar approximant"),
  // ejectives (the generator's l=3 tier)
  "pʼ": T("Bilabial ejective", "Bilabial ejective plosive"), "tʼ": T("Alveolar ejective", "Alveolar ejective plosive"),
  "ʈʼ": T("Retroflex ejective"), "cʼ": T("Palatal ejective"), "kʼ": T("Velar ejective", "Velar ejective plosive"),
  "qʼ": T("Uvular ejective"), "t̪ʼ": T("Dental ejective"), "ʡʼ": T("Epiglottal ejective"),
  "fʼ": T("Labiodental ejective fricative"), "sʼ": T("Alveolar ejective fricative"),
  "ʂʼ": T("Retroflex ejective fricative"), "ɕʼ": T("Alveolo-palatal ejective fricative"),
  "xʼ": T("Velar ejective fricative"), "χʼ": T("Uvular ejective fricative"),
  "θʼ": T("Dental ejective fricative"),
  "t͡sʼ": T("Alveolar ejective affricate"), "t͡ɕʼ": T("Alveolo-palatal ejective affricate"),
  "ʈ͡ʂʼ": T("Retroflex ejective affricate"), "k͡xʼ": T("Velar ejective affricate"),
  "q͡χʼ": T("Uvular ejective affricate"), "t͡θʼ": T("Dental ejective affricate"),
  // aspirated stops (Commons has some; misses fall back to the plain stop)
  "pʰ": T("Voiceless aspirated bilabial plosive", "Aspirated voiceless bilabial plosive"),
  "tʰ": T("Voiceless aspirated alveolar plosive", "Aspirated voiceless alveolar plosive"),
  "ʈʰ": T("Voiceless aspirated retroflex plosive"), "cʰ": T("Voiceless aspirated palatal plosive"),
  "kʰ": T("Voiceless aspirated velar plosive", "Aspirated voiceless velar plosive"),
  "qʰ": T("Voiceless aspirated uvular plosive"), "t̪ʰ": T("Voiceless aspirated dental plosive"),
  // clicks
  "ʘ": T("Bilabial click"), "ǀ": T("Dental click"),
  "ǃ": T("Postalveolar click", "Alveolar click"), "ǂ": T("Palatoalveolar click", "Palatal click"),
  "ǁ": T("Alveolar lateral click", "Lateral click"),
  // vowels — tense
  "i": T("Close front unrounded vowel"), "y": T("Close front rounded vowel"),
  "ɨ": T("Close central unrounded vowel"), "ʉ": T("Close central rounded vowel"),
  "ɯ": T("Close back unrounded vowel"), "u": T("Close back rounded vowel"),
  "e": T("Close-mid front unrounded vowel"), "ø": T("Close-mid front rounded vowel"),
  "ə": T("Mid-central vowel", "Mid central vowel", "Schwa"),
  "ɵ": T("Close-mid central rounded vowel"), "ɤ": T("Close-mid back unrounded vowel"),
  "o": T("Close-mid back rounded vowel"),
  "æ": T("Near-open front unrounded vowel"), "ɶ": T("Open front rounded vowel"),
  "a": T("Open front unrounded vowel"), "ɔ": T("Open-mid back rounded vowel"),
  "ɑ": T("Open back unrounded vowel"), "ɒ": T("Open back rounded vowel", "PR-open back rounded vowel"),
  // vowels — lax (−ATR)
  "ɪ": T("Near-close near-front unrounded vowel", "Near-close front unrounded vowel"),
  "ʏ": T("Near-close near-front rounded vowel", "Near-close front rounded vowel"),
  "ʊ": T("Near-close near-back rounded vowel", "Near-close back rounded vowel"),
  "ɛ": T("Open-mid front unrounded vowel"), "œ": T("Open-mid front rounded vowel"),
  "ɜ": T("Open-mid central unrounded vowel"), "ɞ": T("Open-mid central rounded vowel"),
  "ʌ": T("Open-mid back unrounded vowel"),
  "ɪ̈": T("Near-close central unrounded vowel"),
  "ɯ̽": T("Near-close back unrounded vowel", "Near-close near-back unrounded vowel"),
};

// ── 3. resolve every candidate title in batched API calls ─────────────────
// Results (hits, misses, aliases) are cached on disk per title, flushed after
// every batch, so an interrupted or repeated run only asks for what it lacks.
async function resolveTitles(allTitles) {
  let cache = { info: {}, alias: {}, missing: [] };
  try { cache = JSON.parse(readFileSync(CACHE, "utf8")); } catch { /* first run */ }
  const info = new Map(Object.entries(cache.info));
  const alias = new Map(Object.entries(cache.alias));
  const missing = new Set(cache.missing);
  const flush = () => writeFileSync(CACHE, JSON.stringify({
    info: Object.fromEntries(info), alias: Object.fromEntries(alias), missing: [...missing] }));
  const chase = (t) => { let x = t, hops = 0; while (alias.has(x) && hops++ < 4) x = alias.get(x); return x; };
  const todo = allTitles.filter(t => !info.has(chase(t)) && !missing.has(t));
  let first = true;
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    if (!first) await sleep(PACE_API_MS);
    first = false;
    const qs = new URLSearchParams({
      action: "query", format: "json", redirects: "1", maxlag: "5",
      titles: batch.join("|"),
      prop: "imageinfo", iiprop: "url|extmetadata",
    });
    const res = JSON.parse((await curlRetry(`${API}?${qs}`, [], `API batch ${i / 50 + 1}/${Math.ceil(todo.length / 50)}`)).toString("utf8"));
    for (const r of res.query?.normalized || []) alias.set(r.from, r.to);
    for (const r of res.query?.redirects || []) alias.set(r.from, r.to);
    for (const page of Object.values(res.query?.pages || {})) {
      if (page.missing !== undefined || !page.imageinfo) { if (page.title) missing.add(page.title); continue; }
      const ii = page.imageinfo[0], em = ii.extmetadata || {};
      const strip = (h) => (h || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      info.set(page.title, {
        url: ii.url.split("?")[0],
        licence: strip(em.LicenseShortName?.value) || "unknown",
        author: strip(em.Artist?.value) || "unknown",
        desc: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      });
    }
    // batch members that resolved to nothing (not even a normalization) are misses
    for (const t of batch) if (!info.has(chase(t))) missing.add(t);
    flush();
    console.log(`  batch ${i / 50 + 1}/${Math.ceil(todo.length / 50)} done (${info.size} known)`);
  }
  flush();
  return (title) => info.get(chase(title)) && { title: chase(title), ...info.get(chase(title)) };
}

// ── main ──────────────────────────────────────────────────────────────────
const phones = enumeratePhones();
const mapped = phones.filter(s => CANDIDATES[s]);
const unmapped = phones.filter(s => !CANDIDATES[s]);
console.log(`phone space: ${phones.length} base symbols; ${mapped.length} mapped to Commons candidates`);
if (unmapped.length) console.log(`  no source mapped (synth-only): ${unmapped.join(" ")}`);

const every = [...new Set(mapped.flatMap(s => CANDIDATES[s]))];
console.log(`resolving ${every.length} candidate titles against the Commons API…`);
const lookup = await resolveTitles(every);

const picks = [];                              // {sym, slug, title, url, licence, author, desc}
const misses = [];
for (const sym of mapped) {
  const hit = CANDIDATES[sym].map(lookup).find(Boolean);
  if (hit) picks.push({ sym, slug: cpSlug(sym) + hit.url.slice(hit.url.lastIndexOf(".")), ...hit });
  else misses.push(sym);
}
console.log(`resolved ${picks.length}/${mapped.length}; misses (synth fallback): ${misses.join(" ") || "none"}`);
if (DRY) process.exit(0);

mkdirSync(OUT_DIR, { recursive: true });
let fetched = 0, skipped = 0;
for (const p of picks) {
  const out = join(OUT_DIR, p.slug);
  if (existsSync(out) && validMedia(out)) { skipped++; continue; }
  for (let att = 0; ; att++) {
    await curlRetry(p.url, ["-o", out], p.title);
    if (validMedia(out)) break;
    rmSync(out, { force: true });
    if (att >= 2) throw new Error(`${p.title}: downloads keep coming back as non-media`);
    await sleep(30000);
  }
  fetched++;
  if (fetched % 20 === 0) console.log(`  …${fetched} downloaded`);
  await sleep(PACE_DL_MS);
}
console.log(`downloaded ${fetched}, kept ${skipped} already valid on disk`);

// SOURCES.tsv — the per-file provenance CREDITS-ipa-audio.md points at
const tsv = ["symbol\tfile\tcommons title\tlicence\tauthor\tsource"]
  .concat(picks.map(p => [p.sym, p.slug, p.title, p.licence, p.author, p.desc].join("\t")))
  .join("\n") + "\n";
writeFileSync(join(OUT_DIR, "SOURCES.tsv"), tsv);

// the manifest module the Lab imports (tiny — files stay in assets/)
const total = picks.reduce((a, p) => a + statSync(join(OUT_DIR, p.slug)).size, 0);
const manifest = `// GENERATED by tools/build_ipa_audio.mjs — do not edit by hand.
// ${picks.length} recorded phones (${(total / 1024) | 0} KB of audio in assets/ipa-audio/),
// covering ${picks.length}/${phones.length} of the generator's base phone space.
// Per-file licence + author: assets/ipa-audio/SOURCES.tsv; see CREDITS-ipa-audio.md.
export const IPA_CLIP_CREDIT =
  "Phone recordings from Wikimedia Commons contributors (CC BY-SA / public domain per file — see CREDITS-ipa-audio.md)";
export const IPA_CLIPS = ${JSON.stringify(Object.fromEntries(picks.map(p => [p.sym, p.slug])), null, 0)};
`;
writeFileSync(MANIFEST, manifest);
console.log(`wrote ${MANIFEST.replace(ROOT + "/", "")} (${picks.length} clips), SOURCES.tsv, ${(total / 1024) | 0} KB of audio`);
