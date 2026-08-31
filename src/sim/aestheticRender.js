// ── Aesthetic renderer — phenotype → flat SVG (v0) ─────────────────────────
//
// expressAesthetic() (aestheticIdentity.js) resolves look + dress + built + taste;
// this module draws them as layered procedural SVG — parametric primitives, no
// sprite sheets. Same architecture as emblemRender.js: pure strings, deterministic.
//
// Public API:
//   aestheticSVG(aesthetic, W, H)  → complete <svg> string
//   drawAesthetic(aesthetic, x, y, cw, ch) → <g> for a grid cell

const F = n => (+n).toFixed(1);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

function skinRgb(skin) {
  const t = clamp01(skin ?? 0.5);
  return [
    Math.round(lerp(255, 72, t)),
    Math.round(lerp(220, 48, t)),
    Math.round(lerp(190, 38, t)),
  ];
}

function hairRgb(look) {
  const dark = clamp01(look?.hairDark ?? 0.6);
  const hue = clamp01(look?.hairHue ?? 0.15);
  const base = [
    Math.round(lerp(210, 24, dark) + hue * lerp(40, 90, 1 - dark)),
    Math.round(lerp(170, 18, dark) + hue * lerp(20, 50, 1 - dark) * 0.4),
    Math.round(lerp(120, 12, dark)),
  ];
  return base.map(v => Math.max(0, Math.min(255, v)));
}

function dyeRgb(dye, palette) {
  const table = {
    tyrian: [88, 18, 72], indigo: [36, 44, 110], cochineal: [168, 32, 48],
    saffron: [220, 168, 28], ochre: [186, 128, 44], woad: [32, 56, 108],
    henna: [150, 62, 38], weld: [210, 188, 36], madder: [148, 38, 52],
  };
  if (dye && table[dye]) return table[dye];
  const h = (palette?.hueShift ?? 0) * 360;
  const s = clamp01(palette?.saturation ?? 0.4);
  const c = s * 0.55;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = 0.35 + 0.25 * (1 - s);
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function shade(c, f) { return rgb(c.map(v => Math.max(0, Math.min(255, Math.round(v * f))))); }

function patternDefs(id, pattern, field, trim) {
  if (!pattern || pattern === "plain") return "";
  const fc = rgb(field), tc = rgb(trim);
  if (pattern === "stripe") {
    return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
      <rect width="8" height="8" fill="${fc}"/><rect x="0" y="0" width="4" height="8" fill="${tc}"/></pattern>`;
  }
  if (pattern === "check") {
    return `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse">
      <rect width="10" height="10" fill="${fc}"/><rect x="0" y="0" width="5" height="5" fill="${tc}"/>
      <rect x="5" y="5" width="5" height="5" fill="${tc}"/></pattern>`;
  }
  if (pattern === "brocade") {
    return `<pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="${fc}"/><circle cx="6" cy="6" r="2.2" fill="${tc}" opacity="0.55"/>
      <circle cx="0" cy="0" r="1.4" fill="${tc}" opacity="0.35"/><circle cx="12" cy="12" r="1.4" fill="${tc}" opacity="0.35"/></pattern>`;
  }
  return "";
}

/** Face + hair + beard from look + taste.dress grooming. */
export function faceSVG(look, tasteDress, cx, cy, scale = 1) {
  if (!look) {
    return `<circle cx="${F(cx)}" cy="${F(cy)}" r="${F(18 * scale)}" fill="#bbb" opacity="0.35"/>`;
  }
  const s = scale;
  const skin = skinRgb(look.skin);
  const hair = hairRgb(look);
  const jaw = clamp01(look.jawWidth ?? 0.5);
  const breadth = clamp01(look.headBreadth ?? 0.5);
  const ep = clamp01(look.epicanthic ?? 0.2);
  const eye = clamp01(look.eyeAperture ?? 0.5);
  const bridge = clamp01(look.noseBridge ?? 0.5);
  const nw = clamp01(look.noseWidth ?? 0.5);
  const lip = clamp01(look.lipFullness ?? 0.5);
  const brow = clamp01(look.browRidge ?? 0.4);
  const rx = (14 + jaw * 6 + breadth * 4) * s;
  const ry = (17 + breadth * 3) * s;
  const hairStyle = tasteDress?.hair || "shoulder";
  const beardStyle = tasteDress?.beard || "none";
  const parts = [];

  // hair back
  if (hairStyle !== "shaved" && hairStyle !== "cropped") {
    const hw = rx * (hairStyle === "long" ? 1.15 : 1.05);
    const hh = (hairStyle === "long" ? 26 : hairStyle === "plait" || hairStyle === "topknot" ? 20 : 16) * s;
    parts.push(`<ellipse cx="${F(cx)}" cy="${F(cy - ry * 0.55)}" rx="${F(hw)}" ry="${F(hh)}" fill="${rgb(hair)}"/>`);
  }

  // neck
  parts.push(`<rect x="${F(cx - rx * 0.35)}" y="${F(cy + ry * 0.55)}" width="${F(rx * 0.7)}" height="${F(10 * s)}" fill="${rgb(skin)}" rx="${F(2 * s)}"/>`);

  // head
  parts.push(`<ellipse cx="${F(cx)}" cy="${F(cy)}" rx="${F(rx)}" ry="${F(ry)}" fill="${rgb(skin)}"/>`);

  // eyes
  const eyeY = cy - ry * 0.08;
  const eyeDx = rx * (0.38 - ep * 0.08);
  const ew = (3.5 + eye * 2.5 - ep * 1.2) * s;
  const eh = (2.2 + eye * 1.8 - ep * 0.8) * s;
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDx;
    parts.push(`<ellipse cx="${F(ex)}" cy="${F(eyeY)}" rx="${F(ew)}" ry="${F(eh)}" fill="#f8f8f8"/>`);
    parts.push(`<ellipse cx="${F(ex)}" cy="${F(eyeY)}" rx="${F(ew * 0.45)}" ry="${F(eh * 0.9)}" fill="#2a2018"/>`);
    if (ep > 0.45) {
      parts.push(`<path d="M${F(ex - ew)} ${F(eyeY)} Q${F(ex)} ${F(eyeY - eh * 0.9)} ${F(ex + ew)} ${F(eyeY)}" fill="none" stroke="${shade(skin, 0.75)}" stroke-width="${F(0.8 * s)}"/>`);
    }
  }

  // brows
  const browY = eyeY - eh - (1 + brow * 2) * s;
  for (const side of [-1, 1]) {
    const bx = cx + side * eyeDx;
    parts.push(`<path d="M${F(bx - ew)} ${F(browY)} Q${F(bx)} ${F(browY - brow * 2 * s)} ${F(bx + ew)} ${F(browY)}" fill="none" stroke="${shade(hair, 0.7)}" stroke-width="${F((1.2 + brow * 1.5) * s)}" stroke-linecap="round"/>`);
  }

  // nose
  const noseY = cy + ry * 0.12;
  const nwPx = (2 + nw * 4) * s;
  const nh = (4 + bridge * 6) * s;
  parts.push(`<path d="M${F(cx)} ${F(noseY - nh)} L${F(cx - nwPx)} ${F(noseY + nh * 0.35)} L${F(cx + nwPx)} ${F(noseY + nh * 0.35)} Z" fill="${shade(skin, 0.88)}"/>`);

  // mouth
  const mouthY = cy + ry * 0.42;
  const mw = (4 + lip * 5) * s;
  parts.push(`<path d="M${F(cx - mw)} ${F(mouthY)} Q${F(cx)} ${F(mouthY + lip * 2.5 * s)} ${F(cx + mw)} ${F(mouthY)}" fill="none" stroke="${shade(skin, 0.55)}" stroke-width="${F(1.1 * s)}" stroke-linecap="round"/>`);

  // hair front / topknot / plait
  if (hairStyle === "cropped" || hairStyle === "shaved") {
    parts.push(`<ellipse cx="${F(cx)}" cy="${F(cy - ry * 0.75)}" rx="${F(rx * 0.95)}" ry="${F(5 * s)}" fill="${rgb(hair)}"/>`);
  } else if (hairStyle === "topknot") {
    parts.push(`<circle cx="${F(cx)}" cy="${F(cy - ry - 8 * s)}" r="${F(5 * s)}" fill="${rgb(hair)}"/>`);
  } else if (hairStyle === "plait" || hairStyle === "bun") {
    parts.push(`<ellipse cx="${F(cx)}" cy="${F(cy - ry - 4 * s)}" rx="${F(6 * s)}" ry="${F(5 * s)}" fill="${rgb(hair)}"/>`);
  }

  // beard
  if (beardStyle !== "none") {
    const bh = beardStyle === "full" ? 14 : beardStyle === "plait" ? 16 : 6;
    const bw = rx * (beardStyle === "stubble" ? 0.75 : 0.95);
    parts.push(`<ellipse cx="${F(cx)}" cy="${F(cy + ry * 0.55)}" rx="${F(bw)}" ry="${F(bh * s)}" fill="${rgb(hair)}" opacity="${beardStyle === "stubble" ? 0.45 : 0.92}"/>`);
  }

  return parts.join("");
}

/** Torso garment from dress envelope + taste trim. */
export function dressSVG(dress, tasteDress, cx, cy, scale = 1) {
  if (!dress) return { defs: "", svg: "", pid: "" };
  const s = scale;
  const palette = tasteDress?.palette;
  const field = dyeRgb(dress.dye, palette);
  const trim = dyeRgb(dress.dye, { ...palette, hueShift: ((palette?.hueShift ?? 0) + 0.18) % 1, saturation: clamp01((palette?.saturation ?? 0.4) + 0.15) });
  const pattern = tasteDress?.pattern || "plain";
  const pid = `dp${Math.abs((dress.fibre || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) + (pattern.length * 17)) % 99999}`;
  const fill = pattern === "plain" ? rgb(field) : `url(#${pid})`;
  const parts = [];
  const topY = cy + 8 * s;
  const bare = dress.cut === "bare" || dress.weight === "bare";

  if (bare) {
    parts.push(`<ellipse cx="${F(cx)}" cy="${F(topY + 22 * s)}" rx="${F(16 * s)}" ry="${F(20 * s)}" fill="${rgb(skinRgb(0.55))}" opacity="0.15"/>`);
    return { defs: "", svg: parts.join(""), pid };
  }

  const w = (dress.cut === "robe" || dress.cut === "drape" ? 28 : 22) * s;
  const h = (dress.cut === "robe" ? 48 : 38) * s;
  const x = cx - w / 2;
  const y = topY;

  if (dress.cloak && dress.cloak !== "none") {
    const cw = w * (dress.cloak === "long" ? 1.35 : 1.15);
    parts.push(`<path d="M${F(cx - cw / 2)} ${F(y + 4 * s)} Q${F(cx)} ${F(y - 6 * s)} ${F(cx + cw / 2)} ${F(y + 4 * s)} L${F(cx + cw / 2 - 4 * s)} ${F(y + h)} L${F(cx - cw / 2 + 4 * s)} ${F(y + h)} Z" fill="${shade(field, 0.75)}" opacity="0.85"/>`);
  }

  if (dress.cut === "robe" || dress.cut === "drape") {
    parts.push(`<path d="M${F(cx)} ${F(y)} L${F(cx - w / 2)} ${F(y + h)} L${F(cx + w / 2)} ${F(y + h)} Z" fill="${fill}"/>`);
  } else if (dress.cut === "trousers") {
    parts.push(`<rect x="${F(x)}" y="${F(y)}" width="${F(w)}" height="${F(h * 0.42)}" fill="${fill}" rx="${F(2 * s)}"/>`);
    parts.push(`<rect x="${F(cx - w * 0.42)}" y="${F(y + h * 0.4)}" width="${F(w * 0.36)}" height="${F(h * 0.55)}" fill="${fill}" rx="${F(2 * s)}"/>`);
    parts.push(`<rect x="${F(cx + w * 0.06)}" y="${F(y + h * 0.4)}" width="${F(w * 0.36)}" height="${F(h * 0.55)}" fill="${fill}" rx="${F(2 * s)}"/>`);
  } else {
    parts.push(`<rect x="${F(x)}" y="${F(y)}" width="${F(w)}" height="${F(h)}" fill="${fill}" rx="${F(3 * s)}"/>`);
  }

  // sleeves
  if (dress.sleeve === "wide") {
    parts.push(`<ellipse cx="${F(cx - w * 0.55)}" cy="${F(y + 12 * s)}" rx="${F(8 * s)}" ry="${F(5 * s)}" fill="${fill}"/>`);
    parts.push(`<ellipse cx="${F(cx + w * 0.55)}" cy="${F(y + 12 * s)}" rx="${F(8 * s)}" ry="${F(5 * s)}" fill="${fill}"/>`);
  } else if (dress.sleeve === "full" || dress.sleeve === "wrist") {
    const sl = dress.sleeve === "full" ? 18 : 12;
    parts.push(`<rect x="${F(cx - w / 2 - 5 * s)}" y="${F(y + 4 * s)}" width="${F(6 * s)}" height="${F(sl * s)}" fill="${fill}" rx="${F(2 * s)}"/>`);
    parts.push(`<rect x="${F(cx + w / 2 - 1 * s)}" y="${F(y + 4 * s)}" width="${F(6 * s)}" height="${F(sl * s)}" fill="${fill}" rx="${F(2 * s)}"/>`);
  }

  // embroidery border
  if (tasteDress?.embroidery && tasteDress.embroidery !== "none") {
    parts.push(`<rect x="${F(x + 2 * s)}" y="${F(y + 2 * s)}" width="${F(w - 4 * s)}" height="${F(h - 4 * s)}" fill="none" stroke="${rgb(trim)}" stroke-width="${F(1.4 * s)}" rx="${F(2 * s)}"/>`);
  }

  // belt
  if (dress.belt && dress.belt !== "none") {
    parts.push(`<rect x="${F(x)}" y="${F(y + h * 0.35)}" width="${F(w)}" height="${F(3 * s)}" fill="${rgb(trim)}"/>`);
  }

  // headdress
  const hs = tasteDress?.headdressStyle;
  if (dress.headdress === "crown" || hs === "crown" || hs === "fillet") {
    parts.push(`<path d="M${F(cx - w * 0.35)} ${F(y - 2 * s)} L${F(cx - w * 0.2)} ${F(y - 10 * s)} L${F(cx)} ${F(y - 6 * s)} L${F(cx + w * 0.2)} ${F(y - 10 * s)} L${F(cx + w * 0.35)} ${F(y - 2 * s)} Z" fill="${rgb(trim)}"/>`);
  } else if (dress.headdress === "turban" || hs === "turban" || hs === "wrapped") {
    parts.push(`<ellipse cx="${F(cx)}" cy="${F(y - 4 * s)}" rx="${F(w * 0.38)}" ry="${F(6 * s)}" fill="${rgb(trim)}"/>`);
  }

  return { defs: patternDefs(pid, pattern, field, trim), svg: parts.join(""), pid };
}

/** Building silhouette from built envelope + taste trim. */
export function builtSVG(built, tasteBuilt, x, y, w, h) {
  if (!built) return { defs: "", svg: "" };
  const wallRgb = {
    timber: [142, 98, 58], stone: [148, 142, 132], mudbrick: [168, 118, 72],
    wattle: [128, 108, 68], bamboo: [118, 148, 72], reed: [136, 128, 74],
    felt: [120, 108, 88], turf: [88, 118, 62],
  };
  const base = wallRgb[built.wall] || [130, 120, 100];
  const wash = tasteBuilt?.wallWash || "natural";
  if (wash === "whitewash") base.splice(0, 3, 232, 228, 214);
  else if (wash === "ochre") base.splice(0, 3, 196, 148, 72);
  else if (wash === "lime") base.splice(0, 3, 210, 214, 168);

  const parts = [];
  const bodyH = h * (built.verticality === "high" ? 0.72 : built.verticality === "mid" ? 0.62 : 0.52);
  const bodyY = y + h - bodyH - h * 0.08;
  const bodyW = w * 0.78;
  const bodyX = x + (w - bodyW) / 2;

  // fortification
  if (built.fortification === "palisade") {
    for (let i = 0; i < 9; i++) {
      const px = bodyX + (i / 8) * bodyW;
      parts.push(`<rect x="${F(px)}" y="${F(bodyY - 8)}" width="3" height="10" fill="${shade(base, 0.7)}"/>`);
    }
  } else if (built.fortification === "curtain" || built.fortification === "tower") {
    parts.push(`<rect x="${F(bodyX - 6)}" y="${F(bodyY)}" width="${F(bodyW + 12)}" height="${F(bodyH)}" fill="none" stroke="${shade(base, 0.55)}" stroke-width="3"/>`);
    if (built.fortification === "tower") {
      parts.push(`<rect x="${F(bodyX + bodyW - 14)}" y="${F(bodyY - 18)}" width="14" height="22" fill="${shade(base, 0.85)}"/>`);
    }
  }

  // wall body
  parts.push(`<rect x="${F(bodyX)}" y="${F(bodyY)}" width="${F(bodyW)}" height="${F(bodyH)}" fill="${rgb(base)}" rx="1"/>`);

  // windows
  const wt = built.windowType || "plain";
  if (wt !== "plain" && built.wall !== "felt" && built.wall !== "turf") {
    const cols = built.verticality === "high" ? 3 : 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = bodyX + bodyW * (0.2 + c * 0.3);
        const wy = bodyY + bodyH * (0.25 + r * 0.35);
        if (wt === "lattice") {
          parts.push(`<rect x="${F(wx)}" y="${F(wy)}" width="8" height="10" fill="#2a2820" opacity="0.35"/>`);
          parts.push(`<path d="M${F(wx)} ${F(wy)} H${F(wx + 8)} M${F(wx)} ${F(wy + 5)} H${F(wx + 8)} M${F(wx + 4)} ${F(wy)} V${F(wy + 10)}" stroke="#ddd" stroke-width="0.6"/>`);
        } else {
          parts.push(`<rect x="${F(wx)}" y="${F(wy)}" width="8" height="10" fill="#3a3830" opacity="0.5" rx="1"/>`);
        }
      }
    }
  }

  // roof
  const rf = built.roofForm || "gable";
  const roofY = bodyY;
  if (built.roof === "tent" || rf === "conical") {
    parts.push(`<path d="M${F(bodyX - 6)} ${F(roofY)} L${F(bodyX + bodyW / 2)} ${F(y + 8)} L${F(bodyX + bodyW + 6)} ${F(roofY)} Z" fill="${shade(base, 0.82)}"/>`);
  } else if (rf === "dome" || built.roof === "flat") {
    parts.push(`<ellipse cx="${F(bodyX + bodyW / 2)}" cy="${F(roofY)}" rx="${F(bodyW / 2)}" ry="${F(bodyW * 0.22)}" fill="${shade(base, 0.82)}"/>`);
  } else {
    const peak = y + h * (built.roof === "steep" ? 0.06 : 0.12);
    parts.push(`<path d="M${F(bodyX - 4)} ${F(roofY)} L${F(bodyX + bodyW / 2)} ${F(peak)} L${F(bodyX + bodyW + 4)} ${F(roofY)} Z" fill="${shade(base, 0.88)}"/>`);
    if (rf === "hip") {
      parts.push(`<path d="M${F(bodyX + bodyW / 2)} ${F(peak)} L${F(bodyX + bodyW + 8)} ${F(roofY + 6)} L${F(bodyX + bodyW + 4)} ${F(roofY)} Z" fill="${shade(base, 0.72)}"/>`);
    }
  }

  // corner flare (taste)
  const flare = tasteBuilt?.cornerFlare;
  if (flare && flare !== "none" && built.roof !== "tent") {
    const lift = flare === "horn" ? 10 : flare === "upturned" ? 7 : 4;
    parts.push(`<path d="M${F(bodyX - 2)} ${F(roofY)} Q${F(bodyX - 8)} ${F(roofY - lift)} ${F(bodyX + 6)} ${F(roofY - 2)} Z" fill="${shade(base, 0.95)}"/>`);
    parts.push(`<path d="M${F(bodyX + bodyW + 2)} ${F(roofY)} Q${F(bodyX + bodyW + 8)} ${F(roofY - lift)} ${F(bodyX + bodyW - 6)} ${F(roofY - 2)} Z" fill="${shade(base, 0.95)}"/>`);
  }

  // sacred silhouette
  const sacred = built.sacredForm;
  if (sacred === "spire") {
    parts.push(`<path d="M${F(bodyX + bodyW / 2 - 3)} ${F(y + 14)} L${F(bodyX + bodyW / 2)} ${F(y + 2)} L${F(bodyX + bodyW / 2 + 3)} ${F(y + 14)} Z" fill="${rgb(trimAccent(tasteBuilt))}"/>`);
  } else if (sacred === "tier") {
    for (let i = 0; i < 3; i++) {
      const tw = 12 - i * 3;
      parts.push(`<rect x="${F(bodyX + bodyW / 2 - tw / 2)}" y="${F(y + 6 + i * 5)}" width="${tw}" height="4" fill="${rgb(trimAccent(tasteBuilt))}"/>`);
    }
  } else if (sacred === "minaret") {
    parts.push(`<rect x="${F(bodyX + bodyW - 10)}" y="${F(y + 4)}" width="6" height="18" fill="${rgb(trimAccent(tasteBuilt))}"/>`);
    parts.push(`<circle cx="${F(bodyX + bodyW - 7)}" cy="${F(y + 3)}" r="3" fill="${rgb(trimAccent(tasteBuilt))}"/>`);
  }

  // trim contrast
  if (tasteBuilt?.trim && tasteBuilt.trim !== "none") {
    parts.push(`<rect x="${F(bodyX)}" y="${F(bodyY + bodyH - 4)}" width="${F(bodyW)}" height="4" fill="${rgb(trimAccent(tasteBuilt))}"/>`);
  }

  return { defs: "", svg: parts.join("") };
}

function trimAccent(tasteBuilt) {
  const t = tasteBuilt?.trim;
  if (t === "dark") return [48, 42, 38];
  if (t === "light") return [228, 220, 200];
  if (t === "contrast") return [168, 58, 42];
  return [108, 88, 52];
}

/** Place one aesthetic card in a grid cell. */
export function drawAesthetic(aesthetic, x, y, cw, ch, label = "") {
  const inner = aestheticCardSVG(aesthetic, cw, ch);
  const cap = label ? `<text x="${F(x + cw / 2)}" y="${F(y + 12)}" text-anchor="middle" font-size="9" fill="#555" font-family="system-ui,sans-serif">${label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>` : "";
  return `<g transform="translate(${F(x)},${F(y)})">${cap}${inner}</g>`;
}

function aestheticCardSVG(aesthetic, w, h) {
  const look = aesthetic?.look;
  const dress = aesthetic?.dress;
  const built = aesthetic?.built;
  const taste = aesthetic?.taste || {};
  const faceCx = w * 0.28;
  const faceCy = h * 0.22;
  const scale = Math.min(w, h) / 120;
  const dressOut = dressSVG(dress, taste.dress, faceCx, faceCy + 18 * scale, scale);
  const builtOut = builtSVG(built, taste.built, w * 0.52, h * 0.12, w * 0.44, h * 0.82);
  const defs = [dressOut.defs, builtOut.defs].filter(Boolean).join("");
  const ground = `<rect x="0" y="0" width="${F(w)}" height="${F(h)}" fill="#f6f3ec" rx="6"/>`;
  const divider = `<line x1="${F(w * 0.5)}" y1="${F(16)}" x2="${F(w * 0.5)}" y2="${F(h - 8)}" stroke="#ddd" stroke-width="1"/>`;
  return `${defs ? `<defs>${defs}</defs>` : ""}${ground}${divider}${faceSVG(look, taste.dress, faceCx, faceCy, scale)}${dressOut.svg}${builtOut.svg}`;
}

/** Complete SVG document for one aesthetic phenotype. */
export function aestheticSVG(aesthetic, W = 160, H = 200) {
  const body = aestheticCardSVG(aesthetic, W, H);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>`;
}
