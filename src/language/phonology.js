// ═══════════════════════════════════════════════════════════════════════════════
// PHONOLOGY — Features, Segments, Syllabification, OT Constraints, Evaluation
// ═══════════════════════════════════════════════════════════════════════════════

export const BINARY_FEATURES = [
  "syllabic","consonantal","sonorant","voice","spreadGlottis","constrictedGlottis",
  "nasal","lateral","continuant","strident","delayedRelease","high","low","back","round","atr"
];

function fb(b, p) {
  const m = {};
  BINARY_FEATURES.forEach((f, i) => { m[f] = b[i] || 0; });
  return { binary: m, place: p };
}

export const SG = {
  "p":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0],0),"b":fb([0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0],0),
  "t":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0],3),"d":fb([0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0],3),
  "k":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0],7),"g":fb([0,1,0,1,0,0,0,0,0,0,0,0,0,1,0,0],7),
  "q":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0],8),"ʔ":fb([0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0],10),
  "m":fb([0,1,1,1,0,0,1,0,0,0,0,0,0,0,0,0],0),"n":fb([0,1,1,1,0,0,1,0,0,0,0,0,0,0,0,0],3),
  "ɲ":fb([0,1,1,1,0,0,1,0,0,0,0,1,0,0,0,0],6),"ŋ":fb([0,1,1,1,0,0,1,0,0,0,0,0,0,1,0,0],7),
  "f":fb([0,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0],1),"v":fb([0,1,0,1,0,0,0,0,1,1,0,0,0,0,0,0],1),
  "s":fb([0,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0],3),"z":fb([0,1,0,1,0,0,0,0,1,1,0,0,0,0,0,0],3),
  "ʃ":fb([0,1,0,0,0,0,0,0,1,1,0,1,0,0,0,0],4),"x":fb([0,1,0,0,0,0,0,0,1,0,0,0,0,1,0,0],7),
  "h":fb([0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0],10),
  "l":fb([0,1,1,1,0,0,0,1,1,0,0,0,0,0,0,0],3),"r":fb([0,1,1,1,0,0,0,0,1,0,0,0,0,0,0,0],3),
  "j":fb([0,0,1,1,0,0,0,0,1,0,0,1,0,0,0,0],6),"w":fb([0,0,1,1,0,0,0,0,1,0,0,1,0,1,1,0],7),
  "i":fb([1,0,1,1,0,0,0,0,1,0,0,1,0,0,0,1],6),"e":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,0,0,1],6),
  "ɛ":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,0,0,0],6),"a":fb([1,0,1,1,0,0,0,0,1,0,0,0,1,1,0,0],6),
  "ə":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,0,0,0],6),
  "u":fb([1,0,1,1,0,0,0,0,1,0,0,1,0,1,1,1],7),"o":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,1,1,1],7),
  "ɔ":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,1,1,0],7),
};

export function clone(s) { return { binary: { ...s.binary }, place: s.place }; }
export function isV(s) { return !!s.binary.syllabic; }
export function isC(s) { return !s.binary.syllabic; }
export function isObs(s) { return !!s.binary.consonantal && !s.binary.sonorant; }
export function isNas(s) { return !!s.binary.nasal; }
export function isSon(s) { return !!s.binary.sonorant; }

export function son(s) {
  if (isV(s)) return s.binary.low ? 5 : (s.binary.high ? 3 : 4);
  if (isNas(s)) return 2;
  if (isSon(s) && !isNas(s)) return 2.5;
  if (s.binary.continuant && isObs(s)) return 1;
  return 0;
}

export function segLabel(s) {
  for (const [i, d] of Object.entries(SG)) {
    let m = true;
    for (const f of BINARY_FEATURES) if ((d.binary[f] || 0) !== (s.binary[f] || 0)) { m = false; break; }
    if (m && d.place === s.place) return i;
  }
  return "?";
}

// ─── Syllabification ───

export function syllabify(segs) {
  if (!segs.length) return [];
  const syls = [];
  let i = 0;
  while (i < segs.length) {
    const sy = { onset: [], nucleus: [], coda: [], stress: "none" };
    while (i < segs.length && isC(segs[i])) { sy.onset.push(segs[i]); i++; }
    while (i < segs.length && isV(segs[i])) { sy.nucleus.push(segs[i]); i++; }
    if (!sy.nucleus.length && sy.onset.length) {
      syls.push({ onset: [], nucleus: [sy.onset.pop()], coda: [], stress: "none" });
      if (sy.onset.length) {
        const p = syls[syls.length - 1];
        p.onset = sy.onset.concat(p.onset);
      }
      continue;
    }
    const cs = i;
    while (i < segs.length && isC(segs[i])) i++;
    if (i < segs.length && isV(segs[i])) {
      const cd = segs.slice(cs, i);
      if (cd.length) { const k = Math.max(0, cd.length - 1); sy.coda = cd.slice(0, k); i = cs + k; }
    } else {
      sy.coda = segs.slice(cs, i);
    }
    sy.stress = syls.length === 0 ? "primary" : "none";
    syls.push(sy);
  }
  return syls;
}

export function flat(syls) { return syls.flatMap(s => [...s.onset, ...s.nucleus, ...s.coda]); }
export function sylIPA(syls) { return syls.map(s => [...s.onset, ...s.nucleus, ...s.coda].map(segLabel).join("")).join("."); }

// ─── OT Constraints ───

export const CON = [
  { name: "*CODA", type: "M", fn: (u, sf) => sf.reduce((c, s) => c + s.coda.length, 0), dw: 2 },
  { name: "*CxOn", type: "M", fn: (u, sf) => sf.reduce((c, s) => c + Math.max(0, s.onset.length - 1), 0), dw: 3 },
  { name: "*CxCd", type: "M", fn: (u, sf) => sf.reduce((c, s) => c + Math.max(0, s.coda.length - 1), 0), dw: 3 },
  { name: "ONSET", type: "M", fn: (u, sf) => sf.reduce((c, s) => c + (s.onset.length === 0 ? 1 : 0), 0), dw: 2 },
  { name: "*VdOb", type: "M", fn: (u, sf) => flat(sf).reduce((c, x) => c + (isObs(x) && x.binary.voice ? 1 : 0), 0), dw: .5 },
  { name: "AGRv", type: "M", fn: (u, sf) => { const g = flat(sf); let v = 0; for (let i = 0; i < g.length - 1; i++) if (isObs(g[i]) && isObs(g[i + 1]) && !!g[i].binary.voice !== !!g[i + 1].binary.voice) v++; return v; }, dw: 2 },
  { name: "AGRp", type: "M", fn: (u, sf) => { const g = flat(sf); let v = 0; for (let i = 0; i < g.length - 1; i++) if (isNas(g[i]) && isC(g[i + 1]) && !isNas(g[i + 1]) && g[i].place !== g[i + 1].place) v++; return v; }, dw: 3 },
  { name: "SSP", type: "M", fn: (u, sf) => { let v = 0; for (const s of sf) { for (let i = 0; i < s.onset.length - 1; i++) if (son(s.onset[i]) >= son(s.onset[i + 1])) v++; for (let i = 0; i < s.coda.length - 1; i++) if (son(s.coda[i]) <= son(s.coda[i + 1])) v++; } return v; }, dw: 4 },
  { name: "*VdCd", type: "M", fn: (u, sf) => { let v = 0; for (const s of sf) for (const x of s.coda) if (isObs(x) && x.binary.voice) v++; return v; }, dw: 1 },
  { name: "MAX", type: "F", fn: (u, sf) => Math.max(0, u.length - flat(sf).length), dw: 5 },
  { name: "DEP", type: "F", fn: (u, sf) => Math.max(0, flat(sf).length - u.length), dw: 4 },
  { name: "IDv", type: "F", fn: (u, sf) => { const ss = flat(sf); let v = 0; for (let i = 0; i < Math.min(u.length, ss.length); i++) if (!!u[i].binary.voice !== !!ss[i].binary.voice) v++; return v; }, dw: 3 },
  { name: "IDp", type: "F", fn: (u, sf) => { const ss = flat(sf); let v = 0; for (let i = 0; i < Math.min(u.length, ss.length); i++) if (u[i].place !== ss[i].place) v++; return v; }, dw: 4 },
  { name: "IDn", type: "F", fn: (u, sf) => { const ss = flat(sf); let v = 0; for (let i = 0; i < Math.min(u.length, ss.length); i++) if (!!u[i].binary.nasal !== !!ss[i].binary.nasal) v++; return v; }, dw: 3 },
  { name: "IDm", type: "F", fn: (u, sf) => { const ss = flat(sf); let v = 0; for (let i = 0; i < Math.min(u.length, ss.length); i++) if (!!u[i].binary.continuant !== !!ss[i].binary.continuant) v++; return v; }, dw: 4 },
];

// ─── IPA Parsing ───

export function parseIPA(str) {
  const segs = [];
  let i = 0;
  while (i < str.length) {
    if (i + 1 < str.length) {
      const d = str.slice(i, i + 2);
      if (SG[d]) { segs.push(clone(SG[d])); i += 2; continue; }
    }
    if (SG[str[i]]) segs.push(clone(SG[str[i]]));
    i++;
  }
  return segs;
}

// ─── GEN (candidate generation) ───

export function gen(uf) {
  const cs = new Map();
  const add = (segs, desc) => { const sy = syllabify(segs); const k = sylIPA(sy); if (!cs.has(k)) cs.set(k, { sy, desc, ipa: k }); };
  add([...uf], "faithful");
  for (let i = 0; i < uf.length; i++) { const s = uf.filter((_, j) => j !== i); if (s.length) add(s, "del"); }
  const schwa = clone(SG["ə"]);
  for (let i = 0; i <= uf.length; i++) add([...uf.slice(0, i), clone(schwa), ...uf.slice(i)], "ins ə");
  for (let i = 0; i < uf.length; i++) {
    if (isC(uf[i])) {
      const s = uf.map((x, j) => j === i ? (() => { const c = clone(x); c.binary.voice = !c.binary.voice; return c; })() : clone(x));
      add(s, "±voi");
    }
  }
  for (let i = 0; i < uf.length - 1; i++) {
    if (isNas(uf[i]) && isC(uf[i + 1])) {
      const s = uf.map((x, j) => { if (j === i) { const c = clone(x); c.place = uf[i + 1].place; return c; } return clone(x); });
      add(s, "assim");
    }
    if (isObs(uf[i]) && isObs(uf[i + 1])) {
      const s1 = uf.map((x, j) => { if (j === i + 1) { const c = clone(x); c.binary.voice = uf[i].binary.voice; return c; } return clone(x); });
      add(s1, "voi→");
      const s2 = uf.map((x, j) => { if (j === i) { const c = clone(x); c.binary.voice = uf[i + 1].binary.voice; return c; } return clone(x); });
      add(s2, "voi←");
    }
    const sw = [...uf.map(clone)]; const tmp = sw[i]; sw[i] = sw[i + 1]; sw[i + 1] = tmp; add(sw, "swap");
  }
  return Array.from(cs.values());
}

// ─── EVAL (constraint evaluation) ───

export function evalUF(uf, w) {
  const cands = gen(uf);
  const rows = cands.map(c => {
    const vi = {};
    let h = 0;
    CON.forEach(con => { const v = con.fn(uf, c.sy); vi[con.name] = v; h -= (w[con.name] ?? con.dw) * v; });
    return { ...c, vi, h };
  });
  rows.sort((a, b) => b.h - a.h);
  return rows;
}

// Quick evaluate: underlying form string → surface IPA
export function qe(ipa, w) {
  const uf = parseIPA(ipa);
  if (!uf.length) return ipa;
  const t = evalUF(uf, w);
  return t[0]?.ipa || ipa;
}

// Find alternations between UF and SF
export function findAlternations(uf, sf, w) {
  const ufSegs = parseIPA(uf);
  if (!ufSegs.length) return [];
  const tableau = evalUF(ufSegs, w);
  if (!tableau.length) return [];
  const winner = tableau[0];
  const ufIPA = uf;
  const sfIPA = sf.replace(/\./g, "");
  if (ufIPA === sfIPA) return [];
  const faithful = tableau.find(c => c.ipa.replace(/\./g, "") === ufIPA);
  if (!faithful) return [{ type: "changed", from: ufIPA, to: sfIPA, reason: "phonological optimization" }];
  const alts = [];
  CON.forEach(c => {
    const wV = winner.vi[c.name] || 0;
    const fV = faithful.vi[c.name] || 0;
    if (fV > wV && c.type === "M") alts.push({ constraint: c.name, saved: fV - wV });
  });
  const drivers = alts.filter(a => a.saved).sort((a, b) => b.saved - a.saved).slice(0, 2);
  const reason = drivers.length ? drivers.map(d => `${d.constraint}`).join(", ") : "constraint interaction";
  return [{ type: "changed", from: ufIPA, to: sfIPA, reason }];
}

export function buildWord(uf, w) {
  const sf = qe(uf, w);
  return { uf, sf, alts: findAlternations(uf, sf, w) };
}
