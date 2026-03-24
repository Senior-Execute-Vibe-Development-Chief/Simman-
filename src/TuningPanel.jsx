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

const PW = 320, PH = 160;
const CANDIDATE_COUNT = 4;
const INITIAL_SPREAD = 0.35;
const SPREAD_DECAY = 0.72;

export default function TuningPanel({ noiseFns, seed, params, onParamsChange }) {
  const [group, setGroup] = useState("continents");
  const [round, setRound] = useState(0);
  const [spread, setSpread] = useState(INITIAL_SPREAD);
  const [baseParams, setBaseParams] = useState(params || {});
  const [candidates, setCandidates] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [saveName, setSaveName] = useState("");
  const canvasRefs = useRef([]);

  // Sync external params changes
  useEffect(() => { setBaseParams(params || {}); }, [params]);

  const doGenerate = useCallback((bp, grp, sp) => {
    setGenerating(true);
    const cands = generateCandidates(bp, grp, sp, CANDIDATE_COUNT, Date.now());
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
  }, [seed, noiseFns]);

  useEffect(() => { doGenerate(baseParams, group, spread); }, []); // eslint-disable-line

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
    setGroup(grp);
    setRound(0);
    setSpread(INITIAL_SPREAD);
    doGenerate(baseParams, grp, INITIAL_SPREAD);
  };

  const btn = {
    background: "rgba(201,184,122,0.08)", border: "1px solid rgba(201,184,122,0.18)",
    color: "#8a8474", padding: "3px 8px", borderRadius: 2, cursor: "pointer",
    fontSize: 10, fontFamily: "inherit",
  };
  const btnA = (active, color) => ({
    ...btn,
    background: active ? `rgba(${color},0.2)` : btn.background,
    border: `1px solid ${active ? `rgba(${color},0.35)` : "rgba(201,184,122,0.18)"}`,
    color: active ? `rgb(${color})` : "#8a8474",
  });

  const groupKeys = [...Object.keys(PARAMS), "all"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Group selector */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {groupKeys.map(k => (
          <button key={k} onClick={() => handleGroupChange(k)}
            style={btnA(group === k, k === "all" ? "201,184,122" : PARAMS[k].color)}>
            {k === "all" ? "All" : PARAMS[k].label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 9, color: "#6a6458" }}>
        Round {round} · Spread {(spread * 100).toFixed(0)}%
      </div>

      {/* Preview canvases */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {Array.from({ length: CANDIDATE_COUNT }).map((_, i) => (
          <div key={i} style={{ cursor: "pointer", textAlign: "center" }}
            onClick={() => !generating && handleSelect(i)}>
            <canvas ref={el => canvasRefs.current[i] = el}
              width={PW} height={PH}
              style={{ width: "100%", display: "block", background: "#0a0c14",
                border: "1px solid rgba(201,184,122,0.15)", borderRadius: 2 }} />
            <span style={{ fontSize: 8, color: i === 0 ? "#c9b87a" : "#6a6458" }}>
              {i === 0 ? "Current" : `Var ${i}`}
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => doGenerate(baseParams, group, spread)} style={btn}
          disabled={generating}>Reshuffle</button>
        <button onClick={() => {
          const empty = {};
          setBaseParams(empty); onParamsChange(empty);
          setRound(0); setSpread(INITIAL_SPREAD);
          doGenerate(empty, group, INITIAL_SPREAD);
        }} style={btn}>Reset</button>
      </div>

      {/* Save preset */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input value={saveName} onChange={e => setSaveName(e.target.value)}
          placeholder="Preset name..."
          style={{ background: "rgba(201,184,122,0.06)", border: "1px solid rgba(201,184,122,0.18)",
            color: "#c9b87a", padding: "3px 6px", borderRadius: 2, fontSize: 10,
            fontFamily: "inherit", flex: 1, outline: "none", minWidth: 0 }} />
        <button onClick={() => {
          if (!saveName.trim()) return;
          savePreset(saveName.trim(), baseParams);
          setSaveName("");
        }} style={btn} disabled={!saveName.trim()}>Save</button>
      </div>

      {generating && <span style={{ fontSize: 9, color: "#6a6458" }}>Generating...</span>}
    </div>
  );
}
