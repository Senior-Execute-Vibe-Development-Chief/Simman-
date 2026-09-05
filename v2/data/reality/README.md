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

W14 adds `standingWaterResponse` to `crop-packages.json`: the relative
change of a package's monthly fit on ground standing under water — the
floodplain under its flood, the strip a stream keeps wet. Rice 1.0 (the
paddy about doubles the upland crop: Bray 1986, *The Rice Economies*;
GRiSP 2013, *Rice Almanac*, irrigated ~5.4 t/ha against rainfed lowland
~2.3 and upland ~1); the New Guinea roots 0.33 (taro's ~2× wet-over-dry
gain, Kirch 1994, *The Wet and the Dry*, over one member of three); every
other package −0.35 (the middle of the 20–50 % waterlogging loss of
cereals, Setter & Waters 2003, *Plant and Soil* 253:1–34, applied to the
tubers as the class figure — coarse, and recorded as such). It is the
plant's response, read by the crop fit; no place and no river is named.

W8 adds the wild-habitat envelopes to `crop-packages.json`, sampled at
the progenitors' documented dense-stand localities (lat, lon): wheat &
barley — Galilee 32.9/35.6, Hermon foothills 33.3/35.8, Damascus basin
33.5/36.5, Karacadağ 37.6/39.8, Diyarbakır 37.9/40.2, Gaziantep 37.1/37.4,
Mureybet 36.0/38.1, Mosul 36.3/43.1, Sulaymaniyah 35.6/45.4, Kermanshah
34.3/47.1, Khorramabad 33.5/48.4, Fars 29.6/52.5 (Harlan & Zohary 1966;
Zohary, Hopf & Weiss 2012); rice — Dongting 29.0/112.5, Poyang 29.0/116.0,
Taihu 31.0/120.3, Han 31.0/112.0, Jianghan 30.5/113.5, Huai 32.5/117.0
(Fuller 2011; Zheng et al. 2016); maize — the Balsas 18.0/−100.5,
17.8/−99.8, 18.3/−101.5, 18.3/−99.5 (Piperno et al. 2009); sorghum & pearl
millet — Tilemsi 17.0/0.0, Dhar Tichitt 18.5/−9.5, Kassala 15.5/36.4,
Khartoum 15.6/32.5, Lake Chad 13.5/14.5, the Niger bend 16.5/−3.0, the
Senegal valley 16.5/−15.0 (Harlan 1971; Winchell et al. 2017; Manning et
al. 2011); millet — Cishan 36.6/114.1, Peiligang 34.5/113.5, Xinglonggou
42.5/120.5, Dadiwan 35.0/105.0, the Wei valley 34.3/108.9, Yuezhuang
36.8/117.5 (Zhao 2011; Lu et al. 2009); tubers — the southern Amazon
−12.0/−58.0, −14.0/−60.0, −10.0/−64.0, −15.0/−55.0 and the northwest
lowlands 4.0/−76.0, −2.2/−80.5, −7.0/−79.5 (Olsen & Schaal 1999; Piperno &
Pearsall 1998); the Ethiopian highlands 9.0/38.7, 11.0/37.0, 7.5/38.5,
13.0/39.5, 8.0/36.5 (Harlan 1969); Kuk −5.8/144.3, −6.2/145.0, −5.5/143.5,
−4.5/142.1 (Denham et al. 2003); the Eastern Woodlands — Phillips Spring
38.0/−93.5, Napoleon Hollow 39.5/−90.5, Cloudsplitter 37.8/−83.5, Newt
Kash 37.6/−83.7, the Tennessee valley 36.0/−86.0 (Smith 2006). The
envelope is the mean and spread of the sim's annual indices at those
cells, the spread floored at the climate table's resolution.

`hearths.json` (the centres of domestication with windows; a centre may
carry its own radius where the source describes a belt) and
`staple-by-region.json` (the dominant staple by region at 1 CE) are W8's
reality tables; `crop-ranges.json` carries polygons from W8.

