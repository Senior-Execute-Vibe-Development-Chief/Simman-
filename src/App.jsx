import { useState } from "react";
import LanguageGen from "./LanguageGen.jsx";
import WorldSim from "./WorldSim.jsx";

const TABS = [
  { id: "language", label: "Language" },
  { id: "world", label: "World" },
];

export default function App() {
  const [tab, setTab] = useState("world");

  return (
    <div style={{ minHeight: "100vh", background: "var(--au-table-dark)" }}>
      <nav className="au-app-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`au-app-tab${tab === t.id ? " au-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div style={{ borderTop: "1px solid var(--au-paper-deep)" }}>
        {tab === "language" ? <LanguageGen /> : <WorldSim />}
      </div>
    </div>
  );
}
