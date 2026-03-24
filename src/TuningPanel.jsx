import { useState, useRef, useEffect, useCallback } from "react";
import { generateTectonicWorld } from "./tectonicGen.js";

// ── localStorage preset management ──
const STORAGE_KEY = "simman_tec_presets";

export function loadPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function savePreset(name, params) {
  const presets = loadPresets();
  presets[name] = params;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function deletePreset(name) {
  const presets = loadPresets();
  delete presets[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

// ── Parameter definitions with groups ──
const PARAMS = {
  plates: {
    label: "Plate Layout",
    color: "180,120,100",
    params: [
      { key: "numMajorBase", def: 5, min: 3, max: 9, step: 1, label: "Major plates (base)" },
      { key: "numMajorRange", def: 3, min: 0, max: 5, step: 1, label: "Major plates (variance)" },
      { key: "numMinorBase", def: 6, min: 2, max: 14, step: 1, label: "Minor plates (base)" },
      { key: "numMinorRange", def: 6, min: 0, max: 10, step: 1, label: "Minor plates (variance)" },
      { key: "majorContProb", def: 0.70, min: 0.3, max: 1.0, sens: 0.5, label: "Major continent %" },
      { key: "minorContProb", def: 0.20, min: 0.0, max: 0.6, sens: 0.5, label: "Minor continent %" },
      { key: "plateStretchX", def: 1.3, min: 0.6, max: 2.0, label: "Plate X stretch" },
      { key: "plateStretchY", def: 0.8, min: 0.4, max: 1.4, label: "Plate Y stretch" },
    ]
  },
  continents: {
    label: "Continent Shape",
    color: "120,180,100",
    params: [
      { key: "majorContRadMin", def: 0.14, min: 0.06, max: 0.28, label: "Major continent min radius" },
      { key: "majorContRadRange", def: 0.18, min: 0.04, max: 0.30, label: "Major continent radius range" },
      { key: "minorContRadMin", def: 0.06, min: 0.02, max: 0.14, label: "Minor continent min radius" },
      { key: "minorContRadRange", def: 0.07, min: 0.02, max: 0.14, label: "Minor continent radius range" },
      { key: "majorSubsBase", def: 5, min: 2, max: 10, step: 1, label: "Major sub-stamps (base)" },
      { key: "majorSubsRange", def: 5, min: 0, max: 8, step: 1, label: "Major sub-stamps (variance)" },
      { key: "majorCoreRadMin", def: 0.12, min: 0.04, max: 0.22, label: "Major core radius min" },
      { key: "majorCoreRadRange", def: 0.10, min: 0.02, max: 0.18, label: "Major core radius range" },
      { key: "majorSubRadMin", def: 0.05, min: 0.02, max: 0.12, label: "Major sub radius min" },
      { key: "majorSubRadRange", def: 0.08, min: 0.02, max: 0.14, label: "Major sub radius range" },
      { key: "majorNegsMax", def: 2.5, min: 0, max: 5, label: "Major neg stamps (max)" },
      { key: "warpStr1", def: 0.14, min: 0.02, max: 0.30, label: "Coastline warp (large)" },
      { key: "warpStr2", def: 0.05, min: 0.0, max: 0.15, label: "Coastline warp (detail)" },
      { key: "jagStr", def: 0.025, min: 0.0, max: 0.06, label: "Coastline jaggedness" },
      { key: "penStrength", def: 0.2, min: 0.0, max: 0.5, label: "Peninsula strength" },
      { key: "bayStrength", def: 0.18, min: 0.0, max: 0.5, label: "Bay strength" },
    ]
  },
  mountains: {
    label: "Mountains",
    color: "160,140,180",
    params: [
      { key: "contContUplift", def: 0.18, min: 0.05, max: 0.35, label: "Cont-cont uplift" },
      { key: "contOceanUplift", def: 0.13, min: 0.03, max: 0.25, label: "Cont-ocean uplift" },
      { key: "contContMaxDist", def: 60, min: 20, max: 100, step: 1, label: "Cont-cont range (cells)" },
      { key: "contOceanMaxDist", def: 25, min: 8, max: 50, step: 1, label: "Cont-ocean range (cells)" },
      { key: "contContFlatCore", def: 10, min: 0, max: 25, step: 1, label: "Plateau flat core" },
      { key: "contContSigma", def: 10, min: 3, max: 25, step: 1, label: "Plateau falloff sigma" },
      { key: "contOceanFlatCore", def: 4, min: 0, max: 12, step: 1, label: "Coastal mtn flat core" },
      { key: "contOceanSigma", def: 8, min: 2, max: 16, step: 1, label: "Coastal mtn falloff sigma" },
      { key: "blurSigma", def: 14, min: 4, max: 30, step: 1, label: "Plateau blur sigma" },
      { key: "plateauMult", def: 1.5, min: 0.5, max: 4.0, label: "Plateau height mult" },
      { key: "peaksMult", def: 2.0, min: 0.5, max: 5.0, label: "Peak height mult" },
      { key: "mtnBumpStr", def: 0.10, min: 0.0, max: 0.25, label: "Mountain bumpiness" },
    ]
  },
  ocean: {
    label: "Land / Ocean",
    color: "100,160,220",
    params: [
      { key: "seaLevel", def: 0.72, min: 0.55, max: 0.88, sens: 1.5, label: "Sea level percentile" },
      { key: "majorWeightMin", def: 0.012, min: 0.004, max: 0.030, label: "Major plate weight min" },
      { key: "majorWeightRange", def: 0.025, min: 0.005, max: 0.050, label: "Major plate weight range" },
    ]
  },
};

// All groups for "everything" mode
const ALL_PARAM_KEYS = Object.values(PARAMS).flatMap(g => g.params);

// ── Candidate generation ──
function generateCandidates(baseParams, groupKey, spread, count, rngSeed) {
  let s = ((rngSeed % 2147483647) + 2147483647) % 2147483647 || 1;
  const rng = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const paramList = groupKey === "all" ? ALL_PARAM_KEYS : PARAMS[groupKey].params;

  const candidates = [{ ...baseParams }]; // first = current best (reference)
  for (let i = 1; i < count; i++) {
    const shifted = { ...baseParams };
    for (const pd of paramList) {
      const base = baseParams[pd.key] !== undefined ? baseParams[pd.key] : pd.def;
      const range = pd.max - pd.min;
      const sens = pd.sens || 1.0;
      const shift = (rng() * 2 - 1) * spread * range * sens;
      let val = base + shift;
      if (pd.step && pd.step >= 1) val = Math.round(val);
      shifted[pd.key] = Math.max(pd.min, Math.min(pd.max, val));
    }
    candidates.push(shifted);
  }
  return candidates;
}

// ── Simple terrain coloring for previews ──
function renderPreview(canvas, world, pw, ph) {
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(pw, ph);
  const d = img.data;
  for (let i = 0; i < pw * ph; i++) {
    const e = world.elevation[i];
    const m = world.moisture[i];
    const t = world.temperature[i];
    let r, g, b;
    if (e <= 0) {
      // Ocean: deeper = darker
      const depth = Math.min(1, Math.max(0, -e * 8));
      r = 18 - depth * 12 | 0;
      g = 42 - depth * 28 | 0;
      b = 80 - depth * 40 | 0;
    } else {
      // Land: elevation-based with moisture/temperature tint
      const h = Math.min(1, e * 1.2);
      if (h > 0.6) {
        // High mountain: gray to white
        const a = (h - 0.6) / 0.4;
        r = 140 + a * 115 | 0;
        g = 130 + a * 125 | 0;
        b = 120 + a * 135 | 0;
      } else if (h > 0.25) {
        // Highland: brown
        const a = (h - 0.25) / 0.35;
        r = 80 + a * 60 | 0;
        g = 110 - a * 20 | 0;
        b = 50 - a * 10 | 0;
      } else {
        // Lowland: green (wet) to yellow-green (dry)
        const wet = Math.min(1, Math.max(0, m));
        r = 60 + (1 - wet) * 50 | 0;
        g = 100 + wet * 40 | 0;
        b = 35 + wet * 20 | 0;
        // Desert tint for hot+dry
        if (t > 0.6 && m < 0.2) {
          const desert = Math.min(1, (t - 0.6) * 3 * (0.2 - m) * 8);
          r = r * (1 - desert) + 180 * desert | 0;
          g = g * (1 - desert) + 160 * desert | 0;
          b = b * (1 - desert) + 100 * desert | 0;
        }
      }
    }
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ── Preview dimensions ──
const PW = 480, PH = 240;
const CANDIDATE_COUNT = 5;
const INITIAL_SPREAD = 0.35;
const SPREAD_DECAY = 0.72;

export default function TuningPanel({ noiseFns, seed, initialParams, onApply, onClose }) {
  const [group, setGroup] = useState("continents");
  const [round, setRound] = useState(0);
  const [spread, setSpread] = useState(INITIAL_SPREAD);
  const [baseParams, setBaseParams] = useState(initialParams || {});
  const [candidates, setCandidates] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [saveName, setSaveName] = useState("");
  const canvasRefs = useRef([]);
  const shuffleSeed = useRef(1);

  // Generate candidates when group/round/spread changes
  const doGenerate = useCallback((bp, grp, sp) => {
    setGenerating(true);
    setSelected(-1);
    shuffleSeed.current = Date.now();
    const cands = generateCandidates(bp, grp, sp, CANDIDATE_COUNT, shuffleSeed.current);
    setCandidates(cands);

    // Generate previews async (one per frame to avoid blocking)
    let idx = 0;
    const genNext = () => {
      if (idx >= cands.length) { setGenerating(false); return; }
      const world = generateTectonicWorld(PW, PH, seed, noiseFns, cands[idx]);
      const canvas = canvasRefs.current[idx];
      if (canvas) renderPreview(canvas, world, PW, PH);
      idx++;
      requestAnimationFrame(genNext);
    };
    requestAnimationFrame(genNext);
  }, [seed, noiseFns]);

  // Initial generation
  useEffect(() => {
    doGenerate(baseParams, group, spread);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (idx) => {
    setSelected(idx);
    const newBase = { ...candidates[idx] };
    setBaseParams(newBase);
    const newSpread = idx === 0 ? spread : spread * SPREAD_DECAY;
    setSpread(newSpread);
    setRound(r => r + 1);
    doGenerate(newBase, group, newSpread);
  };

  const handleReshuffle = () => {
    doGenerate(baseParams, group, spread);
  };

  const handleGroupChange = (grp) => {
    setGroup(grp);
    setRound(0);
    setSpread(INITIAL_SPREAD);
    doGenerate(baseParams, grp, INITIAL_SPREAD);
  };

  const handleReset = () => {
    setBaseParams({});
    setRound(0);
    setSpread(INITIAL_SPREAD);
    doGenerate({}, group, INITIAL_SPREAD);
  };

  const handleApply = () => {
    onApply(baseParams);
    onClose();
  };

  const groupKeys = [...Object.keys(PARAMS), "all"];

  const panelStyle = {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(4,6,12,0.95)", zIndex: 9999,
    display: "flex", flexDirection: "column", alignItems: "center",
    fontFamily: "inherit", color: "#c9b87a",
    overflow: "auto",
  };

  const headerStyle = {
    display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
    justifyContent: "center", padding: "12px 16px",
  };

  const btnBase = {
    background: "rgba(201,184,122,0.08)", border: "1px solid rgba(201,184,122,0.18)",
    color: "#8a8474", padding: "5px 12px", borderRadius: 2, cursor: "pointer",
    fontSize: 11, letterSpacing: 0.5, fontFamily: "inherit",
  };

  const btnActive = (active, color) => ({
    ...btnBase,
    background: active ? `rgba(${color},0.2)` : btnBase.background,
    border: `1px solid ${active ? `rgba(${color},0.35)` : "rgba(201,184,122,0.18)"}`,
    color: active ? `rgb(${color})` : "#8a8474",
  });

  return (
    <div style={panelStyle}>
      {/* Header: group selector */}
      <div style={headerStyle}>
        <span style={{ fontSize: 11, color: "#6a6458", marginRight: 4 }}>TUNE:</span>
        {groupKeys.map(k => {
          const label = k === "all" ? "Everything" : PARAMS[k].label;
          const color = k === "all" ? "201,184,122" : PARAMS[k].color;
          return (
            <button key={k} onClick={() => handleGroupChange(k)}
              style={btnActive(group === k, color)}>{label}</button>
          );
        })}
        <div style={{ width: 1, height: 16, background: "rgba(201,184,122,0.15)" }} />
        <span style={{ fontSize: 10, color: "#6a6458" }}>
          Round {round} · Spread {(spread * 100).toFixed(0)}%
        </span>
      </div>

      {/* Preview grid */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center",
        padding: "0 16px", maxWidth: 1200 }}>
        {Array.from({ length: CANDIDATE_COUNT }).map((_, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{
              border: selected === i ? "2px solid #c9b87a" : "2px solid rgba(201,184,122,0.15)",
              borderRadius: 3, overflow: "hidden", cursor: "pointer",
              opacity: generating && i >= candidates.length ? 0.3 : 1,
              transition: "border-color 0.15s",
            }} onClick={() => !generating && handleSelect(i)}>
              <canvas
                ref={el => canvasRefs.current[i] = el}
                width={PW} height={PH}
                style={{ width: 220, height: 110, display: "block", background: "#0a0c14" }}
              />
            </div>
            <span style={{ fontSize: 9, color: i === 0 ? "#c9b87a" : "#6a6458" }}>
              {i === 0 ? "Current" : `Variant ${i}`}
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, padding: "12px 16px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={handleReshuffle} style={btnBase}
          disabled={generating}>Reshuffle</button>
        <button onClick={handleReset} style={btnBase}>Reset All</button>
        <div style={{ width: 1, height: 16, background: "rgba(201,184,122,0.15)" }} />
        <input value={saveName} onChange={e => setSaveName(e.target.value)}
          placeholder="Preset name..."
          style={{ background: "rgba(201,184,122,0.06)", border: "1px solid rgba(201,184,122,0.18)",
            color: "#c9b87a", padding: "4px 8px", borderRadius: 2, fontSize: 11,
            fontFamily: "inherit", width: 120, outline: "none" }} />
        <button onClick={() => {
          if (!saveName.trim()) return;
          savePreset(saveName.trim(), baseParams);
          setSaveName("");
        }} style={btnBase} disabled={!saveName.trim()}>Save</button>
        <div style={{ width: 1, height: 16, background: "rgba(201,184,122,0.15)" }} />
        <button onClick={handleApply}
          style={{ ...btnBase, color: "#c9b87a", border: "1px solid rgba(201,184,122,0.4)" }}>
          Apply &amp; Generate
        </button>
        <button onClick={onClose} style={btnBase}>Cancel</button>
      </div>

      {generating && (
        <span style={{ fontSize: 10, color: "#6a6458", padding: 4 }}>
          Generating previews...
        </span>
      )}
    </div>
  );
}
