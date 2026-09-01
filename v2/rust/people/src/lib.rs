// W2 port of the hot phases from src/sim/peopleSim/popFieldKernel.js
// (source commit 503dd66a06bd97d002b53cfb988f2ab552e06dc8), via the strict
// v2 reference kernels in src/sim/people/{capacity,growth,migration,technique}.ts
// (reference commit 3d810fdc8de6e2359b3c409f01b29f08588781b5). Deviations:
// land-works is intentionally omitted per W2, sequential hearth/basin logic
// remains in TypeScript, and the arrays are owned by this wasm instance and
// exposed through pointers rather than copied in or out per tick. The only
// transcendental is the exact dmath dpow port below.
use wasm_bindgen::prelude::*;

const MONTHS_PER_YEAR: usize = 12;
const PEOPLE_CAPACITY_FLOOR_PER_KM2: f64 = 0.001;
const PEOPLE_FARM_CAPACITY_PER_KM2: f64 = 12.0;
const PEOPLE_FARM_TECHNIQUE_BASE: f64 = 0.45;
const PEOPLE_FARM_TECHNIQUE_GAIN: f64 = 1.65;
const PEOPLE_WATER_ACCESS_GAIN: f64 = 1.4;
const PEOPLE_R_GROWTH_PER_YEAR: f64 = 0.0028;
const PEOPLE_GROWTH_FORAGER_FACTOR: f64 = 0.35;
const PEOPLE_GROWTH_TECHNIQUE_GAIN: f64 = 1.3;
const PEOPLE_DISEASE_RATE: f64 = 0.35;
const PEOPLE_GRAVEYARD_RATE: f64 = 0.0014;
const PEOPLE_GRAVEYARD_DENSITY: f64 = 30.0;
const PEOPLE_GRAVEYARD_GAMMA: f64 = 0.5;
const PEOPLE_TECHNIQUE_WAVE_KMPY: f64 = 1.0;
const PEOPLE_TECHNIQUE_CLIMATE_FLOOR: f64 = 0.05;
const PEOPLE_CHILD_AGE_YEARS: f64 = 15.0;
const PEOPLE_WORKING_AGE_YEARS: f64 = 45.0;
const PEOPLE_CHILD_MORTALITY_FACTOR: f64 = 1.2;
const PEOPLE_WORKING_MORTALITY_FACTOR: f64 = 0.8;
const PEOPLE_ELDER_MORTALITY_FACTOR: f64 = 2.4;

// These are implementation coefficients from v2/src/sim/dmath.ts. They are
// deliberately written out here rather than calling libm: the wasm kernel
// must produce the same graveyard mortality values as the TypeScript oracle.
const MATH_LN2: f64 = 0.6931471805599453;
const MATH_INV_LN2: f64 = 1.4426950408889634;
const MATH_EXP_C2: f64 = 1.0 / 2.0;
const MATH_EXP_C3: f64 = 1.0 / 6.0;
const MATH_EXP_C4: f64 = 1.0 / 24.0;
const MATH_EXP_C5: f64 = 1.0 / 120.0;
const MATH_EXP_C6: f64 = 1.0 / 720.0;
const MATH_EXP_C7: f64 = 1.0 / 5040.0;
const MATH_EXP_C8: f64 = 1.0 / 40320.0;
const MATH_EXP_C9: f64 = 1.0 / 362880.0;
const MATH_EXP_C10: f64 = 1.0 / 3628800.0;
const MATH_EXP_C11: f64 = 1.0 / 39916800.0;
const MATH_EXP_MAX: f64 = 709.0;
const MATH_EXP_MIN: f64 = -745.0;
const MATH_HALF: f64 = 0.5;
const MATH_LN_FIRST_ODD: usize = 3;
const MATH_LN_LAST_ODD: usize = 23;

fn copy_u8(input: &[u8], length: usize, default: u8) -> Vec<u8> {
    let mut result = vec![default; length];
    let copy_length = input.len().min(length);
    result[..copy_length].copy_from_slice(&input[..copy_length]);
    result
}

fn copy_f64(input: &[f64], length: usize) -> Vec<f64> {
    let mut result = vec![0.0; length];
    let copy_length = input.len().min(length);
    result[..copy_length].copy_from_slice(&input[..copy_length]);
    result
}

fn clamp01(value: f64) -> f64 {
    value.max(0.0).min(1.0)
}

fn scale_by_power_of_two(value: f64, exponent: i32) -> f64 {
    let mut result = value;
    if exponent > 0 {
        for _ in 0..exponent {
            result *= 2.0;
        }
    } else {
        for _ in exponent..0 {
            result *= MATH_HALF;
        }
    }
    result
}

fn dexp(value: f64) -> f64 {
    if value.is_nan() {
        return f64::NAN;
    }
    if value > MATH_EXP_MAX {
        return f64::INFINITY;
    }
    if value < MATH_EXP_MIN {
        return 0.0;
    }

    let exponent =
        (value * MATH_INV_LN2 + if value >= 0.0 { MATH_HALF } else { -MATH_HALF }).trunc() as i32;
    let reduced = value - exponent as f64 * MATH_LN2;
    let square = reduced * reduced;
    let cube = square * reduced;
    let fourth = square * square;
    let fifth = fourth * reduced;
    let sixth = fourth * square;
    let seventh = sixth * reduced;
    let eighth = fourth * fourth;
    let ninth = eighth * reduced;
    let tenth = fifth * fifth;
    let eleventh = tenth * reduced;
    let polynomial = 1.0
        + reduced
        + square * MATH_EXP_C2
        + cube * MATH_EXP_C3
        + fourth * MATH_EXP_C4
        + fifth * MATH_EXP_C5
        + sixth * MATH_EXP_C6
        + seventh * MATH_EXP_C7
        + eighth * MATH_EXP_C8
        + ninth * MATH_EXP_C9
        + tenth * MATH_EXP_C10
        + eleventh * MATH_EXP_C11;
    scale_by_power_of_two(polynomial, exponent)
}

fn dln(value: f64) -> f64 {
    if value.is_nan() {
        return f64::NAN;
    }
    if value == 0.0 {
        return f64::NEG_INFINITY;
    }
    if value < 0.0 {
        return f64::NAN;
    }
    if value == f64::INFINITY {
        return f64::INFINITY;
    }

    let mut normalized = value;
    let mut exponent: i32 = 0;
    while normalized >= 2.0 {
        normalized *= MATH_HALF;
        exponent += 1;
    }
    while normalized < 1.0 {
        normalized *= 2.0;
        exponent -= 1;
    }

    let z = (normalized - 1.0) / (normalized + 1.0);
    let z_square = z * z;
    let mut power = z;
    let mut series = z;
    let mut odd = MATH_LN_FIRST_ODD;
    while odd <= MATH_LN_LAST_ODD {
        power *= z_square;
        series += power / odd as f64;
        odd += 2;
    }
    2.0 * series + exponent as f64 * MATH_LN2
}

fn dpow(base: f64, exponent: f64) -> f64 {
    if base.is_nan() || exponent.is_nan() {
        return f64::NAN;
    }
    if base == 0.0 {
        if exponent == 0.0 {
            return 1.0;
        }
        return if exponent < 0.0 { f64::INFINITY } else { 0.0 };
    }
    if base < 0.0 {
        if exponent != exponent.trunc() {
            return f64::NAN;
        }
        let magnitude = dexp(exponent * dln(-base));
        return if (exponent.trunc() as i64) % 2 == 0 {
            magnitude
        } else {
            -magnitude
        };
    }
    dexp(exponent * dln(base))
}

#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

#[wasm_bindgen]
pub fn deterministic_power(base: f64, exponent: f64) -> f64 {
    dpow(base, exponent)
}

#[wasm_bindgen]
pub struct PeopleKernel {
    width: usize,
    height: usize,
    cells: usize,

    // Immutable substrate inputs copied once at construction. No substrate
    // array is copied through the boundary during a tick.
    land: Vec<u8>,
    peopled: Vec<u8>,
    fertility: Vec<f64>,
    water_access: Vec<f64>,
    relief_multiplier: Vec<f64>,
    forager_capacity: Vec<f64>,
    disease_burden: Vec<f64>,
    cell_area: Vec<f64>,
    technique_suitability: Vec<f64>,
    technique_edge_h: Vec<f64>,
    technique_edge_v: f64,
    migration_days: Vec<f64>,
    migration_edge_h: Vec<f64>,
    migration_edge_v: f64,
    migration_share_row: Vec<f64>,

    // Authoritative people state and all hot-path scratch live in this
    // instance. JavaScript only keeps typed-array views onto these vectors.
    people: Vec<f64>,
    technique: Vec<f64>,
    children: Vec<f64>,
    working: Vec<f64>,
    elders: Vec<f64>,
    capacity: Vec<f64>,
    people_next: Vec<f64>,
    technique_next: Vec<f64>,
    children_mass: Vec<f64>,
    working_mass: Vec<f64>,
    elders_mass: Vec<f64>,
    children_next: Vec<f64>,
    working_next: Vec<f64>,
    elders_next: Vec<f64>,
    migration_out: Vec<f64>,
    migration_weight: Vec<f64>,
    migration_population: Vec<f64>,

    migration_month: usize,
    migration_total: f64,
    migration_received: f64,
    births: f64,
    deaths: f64,
}

#[wasm_bindgen]
impl PeopleKernel {
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(constructor)]
    pub fn new(
        width: usize,
        height: usize,
        land: &[u8],
        peopled: &[u8],
        fertility: &[f64],
        water_access: &[f64],
        relief_multiplier: &[f64],
        forager_capacity: &[f64],
        disease_burden: &[f64],
        cell_area: &[f64],
        technique_suitability: &[f64],
        technique_edge_h: &[f64],
        technique_edge_v: f64,
        migration_days: &[f64],
        migration_edge_h: &[f64],
        migration_edge_v: f64,
        migration_share_row: &[f64],
    ) -> PeopleKernel {
        let cells = width.saturating_mul(height);
        PeopleKernel {
            width,
            height,
            cells,
            land: copy_u8(land, cells, 0),
            peopled: copy_u8(peopled, cells, 0),
            fertility: copy_f64(fertility, cells),
            water_access: copy_f64(water_access, cells),
            relief_multiplier: copy_f64(relief_multiplier, cells),
            forager_capacity: copy_f64(forager_capacity, cells),
            disease_burden: copy_f64(disease_burden, cells),
            cell_area: copy_f64(cell_area, cells),
            technique_suitability: copy_f64(technique_suitability, cells),
            technique_edge_h: copy_f64(technique_edge_h, height),
            technique_edge_v,
            migration_days: copy_f64(migration_days, cells.saturating_mul(MONTHS_PER_YEAR)),
            migration_edge_h: copy_f64(migration_edge_h, height),
            migration_edge_v,
            migration_share_row: copy_f64(migration_share_row, height),
            people: vec![0.0; cells],
            technique: vec![0.0; cells],
            children: vec![0.0; cells],
            working: vec![0.0; cells],
            elders: vec![0.0; cells],
            capacity: vec![0.0; cells],
            people_next: vec![0.0; cells],
            technique_next: vec![0.0; cells],
            children_mass: vec![0.0; cells],
            working_mass: vec![0.0; cells],
            elders_mass: vec![0.0; cells],
            children_next: vec![0.0; cells],
            working_next: vec![0.0; cells],
            elders_next: vec![0.0; cells],
            migration_out: vec![0.0; cells],
            migration_weight: vec![0.0; cells],
            migration_population: vec![0.0; cells],
            migration_month: 0,
            migration_total: 0.0,
            migration_received: 0.0,
            births: 0.0,
            deaths: 0.0,
        }
    }

    pub fn people_ptr(&self) -> usize {
        self.people.as_ptr() as usize
    }

    pub fn technique_ptr(&self) -> usize {
        self.technique.as_ptr() as usize
    }

    pub fn children_ptr(&self) -> usize {
        self.children.as_ptr() as usize
    }

    pub fn working_ptr(&self) -> usize {
        self.working.as_ptr() as usize
    }

    pub fn elders_ptr(&self) -> usize {
        self.elders.as_ptr() as usize
    }

    pub fn capacity_ptr(&self) -> usize {
        self.capacity.as_ptr() as usize
    }

    pub fn people_next_ptr(&self) -> usize {
        self.people_next.as_ptr() as usize
    }

    pub fn technique_next_ptr(&self) -> usize {
        self.technique_next.as_ptr() as usize
    }

    pub fn children_mass_ptr(&self) -> usize {
        self.children_mass.as_ptr() as usize
    }

    pub fn working_mass_ptr(&self) -> usize {
        self.working_mass.as_ptr() as usize
    }

    pub fn elders_mass_ptr(&self) -> usize {
        self.elders_mass.as_ptr() as usize
    }

    pub fn children_next_ptr(&self) -> usize {
        self.children_next.as_ptr() as usize
    }

    pub fn working_next_ptr(&self) -> usize {
        self.working_next.as_ptr() as usize
    }

    pub fn elders_next_ptr(&self) -> usize {
        self.elders_next.as_ptr() as usize
    }

    pub fn migration_out_ptr(&self) -> usize {
        self.migration_out.as_ptr() as usize
    }

    pub fn migration_weight_ptr(&self) -> usize {
        self.migration_weight.as_ptr() as usize
    }

    pub fn migration_population_ptr(&self) -> usize {
        self.migration_population.as_ptr() as usize
    }

    pub fn derive_capacity_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.cells);
        for cell in raw_lo.min(hi)..hi {
            if self.land[cell] == 0 {
                self.capacity[cell] = 0.0;
                continue;
            }
            let fertility = clamp01(self.fertility[cell]);
            let technique = clamp01(self.technique[cell]);
            let access = self.water_access[cell];
            let farmed = fertility
                * PEOPLE_FARM_CAPACITY_PER_KM2
                * technique
                * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
                * (1.0 + access * PEOPLE_WATER_ACCESS_GAIN)
                * self.relief_multiplier[cell];
            let forager = self.forager_capacity[cell];
            let mut capacity = PEOPLE_CAPACITY_FLOOR_PER_KM2;
            if forager > capacity {
                capacity = forager;
            }
            if farmed > capacity {
                capacity = farmed;
            }
            self.capacity[cell] = capacity;
        }
    }

    pub fn prepare_technique(&mut self) {
        self.technique_next.copy_from_slice(&self.technique);
    }

    pub fn technique_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.cells);
        for cell in raw_lo.min(hi)..hi {
            if self.land[cell] == 0 || self.peopled[cell] == 0 {
                continue;
            }
            let y = cell / self.width.max(1);
            let x = cell - y * self.width.max(1);
            let current = self.technique[cell];
            let mut candidate = current.max(self.technique_next[cell]);

            // Direction order N, S, W, E is part of the oracle contract.
            if y > 0 {
                candidate = self.spread_from(
                    cell,
                    cell - self.width,
                    current,
                    candidate,
                    self.technique_edge_v,
                );
            }
            if y + 1 < self.height {
                candidate = self.spread_from(
                    cell,
                    cell + self.width,
                    current,
                    candidate,
                    self.technique_edge_v,
                );
            }
            let west = y * self.width + if x == 0 { self.width - 1 } else { x - 1 };
            candidate = self.spread_from(cell, west, current, candidate, self.technique_edge_h[y]);
            let east = y * self.width + if x + 1 == self.width { 0 } else { x + 1 };
            candidate = self.spread_from(cell, east, current, candidate, self.technique_edge_h[y]);

            self.technique_next[cell] = current.max(candidate.min(1.0));
        }
    }

    fn spread_from(
        &self,
        cell: usize,
        source: usize,
        current: f64,
        candidate: f64,
        distance: f64,
    ) -> f64 {
        if self.land[source] == 0 {
            return candidate;
        }
        let source_technique = self.technique[source];
        if source_technique <= current {
            return candidate;
        }
        let mut progress = PEOPLE_TECHNIQUE_WAVE_KMPY / MONTHS_PER_YEAR as f64 / distance.max(1.0);
        if progress > 1.0 {
            progress = 1.0;
        }
        let suitability = self.technique_suitability[cell];
        let fit = if suitability < PEOPLE_TECHNIQUE_CLIMATE_FLOOR {
            0.0
        } else {
            suitability
        };
        let reached = current + (source_technique - current) * progress * fit;
        if reached > candidate {
            reached
        } else {
            candidate
        }
    }

    pub fn commit_technique(&mut self) {
        self.technique.copy_from_slice(&self.technique_next);
    }

    pub fn begin_growth(&mut self) {
        self.people_next.fill(0.0);
        self.children_mass.fill(0.0);
        self.working_mass.fill(0.0);
        self.elders_mass.fill(0.0);
        self.births = 0.0;
        self.deaths = 0.0;
    }

    pub fn growth_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.cells);
        for cell in raw_lo.min(hi)..hi {
            if self.land[cell] == 0 {
                continue;
            }
            let population = self.people[cell].max(0.0);
            let capacity = self.capacity[cell];
            if population <= 0.0 || capacity <= 0.0 {
                self.people_next[cell] = 0.0;
                self.children_mass[cell] = 0.0;
                self.working_mass[cell] = 0.0;
                self.elders_mass[cell] = 0.0;
                continue;
            }
            let technique = clamp01(self.technique[cell]);
            let regime = PEOPLE_GROWTH_FORAGER_FACTOR + PEOPLE_GROWTH_TECHNIQUE_GAIN * technique;
            let rate = PEOPLE_R_GROWTH_PER_YEAR / MONTHS_PER_YEAR as f64 * regime
                / (1.0 + PEOPLE_DISEASE_RATE * self.disease_burden[cell]);
            let natural_births = population * rate;
            let density_pressure =
                clamp01((population - PEOPLE_GRAVEYARD_DENSITY) / PEOPLE_GRAVEYARD_DENSITY);
            let graveyard_deaths = if density_pressure > 0.0 {
                population * PEOPLE_GRAVEYARD_RATE * dpow(density_pressure, PEOPLE_GRAVEYARD_GAMMA)
            } else {
                0.0
            };
            let crowding_deaths = natural_births * clamp01(population / capacity);
            let cell_deaths = (graveyard_deaths + crowding_deaths).min(population + natural_births);
            let next_population = (population + natural_births - cell_deaths).max(0.0);
            self.people_next[cell] = next_population;
            self.births += natural_births * self.cell_area[cell];
            self.deaths += cell_deaths * self.cell_area[cell];

            let child = population * clamp01(self.children[cell]);
            let working = population * clamp01(self.working[cell]);
            let elders = population * clamp01(self.elders[cell]);
            let mortality_weight = child * PEOPLE_CHILD_MORTALITY_FACTOR
                + working * PEOPLE_WORKING_MORTALITY_FACTOR
                + elders * PEOPLE_ELDER_MORTALITY_FACTOR;
            let child_deaths = if mortality_weight > 0.0 {
                cell_deaths * child * PEOPLE_CHILD_MORTALITY_FACTOR / mortality_weight
            } else {
                0.0
            };
            let working_deaths = if mortality_weight > 0.0 {
                cell_deaths * working * PEOPLE_WORKING_MORTALITY_FACTOR / mortality_weight
            } else {
                0.0
            };
            let elder_deaths = (cell_deaths - child_deaths - working_deaths).max(0.0);
            let child_after = (child - child_deaths).max(0.0);
            let working_after = (working - working_deaths).max(0.0);
            let elders_after = (elders - elder_deaths).max(0.0);
            let child_to_working =
                child_after.min(child_after / (PEOPLE_CHILD_AGE_YEARS * MONTHS_PER_YEAR as f64));
            let working_to_elders = working_after
                .min(working_after / (PEOPLE_WORKING_AGE_YEARS * MONTHS_PER_YEAR as f64));
            self.children_mass[cell] = (child_after - child_to_working).max(0.0) + natural_births;
            self.working_mass[cell] =
                (working_after - working_to_elders).max(0.0) + child_to_working;
            self.elders_mass[cell] = elders_after + working_to_elders;
        }
    }

    pub fn births(&self) -> f64 {
        self.births
    }

    pub fn deaths(&self) -> f64 {
        self.deaths
    }

    pub fn begin_migration(&mut self, month: usize) {
        self.migration_month = month % MONTHS_PER_YEAR;
        self.migration_out.fill(0.0);
        self.migration_weight.fill(0.0);
        self.migration_population.copy_from_slice(&self.people_next);
        self.children_next.copy_from_slice(&self.children_mass);
        self.working_next.copy_from_slice(&self.working_mass);
        self.elders_next.copy_from_slice(&self.elders_mass);
        self.migration_total = 0.0;
        self.migration_received = 0.0;
    }

    fn days(&self, cell: usize) -> f64 {
        self.migration_days[self.migration_month * self.cells + cell]
    }

    fn add_source_weight(&self, target: usize, edge: f64, sum: &mut f64) {
        if self.land[target] == 0 || self.peopled[target] == 0 {
            return;
        }
        let spare =
            (self.capacity[target] - self.people_next[target]).max(0.0) * self.cell_area[target];
        if spare <= 0.0 {
            return;
        }
        let cost = self.days(target) * edge;
        if cost.is_finite() && cost >= 0.0 {
            *sum += (1.0 / (1.0 + cost)) * spare;
        }
    }

    pub fn migration_source_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.cells);
        for cell in raw_lo.min(hi)..hi {
            if self.land[cell] == 0 {
                continue;
            }
            let population = self.people_next[cell];
            if population <= 0.0 {
                continue;
            }
            let area = self.cell_area[cell];
            if area <= 0.0 {
                continue;
            }
            let y = cell / self.width.max(1);
            let x = cell - y * self.width.max(1);
            let share = self.migration_share_row[y];
            let row_length = self.migration_edge_h[y];
            let mut sum_weight = 0.0;
            let east = y * self.width + if x + 1 == self.width { 0 } else { x + 1 };
            self.add_source_weight(east, row_length, &mut sum_weight);
            let west = y * self.width + if x == 0 { self.width - 1 } else { x - 1 };
            self.add_source_weight(west, row_length, &mut sum_weight);
            if y + 1 < self.height {
                let south = cell + self.width;
                self.add_source_weight(south, self.migration_edge_v, &mut sum_weight);
            }
            if y > 0 {
                let north = cell - self.width;
                self.add_source_weight(north, self.migration_edge_v, &mut sum_weight);
            }
            if sum_weight > 0.0 {
                let amount = population * area * share;
                self.migration_out[cell] = amount;
                self.migration_weight[cell] = sum_weight;
                self.migration_total += amount;
            }
        }
    }

    pub fn migration_debit_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.cells);
        for cell in raw_lo.min(hi)..hi {
            let amount = self.migration_out[cell];
            if amount <= 0.0 {
                continue;
            }
            let area = self.cell_area[cell];
            let density_moved = amount / if area > 0.0 { area } else { 1.0 };
            self.people_next[cell] =
                (self.people_next[cell] - amount / if area > 0.0 { area } else { 1.0 }).max(0.0);
            let population = self.migration_population[cell];
            if population > 0.0 {
                self.children_next[cell] = (self.children_next[cell]
                    - density_moved * self.children_mass[cell] / population)
                    .max(0.0);
                self.working_next[cell] = (self.working_next[cell]
                    - density_moved * self.working_mass[cell] / population)
                    .max(0.0);
                self.elders_next[cell] = (self.elders_next[cell]
                    - density_moved * self.elders_mass[cell] / population)
                    .max(0.0);
            }
        }
    }

    fn source_flow(&self, source: Option<usize>, conductance: f64, target_spare: f64) -> f64 {
        let Some(source) = source else {
            return 0.0;
        };
        let amount = self.migration_out[source];
        let weight = self.migration_weight[source];
        if amount > 0.0 && weight > 0.0 {
            amount * conductance * target_spare / weight
        } else {
            0.0
        }
    }

    fn cohort_share(&self, flow: f64, source: usize, mass: &[f64]) -> f64 {
        let population = self.migration_population[source];
        if flow <= 0.0 || population <= 0.0 {
            return 0.0;
        }
        flow * mass[source] / population
    }

    pub fn migration_target_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.cells);
        for target in raw_lo.min(hi)..hi {
            if self.land[target] == 0 || self.peopled[target] == 0 {
                continue;
            }
            let target_area = self.cell_area[target];
            if target_area <= 0.0 {
                continue;
            }
            let target_spare =
                (self.capacity[target] - self.migration_population[target]).max(0.0) * target_area;
            if target_spare <= 0.0 {
                continue;
            }
            let y = target / self.width.max(1);
            let x = target - y * self.width.max(1);
            let target_days = self.days(target);
            let vertical_cost = target_days * self.migration_edge_v;
            let vertical_conductance = if vertical_cost.is_finite() && vertical_cost >= 0.0 {
                1.0 / (1.0 + vertical_cost)
            } else {
                0.0
            };
            let horizontal_cost = target_days * self.migration_edge_h[y];
            let horizontal_conductance = if horizontal_cost.is_finite() && horizontal_cost >= 0.0 {
                1.0 / (1.0 + horizontal_cost)
            } else {
                0.0
            };
            let north = if y > 0 {
                Some(target - self.width)
            } else {
                None
            };
            let south = if y + 1 < self.height {
                Some(target + self.width)
            } else {
                None
            };
            let west = Some(y * self.width + if x == 0 { self.width - 1 } else { x - 1 });
            let east = Some(y * self.width + if x + 1 == self.width { 0 } else { x + 1 });
            let north_flow = self.source_flow(north, vertical_conductance, target_spare);
            let south_flow = self.source_flow(south, vertical_conductance, target_spare);
            let west_flow = self.source_flow(west, horizontal_conductance, target_spare);
            let east_flow = self.source_flow(east, horizontal_conductance, target_spare);
            let mut received = 0.0;
            received += north_flow;
            received += south_flow;
            received += west_flow;
            received += east_flow;
            self.people_next[target] += received / target_area;
            self.migration_received += received;

            let mut child = self.children_next[target];
            child += match north {
                Some(source) => self.cohort_share(north_flow, source, &self.children_mass),
                None => 0.0,
            } / target_area;
            child += match south {
                Some(source) => self.cohort_share(south_flow, source, &self.children_mass),
                None => 0.0,
            } / target_area;
            child += self.cohort_share(west_flow, west.unwrap(), &self.children_mass) / target_area;
            child += self.cohort_share(east_flow, east.unwrap(), &self.children_mass) / target_area;
            self.children_next[target] = child;

            let mut working = self.working_next[target];
            working += match north {
                Some(source) => self.cohort_share(north_flow, source, &self.working_mass),
                None => 0.0,
            } / target_area;
            working += match south {
                Some(source) => self.cohort_share(south_flow, source, &self.working_mass),
                None => 0.0,
            } / target_area;
            working +=
                self.cohort_share(west_flow, west.unwrap(), &self.working_mass) / target_area;
            working +=
                self.cohort_share(east_flow, east.unwrap(), &self.working_mass) / target_area;
            self.working_next[target] = working;

            let mut elders = self.elders_next[target];
            elders += match north {
                Some(source) => self.cohort_share(north_flow, source, &self.elders_mass),
                None => 0.0,
            } / target_area;
            elders += match south {
                Some(source) => self.cohort_share(south_flow, source, &self.elders_mass),
                None => 0.0,
            } / target_area;
            elders += self.cohort_share(west_flow, west.unwrap(), &self.elders_mass) / target_area;
            elders += self.cohort_share(east_flow, east.unwrap(), &self.elders_mass) / target_area;
            self.elders_next[target] = elders;
        }
    }

    pub fn finish_migration(&mut self) {
        let remainder = self.migration_total - self.migration_received;
        let mut remainder_cell = None;
        for cell in 0..self.cells {
            if self.land[cell] != 0 && self.peopled[cell] != 0 {
                remainder_cell = Some(cell);
                break;
            }
        }
        if let Some(cell) = remainder_cell {
            let area = self.cell_area[cell];
            if area > 0.0 {
                let density = remainder / area;
                self.people_next[cell] += density;
                let population = self.migration_population[cell];
                if population > 0.0 {
                    self.children_next[cell] += density * self.children_mass[cell] / population;
                    self.working_next[cell] += density * self.working_mass[cell] / population;
                    self.elders_next[cell] += density * self.elders_mass[cell] / population;
                }
            }
        }
        self.children_mass.copy_from_slice(&self.children_next);
        self.working_mass.copy_from_slice(&self.working_next);
        self.elders_mass.copy_from_slice(&self.elders_next);
    }

    pub fn migration_total(&self) -> f64 {
        self.migration_total
    }

    pub fn commit_population(&mut self) {
        self.people.copy_from_slice(&self.people_next);
    }

    pub fn normalize_cohorts(&mut self) {
        for cell in 0..self.cells {
            if self.land[cell] == 0 {
                continue;
            }
            let population = self.people[cell];
            if population <= 0.0 {
                self.children[cell] = 0.0;
                self.working[cell] = 0.0;
                self.elders[cell] = 0.0;
                continue;
            }
            let child = clamp01(self.children_mass[cell] / population);
            let working = clamp01(self.working_mass[cell] / population).min(1.0 - child);
            self.children[cell] = child;
            self.working[cell] = working;
            self.elders[cell] = (1.0 - child - working).max(0.0);
        }
    }
}
