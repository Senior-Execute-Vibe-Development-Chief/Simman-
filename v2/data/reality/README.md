# Reality data shelf

`travel-routes.json` is a hand-curated M1 fixture. The route names, endpoint
coordinates, and expected travel windows are transcribed from ORBIS-style
Roman route reconstructions and published historical itinerary/sailing-time
comparisons; no runtime scraping is performed. The freight ratio uses the
Duncan-Jones relative-cost anchor. This derived fixture contains no
third-party source data, so no source dataset is redistributed; the source
and tolerance are recorded per route for later review.

The `global_*.json` files are derived NCEP/NCAR Reanalysis 1991–2020
climatologies, converted by the v1 conversion tools from the public NOAA
archive. Their provenance is retained in the copied loader headers; the
files are inputs to the observed-climate mode and are not simulation state.
