import { useState } from "react";
import LanguageGen from "./LanguageGen.jsx";
import WorldSim from "./WorldSim.jsx";

const TABS = [
  { id: "language", label: "Language Generator" },
  { id: "world", label: "World Simulator" },
];

export default function App() {
  const [tab, setTab] = useState("language");

  return (
    <div style={{ minHeight: "100vh", background: "#060810" }}>
      <nav
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 4,
          padding: "10px 12px 0",
          background: "linear-gradient(180deg, #0e1118 0%, #060810 100%)",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 24px",
              fontSize: 13,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              fontFamily: "'Palatino Linotype','Book Antiqua',Palatino,serif",
              border: "1px solid",
              borderBottom: tab === t.id ? "1px solid #060810" : "1px solid rgba(201,184,122,0.15)",
              borderColor:
                tab === t.id
                  ? "rgba(201,184,122,0.25) rgba(201,184,122,0.25) #060810"
                  : "rgba(201,184,122,0.08)",
              borderRadius: "4px 4px 0 0",
              background: tab === t.id ? "#060810" : "transparent",
              color: tab === t.id ? "#c9b87a" : "#5a5448",
              cursor: "pointer",
              position: "relative",
              bottom: -1,
              transition: "color 0.2s",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div
        style={{
          borderTop: "1px solid rgba(201,184,122,0.15)",
        }}
      >
        {tab === "language" ? <LanguageGen /> : <WorldSim />}
      </div>
    </div>
  );
}
