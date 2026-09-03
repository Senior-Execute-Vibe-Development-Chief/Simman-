# Reality data shelf

`travel-routes.json` is a hand-curated M1 fixture. The route names, endpoint
coordinates, and expected travel windows are transcribed from ORBIS-style
Roman route reconstructions and published historical itinerary/sailing-time
comparisons; no runtime scraping is performed. The freight ratio uses the
Duncan-Jones relative-cost anchor. This derived fixture contains no
third-party source data, so no source dataset is redistributed; the source
and tolerance are recorded per route for later review.

`known-misses.json` is the reality gate's acknowledged-failure manifest:
every entry names a failing check and the physical reason it fails at this
milestone (no road infrastructure until M7; dev-raster geometry at 165 km
cells). The gate hard-fails on any failure NOT in the manifest and on any
manifest entry that has silently started passing, so the list only ever
shrinks for honest reasons — a ratchet, never an exemption list.

The `global_*.json` files are derived NCEP/NCAR Reanalysis 1991–2020
climatologies, converted by the v1 conversion tools from the public NOAA
archive. Their provenance is retained in the copied loader headers; the
files are inputs to the observed-climate mode and are not simulation state.

`lakes.json` is the W1 reality fixture for the positive-elevation portion of
HydroLAKES v1.0. The committed `LAKE_MASK` is a generated 1920×960 majority
raster of the polygon layer; HydroLAKES is © WWF/Lehner et al. and licensed
CC-BY 4.0. `floodplain.json` and `river-seasons.json` record the W1 gates for
ETOPO channel-floor cross-sections and monthly runoff derived from observed
climate. These fixtures contain checks and citations, not runtime state.

`population-curve.json`, `farming-arrivals.json`, and `neolithic-arrivals.json`
are hand-curated reality fixtures: population bands and arrival windows are
validation references, not simulation rails. `crop-packages.json` (climate
bells, growing-season minimum, storability, yield, domestication lag) and
`crop-ranges.json` (the DENSE-STAND habitat of each package's wild
progenitors as longitude/latitude boxes, rasterized at the substrate grid;
every range carries its citations, W7) are the M3a data inputs; there are no
hearth pins — a hearth condenses wherever a range is peopled long enough
by people who still live on the land's forager yield (a basin that already
farms stops domesticating, W7). The sorghum lag (2500 y) runs from the
wild-sorghum harvests of the Khartoum Mesolithic and Nabta Playa (~6000 BCE)
to the domesticated grain of the eastern Sudan (Winchell et al. 2017).

`known-misses-people.json` rows are scoped by arm and grid: `…:dev` and
`…:target` are the awake (monthly) kernel's long arms; `…:solve:dev` and
`…:solve:target` are the per-commit solve arm (W5), the same instruments
over the solve regime to 1 CE. The ratchet applies to both scopes.
