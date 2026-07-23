// ── The event nervous system (plan §8) ──────────────────────────────────────
// Category + severity metadata over the structured feed the worker already
// streams ({step, type, text, x, y}), a bell with an unread count, and a
// toast stack for epochal moments. Severity derives from the event TYPE —
// what kind of thing happened in the world — never from the clock.

import { useEffect, useRef, useState } from "react";

export const EV_CATS = [
  ["war", "War", "#e06a52"],
  ["politics", "Politics", "#d4a83e"],
  ["faith", "Faith", "#8f9fe4"],
  ["economy", "Economy", "#5cc0aa"],
  ["disaster", "Disaster", "#c078e0"],
  ["discovery", "Discovery", "#6aa8e0"],
  ["society", "Society", "#c99078"],
];

// Keyed on the sim's RAW event types (events.js logEvent calls — the worker
// feed forwards ev.type verbatim). `toast: true` marks the epochal moments.
const TYPE_META = {
  "war.began": { cat: "war", icon: "⚔" }, "war.ended": { cat: "war", icon: "⚑" },
  "settlement.captured": { cat: "war", icon: "⚔" },
  "polity.shattered": { cat: "war", icon: "⚔", toast: true },
  "war.indemnity": { cat: "war", icon: "◈" }, "horde.raid": { cat: "war", icon: "🐎" },
  "polity.founded": { cat: "politics", icon: "✦" }, "polity.restored": { cat: "politics", icon: "✦", toast: true },
  "polity.seceded": { cat: "politics", icon: "⚐" }, "polity.ended": { cat: "politics", icon: "✝", toast: true },
  "polity.submitted": { cat: "politics", icon: "⚐" },
  "settlement.annexed": { cat: "politics", icon: "⚑" },
  "colony.independent": { cat: "politics", icon: "⚐", toast: true },
  "succession.crisis": { cat: "politics", icon: "♔" },
  "gov.changed": { cat: "politics", icon: "♔" },
  "ruler.crowned": { cat: "politics", icon: "♔" }, "ruler.elected": { cat: "politics", icon: "♔" },
  "ruler.elevated": { cat: "politics", icon: "♔" }, "ruler.died": { cat: "politics", icon: "♔" },
  "dynasty.founded": { cat: "politics", icon: "♔" }, "dynasty.union": { cat: "politics", icon: "♔" },
  "dynasty.extinct": { cat: "politics", icon: "♔" }, "crown.debt": { cat: "politics", icon: "◈" },
  "faith.founded": { cat: "faith", icon: "❖", toast: true },
  "polity.adoptedFaith": { cat: "faith", icon: "❖" },
  "faith.syncretized": { cat: "faith", icon: "❖" },
  "faith.schism": { cat: "faith", icon: "❖", toast: true },
  "faith.faded": { cat: "faith", icon: "❖" }, "city.holy": { cat: "faith", icon: "❖" },
  "market.boom": { cat: "economy", icon: "◈" }, "wealth.milestone": { cat: "economy", icon: "◈" },
  "industry.specialty": { cat: "economy", icon: "⚒" }, "mine.boom": { cat: "economy", icon: "⚒" },
  "city.entrepot": { cat: "economy", icon: "⇄" }, "city.financier": { cat: "economy", icon: "⇄" },
  "realm.monument": { cat: "economy", icon: "◆", toast: true },
  "famine.struck": { cat: "disaster", icon: "☄" }, "market.dearth": { cat: "disaster", icon: "☄" },
  "plague.outbreak": { cat: "disaster", icon: "☠" },
  "plague.virginSoil": { cat: "disaster", icon: "☠", toast: true },
  "era.reached": { cat: "discovery", icon: "✧", toast: true },
  "growth.cities": { cat: "society", icon: "⌂" },
  "settlement.founded": { cat: "society", icon: "⌂" },
  "settlement.lapsed": { cat: "society", icon: "⌂" },
  "colony.departed": { cat: "society", icon: "⛵" }, "colony.founded": { cat: "society", icon: "⛵" },
  "culture.born": { cat: "society", icon: "✦" }, "culture.diverged": { cat: "society", icon: "✦" },
  "language.shift": { cat: "society", icon: "✎" },
  "city.slaver": { cat: "society", icon: "⛓" }, "city.plantation": { cat: "society", icon: "⛓" },
  "city.latifundia": { cat: "society", icon: "⛓" }, "society.serfdom": { cat: "society", icon: "⛓" },
  "society.emancipation": { cat: "society", icon: "🕊", toast: true },
  "slave.revolt": { cat: "society", icon: "⛓", toast: true },
};
const PREFIX_CAT = { war: "war", polity: "politics", ruler: "politics", dynasty: "politics",
  succession: "politics", gov: "politics", faith: "faith", market: "economy", wealth: "economy",
  industry: "economy", mine: "economy", city: "economy", famine: "disaster", plague: "disaster",
  era: "discovery" };

export function evMeta(type) {
  const m = TYPE_META[type];
  if (m) return m;
  const prefix = typeof type === "string" ? type.split(".")[0] : "";
  return { cat: PREFIX_CAT[prefix] || "society", icon: "·" };
}
export function evCatColor(cat) {
  const row = EV_CATS.find(([id]) => id === cat);
  return row ? row[2] : "#b8a482";
}

/** Bell in the top bar: unread count since the feed was last opened. */
export function TopBarBell({ feedRef, onOpenFeed }) {
  const seenRef = useRef(0);
  const psw = feedRef.current;
  const n = psw && psw._feed ? psw._feed.length : 0;
  const unread = Math.max(0, n - seenRef.current);
  return (
    <button className="au-btn au-flat" style={{ fontSize: 13, padding: "3px 8px", position: "relative" }}
      title={unread ? `${unread} new events — open the feed` : "World event feed"}
      onClick={() => { seenRef.current = n; onOpenFeed(); }}>
      🔔
      {unread > 0 && <span style={{
        position: "absolute", top: -1, right: -1, minWidth: 15, height: 15, borderRadius: 8,
        background: "var(--au-ch-wax)", color: "#fff", fontSize: 9.5, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
        {unread > 99 ? "99+" : unread}</span>}
    </button>
  );
}

/**
 * Toast stack (NE over the map) for epochal events — a realm falls, a faith
 * schisms, a first-of-its-kind discovery. Click jumps the camera. Purely a
 * view over the feed; verbosity: "epochal" | "all" | "silent".
 */
export function ToastHost({ feedRef, verbosity, onJump, stepNow }) {
  const [toasts, setToasts] = useState([]);
  const cursorRef = useRef(-1);   // feed index consumed so far (-1 = start at live end)
  const idRef = useRef(0);

  useEffect(() => {
    const psw = feedRef.current;
    const F = psw && psw._feed;
    if (!F) return;
    if (cursorRef.current < 0) { cursorRef.current = F.length; return; }   // don't replay history on mount
    if (F.length <= cursorRef.current) { if (F.length < cursorRef.current) cursorRef.current = F.length; return; }
    if (verbosity === "silent") { cursorRef.current = F.length; return; }
    const fresh = [];
    for (let i = cursorRef.current; i < F.length; i++) {
      const e = F[i];
      const meta = evMeta(e.type);
      if (verbosity === "epochal" && !meta.toast) continue;
      fresh.push({ id: ++idRef.current, e, meta });
    }
    cursorRef.current = F.length;
    if (!fresh.length) return;
    setToasts((t) => [...t, ...fresh].slice(-3));
    // schedule dismissal per toast
    for (const f of fresh) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== f.id)), 7000);
  }, [stepNow, feedRef, verbosity]);

  if (!toasts.length) return null;
  return (
    <div style={{ position: "absolute", top: 10, right: 10, zIndex: "var(--z-toasts)",
      display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", pointerEvents: "none" }}>
      {toasts.map(({ id, e, meta }) => (
        <div key={id} className="au-parchment au-toast" style={{ pointerEvents: "auto" }}
          onClick={() => { if (e.x != null) onJump(e.x, e.y); setToasts((t) => t.filter((x) => x.id !== id)); }}
          title={e.x != null ? "Jump to where it happened" : undefined}>
          <span style={{ fontSize: 16, color: evCatColor(meta.cat), flexShrink: 0 }}>{meta.icon}</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.35 }}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Keyboard & reading-the-map help (the `?` overlay). */
export function HelpOverlay({ onClose }) {
  const K = ([k, d], i) => (
    <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "2px 0" }}>
      <kbd style={{ fontFamily: "inherit", fontSize: 11.5, border: "1px solid rgba(216,190,150,0.4)",
        borderRadius: 3, padding: "0 7px", minWidth: 34, textAlign: "center", background: "rgba(214,178,118,0.10)" }}>{k}</kbd>
      <span style={{ fontSize: 12.5 }}>{d}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,8,6,0.72)",
      zIndex: "var(--z-documents)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="au-parchment au-elev"
        style={{ padding: "16px 22px", width: "min(560px,92vw)", maxHeight: "86vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <span className="au-pico-title" style={{ fontSize: 16 }}>Reading the world</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--au-fade)", fontSize: 18 }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 26px" }}>
          <div>
            <div className="au-heading au-sc au-fade" style={{ fontSize: 11, margin: "4px 0" }}>Time</div>
            {[["Space", "play / pause"], ["1–9", "switch lens"]].map(K)}
            <div className="au-heading au-sc au-fade" style={{ fontSize: 11, margin: "8px 0 4px" }}>Camera</div>
            {[["drag", "pan"], ["wheel", "zoom at cursor"], ["dbl-click", "reset view"], ["F", "fit world"]].map(K)}
          </div>
          <div>
            <div className="au-heading au-sc au-fade" style={{ fontSize: 11, margin: "4px 0" }}>Panels</div>
            {[["L", "map layers"], ["G", "globe"], ["?", "this card"], ["Esc", "step back out"]].map(K)}
            <div className="au-heading au-sc au-fade" style={{ fontSize: 11, margin: "8px 0 4px" }}>The map</div>
            {[["hover", "what is this place"], ["click", "select city / realm"]].map(K)}
          </div>
        </div>
        <div className="au-rule" style={{ margin: "10px 0 8px" }} />
        <div className="au-fade" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Nothing in this world is scripted. Every realm, war, faith and famine
          emerges from local rules — the lenses on the left are different ways of
          reading the same living state, and everything you can click opens a
          deeper page about that thing.
        </div>
      </div>
    </div>
  );
}
