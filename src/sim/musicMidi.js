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
export const ROLL_DRUM_NOTE = { mark: 49, pulse: 38 }; // crash / snare fallback
export const STROKE_DRUM_NOTE = { bass: 36, open: 38, slap: 40, ghost: 42 };

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
      if (ch === 9) note = STROKE_DRUM_NOTE[n.stroke] || ROLL_DRUM_NOTE[role] || 42;
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
      if (ch === 9) { midi = String(STROKE_DRUM_NOTE[n.stroke] || ROLL_DRUM_NOTE[role] || 42); cents = "0"; }
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

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiName(note) {
  if (note == null || note < 0) return null;
  return PITCH_NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1);
}

const ROLE_GLOSS = {
  skeleton: "structural trunk tones on strong beats — the map under the surface",
  core: "slow skeletal melody (same job as skeleton when a core body is playing)",
  lead: "main melodic surface",
  voice: "sung line (often a heterophonic doubling of the lead)",
  bass: "low moving support on stable degrees",
  ost: "repeating ostinato / timeline figure",
  pad: "held drone or pad",
  elab: "dense elaboration / figuration around the lead",
  het: "heterophonic doubling of the lead on another body",
  mark: "colotomic punctuation (gong/bell cycle markers) — often unpitched in export",
  pulse: "percussion / timekeeper — often unpitched in export",
};

/**
 * Self-describing roll document for pasting into an AI chat or tool.
 * Returns { json, text } — text is JSON with a prose header so a model gets
 * both the schema legend and the data in one clipboard payload.
 */
export function buildRollForAi(notes, opts = {}) {
  const list = (notes || []).filter(Boolean);
  const bpm = opts.bpm || 120;
  const beatsPerBar = opts.beatsPerBar || 4;
  const labels = opts.roleLabels || {};
  const byRole = new Map();
  for (const n of list) {
    const role = n.role || "lead";
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(n);
  }
  const layers = [];
  for (const role of [...byRole.keys()].sort()) {
    const outNotes = [];
    for (const n of byRole.get(role).slice().sort((a, b) => a.b - b.b || a.dur - b.dur)) {
      const ch = ROLL_MIDI_CH[role] != null ? ROLL_MIDI_CH[role] : 0;
      const pitched = ch !== 9 && n.hz > 30;
      const p = pitched ? hzToMidi(n.hz) : null;
      const drum = ch === 9 ? (STROKE_DRUM_NOTE[n.stroke] || ROLL_DRUM_NOTE[role] || 42) : null;
      outNotes.push({
        start_beat: +Number(n.b).toFixed(4),
        duration_beats: +Number(n.dur).toFixed(4),
        end_beat: +Number(n.b + n.dur).toFixed(4),
        hz: pitched ? +Number(n.hz).toFixed(2) : null,
        midi: p ? p.note : drum,
        cents_from_et: p ? p.cents : null,
        et_name: p ? midiName(p.note) : (drum != null ? `drum:${drum}` : null),
        stroke: n.stroke || null,
        velocity: +Number(n.vel || 0.4).toFixed(3),
        unpitched: !pitched,
      });
    }
    layers.push({
      id: role,
      name: labels[role] || role,
      gloss: ROLE_GLOSS[role] || "ensemble part",
      note_count: outNotes.length,
      notes: outNotes,
    });
  }
  const totalBeats = list.reduce((a, n) => Math.max(a, n.b + n.dur), 0);
  const doc = {
    format: "simman-piano-roll/v1",
    how_to_read: {
      purpose: "A multi-layer piano roll from Simman Music Lab. Each layer is one musical part; notes that overlap in time sound together.",
      time: "start_beat and duration_beats are in BEATS. One beat = one quarter note at tempo_bpm. Bar length is beats_per_bar.",
      pitch: "hz is the exact derived-tuning frequency. midi + et_name are the nearest 12-TET key (for DAWs). cents_from_et is how far hz sits from that ET key (negative = flat).",
      velocity: "0..1 how hard the note is played (not MIDI 0..127).",
      layers: "Hide/show in the Lab before copy — only visible layers are included. Typical form-critical set: skeleton, lead, bass, mark, pulse.",
      unpitched: "Percussion/punctuation may have hz null and unpitched true; midi then is a GM drum note number.",
    },
    people: opts.name || null,
    seed: opts.seed != null ? opts.seed : null,
    occasion: opts.occ || null,
    form_process: opts.formProcess || null,
    tempo_bpm: bpm,
    beats_per_bar: beatsPerBar,
    total_beats: +totalBeats.toFixed(4),
    duration_seconds: +((totalBeats * 60) / bpm).toFixed(3),
    layer_count: layers.length,
    note_count: list.length,
    layers,
  };
  const header = [
    "SIMMAN_PIANO_ROLL v1 — paste this whole block into an AI or tool.",
    "Everything after the blank line is JSON. Read how_to_read first, then layers[].notes.",
    `People: ${doc.people || "?"} · occasion: ${doc.occasion || "?"} · ${doc.tempo_bpm} BPM · ${doc.total_beats} beats · ${doc.layer_count} layers / ${doc.note_count} notes.`,
    "",
  ].join("\n");
  return { json: doc, text: header + JSON.stringify(doc, null, 2) + "\n" };
}

