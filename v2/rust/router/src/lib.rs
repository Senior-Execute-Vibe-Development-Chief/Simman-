use wasm_bindgen::prelude::*;

const MODE_COUNT: usize = 6;
const DIAGONAL_FACTOR: f64 = 1.4142135623730951;
const INFINITY: f64 = 1.0e300;
const RIVER_MODE: usize = 3;

#[derive(Clone, Copy)]
struct HeapEntry {
    node: usize,
    distance: f64,
}

struct MinHeap {
    entries: Vec<HeapEntry>,
}

impl MinHeap {
    fn new(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
    }

    fn push(&mut self, entry: HeapEntry) {
        self.entries.push(entry);
        let mut index = self.entries.len() - 1;
        while index > 0 {
            let parent = (index - 1) / 2;
            if !Self::before(self.entries[index], self.entries[parent]) {
                break;
            }
            self.entries.swap(index, parent);
            index = parent;
        }
    }

    fn pop(&mut self) -> Option<HeapEntry> {
        let first = self.entries.first().copied()?;
        let last = self.entries.pop()?;
        if !self.entries.is_empty() {
            self.entries[0] = last;
            let mut index = 0;
            loop {
                let left = index * 2 + 1;
                if left >= self.entries.len() {
                    break;
                }
                let right = left + 1;
                let mut best = left;
                if right < self.entries.len()
                    && Self::before(self.entries[right], self.entries[left])
                {
                    best = right;
                }
                if !Self::before(self.entries[best], self.entries[index]) {
                    break;
                }
                self.entries.swap(index, best);
                index = best;
            }
        }
        Some(first)
    }

    fn before(left: HeapEntry, right: HeapEntry) -> bool {
        left.distance < right.distance
            || (left.distance == right.distance && left.node < right.node)
    }
}

#[wasm_bindgen]
pub struct Router {
    width: usize,
    height: usize,
    land: Vec<u8>,
    elevation: Vec<f64>,
    river_direction: Vec<u8>,
    mode_mask: Vec<u8>,
    costs: Vec<f64>,
    partition: Vec<u32>,
    distances: Vec<f64>,
    previous: Vec<i32>,
    heap: MinHeap,
    last_path: Vec<u32>,
    transfer_days: f64,
    slope_factor: f64,
    river_downstream_factor: f64,
    river_upstream_factor: f64,
    preprocessed: bool,
    customized: bool,
}

#[wasm_bindgen]
impl Router {
    #[wasm_bindgen(constructor)]
    pub fn new(
        width: usize,
        height: usize,
        land: &[u8],
        elevation: &[f64],
        river_direction: &[u8],
    ) -> Router {
        let cells = width.saturating_mul(height);
        let mut land_copy = vec![0; cells];
        let copy_len = land.len().min(cells);
        land_copy[..copy_len].copy_from_slice(&land[..copy_len]);
        let mut elevation_copy = vec![0.0; cells];
        let elevation_len = elevation.len().min(cells);
        elevation_copy[..elevation_len].copy_from_slice(&elevation[..elevation_len]);
        let mut river_direction_copy = vec![255; cells];
        let river_direction_len = river_direction.len().min(cells);
        river_direction_copy[..river_direction_len]
            .copy_from_slice(&river_direction[..river_direction_len]);
        let nodes = cells.saturating_mul(MODE_COUNT);
        Router {
            width,
            height,
            land: land_copy,
            elevation: elevation_copy,
            river_direction: river_direction_copy,
            mode_mask: vec![0; cells],
            costs: vec![INFINITY; nodes],
            partition: vec![0; cells],
            distances: vec![INFINITY; nodes],
            previous: vec![-1; nodes],
            heap: MinHeap::new(nodes.min(1024)),
            last_path: Vec::new(),
            transfer_days: 0.0,
            slope_factor: 0.0,
            river_downstream_factor: 1.0,
            river_upstream_factor: 1.0,
            preprocessed: false,
            customized: false,
        }
    }

    /// Metric-independent topology partition. The labels are deliberately
    /// simple nested geographic cells in M1; callers only depend on the phase.
    pub fn preprocess(&mut self) -> u32 {
        let coarse_width = self.width.div_ceil(16).max(1);
        let coarse_height = self.height.div_ceil(16).max(1);
        for cell in 0..self.land.len() {
            let y = cell / self.width.max(1);
            let x = cell % self.width.max(1);
            self.partition[cell] = ((y / 16) * coarse_width + (x / 16)) as u32;
        }
        self.preprocessed = true;
        coarse_width.saturating_mul(coarse_height) as u32
    }

    /// Fill the current metric overlay. Costs are days per cardinal edge,
    /// indexed as cell × mode; unavailable modes use a large sentinel.
    pub fn customize(
        &mut self,
        costs: &[f64],
        mode_mask: &[u8],
        transfer_days: f64,
        slope_factor: f64,
        river_downstream_factor: f64,
        river_upstream_factor: f64,
    ) -> bool {
        if costs.len() != self.costs.len() || mode_mask.len() != self.mode_mask.len() {
            return false;
        }
        self.costs.copy_from_slice(costs);
        self.mode_mask.copy_from_slice(mode_mask);
        self.transfer_days = transfer_days;
        self.slope_factor = slope_factor;
        self.river_downstream_factor = river_downstream_factor;
        self.river_upstream_factor = river_upstream_factor;
        self.customized = true;
        true
    }

    pub fn query(&mut self, start: u32, goal: u32) -> f64 {
        if !self.ready() {
            return INFINITY;
        }
        let start = start as usize;
        let goal = goal as usize;
        if start >= self.land.len() || goal >= self.land.len() {
            return INFINITY;
        }
        self.reset_workspace();
        for mode in 0..MODE_COUNT {
            self.seed_node(start, mode);
        }
        self.run_until(goal);
        let mut best_node = None;
        let mut best_distance = INFINITY;
        for mode in 0..MODE_COUNT {
            let node = goal * MODE_COUNT + mode;
            if self.distances[node] < best_distance {
                best_distance = self.distances[node];
                best_node = Some(node);
            }
        }
        self.last_path.clear();
        if let Some(node) = best_node {
            if best_distance < INFINITY {
                self.collect_path(node);
            }
        }
        best_distance
    }

    pub fn path(&self) -> Vec<u32> {
        self.last_path.clone()
    }

    pub fn distance_map(&mut self, sources: &[u32]) -> Vec<f64> {
        if !self.ready() {
            return vec![INFINITY; self.land.len()];
        }
        self.reset_workspace();
        for source in sources {
            let cell = *source as usize;
            if cell >= self.land.len() {
                continue;
            }
            for mode in 0..MODE_COUNT {
                self.seed_node(cell, mode);
            }
        }
        self.run_until(self.land.len());
        let mut result = vec![INFINITY; self.land.len()];
        for cell in 0..self.land.len() {
            for mode in 0..MODE_COUNT {
                result[cell] = result[cell].min(self.distances[cell * MODE_COUNT + mode]);
            }
        }
        result
    }

    pub fn partition_count(&self) -> u32 {
        self.partition
            .iter()
            .copied()
            .max()
            .unwrap_or(0)
            .saturating_add(1)
    }

    fn ready(&self) -> bool {
        self.preprocessed && self.customized && self.width > 0 && self.height > 0
    }

    fn reset_workspace(&mut self) {
        self.distances.fill(INFINITY);
        self.previous.fill(-1);
        self.heap.clear();
    }

    fn seed_node(&mut self, cell: usize, mode: usize) {
        if self.mode_mask[cell] & (1 << mode) == 0 {
            return;
        }
        let node = cell * MODE_COUNT + mode;
        if self.distances[node] == 0.0 {
            return;
        }
        self.distances[node] = 0.0;
        self.heap.push(HeapEntry {
            node,
            distance: 0.0,
        });
    }

    fn run_until(&mut self, goal: usize) {
        while let Some(entry) = self.heap.pop() {
            if entry.distance != self.distances[entry.node] {
                continue;
            }
            let cell = entry.node / MODE_COUNT;
            let mode = entry.node % MODE_COUNT;
            if cell == goal {
                // Dijkstra pops the globally cheapest unsettled node, so the
                // first goal layer popped is the cheapest goal mode.
                break;
            }
            self.relax_neighbors(cell, mode, entry.node);
            self.relax_transfers(cell, mode, entry.node);
        }
    }

    fn relax_neighbors(&mut self, cell: usize, mode: usize, node: usize) {
        let y = cell / self.width;
        let x = cell % self.width;
        let neighbors = [
            (
                if x == 0 { self.width - 1 } else { x - 1 },
                Some(y),
                1.0,
                4usize,
            ),
            (
                if x + 1 == self.width { 0 } else { x + 1 },
                Some(y),
                1.0,
                0usize,
            ),
            (x, y.checked_sub(1), 1.0, 6usize),
            (
                x,
                if y + 1 < self.height {
                    Some(y + 1)
                } else {
                    None
                },
                1.0,
                2usize,
            ),
            (
                if x == 0 { self.width - 1 } else { x - 1 },
                y.checked_sub(1),
                DIAGONAL_FACTOR,
                5usize,
            ),
            (
                if x + 1 == self.width { 0 } else { x + 1 },
                y.checked_sub(1),
                DIAGONAL_FACTOR,
                7usize,
            ),
            (
                if x == 0 { self.width - 1 } else { x - 1 },
                if y + 1 < self.height {
                    Some(y + 1)
                } else {
                    None
                },
                DIAGONAL_FACTOR,
                3usize,
            ),
            (
                if x + 1 == self.width { 0 } else { x + 1 },
                if y + 1 < self.height {
                    Some(y + 1)
                } else {
                    None
                },
                DIAGONAL_FACTOR,
                1usize,
            ),
        ];
        for (nx, ny, factor, direction) in neighbors {
            let Some(ny) = ny else { continue };
            let next_cell = ny * self.width + nx;
            let next_node = next_cell * MODE_COUNT + mode;
            if self.mode_mask[next_cell] & (1 << mode) == 0 {
                continue;
            }
            let slope = if mode < RIVER_MODE {
                (self.elevation[next_cell] - self.elevation[cell]).abs() * self.slope_factor
            } else {
                0.0
            };
            let river_factor = if mode == RIVER_MODE {
                let downstream = self.river_direction[cell] as usize;
                let upstream = (direction + 4) % 8;
                if downstream == direction {
                    self.river_downstream_factor
                } else if self.river_direction[next_cell] as usize == upstream {
                    self.river_upstream_factor
                } else {
                    1.0
                }
            } else {
                1.0
            };
            let edge =
                ((self.costs[node] + self.costs[next_node]) * 0.5 + slope) * factor * river_factor;
            self.relax(node, next_node, edge);
        }
    }

    fn relax_transfers(&mut self, cell: usize, mode: usize, node: usize) {
        if self.mode_mask[cell] == 0 {
            return;
        }
        for next_mode in 0..MODE_COUNT {
            if next_mode == mode || self.mode_mask[cell] & (1 << next_mode) == 0 {
                continue;
            }
            let next_node = cell * MODE_COUNT + next_mode;
            self.relax(node, next_node, self.transfer_days);
        }
    }

    fn relax(&mut self, from: usize, to: usize, edge: f64) {
        if edge >= INFINITY {
            return;
        }
        let candidate = self.distances[from] + edge;
        if candidate < self.distances[to] {
            self.distances[to] = candidate;
            self.previous[to] = from as i32;
            self.heap.push(HeapEntry {
                node: to,
                distance: candidate,
            });
        }
    }

    fn collect_path(&mut self, mut node: usize) {
        self.last_path.clear();
        loop {
            self.last_path.push((node / MODE_COUNT) as u32);
            let previous = self.previous[node];
            if previous < 0 {
                break;
            }
            node = previous as usize;
        }
        self.last_path.reverse();
        self.last_path.dedup();
    }
}
