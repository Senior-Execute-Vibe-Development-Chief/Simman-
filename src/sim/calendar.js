// ── Simulation calendar ──
// ── Calendar: a steady step-based clock, anchored so the era ladder lands on real
// history. The sim seeds Neolithic farming cradles holding STONE tools — that is
// ~9000 BC, not 2000 BC (when the real cradles were already bronze-age cities with
// writing), so the long Stone/Neolithic opening spans the most calendar time even
// though little changes, then the clock accelerates as the eras shorten, the way
// history actually ran. YEAR_ANCHORS map peopleSim step → year (negative = BC,
// positive = AD): on the reference world the leading civilisation reaches each era
// near the step listed (measured against the current tech pace, not guessed).
// CLOCK_STRETCH is a manual fine-tune. The clock tracks the LEADING civilisation,
// which develops at roughly the same per-step rate regardless of map size (only the
// periphery lags on a big map), so ≈1.0 fits most worlds. Nudge it only if the
// displayed year drifts from your tech: raise it if the year runs AHEAD of the tech,
// lower it if BEHIND.
const CLOCK_STRETCH = 1.0;
const PRESENT_YEAR  = 2025;
const YEAR_ANCHORS = [   // [reference step, year]
  [0,     -9000],   // Stone / Neolithic — cradles seeded with stone tools
  [4000,  -3300],   // Bronze — first cities, the wheel, writing
  [8500,   -500],   // Classical / Iron Age
  [10000,   900],   // Medieval
  [13000,  1500],   // Renaissance
  [18000,  1800],   // Industrial
  [22000,  1950],   // Modern
];
export function stepToYear(step){
  const A=YEAR_ANCHORS, n=A.length, s=step/CLOCK_STRETCH;
  if(s<=0)return A[0][1];
  for(let i=1;i<n;i++){
    if(s<=A[i][0]){
      const [s0,y0]=A[i-1], [s1,y1]=A[i];
      return y0+(y1-y0)*(s-s0)/(s1-s0);
    }
  }
  // Past the last era anchor: keep advancing at the final (modern) rate up to the
  // present day, then clamp — we date history, not the future.
  const [sp,yp]=A[n-2], [sl,yl]=A[n-1];
  return Math.min(PRESENT_YEAR, yl+(yl-yp)/(sl-sp)*(s-sl));
}
export function yearStr(step){const y=Math.round(stepToYear(step));
return y<0?`${-y} BC`:`${y} AD`;}
