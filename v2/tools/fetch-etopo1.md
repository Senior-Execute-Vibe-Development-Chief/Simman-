# Fetching the 1-arc-minute ETOPO1 floor grid

The river bake's channel-floor measurements (`RIVER_GRAD`) need the TRUE
1-arc-minute ETOPO1 grid — 21601×10801 int16, ~466 MB — which is too large
for a single ERDDAP request. Fetch it in 18 latitude bands and assemble to
one raw little-endian int16 file whose dimensions ride in the filename
(`build-riverdata.mts` recognizes `*-<W>x<H>.bin`).

Rows ascend from −90 (ERDDAP order); adjacent bands share an edge row,
dropped at assembly. QUESTIONS.md #28 records why this exists: the first
gradient bake unknowingly used a 6-arc-minute file, which smeared every
narrow gorge into its valley walls.

```sh
mkdir -p etopo1
for i in $(seq 0 17); do
  lat0=$((i*10-90)); lat1=$((lat0+10))
  curl -g -sS --fail -o etopo1/band_$i.nc \
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.nc?altitude[($lat0):1:($lat1)][(-180):1:(180)]"
done
```

Assemble (node, any recent version — the reader is the same minimal
NetCDF-3 parser the bake tools carry):

```js
// node assemble.mjs <bandDir>   → writes etopo1-21601x10801.bin beside it
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
function readNc(path) {
  const buf = readFileSync(path);
  let off = 4;
  const u32 = () => { const v = buf.readUInt32BE(off); off += 4; return v; };
  const name = () => { const n = u32(); const s = buf.toString("latin1", off, off + n); off += n + ((4 - (n % 4)) % 4); return s; };
  u32();
  const dims = []; const dimTag = u32(); const dimCount = u32();
  if (dimTag === 10) for (let i = 0; i < dimCount; i++) { name(); dims.push(u32()); }
  const skipAttrs = () => { const t = u32(); const c = u32(); if (t === 0 && c === 0) return;
    for (let i = 0; i < c; i++) { name(); const ty = u32(); const n = u32();
      const size = [0,1,1,2,4,4,8][ty] ?? 1; const b = n * size; off += b + ((4 - (b % 4)) % 4); } };
  skipAttrs();
  if (u32() !== 11) throw new Error("no vars");
  const varCount = u32(); let found;
  for (let i = 0; i < varCount; i++) { const vn = name(); const rank = u32(); const vd = [];
    for (let d = 0; d < rank; d++) vd.push(dims[u32()] ?? 0);
    skipAttrs(); const type = u32(); u32(); const begin = u32();
    if (vn === "altitude") found = { dims: vd, begin, type }; }
  return { buf, ...found };
}
const dir = process.argv[2]; const W = 21601;
const out = `${dir}/../etopo1-${W}x10801.bin`;
writeFileSync(out, Buffer.alloc(0));
for (let band = 0; band < 18; band++) {
  const { buf, dims, begin, type } = readNc(`${dir}/band_${band}.nc`);
  if (type !== 3 || dims[1] !== W) throw new Error(`band ${band} shape/type`);
  const skip = band > 0 ? 1 : 0;
  const rows = dims[0] - skip;
  const chunk = Buffer.alloc(rows * W * 2);
  for (let r = 0; r < rows; r++) for (let c = 0; c < W; c++)
    chunk.writeInt16LE(buf.readInt16BE(begin + ((r + skip) * W + c) * 2), (r * W + c) * 2);
  appendFileSync(out, chunk);
}
```

Then bake: `npx tsx tools/build-riverdata.mts hyd_glo_dir_5m.tif etopo1-21601x10801.bin`
(add the HydroLAKES `.shp` to also regenerate `LAKE_MASK`; without it the
committed lake layer is carried forward unchanged).

Known source defect (QUESTIONS.md #28): ETOPO1 carries a multi-pixel
void-fill seam in the Congo cuvette (~0.2°S 18.1°E, ~106 m values in
~320 m terrain) that fakes a cataract on the Ruki tributary. It is a data
blemish, not a mechanism bug — an ETOPO 2022 refresh is the fix.
