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
const PEOPLE_CHILD_AGE_YEARS: f64 = 15.0;
const PEOPLE_WORKING_AGE_YEARS: f64 = 45.0;
const PEOPLE_CHILD_MORTALITY_FACTOR: f64 = 1.2;
const PEOPLE_WORKING_MORTALITY_FACTOR: f64 = 0.8;
const PEOPLE_ELDER_MORTALITY_FACTOR: f64 = 2.4;
const PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR: f64 = 1200.0;
const PEOPLE_MIGRATION_MAX_SHARE: f64 = 0.5;
const PEOPLE_MIGRATION_MAX_SUBSTEPS: usize = 16;
const PEOPLE_BAND_COUNT: usize = 16;
const PEOPLE_CROP_NEIGHBOR_COUNT: usize = 8;
const PEOPLE_NEIGHBOR_OPPOSITE: [usize; PEOPLE_CROP_NEIGHBOR_COUNT] = [1, 0, 3, 2, 7, 6, 5, 4];
const TRAVEL_COASTAL_KM_PER_DAY: f64 = 80.0;
const PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR: f64 = 15.0;
const PEOPLE_FARMER_MOBILITY_RATIO: f64 =
    PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR / PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR;

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

/// The oracle's `migrationShareForArea`: the per-firing hop share of a
/// group with the given diffusivity, substepped and capped by the
/// explicit-diffusion bound.
fn share_for_area(area: f64, dt_months: f64, diffusivity: f64) -> f64 {
    let annual_share = diffusivity / area.max(1.0);
    let raw_share = if dt_months == 1.0 {
        annual_share / MONTHS_PER_YEAR as f64
    } else {
        annual_share * dt_months / MONTHS_PER_YEAR as f64
    };
    let substeps = (raw_share / PEOPLE_MIGRATION_MAX_SHARE)
        .ceil()
        .max(1.0)
        .min(PEOPLE_MIGRATION_MAX_SUBSTEPS as f64) as usize;
    let share = raw_share / substeps as f64;
    let mut effective = 0.0;
    for _ in 0..substeps {
        effective += (1.0 - effective) * share;
    }
    effective.min(PEOPLE_MIGRATION_MAX_SHARE)
}

fn grow_group(
    population: f64,
    capacity: f64,
    disease: f64,
    regime: f64,
    dt_months: f64,
) -> (f64, f64, f64) {
    if population <= 0.0 || capacity <= 0.0 {
        return (population, 0.0, 0.0);
    }
    let monthly_rate = if dt_months == 1.0 {
        PEOPLE_R_GROWTH_PER_YEAR / MONTHS_PER_YEAR as f64
    } else {
        PEOPLE_R_GROWTH_PER_YEAR * dt_months / MONTHS_PER_YEAR as f64
    };
    let rate = monthly_rate * regime / (1.0 + PEOPLE_DISEASE_RATE * disease);
    let natural_births = population * rate;
    let density_pressure =
        clamp01((population - PEOPLE_GRAVEYARD_DENSITY) / PEOPLE_GRAVEYARD_DENSITY);
    let graveyard_deaths = if density_pressure > 0.0 {
        population
            * if dt_months == 1.0 {
                PEOPLE_GRAVEYARD_RATE
            } else {
                PEOPLE_GRAVEYARD_RATE * dt_months
            }
            * dpow(density_pressure, PEOPLE_GRAVEYARD_GAMMA)
    } else {
        0.0
    };
    let crowding_deaths = natural_births * clamp01(population / capacity);
    let deaths = (graveyard_deaths + crowding_deaths).min(population + natural_births);
    ((population + natural_births - deaths).max(0.0), natural_births, deaths)
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
    peopled: Vec<u8>,
    fertility: Vec<f64>,
    water_access: Vec<f64>,
    relief_multiplier: Vec<f64>,
    forager_capacity: Vec<f64>,
    disease_burden: Vec<f64>,
    cell_area: Vec<f64>,
    migration_days: Vec<f64>,
    migration_share_row: Vec<f64>,
    package_count: usize,
    package_yields: Vec<f64>,
    can_grow: Vec<u8>,
    neighbor_targets: Vec<i32>,
    neighbor_distance: Vec<f64>,
    neighbor_mode: Vec<u8>,

    // Authoritative people state and all hot-path scratch live in this
    // instance. JavaScript only keeps typed-array views onto these vectors.
    land_cells: Vec<u32>,
    packed_of: Vec<i32>,
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
    migration_received_cell: Vec<f64>,
    farmers: Vec<f64>,
    farmers_next: Vec<f64>,
    farmers_migration: Vec<f64>,
    farmer_total: Vec<f64>,
    farmer_total_next: Vec<f64>,
    farmer_migration_total: Vec<f64>,
    /// Dominant package per cell, written by capacity derivation and read by
    /// the migration pair spare; the shell lens views it.
    dominant: Vec<u8>,
    /// Packages carrying any mass anywhere; loops over packages skip the rest.
    active_package: Vec<u8>,
    /// Mobile mass (foragers + farmers × mobility ratio) and farmer share
    /// frozen per source for the month's flow.
    migration_mobile: Vec<f64>,
    migration_farmer_share: Vec<f64>,
    /// Per source slot, conductance × pair spare, written in the source
    /// phase and read back by the target phase through the reverse slot so
    /// no pair is priced twice; per source, out ÷ weight; per source, the
    /// cohort fractions of the month's frozen population.
    pair_weight: Vec<f64>,
    migration_ratio: Vec<f64>,
    children_fraction: Vec<f64>,
    working_fraction: Vec<f64>,
    elders_fraction: Vec<f64>,

    migration_month: usize,
    migration_dt_months: f64,
    migration_growth_prepared: bool,
    /// The regime's mobility (W5). Mobile mass = foragers × forager weight
    /// + farmers × farmer weight; a source sends mobile × area × out-share.
    /// AWAKE: weights 1 and the mobility ratio, out-share the row's forager
    /// share — the kernel as it was, bit for bit. SOLVE: each group takes
    /// its own row share for the stride and the out-share is one. Either
    /// way a farmer mass hops PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR × dt /
    /// area of itself per firing.
    migration_solve: bool,
    migration_farmer_weight: Vec<f64>,
    migration_farmer_share_row: Vec<f64>,
    growth_dt_months: f64,
    births_by_band: [f64; PEOPLE_BAND_COUNT],
    deaths_by_band: [f64; PEOPLE_BAND_COUNT],
    migration_by_band: [f64; PEOPLE_BAND_COUNT],
    migration_received_by_band: [f64; PEOPLE_BAND_COUNT],
    migration_total_value: f64,
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
        migration_days: &[f64],
        migration_share_row: &[f64],
        package_count: usize,
        package_yields: &[f64],
        can_grow: &[u8],
        neighbor_targets: &[i32],
        neighbor_distance: &[f64],
        neighbor_mode: &[u8],
    ) -> PeopleKernel {
        let cells = width.saturating_mul(height);
        let land = copy_u8(land, cells, 0);
        let mut land_cells = Vec::new();
        let mut packed_of = vec![-1; cells];
        for cell in 0..cells {
            if land[cell] != 0 {
                packed_of[cell] = land_cells.len() as i32;
                land_cells.push(cell as u32);
            }
        }
        let land_count = land_cells.len();
        PeopleKernel {
            width,
            height,
            cells,
            peopled: copy_u8(peopled, cells, 0),
            fertility: copy_f64(fertility, cells),
            water_access: copy_f64(water_access, cells),
            relief_multiplier: copy_f64(relief_multiplier, cells),
            forager_capacity: copy_f64(forager_capacity, cells),
            disease_burden: copy_f64(disease_burden, cells),
            cell_area: copy_f64(cell_area, cells),
            // Twelve monthly tables and their annual mean at index
            // MONTHS_PER_YEAR (the solve regime's conductance, W5).
            migration_days: copy_f64(migration_days, cells.saturating_mul(MONTHS_PER_YEAR + 1)),
            migration_share_row: copy_f64(migration_share_row, height),
            package_count,
            package_yields: copy_f64(package_yields, package_count),
            can_grow: copy_u8(can_grow, package_count.saturating_mul(land_count), 0),
            neighbor_targets: neighbor_targets.to_vec(),
            neighbor_distance: copy_f64(
                neighbor_distance,
                PEOPLE_CROP_NEIGHBOR_COUNT.saturating_mul(land_count),
            ),
            neighbor_mode: copy_u8(
                neighbor_mode,
                PEOPLE_CROP_NEIGHBOR_COUNT.saturating_mul(land_count),
                0,
            ),
            land_cells,
            packed_of,
            people: vec![0.0; cells],
            technique: vec![0.0; cells],
            children: vec![0.0; cells],
            working: vec![0.0; cells],
            elders: vec![0.0; cells],
            capacity: vec![0.0; cells],
            people_next: vec![0.0; land_count],
            technique_next: vec![0.0; land_count],
            children_mass: vec![0.0; land_count],
            working_mass: vec![0.0; land_count],
            elders_mass: vec![0.0; land_count],
            children_next: vec![0.0; land_count],
            working_next: vec![0.0; land_count],
            elders_next: vec![0.0; land_count],
            migration_out: vec![0.0; land_count],
            migration_weight: vec![0.0; land_count],
            migration_population: vec![0.0; land_count],
            migration_received_cell: vec![0.0; land_count],
            farmers: vec![0.0; package_count.saturating_mul(land_count)],
            farmers_next: vec![0.0; package_count.saturating_mul(land_count)],
            farmers_migration: vec![0.0; package_count.saturating_mul(land_count)],
            farmer_total: vec![0.0; land_count],
            farmer_total_next: vec![0.0; land_count],
            farmer_migration_total: vec![0.0; land_count],
            dominant: vec![0; cells],
            active_package: vec![0; package_count],
            migration_mobile: vec![0.0; land_count],
            migration_farmer_share: vec![0.0; land_count],
            pair_weight: vec![0.0; PEOPLE_CROP_NEIGHBOR_COUNT.saturating_mul(land_count)],
            migration_ratio: vec![0.0; land_count],
            children_fraction: vec![0.0; land_count],
            working_fraction: vec![0.0; land_count],
            elders_fraction: vec![0.0; land_count],
            migration_month: 0,
            migration_dt_months: 1.0,
            migration_growth_prepared: false,
            migration_solve: false,
            migration_farmer_weight: vec![0.0; land_count],
            migration_farmer_share_row: vec![0.0; height],
            growth_dt_months: 1.0,
            births_by_band: [0.0; PEOPLE_BAND_COUNT],
            deaths_by_band: [0.0; PEOPLE_BAND_COUNT],
            migration_by_band: [0.0; PEOPLE_BAND_COUNT],
            migration_received_by_band: [0.0; PEOPLE_BAND_COUNT],
            migration_total_value: 0.0,
        }
    }

    pub fn people_ptr(&self) -> usize {
        self.people.as_ptr() as usize
    }

    pub fn peopled_ptr(&self) -> usize {
        self.peopled.as_ptr() as usize
    }

    pub fn kernel_ptr(&self) -> usize {
        self as *const PeopleKernel as usize
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

    pub fn migration_received_ptr(&self) -> usize {
        self.migration_received_cell.as_ptr() as usize
    }

    pub fn farmer_ptr(&self, package_index: usize) -> usize {
        let offset = package_index.saturating_mul(self.land_cells.len());
        self.farmers.as_ptr() as usize + offset.saturating_mul(std::mem::size_of::<f64>())
    }

    pub fn farmer_next_ptr(&self, package_index: usize) -> usize {
        let offset = package_index.saturating_mul(self.land_cells.len());
        self.farmers_next.as_ptr() as usize + offset.saturating_mul(std::mem::size_of::<f64>())
    }

    pub fn farmer_total_ptr(&self) -> usize {
        self.farmer_total.as_ptr() as usize
    }

    pub fn farmer_total_next_ptr(&self) -> usize {
        self.farmer_total_next.as_ptr() as usize
    }

    pub fn dominant_ptr(&self) -> usize {
        self.dominant.as_ptr() as usize
    }

    pub fn set_active_packages(&mut self, mask: &[u8]) {
        for (index, slot) in self.active_package.iter_mut().enumerate() {
            *slot = mask.get(index).copied().unwrap_or(0);
        }
    }

    pub fn derive_capacity_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.land_cells.len());
        for packed in raw_lo.min(hi)..hi {
            let cell = self.land_cells[packed] as usize;
            let dominant = self.dominant_package(packed);
            self.dominant[cell] = dominant as u8;
            // A cell's capacity is the mixture its people imply: foragers at
            // the forager density, farmers at their dominant package's farmed
            // density, weighted by the farmed share. Unfarmed land is forager
            // land even where a package could grow; the farmed capacity opens
            // to a migration source through `pair_spare`, never to foragers.
            let farmed = self.package_capacity(cell, packed, dominant);
            let forager = self.forager_capacity[cell];
            let share = clamp01(self.technique[cell]);
            let mixture = forager + share * (farmed - forager);
            self.capacity[cell] = if mixture > PEOPLE_CAPACITY_FLOOR_PER_KM2 {
                mixture
            } else {
                PEOPLE_CAPACITY_FLOOR_PER_KM2
            };
        }
    }

    /// The largest active farmer mass in a cell, index order breaking ties;
    /// package 0 where nobody farms. The oracle's `dominantPackageOf`.
    fn dominant_package(&self, packed: usize) -> usize {
        let mut dominant = 0;
        let mut dominant_mass = 0.0;
        for package_index in 0..self.package_count {
            if self.active_package[package_index] == 0 {
                continue;
            }
            let mass = self.farmers[package_index * self.land_cells.len() + packed].max(0.0);
            if mass > dominant_mass {
                dominant_mass = mass;
                dominant = package_index;
            }
        }
        dominant
    }

    /// Farmed capacity of a package in a cell, per km², independent of how
    /// many farmers are there now (review, M3a); the regime term is the
    /// share-keyed maturity M2 carried.
    fn package_capacity(&self, cell: usize, packed: usize, package_index: usize) -> f64 {
        if package_index >= self.package_count
            || self.can_grow[package_index * self.land_cells.len() + packed] == 0
        {
            return 0.0;
        }
        let fertility = clamp01(self.fertility[cell]);
        let technique = clamp01(self.technique[cell]);
        let access = self.water_access[cell];
        fertility
            * PEOPLE_FARM_CAPACITY_PER_KM2
            * self.package_yields[package_index]
            * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
            * (1.0 + access * PEOPLE_WATER_ACCESS_GAIN)
            * self.relief_multiplier[cell]
    }

    pub fn begin_growth(&mut self, dt_months: f64) {
        self.births_by_band.fill(0.0);
        self.deaths_by_band.fill(0.0);
        self.growth_dt_months = dt_months;
    }

    pub fn growth_band(&mut self, raw_lo: usize, raw_hi: usize, band_index: usize) {
        let hi = raw_hi.min(self.land_cells.len());
        // Band partials accumulate in locals and are stored once: the per-band
        // slots are adjacent f64s on one cache line, and a per-cell
        // read-modify-write from every worker bounced that line between
        // cores until threads gave no speedup at all (review, W4). The
        // addition order is unchanged, so the sums are bit-identical.
        let mut births = 0.0;
        let mut deaths = 0.0;
        for packed in raw_lo.min(hi)..hi {
            let cell = self.land_cells[packed] as usize;
            let population = self.people[cell].max(0.0);
            if population <= 0.0 {
                self.people_next[packed] = 0.0;
                self.children_mass[packed] = 0.0;
                self.working_mass[packed] = 0.0;
                self.elders_mass[packed] = 0.0;
                self.farmer_total_next[packed] = 0.0;
                for package_index in 0..self.package_count {
                    if self.active_package[package_index] == 0 {
                        continue;
                    }
                    self.farmers_next[package_index * self.land_cells.len() + packed] = 0.0;
                }
                continue;
            }
            // The maintained total, as the oracle's `foragerDensity` reads it.
            let forager = (self.people[cell] - self.farmer_total[packed]).max(0.0);
            let (forager_next, forager_births, forager_deaths) = grow_group(
                forager,
                self.forager_capacity[cell],
                self.disease_burden[cell],
                PEOPLE_GROWTH_FORAGER_FACTOR,
                self.growth_dt_months,
            );
            let mut next_population = forager_next;
            let mut natural_births = forager_births;
            let mut cell_deaths = forager_deaths;
            // Inactive packages carry no mass anywhere and an absent package
            // needs no capacity: both skips are arithmetic no-ops (zero mass,
            // zero births, zero deaths) that the oracle applies identically.
            let mut farmer_total_next = 0.0;
            for package_index in 0..self.package_count {
                if self.active_package[package_index] == 0 {
                    continue;
                }
                let farmer_index = package_index * self.land_cells.len() + packed;
                let farmer = self.farmers[farmer_index].max(0.0);
                if farmer <= 0.0 {
                    self.farmers_next[farmer_index] = 0.0;
                    continue;
                }
                let (farmer_next, farmer_births, farmer_deaths) = grow_group(
                    farmer,
                    self.package_capacity(cell, packed, package_index),
                    self.disease_burden[cell],
                    PEOPLE_GROWTH_FORAGER_FACTOR + PEOPLE_GROWTH_TECHNIQUE_GAIN,
                    self.growth_dt_months,
                );
                self.farmers_next[farmer_index] = farmer_next;
                farmer_total_next += farmer_next;
                next_population += farmer_next;
                natural_births += farmer_births;
                cell_deaths += farmer_deaths;
            }
            self.people_next[packed] = next_population;
            self.farmer_total_next[packed] = farmer_total_next;
            births += natural_births * self.cell_area[cell];
            deaths += cell_deaths * self.cell_area[cell];

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
            let child_to_working = child_after.min(if self.growth_dt_months == 1.0 {
                child_after / (PEOPLE_CHILD_AGE_YEARS * MONTHS_PER_YEAR as f64)
            } else {
                child_after / (PEOPLE_CHILD_AGE_YEARS * MONTHS_PER_YEAR as f64)
                    * self.growth_dt_months
            });
            let working_to_elders = working_after.min(if self.growth_dt_months == 1.0 {
                working_after / (PEOPLE_WORKING_AGE_YEARS * MONTHS_PER_YEAR as f64)
            } else {
                working_after / (PEOPLE_WORKING_AGE_YEARS * MONTHS_PER_YEAR as f64)
                    * self.growth_dt_months
            });
            self.children_mass[packed] = (child_after - child_to_working).max(0.0) + natural_births;
            self.working_mass[packed] =
                (working_after - working_to_elders).max(0.0) + child_to_working;
            self.elders_mass[packed] = elders_after + working_to_elders;
        }
        let slot = band_index.min(PEOPLE_BAND_COUNT - 1);
        self.births_by_band[slot] += births;
        self.deaths_by_band[slot] += deaths;
    }

    pub fn births(&self) -> f64 {
        self.births_by_band.iter().fold(0.0, |total, value| total + value)
    }

    pub fn deaths(&self) -> f64 {
        self.deaths_by_band.iter().fold(0.0, |total, value| total + value)
    }

    pub fn begin_migration(
        &mut self,
        month: usize,
        dt_months: f64,
        growth_prepared: bool,
        solve: bool,
    ) {
        // Month MONTHS_PER_YEAR selects the annual-mean table.
        self.migration_month = month.min(MONTHS_PER_YEAR);
        self.migration_dt_months = dt_months;
        self.migration_growth_prepared = growth_prepared;
        self.migration_solve = solve;
        self.migration_by_band.fill(0.0);
        self.migration_received_by_band.fill(0.0);
        self.migration_total_value = 0.0;
    }

    fn days(&self, cell: usize) -> f64 {
        self.migration_days[self.migration_month * self.cells + cell]
    }

    /// The room a target has for what a source sends. Foragers see the
    /// target's capacity as it stands; the farmers in the flow see, in
    /// proportion to their share of the source, the land farmed with the
    /// source's dominant package. Source weights and target flows evaluate
    /// this one expression, so every unit that leaves a source arrives.
    fn pair_spare(&self, source_packed: usize, target: usize, target_packed: usize) -> f64 {
        let capacity = self.capacity[target];
        let share = self.migration_farmer_share[source_packed];
        let mut open = capacity;
        if share > 0.0 {
            let source_cell = self.land_cells[source_packed] as usize;
            let farmed =
                self.package_capacity(target, target_packed, self.dominant[source_cell] as usize);
            open = capacity + share * (farmed - capacity).max(0.0);
        }
        (open - self.migration_population[target_packed]).max(0.0) * self.cell_area[target]
    }

    fn edge_cost(&self, target: usize, distance: f64, mode: u8) -> f64 {
        if mode == 1 {
            distance / TRAVEL_COASTAL_KM_PER_DAY
        } else {
            self.days(target) * distance
        }
    }

    pub fn migration_prepare_band(&mut self, raw_lo: usize, raw_hi: usize, band_index: usize) {
        let hi = raw_hi.min(self.land_cells.len());
        let row_lo = band_index * self.height / PEOPLE_BAND_COUNT;
        let row_hi = (band_index + 1) * self.height / PEOPLE_BAND_COUNT;
        // Every firing prices its own stride (a monthly firing after the
        // wake must not inherit the solve regime's shares); the expression
        // is the oracle's, so a month matches the opening fill bit for bit.
        for row in row_lo..row_hi {
            let area = self.cell_area[row * self.width].max(1.0);
            self.migration_share_row[row] = share_for_area(
                area,
                self.migration_dt_months,
                PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
            );
        }
        if self.migration_solve {
            for row in row_lo..row_hi {
                let area = self.cell_area[row * self.width].max(1.0);
                self.migration_farmer_share_row[row] = share_for_area(
                    area,
                    self.migration_dt_months,
                    PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR,
                );
            }
        }
        for packed in raw_lo.min(hi)..hi {
            let cell = self.land_cells[packed] as usize;
            self.migration_out[packed] = 0.0;
            self.migration_weight[packed] = 0.0;
            if self.migration_growth_prepared {
                self.migration_population[packed] = self.people_next[packed];
                self.children_next[packed] = self.children_mass[packed];
                self.working_next[packed] = self.working_mass[packed];
                self.elders_next[packed] = self.elders_mass[packed];
            } else {
                let population = self.people[cell];
                self.people_next[packed] = population;
                self.migration_population[packed] = population;
                self.children_next[packed] = population * self.children[cell];
                self.working_next[packed] = population * self.working[cell];
                self.elders_next[packed] = population * self.elders[cell];
                self.children_mass[packed] = self.children_next[packed];
                self.working_mass[packed] = self.working_next[packed];
                self.elders_mass[packed] = self.elders_next[packed];
            }
            for package_index in 0..self.package_count {
                if self.active_package[package_index] == 0 {
                    continue;
                }
                let farmer_index = package_index * self.land_cells.len() + packed;
                let value = if self.migration_growth_prepared {
                    self.farmers_next[farmer_index]
                } else {
                    self.farmers[farmer_index]
                };
                self.farmers_migration[farmer_index] = value;
                self.farmers_next[farmer_index] = value;
            }
            let total = if self.migration_growth_prepared {
                self.farmer_total_next[packed]
            } else {
                self.farmer_total[packed]
            };
            self.farmer_migration_total[packed] = total;
            self.farmer_total_next[packed] = total;
            // Foragers move at the migration diffusivity, farmers at their
            // own mobility: a farmer mass joins the month's flow at the ratio.
            let population = self.migration_population[packed];
            let foragers = (population - total).max(0.0);
            let row = cell / self.width.max(1);
            let farmer_weight = if self.migration_solve {
                self.migration_farmer_share_row[row]
            } else {
                PEOPLE_FARMER_MOBILITY_RATIO
            };
            let forager_weight = if self.migration_solve {
                self.migration_share_row[row]
            } else {
                1.0
            };
            self.migration_farmer_weight[packed] = farmer_weight;
            self.migration_mobile[packed] = foragers * forager_weight + total * farmer_weight;
            self.migration_farmer_share[packed] = if population > 0.0 {
                (total / population).min(1.0)
            } else {
                0.0
            };
            self.migration_ratio[packed] = 0.0;
            for direction in 0..PEOPLE_CROP_NEIGHBOR_COUNT {
                self.pair_weight[packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction] = 0.0;
            }
            if population > 0.0 {
                self.children_fraction[packed] = self.children_mass[packed] / population;
                self.working_fraction[packed] = self.working_mass[packed] / population;
                self.elders_fraction[packed] = self.elders_mass[packed] / population;
            } else {
                self.children_fraction[packed] = 0.0;
                self.working_fraction[packed] = 0.0;
                self.elders_fraction[packed] = 0.0;
            }
        }
    }

    pub fn migration_source_band(&mut self, raw_lo: usize, raw_hi: usize, band_index: usize) {
        let hi = raw_hi.min(self.land_cells.len());
        let mut moved = 0.0;
        for packed in raw_lo.min(hi)..hi {
            let cell = self.land_cells[packed] as usize;
            let population = self.people_next[packed];
            if population <= 0.0 {
                continue;
            }
            let area = self.cell_area[cell];
            if area <= 0.0 {
                continue;
            }
            // Nothing mobile, nothing priced (the oracle's skip; W5).
            if self.migration_mobile[packed] <= 0.0 {
                continue;
            }
            let y = cell / self.width.max(1);
            let share = if self.migration_solve {
                1.0
            } else {
                self.migration_share_row[y]
            };
            let mut sum_weight = 0.0;
            for direction in 0..PEOPLE_CROP_NEIGHBOR_COUNT {
                let slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
                let target = self.neighbor_targets.get(slot).copied().unwrap_or(-1);
                if target < 0 {
                    continue;
                }
                let target = target as usize;
                let target_packed = self.packed_of[target];
                if target_packed < 0 {
                    continue;
                }
                let spare = self.pair_spare(packed, target, target_packed as usize);
                if spare <= 0.0 {
                    continue;
                }
                let cost = self.edge_cost(
                    target,
                    self.neighbor_distance.get(slot).copied().unwrap_or(0.0),
                    self.neighbor_mode.get(slot).copied().unwrap_or(0),
                );
                if cost.is_finite() && cost >= 0.0 {
                    let contribution = (1.0 / (1.0 + cost)) * spare;
                    self.pair_weight[slot] = contribution;
                    sum_weight += contribution;
                }
            }
            if sum_weight > 0.0 {
                let amount = self.migration_mobile[packed] * area * share;
                self.migration_out[packed] = amount;
                self.migration_weight[packed] = sum_weight;
                self.migration_ratio[packed] = amount / sum_weight;
                moved += amount;
            }
        }
        self.migration_by_band[band_index.min(PEOPLE_BAND_COUNT - 1)] += moved;
    }

    pub fn migration_debit_band(&mut self, raw_lo: usize, raw_hi: usize) {
        let hi = raw_hi.min(self.land_cells.len());
        for packed in raw_lo.min(hi)..hi {
            let cell = self.land_cells[packed] as usize;
            let amount = self.migration_out[packed];
            if amount <= 0.0 {
                continue;
            }
            let area = self.cell_area[cell];
            let density_moved = amount / if area > 0.0 { area } else { 1.0 };
            self.people_next[packed] =
                (self.people_next[packed] - amount / if area > 0.0 { area } else { 1.0 }).max(0.0);
            let population = self.migration_population[packed];
            let mobile = self.migration_mobile[packed];
            let total = self.farmer_migration_total[packed];
            if mobile > 0.0 && total > 0.0 {
                let weight = self.migration_farmer_weight[packed];
                for package_index in 0..self.package_count {
                    if self.active_package[package_index] == 0 {
                        continue;
                    }
                    let farmer_index = package_index * self.land_cells.len() + packed;
                    let fraction = self.farmers_migration[farmer_index] * weight / mobile;
                    self.farmers_next[farmer_index] =
                        (self.farmers_next[farmer_index] - density_moved * fraction).max(0.0);
                }
            }
            if population > 0.0 {
                self.children_next[packed] = (self.children_next[packed]
                    - density_moved * self.children_mass[packed] / population)
                    .max(0.0);
                self.working_next[packed] = (self.working_next[packed]
                    - density_moved * self.working_mass[packed] / population)
                    .max(0.0);
                self.elders_next[packed] = (self.elders_next[packed]
                    - density_moved * self.elders_mass[packed] / population)
                    .max(0.0);
            }
        }
    }

    pub fn migration_target_band(&mut self, raw_lo: usize, raw_hi: usize, band_index: usize) {
        let hi = raw_hi.min(self.land_cells.len());
        for packed in raw_lo.min(hi)..hi {
            self.migration_received_cell[packed] = 0.0;
        }
        let mut received_in_band = 0.0;
        for packed in raw_lo.min(hi)..hi {
            let target = self.land_cells[packed] as usize;
            let target_area = self.cell_area[target];
            if target_area <= 0.0 {
                continue;
            }
            let mut received = 0.0;
            for direction in 0..PEOPLE_CROP_NEIGHBOR_COUNT {
                let slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
                let source = self.neighbor_targets.get(slot).copied().unwrap_or(-1);
                if source < 0 {
                    continue;
                }
                let source_packed = self.packed_of[source as usize];
                if source_packed < 0 {
                    continue;
                }
                let source_packed = source_packed as usize;
                // The source priced this pair in its own phase; read it back
                // through the reverse slot. A hop the source does not see in
                // return (none by construction) stays in the remainder.
                let reverse =
                    source_packed * PEOPLE_CROP_NEIGHBOR_COUNT + PEOPLE_NEIGHBOR_OPPOSITE[direction];
                if self.neighbor_targets.get(reverse).copied().unwrap_or(-1) != target as i32 {
                    continue;
                }
                let contribution = self.pair_weight[reverse];
                if contribution <= 0.0 {
                    continue;
                }
                let flow = self.migration_ratio[source_packed] * contribution;
                if flow <= 0.0 {
                    continue;
                }
                received += flow;
                let mobile = self.migration_mobile[source_packed];
                let total = self.farmer_migration_total[source_packed];
                if flow > 0.0 && mobile > 0.0 && total > 0.0 {
                    let weight = self.migration_farmer_weight[source_packed];
                    for package_index in 0..self.package_count {
                        if self.active_package[package_index] == 0 {
                            continue;
                        }
                        let target_index = package_index * self.land_cells.len() + packed;
                        let source_index = package_index * self.land_cells.len() + source_packed;
                        self.farmers_next[target_index] += (flow
                            * self.farmers_migration[source_index]
                            * weight
                            / mobile)
                            / target_area;
                    }
                }
                self.children_next[packed] += flow * self.children_fraction[source_packed] / target_area;
                self.working_next[packed] += flow * self.working_fraction[source_packed] / target_area;
                self.elders_next[packed] += flow * self.elders_fraction[source_packed] / target_area;
            }
            if received <= 0.0 {
                continue;
            }
            self.people_next[packed] += received / target_area;
            self.migration_received_cell[packed] = received;
            received_in_band += received;
            self.peopled[target] = 1;
        }
        self.migration_received_by_band[band_index.min(PEOPLE_BAND_COUNT - 1)] += received_in_band;
    }

    pub fn finish_migration(&mut self) {
        // Band-slot folds are ledger-only. The remainder written back onto
        // people must use the oracle's left-to-right land-cell association
        // or a 1-ulp total difference lands on the first peopled cell.
        let migration_total = self
            .migration_by_band
            .iter()
            .fold(0.0, |total, value| total + value);
        let migration_received = self
            .migration_received_by_band
            .iter()
            .fold(0.0, |total, value| total + value);
        self.migration_total_value = migration_total;
        let remainder = migration_total - migration_received;
        let mut remainder_packed = None;
        for (packed, &cell) in self.land_cells.iter().enumerate() {
            if self.peopled[cell as usize] != 0 {
                remainder_packed = Some(packed);
                break;
            }
        }
        if let Some(packed) = remainder_packed {
            let cell = self.land_cells[packed] as usize;
            let area = self.cell_area[cell];
            if area > 0.0 {
                let density = remainder / area;
                self.people_next[packed] += density;
                let population = self.migration_population[packed];
                if population > 0.0 {
                    self.children_next[packed] += density * self.children_mass[packed] / population;
                    self.working_next[packed] += density * self.working_mass[packed] / population;
                    self.elders_next[packed] += density * self.elders_mass[packed] / population;
                    let mobile = self.migration_mobile[packed];
                    let total = self.farmer_migration_total[packed];
                    if mobile > 0.0 && total > 0.0 {
                        let weight = self.migration_farmer_weight[packed];
                        for package_index in 0..self.package_count {
                            if self.active_package[package_index] == 0 {
                                continue;
                            }
                            let farmer_index = package_index * self.land_cells.len() + packed;
                            self.farmers_next[farmer_index] += density
                                * (self.farmers_migration[farmer_index] * weight / mobile);
                        }
                    }
                }
            }
        }
        self.children_mass.copy_from_slice(&self.children_next);
        self.working_mass.copy_from_slice(&self.working_next);
        self.elders_mass.copy_from_slice(&self.elders_next);
        self.farmers.copy_from_slice(&self.farmers_next);
        // The farmer total is always the package sum in package order, as
        // the oracle rebuilds it from a save; an incrementally maintained
        // total drifts from that sum by rounding.
        let land_count = self.land_cells.len();
        for packed in 0..land_count {
            let mut farmer_total = 0.0;
            for package_index in 0..self.package_count {
                if self.active_package[package_index] == 0 {
                    continue;
                }
                farmer_total += self.farmers_next[package_index * land_count + packed];
            }
            self.farmer_total[packed] = farmer_total;
        }
    }

    pub fn migration_total(&self) -> f64 {
        self.migration_total_value
    }

    pub fn commit_population(&mut self) {
        for packed in 0..self.land_cells.len() {
            let cell = self.land_cells[packed] as usize;
            self.people[cell] = self.people_next[packed];
        }
    }

    pub fn normalize_cohorts(&mut self) {
        for packed in 0..self.land_cells.len() {
            let cell = self.land_cells[packed] as usize;
            let population = self.people[cell];
            if population <= 0.0 {
                self.children[cell] = 0.0;
                self.working[cell] = 0.0;
                self.elders[cell] = 0.0;
                continue;
            }
            let child = clamp01(self.children_mass[packed] / population);
            let working = clamp01(self.working_mass[packed] / population).min(1.0 - child);
            self.children[cell] = child;
            self.working[cell] = working;
            self.elders[cell] = (1.0 - child - working).max(0.0);
        }
    }
}

/// Free-function band dispatch. Workers must not go through wasm-bindgen's
/// `&mut self` JS borrow flag; the band layout is the write-disjointness proof.
unsafe fn kernel_mut(pointer: usize) -> &'static mut PeopleKernel {
    &mut *(pointer as *mut PeopleKernel)
}

#[wasm_bindgen]
pub fn people_dispatch_capacity(pointer: usize, raw_lo: usize, raw_hi: usize) {
    unsafe { kernel_mut(pointer).derive_capacity_band(raw_lo, raw_hi) }
}

#[wasm_bindgen]
pub fn people_dispatch_growth(pointer: usize, raw_lo: usize, raw_hi: usize, band_index: usize) {
    unsafe { kernel_mut(pointer).growth_band(raw_lo, raw_hi, band_index) }
}

#[wasm_bindgen]
pub fn people_dispatch_migration_prepare(
    pointer: usize,
    raw_lo: usize,
    raw_hi: usize,
    band_index: usize,
) {
    unsafe { kernel_mut(pointer).migration_prepare_band(raw_lo, raw_hi, band_index) }
}

#[wasm_bindgen]
pub fn people_dispatch_migration_source(
    pointer: usize,
    raw_lo: usize,
    raw_hi: usize,
    band_index: usize,
) {
    unsafe { kernel_mut(pointer).migration_source_band(raw_lo, raw_hi, band_index) }
}

#[wasm_bindgen]
pub fn people_dispatch_migration_debit(pointer: usize, raw_lo: usize, raw_hi: usize) {
    unsafe { kernel_mut(pointer).migration_debit_band(raw_lo, raw_hi) }
}

#[wasm_bindgen]
pub fn people_dispatch_migration_target(
    pointer: usize,
    raw_lo: usize,
    raw_hi: usize,
    band_index: usize,
) {
    unsafe { kernel_mut(pointer).migration_target_band(raw_lo, raw_hi, band_index) }
}
