import { useState, useRef, useEffect, useCallback } from "react";
import { generateTectonicWorld } from "./tectonicGen.js";
import { PARAMS, generateCandidates, savePreset } from "./paramDefs.js";

// ── Simple terrain coloring for previews ──
function renderPreview(canvas, world, pw, ph) {
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(pw, ph);
  const d = img.data;
  for (let i = 0; i < pw * ph; i++) {
    const e = world.elevation[i], m = world.moisture[i], t = world.temperature[i];
    let r, g, b;
    if (e <= 0) {
      const depth = Math.min(1, Math.max(0, -e * 8));
      r = 18 - depth * 12 | 0; g = 42 - depth * 28 | 0; b = 80 - depth * 40 | 0;
    } else {
      const h = Math.min(1, e * 1.2);
      if (h > 0.6) { const a = (h - 0.6) / 0.4; r = 140 + a * 115 | 0; g = 130 + a * 125 | 0; b = 120 + a * 135 | 0; }
      else if (h > 0.25) { const a = (h - 0.25) / 0.35; r = 80 + a * 60 | 0; g = 110 - a * 20 | 0; b = 50 - a * 10 | 0; }
      else {
        const wet = Math.min(1, Math.max(0, m));
        r = 60 + (1 - wet) * 50 | 0; g = 100 + wet * 40 | 0; b = 35 + wet * 20 | 0;
        if (t > 0.6 && m < 0.2) {
          const desert = Math.min(1, (t - 0.6) * 3 * (0.2 - m) * 8);
          r = r * (1 - desert) + 180 * desert | 0; g = g * (1 - desert) + 160 * desert | 0; b = b * (1 - desert) + 100 * desert | 0;
        }
      }
    }
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export { renderPreview };

// ── Shared Parameter Editor component ──
export function ParamEditor({ params, onChange }) {
  const [openGroup, setOpenGroup] = useState("");
  return (
    <div style={{ fontSize: 10 }}>
      {Object.entries(PARAMS).map(([gk, gv]) => (
        <div key={gk} style={{ marginBottom: 6 }}>
          <div onClick={() => setOpenGroup(openGroup === gk ? "" : gk)} style={{ cursor: "pointer", padding: "4px 6px",
            background: `rgba(${gv.color},0.1)`, borderRadius: 2, color: `rgb(${gv.color})`, fontSize: 11,
            display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 8 }}>{openGroup === gk ? "▼" : "▶"}</span>
            {gv.label} <span style={{ color: "#6a6458", fontSize: 9 }}>({gv.params.length})</span>
          </div>
          {openGroup === gk && <div style={{ padding: "4px 0" }}>
            {gv.params.map(pd => {
              const val = params[pd.key] !== undefined ? params[pd.key] : pd.def;
              const step = pd.step || ((pd.max - pd.min) / 100);
              return (
                <div key={pd.key} style={{ marginBottom: 6, padding: "0 4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                    <span style={{ color: "#b0a888", flex: 1 }}>{pd.label}</span>
                    <span title={pd.desc} style={{ cursor: "help", color: "#6a6458", fontSize: 11,
                      width: 14, height: 14, borderRadius: 7, border: "1px solid rgba(201,184,122,0.2)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>?</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="range" min={pd.min} max={pd.max} step={step} value={val}
                      onChange={e => onChange({ ...params, [pd.key]: Number(e.target.value) })}
                      style={{ flex: 1, accentColor: `rgb(${gv.color})` }} />
                    <span style={{ color: "#8a8474", fontSize: 9, minWidth: 32, textAlign: "right" }}>
                      {pd.step && pd.step >= 1 ? val : val.toFixed(3)}</span>
                  </div>
                  {pd.desc && <div style={{ fontSize: 8, color: "#4a4438", lineHeight: "11px", marginTop: 1 }}>{pd.desc}</div>}
                </div>);
            })}
          </div>}
        </div>))}
    </div>
  );
}

const PW = 480, PH = 240;
const INITIAL_SPREAD = 0.35;
const SPREAD_DECAY = 0.72;

export default function TuningPanel({ noiseFns, seed, params, onParamsChange, onClose }) {
  const [group, setGroup] = useState("continents");
  const [round, setRound] = useState(0);
  const [spread, setSpread] = useState(INITIAL_SPREAD);
  const [baseParams, setBaseParams] = useState(params || {});
  const [candidates, setCandidates] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [candCount, setCandCount] = useState(4);
  const [rightTab, setRightTab] = useState("params");
  const canvasRefs = useRef([]);

  useEffect(() => { setBaseParams(params || {}); }, [params]);

  const doGenerate = useCallback((bp, grp, sp, count) => {
    setGenerating(true);
    const cands = generateCandidates(bp, grp, sp, count || candCount, Date.now());
    setCandidates(cands);
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
  }, [seed, noiseFns, candCount]);

  useEffect(() => { doGenerate(baseParams, group, spread, candCount); }, []); // eslint-disable-line

  const handleSelect = (idx) => {
    const newBase = { ...candidates[idx] };
    setBaseParams(newBase);
    onParamsChange(newBase);
    const newSpread = idx === 0 ? spread : spread * SPREAD_DECAY;
    setSpread(newSpread);
    setRound(r => r + 1);
    doGenerate(newBase, group, newSpread);
  };

  const handleGroupChange = (grp) => {
    setGroup(grp); setRound(0); setSpread(INITIAL_SPREAD);
    doGenerate(baseParams, grp, INITIAL_SPREAD);
  };

  const handleCandCountChange = (n) => {
    setCandCount(n);
    doGenerate(baseParams, group, spread, n);
  };

  const handleParamEdit = (newParams) => {
    setBaseParams(newParams);
    onParamsChange(newParams);
    doGenerate(newParams, group, spread);
  };

  const btn = {
    background: "rgba(201,184,122,0.08)", border: "1px solid rgba(201,184,122,0.18)",
    color: "#8a8474", padding: "4px 10px", borderRadius: 2, cursor: "pointer",
    fontSize: 11, fontFamily: "inherit",
  };
  const btnA = (active, color) => ({
    ...btn, background: active ? `rgba(${color},0.2)` : btn.background,
    border: `1px solid ${active ? `rgba(${color},0.35)` : "rgba(201,184,122,0.18)"}`,
    color: active ? `rgb(${color})` : "#8a8474",
  });

  const groupKeys = [...Object.keys(PARAMS), "all"];
  const gridCols = candCount <= 2 ? candCount : candCount <= 4 ? 2 : candCount <= 6 ? 3 : candCount <= 9 ? 3 : 5;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(4,6,12,0.97)", zIndex: 9999,
      display: "flex", fontFamily: "inherit", color: "#c9b87a" }}>

      {/* ── LEFT: Tune controls + preview grid ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header bar */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
          padding: "8px 12px", borderBottom: "1px solid rgba(201,184,122,0.08)" }}>
          <span style={{ fontSize: 12, color: "#c9b87a", fontWeight: "bold" }}>TUNE</span>
          <div style={{ width: 1, height: 16, background: "rgba(201,184,122,0.15)" }} />
          {groupKeys.map(k => (
            <button key={k} onClick={() => handleGroupChange(k)}
              style={btnA(group === k, k === "all" ? "201,184,122" : PARAMS[k].color)}>
              {k === "all" ? "Everything" : PARAMS[k].label}
            </button>
          ))}
          <div style={{ width: 1, height: 16, background: "rgba(201,184,122,0.15)" }} />
          <span style={{ fontSize: 10, color: "#6a6458" }}>Round {round} · Spread {(spread * 100).toFixed(0)}%</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "#6a6458" }}>Candidates</span>
          <input type="range" min={1} max={10} value={candCount}
            onChange={e => handleCandCountChange(+e.target.value)}
            style={{ width: 60, accentColor: "#c9b87a" }} />
          <span style={{ fontSize: 10, color: "#8a8474", minWidth: 14 }}>{candCount}</span>
          <div style={{ width: 1, height: 16, background: "rgba(201,184,122,0.15)" }} />
          <button onClick={onClose} style={{ ...btn, color: "#c9b87a" }}>Close</button>
        </div>

        {/* Preview grid */}
        <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${gridCols},1fr)`, gap: 6 }}>
            {Array.from({ length: candCount }).map((_, i) => (
              <div key={i} style={{ cursor: "pointer", textAlign: "center" }}
                onClick={() => !generating && handleSelect(i)}>
                <canvas ref={el => canvasRefs.current[i] = el}
                  width={PW} height={PH}
                  style={{ width: "100%", display: "block", background: "#0a0c14",
                    border: "2px solid rgba(201,184,122,0.12)", borderRadius: 3,
                    transition: "border-color 0.15s" }}
                  onMouseEnter={e => e.target.style.borderColor = "rgba(201,184,122,0.5)"}
                  onMouseLeave={e => e.target.style.borderColor = "rgba(201,184,122,0.12)"} />
                <span style={{ fontSize: 9, color: i === 0 ? "#c9b87a" : "#6a6458" }}>
                  {i === 0 ? "Current" : `Variant ${i}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom actions */}
        <div style={{ display: "flex", gap: 8, padding: "8px 12px", alignItems: "center",
          borderTop: "1px solid rgba(201,184,122,0.08)", flexWrap: "wrap" }}>
          <button onClick={() => doGenerate(baseParams, group, spread)} style={btn}
            disabled={generating}>Reshuffle</button>
          <button onClick={() => {
            const empty = {};
            setBaseParams(empty); onParamsChange(empty);
            setRound(0); setSpread(INITIAL_SPREAD);
            doGenerate(empty, group, INITIAL_SPREAD);
          }} style={btn}>Reset All</button>
          <div style={{ width: 1, height: 16, background: "rgba(201,184,122,0.15)" }} />
          <input value={saveName} onChange={e => setSaveName(e.target.value)}
            placeholder="Preset name..."
            style={{ background: "rgba(201,184,122,0.06)", border: "1px solid rgba(201,184,122,0.18)",
              color: "#c9b87a", padding: "4px 8px", borderRadius: 2, fontSize: 11,
              fontFamily: "inherit", width: 130, outline: "none" }} />
          <button onClick={() => {
            if (!saveName.trim()) return;
            savePreset(saveName.trim(), baseParams); setSaveName("");
          }} style={btn} disabled={!saveName.trim()}>Save Preset</button>
          {generating && <span style={{ fontSize: 10, color: "#6a6458" }}>Generating...</span>}
        </div>
      </div>

      {/* ── RIGHT: Parameter editor ── */}
      <div style={{ width: 300, minWidth: 300, borderLeft: "1px solid rgba(201,184,122,0.08)",
        display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "8px 10px", fontSize: 11, color: "#c9b87a",
          borderBottom: "1px solid rgba(201,184,122,0.08)" }}>Parameters</div>
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          <ParamEditor params={baseParams} onChange={handleParamEdit} />
        </div>
      </div>
    </div>
  );
}
