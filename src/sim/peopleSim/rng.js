// ── Seeded randomness, partitioned into named substreams ──
//
// THE rule: no shared sequential stream. Every system derives its own
// stream from (world.seed, systemName[, entityId or step]), so adding a
// new randomness consumer NEVER perturbs the draws an existing system
// sees — same-seed histories stay stable as features are added, and an
// A/B of one system's change leaves every other system's dice untouched.
//
// Streams are STATELESS across ticks (re-derived per pass / per entity),
// which also means there is no RNG state to serialize in a save.
//
//   passRng(world, "shocks")            — fresh stream per (seed, name, step)
//   entityRng(world, "personality", id) — stable stream per (seed, name, id)
//
// Generator is sfc32 (good statistical quality, ~Park-Miller speed),
// seeded through splitmix32 from a 32-bit FNV-1a hash of the parts.

export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    if (typeof p === "number") {
      // fold 64-bit-ish values in 8 bytes so large ids hash cleanly
      const hi = Math.floor(p / 4294967296), lo = p >>> 0;
      for (const v of [lo, hi]) {
        h = Math.imul(h ^ (v & 0xff), 0x01000193);
        h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
        h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
        h = Math.imul(h ^ ((v >>> 24) & 0xff), 0x01000193);
      }
    } else {
      const s = String(p);
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    }
  }
  return h >>> 0;
}

function splitmix32(a) {
  return function () {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0);
  };
}

export function mkRng(seed) {
  const sm = splitmix32(seed >>> 0);
  let a = sm(), b = sm(), c = sm(), d = sm();
  const rng = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

/** Per-pass stream: fresh, independent draws each tick for one system. */
export function passRng(world, system) {
  return mkRng(hash32(world.seed || 1, system, world.step | 0));
}

/** Per-entity stream: the same draws for this (system, entity) forever. */
export function entityRng(world, system, id) {
  return mkRng(hash32(world.seed || 1, system, id | 0));
}
