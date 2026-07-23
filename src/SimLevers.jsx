// ── Sim Levers menu ──────────────────────────────────────────────────
//
// A side panel exposing the runtime gameplay tuning knobs (peopleSim/tuning.js)
// as live sliders, grouped by category, each with a one-line description.
// Changes are reported up via onChange and take effect on the next sim pass.
//
// Pure presentation: it owns no sim state. The parent holds `values` (the
// current { KEY: number } map) and pushes changes to the worker.

import { TUNING_SCHEMA, tuningDefaults } from "./sim/peopleSim/tuning.js";

const DEFAULTS = tuningDefaults();

// Format a value for the readout: integers plain, tiny numbers in exponent
// form, everything else with enough decimals to see a single step.
function fmt(v, step) {
  if (!isFinite(v)) return String(v);
  if (step >= 1) return String(Math.round(v));
  if (Math.abs(v) > 0 && Math.abs(v) < 0.001) return v.toExponential(1);
  const dp = step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return v.toFixed(dp);
}

function Lever({ p, val, onChange, onReset }) {
  const changed = Math.abs(val - DEFAULTS[p.key]) > 1e-12;
  return (
    <div style={{ marginBottom: 9, padding: "0 2px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
        <span style={{ color: changed ? "#d8c47a" : "#b0a888", flex: 1, fontSize: 11 }}>
          {p.label}{changed ? " ●" : ""}
        </span>
        <span style={{ color: "#8a8474", fontSize: 10, minWidth: 40, textAlign: "right",
          fontVariantNumeric: "tabular-nums" }}>{fmt(val, p.step)}</span>
        <button title="Reset to default" onClick={onReset}
          style={{ background: "none", border: "none", cursor: "pointer",
            color: changed ? "#8a8474" : "#4a463c", fontSize: 11, padding: "0 2px", lineHeight: 1 }}>↺</button>
      </div>
      <input type="range" min={p.min} max={p.max} step={p.step} value={val}
        onChange={e => onChange(p.key, Number(e.target.value))}
        style={{ width: "100%", accentColor: "#b89a4a", height: 12 }} />
      <div style={{ color: "#7d7763", fontSize: 9.5, lineHeight: 1.25, marginTop: 1 }}>{p.desc}</div>
    </div>
  );
}

export default function SimLevers({ values, onChange, onResetKey, onResetAll, onClose }) {
  return (
    <aside className="au-chrome au-glass au-scroll" style={{
      position: "absolute", right: 8, top: 6, bottom: 6, width: 290, zIndex: "var(--z-drawers)",
      padding: "8px 10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4,
        position: "sticky", top: -8, background: "inherit", paddingBottom: 4, zIndex: 1 }}>
        <span className="au-sc" style={{ fontSize: 13, flex: 1, color: "#cbb878" }}>Sim Levers</span>
        <button onClick={onResetAll} className="au-btn" style={{ fontSize: 10 }}>Reset all</button>
        <button onClick={onClose} className="au-btn" style={{ fontSize: 11, padding: "1px 7px" }}>✕</button>
      </div>
      <div style={{ color: "#7d7763", fontSize: 9.5, lineHeight: 1.3, marginBottom: 6 }}>
        Live gameplay tuning — drag a slider and the running world reacts on its next pass.
        ● marks a changed value; ↺ resets one.
      </div>
      {TUNING_SCHEMA.map(cat => (
        <details key={cat.category} open style={{ marginBottom: 6 }}>
          <summary style={{ cursor: "pointer", color: "#bda85f", fontSize: 11.5,
            fontVariant: "small-caps", letterSpacing: 0.3, padding: "2px 0", userSelect: "none" }}>
            {cat.category}
          </summary>
          {cat.blurb && <div style={{ color: "#6f6a57", fontSize: 9, lineHeight: 1.3,
            margin: "1px 0 5px" }}>{cat.blurb}</div>}
          {cat.params.map(p => (
            <Lever key={p.key} p={p} val={values[p.key] ?? DEFAULTS[p.key]}
              onChange={onChange} onReset={() => onResetKey(p.key)} />
          ))}
        </details>
      ))}
    </aside>
  );
}
