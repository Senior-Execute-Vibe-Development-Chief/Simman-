// ── Settlement spatial grid ──────────────────────────────────────────
// "Which settlements are near (x,y)?" was answered by scanning ALL settlements
// (crystallisation spacing/market pull, road planning, close-neighbour links,
// the Gabriel test) — O(settlements) per query, so the whole sim was
// O(settlements²) and choked once the map got dense. Bucket settlements into a
// coarse grid of CELL-sized cells; a radius query then visits only the handful
// of cells the radius overlaps, turning those passes ~linear and letting the map
// carry thousands of settlements. Positions are static per settlement, but the
// set changes (spawn/die), so the grid is rebuilt each step (O(settlements)).
const CELL = 16;

export function buildSettlementGrid(world) {
  const tw = world.tw, th = world.th;
  const cols = Math.ceil(tw / CELL), rows = Math.ceil(th / CELL);
  let grid = world._settGrid;
  if (!grid || grid.cols !== cols || grid.rows !== rows) {
    grid = { cols, rows, cells: new Array(cols * rows).fill(null) };
  } else {
    for (let i = 0; i < grid.cells.length; i++) { const a = grid.cells[i]; if (a) a.length = 0; }
  }
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const cx = ((s.pos.x / CELL) | 0) % cols, cy = (s.pos.y / CELL) | 0;
    const k = cy * cols + (cx < 0 ? cx + cols : cx);
    (grid.cells[k] || (grid.cells[k] = [])).push(s);
  }
  world._settGrid = grid;
  return grid;
}

// Insert a freshly-spawned settlement so same-pass queries see it (crystallise
// spawns mid-pass and the next candidate tile must respect its spacing).
export function gridAdd(world, s) {
  const grid = world._settGrid; if (!grid) return;
  const cols = grid.cols;
  const cx = ((s.pos.x / CELL) | 0) % cols, cy = (s.pos.y / CELL) | 0;
  const k = cy * cols + (cx < 0 ? cx + cols : cx);
  (grid.cells[k] || (grid.cells[k] = [])).push(s);
}

// Call cb(settlement, distSq) for every settled settlement whose centre is
// within `radius` tiles of (x,y). Longitude wraps; latitude clamps. The grid is
// built once per step, but a settlement can die (mode → "dead") between the
// build and a query later in the same step; such stale entries are skipped here
// so callers see exactly the live set the old full scans did.
export function forEachNear(world, x, y, radius, cb) {
  const grid = world._settGrid; if (!grid) return;
  const { cols, rows, cells } = grid;
  const tw = world.tw, halfTw = tw / 2, r2 = radius * radius;
  const span = Math.ceil(radius / CELL);
  const ccx = (x / CELL) | 0, ccy = (y / CELL) | 0;
  const yLo = Math.max(0, ccy - span), yHi = Math.min(rows - 1, ccy + span);
  for (let cy = yLo; cy <= yHi; cy++) {
    const rowOff = cy * cols;
    for (let dxc = -span; dxc <= span; dxc++) {
      let cx = (ccx + dxc) % cols; if (cx < 0) cx += cols;
      const arr = cells[rowOff + cx]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s.mode !== "settled") continue;   // died after the grid was built this step
        let dx = Math.abs(s.pos.x - x); if (dx > halfTw) dx = tw - dx;
        const dy = s.pos.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) cb(s, d2);
      }
    }
  }
}
