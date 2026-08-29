// ── Standard MIDI File (SMF) from a piano-roll note list ─────────────────
//
// MIDI is the interchange format every DAW piano roll imports. Notes are
// { b, dur, hz, role, vel } in beats / Hz. Derived scales are not 12-TET, so
// Hz rounds to the nearest MIDI key; residual cents belong in a side table.
// Unpitched percussion (hz ≤ 30) lands on GM channel 10.

export const MIDI_TPQ = 480;

export const ROLL_MIDI_CH = {
  lead: 0, voice: 1, skeleton: 2, core: 2, bass: 3, elab: 4, het: 5,
  ost: 6, pad: 7, mark: 9, pulse: 9,
};
export const ROLL_DRUM_NOTE = { mark: 49, pulse: 38 }; // crash / snare

export function hzToMidi(hz) {
  if (!(hz > 30)) return null;
  const m = 69 + 12 * Math.log2(hz / 440);
  const note = Math.max(0, Math.min(127, Math.round(m)));
  return { note, cents: Math.round((m - note) * 100), exact: m };
}

function midiTempo(bpm) {
  return Math.max(1, Math.round(60_000_000 / Math.max(1, bpm)));
}
function writeVarLen(n) {
  n = Math.max(0, n >>> 0);
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}
function midiTrackBytes(events) {
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const out = [];
  let last = 0;
  for (const e of events) {
    out.push(...writeVarLen(e.t - last));
    out.push(...e.bytes);
    last = e.t;
  }
  out.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
  return out;
}
function u16(n) { return [(n >> 8) & 255, n & 255]; }
function u32(n) { return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function chunk(type, data) {
  const t = [...type].map(c => c.charCodeAt(0));
  return [...t, ...u32(data.length), ...data];
}
function encodeText(s, max = 32) {
  return [...new TextEncoder().encode(String(s || "").slice(0, max))];
}

/**
 * Type-1 SMF: tempo track + one track per role.
 * @param {Array<{b:number,dur:number,hz:number,role:string,vel?:number}>} notes
 * @param {{bpm?:number, beatsPerBar?:number, name?:string, roleLabels?:Record<string,string>}} opts
 */
export function buildMidiFile(notes, opts = {}) {
  const list = (notes || []).filter(Boolean);
  const bpm = opts.bpm || 120;
  const beatsPerBar = opts.beatsPerBar || 4;
  const byRole = new Map();
  for (const n of list) {
    const role = n.role || "lead";
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(n);
  }
  const tracks = [];
  const meta = [];
  const us = midiTempo(bpm);
  meta.push({ t: 0, order: 0, bytes: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
  meta.push({ t: 0, order: 1, bytes: [0xff, 0x58, 0x04, beatsPerBar, 2, 24, 8] });
  const nameBytes = encodeText(opts.name || "simman");
  meta.push({ t: 0, order: 2, bytes: [0xff, 0x03, nameBytes.length, ...nameBytes] });
  tracks.push(midiTrackBytes(meta));

  const labels = opts.roleLabels || {};
  for (const role of [...byRole.keys()].sort()) {
    const ch = ROLL_MIDI_CH[role] != null ? ROLL_MIDI_CH[role] : 0;
    const ev = [];
    const rname = encodeText(labels[role] || role, 24);
    ev.push({ t: 0, order: 0, bytes: [0xff, 0x03, rname.length, ...rname] });
    let oi = 1;
    for (const n of byRole.get(role)) {
      const start = Math.max(0, Math.round(n.b * MIDI_TPQ));
      const dur = Math.max(1, Math.round(n.dur * MIDI_TPQ));
      const vel = Math.max(1, Math.min(127, Math.round((n.vel || 0.4) * 100)));
      let note;
      if (ch === 9) note = ROLL_DRUM_NOTE[role] || 42;
      else {
        const p = hzToMidi(n.hz);
        if (!p) continue;
        note = p.note;
      }
      ev.push({ t: start, order: oi++, bytes: [0x90 | ch, note, vel] });
      ev.push({ t: start + dur, order: oi++, bytes: [0x80 | ch, note, 0] });
    }
    tracks.push(midiTrackBytes(ev));
  }
  const header = chunk("MThd", [...u16(1), ...u16(tracks.length), ...u16(MIDI_TPQ)]);
  const body = tracks.flatMap(t => chunk("MTrk", t));
  return new Uint8Array([...header, ...body]);
}

/**
 * Beat-accurate CSV with Hz + cents (what SMF cannot carry).
 */
export function buildMidiCsv(notes, opts = {}) {
  const list = (notes || []).filter(Boolean);
  const bpm = opts.bpm || 120;
  const labels = opts.roleLabels || {};
  const lines = [
    `# Simman Music Lab piano roll — ${opts.name || "people"} · ${opts.occ || "peace"}`,
    `# tempo ${bpm} bpm · TPQ ${MIDI_TPQ} · MIDI column is nearest 12-TET; cents/hz keep the derived pitch`,
    "track,role,start_beat,dur_beat,start_tick,dur_tick,midi,cents,hz,velocity",
  ];
  const byRole = new Map();
  for (const n of list) {
    const role = n.role || "lead";
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(n);
  }
  let track = 1;
  for (const role of [...byRole.keys()].sort()) {
    for (const n of byRole.get(role)) {
      const ch = ROLL_MIDI_CH[role] != null ? ROLL_MIDI_CH[role] : 0;
      let midi = "", cents = "";
      if (ch === 9) { midi = String(ROLL_DRUM_NOTE[role] || 42); cents = "0"; }
      else {
        const p = hzToMidi(n.hz);
        if (!p) continue;
        midi = String(p.note); cents = String(p.cents);
      }
      const st = Math.round(n.b * MIDI_TPQ), dt = Math.max(1, Math.round(n.dur * MIDI_TPQ));
      const vel = Math.max(1, Math.min(127, Math.round((n.vel || 0.4) * 100)));
      lines.push([
        track, labels[role] || role,
        Number(n.b).toFixed(4), Number(n.dur).toFixed(4),
        st, dt, midi, cents,
        n.hz > 30 ? Number(n.hz).toFixed(2) : "",
        vel,
      ].join(","));
    }
    track++;
  }
  return lines.join("\n") + "\n";
}
