// ── One legend to rule every lens (plan §6.3) ───────────────────────────────
// Each map view declares its legend as DATA — swatch ramps, categorical keys,
// pattern samples, one short "how to read this" paragraph. WorldSim renders
// exactly one <LegendCard> (bottom-left, paper) fed from this table, plus a
// `controls` slot for the lenses that carry a widget (Prices' good picker,
// Depth's range slider, Resources' toggles).
//
// Legend content teaches the MECHANISM in world terms — it never gates or
// drives anything.

const ramp = (stops, w = 16, h = 11) => (
  <span style={{ display: "flex", flexShrink: 0 }}>
    {stops.map((c, i) => <span key={i} style={{ width: w, height: h, background: c }} />)}
  </span>
);

export function KeyRow({ swatch, children }) {
  return (
    <div className="au-key-row" style={{ alignItems: "center" }}>
      {swatch}
      <span>{children}</span>
    </div>
  );
}

export const LEGENDS = {
  country: {
    title: "The political map",
    rows: [
      [ramp(["hsl(8,60%,50%)", "hsl(110,60%,50%)", "hsl(220,60%,50%)"]), "each colour, one sovereign realm"],
      [<span key="p" style={{ width: 32, height: 11, flexShrink: 0, background: "hsl(200,60%,50%)", backgroundImage: "repeating-linear-gradient(45deg,rgba(0,0,0,0.65) 0 1.5px,transparent 1.5px 4px)" }} />, "striped: a colony of the empire whose colour it wears"],
      [<span key="s" style={{ color: "#c9a227", fontSize: 13, width: 16, textAlign: "center", flexShrink: 0 }}>★</span>, "capital seat"],
    ],
    tip: "Realm names and arms sit at each realm's heart. Click any territory to select the realm; click a town to inspect it.",
  },
  loyalty: {
    title: "Loyalty of the land",
    rows: [
      [ramp(["hsl(8,64%,38%)", "hsl(74,55%,43%)", "hsl(140,46%,47%)"]), "detached → attached"],
      [<span key="h" style={{ width: 32, height: 11, flexShrink: 0, background: "repeating-linear-gradient(90deg,hsl(200,62%,46%) 0 3px,hsl(30,60%,42%) 3px 6px)" }} />, "ground that remembers a fallen nation"],
    ],
    tip: "How far each tile's people accept their ruler. Trust builds over generations — slower under a foreign crown, frozen by grievance — and conquest detaches it. Hatched ground still yearns for the nation whose colour it wears; a revolt there restores that nation.",
  },
  culture: {
    title: "Peoples",
    rows: [
      [ramp(["hsl(20,60%,52%)", "hsl(150,60%,52%)", "hsl(260,60%,52%)"]), "each colour, one people"],
      [<span key="m" style={{ width: 22, height: 11, flexShrink: 0, background: "repeating-conic-gradient(hsl(20,60%,52%) 0% 25%, hsl(260,60%,52%) 0% 50%)", backgroundSize: "6px 6px" }} />, "checkered: a mixed town"],
    ],
    tip: "Who LIVES on the land — identity carried by population, not by crowns. Conquest changes rulers overnight; peoples assimilate over generations, so this map lags the political one and remembers what it erased.",
  },
  faith: {
    title: "Faiths",
    rows: [
      [ramp(["hsl(230,58%,52%)", "hsl(0,58%,52%)", "hsl(120,58%,52%)"]), "each colour, one creed"],
      [ramp(["hsl(40,40%,52%)"]), "muted: folk faith (no church yet)"],
    ],
    tip: "What the people believe. Folk faiths organize into churches in literate towns, spread along trade, convert courts — and schism when followers span realms far from the founding see.",
  },
  language: {
    title: "Tongues",
    rows: [
      [ramp(["hsl(200,58%,50%)", "hsl(210,58%,42%)", "hsl(190,58%,58%)"]), "shades of one family"],
    ],
    tip: "What the people SPEAK — a faster layer than who they are. A conquering crown spreads its standard speech, so one tongue can blanket many peoples and the map steps at old political borders.",
  },
  ancestry: {
    title: "Deep ancestry",
    rows: [
      [ramp(["hsl(30,53%,52%)", "hsl(90,53%,52%)", "hsl(330,53%,52%)"]), "founding stocks and their branches"],
    ],
    tip: "The genetic bedrock laid down by the first peopling — it shifts under colonisation and migration, and stays put under mere conquest. Watch the replay when a world is born: lineages split as the wavefront spreads.",
  },
  population: {
    title: "People on the land",
    rows: [
      [ramp(["rgba(56,66,96,0.4)", "rgb(44,66,148)", "rgb(50,170,130)", "rgb(240,205,60)", "rgb(240,250,225)"], 11), "≈100 → ≈1,000,000 people per region"],
      [ramp(["rgba(56,66,96,0.35)", "rgba(56,66,96,0.7)"]), "haze — subsistence scatter (<1k)"],
      [ramp(["rgb(44,66,148)"]), "sparse countryside (~3k)"],
      [ramp(["rgb(50,170,130)"]), "farmed belts (~30k)"],
      [ramp(["rgb(240,205,60)"]), "dense basins (~200k)"],
      [ramp(["rgb(240,250,225)"]), "urban cores (500k+)"],
    ],
    tip: "LIVE population on a FIXED ruler — the same colour means the same density in every era, so a thin ancient world reads faint and growth is real change on screen (nothing renormalizes to the brightest tile). National power, manpower and migration all read this field.",
  },
  money: {
    title: "Money flow",
    rows: [
      [<span key="a" style={{ width: 12, height: 12, borderRadius: "50%", background: "radial-gradient(rgba(255,210,80,0.9),rgba(255,210,80,0))", flexShrink: 0 }} />, "mining — money minted into the world"],
      [<span key="b" style={{ display: "flex", gap: 4, flexShrink: 0 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ffcf46" }} /><span style={{ width: 9, height: 9, borderRadius: "50%", background: "#e0563b" }} /></span>, "gaining · losing wealth"],
      [<span key="c" style={{ color: "#ffcd46", flexShrink: 0 }}>● ● ●</span>, "coins flow buyer → seller"],
    ],
    tip: "Dot density on each link is its share of THIS tick's trade, so the busiest routes pop regardless of the world's money supply. The world starts on barter — no coins to show until the first mine opens.",
  },
  roads: {
    title: "Trade & roads",
    rows: [
      [ramp(["rgba(120,90,50,0.5)", "rgba(160,120,60,0.8)", "rgba(220,180,90,1)"]), "track → road → highway (by traffic)"],
      [<span key="s" style={{ width: 32, height: 0, borderTop: "2px dashed rgba(90,175,225,0.7)", flexShrink: 0 }} />, "sea lanes between ports"],
    ],
    tip: "Roads EMERGE from repeated trade — each caravan wears the path smoother, and busy routes upgrade themselves. Sea lanes connect the ports whose ships actually meet.",
  },
  crop: {
    title: "Cropland",
    rows: [
      [ramp(["#7a6a4a", "#9a9a4a", "#5fae4a"]), "barren → marginal → prime farmland"],
    ],
    tip: "Where agriculture can feed a people — the soil, water and warmth underneath every empire that ever grew.",
  },
  society: {
    title: "Coerced labour",
    rows: [
      [ramp(["#5e626b", "hsl(17,69%,42%)", "hsl(4,88%,34%)"]), "free → bound"],
    ],
    tip: "How coerced each settlement's labour is — slaves as a share of its people, serfdom, and cash-crop plantation land combined. The deep-red bands are the slave coasts and serf peripheries; grey land is free.",
  },
  prices: {
    title: "Local market prices",
    rows: [
      [ramp(["hsl(120,55%,38%)", "hsl(45,30%,52%)", "hsl(4,85%,36%)"]), "glut ×0.25 → ×1 → scarce ×4"],
    ],
    tip: "Each catchment tinted by its LOCAL price of the chosen good — the gradient the goods trade flows down. Green basins export it; red fronts are shortages bidding for imports; grey has no market yet.",
  },
};

/** The one bottom-left legend card. `spec` from LEGENDS; `controls` slot for
 *  lens widgets; `defaultOpen` persists via parent state. */
export function LegendCard({ spec, open, onToggle, controls, children }) {
  if (!spec) return null;
  return (
    <div className="au-parchment" style={{ position: "absolute", bottom: 8, left: 8, padding: open ? "7px 11px 9px" : "4px 11px", fontSize: 11, maxWidth: 252, zIndex: 20 }}>
      <div style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 5, borderBottom: open ? "1px solid rgba(216,190,150,0.18)" : "none", paddingBottom: open ? 3 : 0, marginBottom: open ? 5 : 0 }}
        onClick={onToggle}>
        <span className="au-heading au-sc" style={{ fontSize: 11, flex: 1 }}>{open ? "▾" : "▸"} {spec.title}</span>
      </div>
      {open && <div className="au-key">
        {controls}
        {(spec.rows || []).map(([sw, label], i) => <KeyRow key={i} swatch={sw}>{label}</KeyRow>)}
        {children}
        {spec.tip && <div className="au-fade" style={{ fontSize: 10, fontStyle: "italic", marginTop: 5, lineHeight: 1.45 }}>{spec.tip}</div>}
      </div>}
    </div>
  );
}
