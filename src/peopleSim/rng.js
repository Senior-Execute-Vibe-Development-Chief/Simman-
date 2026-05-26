// Tiny seedable PRNG (Park-Miller). Matches the legacy mkRng signature
// so seeds can be carried across runs.
export function mkRng(seed) {
  let s = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}
