// ── Names on the map (plan §5.1) ────────────────────────────────────────────
//
// Realm labels are anchored at the (approximate) centre of each realm's
// claimed territory, computed from the claim grid the snapshot already ships
// (psw._countryClaim, one countryId per sim tile). Placement is cached and
// recomputed only when a new claim grid arrives (a render cadence, not a
// mechanic). Drawing is screen-space each frame: LOD by zoom, greedy
// collision culling by realm size, paper-halo text over any tint.
//
// Settlement labels are placed per frame from the visible settlements —
// cheap (a few hundred points) — and share the same collision field so city
// names never sit on top of realm names.

// circular mean over x (the map wraps east-west) via angle accumulation
function centroidOf(claim, tw, th) {
  // per-country accumulators: count, sin/cos of x-angle, sum y, plus the
  // single most "interior" run mid-point as a fallback anchor
  const acc = new Map();
  for (let ti = 0; ti < claim.length; ti++) {
    const c = claim[ti];
    if (c < 0) continue;
    let a = acc.get(c);
    if (!a) acc.set(c, a = { n: 0, sx: 0, cx: 0, sy: 0 });
    const y = (ti / tw) | 0, x = ti - y * tw;
    const ang = (x / tw) * Math.PI * 2;
    a.n++; a.sx += Math.sin(ang); a.cx += Math.cos(ang); a.sy += y;
  }
  const out = new Map();
  for (const [id, a] of acc) {
    const ang = Math.atan2(a.sx / a.n, a.cx / a.n);
    let x = (ang / (Math.PI * 2)) * tw; if (x < 0) x += tw;
    out.set(id, { x, y: a.sy / a.n, area: a.n });
  }
  return out;
}

// nudge an anchor onto owned ground: if the centroid tile isn't the realm's
// (a crescent-shaped realm), walk a small spiral for the nearest owned tile.
function snapToOwned(anchor, id, claim, tw, th) {
  const x0 = anchor.x | 0, y0 = Math.max(0, Math.min(th - 1, anchor.y | 0));
  if (claim[y0 * tw + ((x0 % tw) + tw) % tw] === id) return anchor;
  for (let r = 2; r <= 24; r += 2) {
    for (let dy = -r; dy <= r; dy += 2) {
      const y = y0 + dy; if (y < 0 || y >= th) continue;
      for (let dx = -r; dx <= r; dx += 2) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = (((x0 + dx) % tw) + tw) % tw;
        if (claim[y * tw + x] === id) return { ...anchor, x, y };
      }
    }
  }
  return anchor;
}

/**
 * Recompute realm label anchors if the claim grid changed (else return cache).
 * Returns [{id, name, x, y, area}] sorted by area desc — x/y in SIM tiles.
 *
 * Anchors are DAMPED against the previous placement: a claim refresh moves a
 * realm's centroid a little every few seconds, and a label that snaps to each
 * new centroid visibly jitters. Blending toward the new anchor keeps the name
 * planted while borders creep.
 */
export function realmLabelAnchors(psw, cache) {
  const claim = psw._countryClaim;
  if (!claim || !psw.countries) return cache && cache.list ? cache : { ver: -1, list: [] };
  const ver = psw._claimVer || 0;
  if (cache && cache.ver === ver && cache.count === psw.countries.size) return cache;
  const tw = psw.tw, th = psw.th;
  const cents = centroidOf(claim, tw, th);
  const prev = new Map();
  if (cache && cache.list) for (const p of cache.list) prev.set(p.id, p);
  const list = [];
  for (const c of psw.countries.values()) {
    const cent = cents.get(c.id);
    if (!cent || cent.area < 4) continue;
    const a = snapToOwned(cent, c.id, claim, tw, th);
    const name = c.name || (c.capital && c.capital.name) || ("realm " + c.id);
    const old = prev.get(c.id);
    let x = a.x, y = a.y;
    if (old) {
      // damp: ~1/4 of the way per refresh; snap only on a big jump (secession
      // moved the heartland) so stale anchors can't strand off-territory.
      let dx = x - old.x; if (dx > tw / 2) dx -= tw; if (dx < -tw / 2) dx += tw;
      const dy = y - old.y;
      if (Math.hypot(dx, dy) < tw * 0.06) { x = ((old.x + dx * 0.25) % tw + tw) % tw; y = old.y + dy * 0.25; }
    }
    list.push({ id: c.id, name, x, y, area: cent.area });
  }
  list.sort((p, q2) => q2.area - p.area);
  return { ver, count: psw.countries.size, list };
}

// ── screen-space drawing ────────────────────────────────────────────────────

function makeCollider() {
  const rects = [];
  return {
    place(x, y, w, h) {
      for (const r of rects)
        if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
      rects.push({ x, y, w, h });
      return true;
    },
  };
}

/**
 * Draw realm names (+ emblem shields) and settlement names onto the feature
 * canvas in DEVICE-INDEPENDENT screen space. Call with the ctx transform
 * RESET; all projection is done here.
 *
 * view: {z, vx, vy, k, pxScale} — pan/zoom (map-canvas units), feature scale
 *   _k, and pxScale = canvas px per CSS px (so font sizes land readable).
 * proj: {TR, toScreenY} — sim-tile → map-canvas projection helpers.
 */
export function drawMapLabels(ctx, psw, anchors, view, proj, opts) {
  const { z, vx, vy, k, pxScale } = view;
  const { TR, toScreenY } = proj;
  const { showRealms, showSettlements, emblemFor, selRealm, featW, featH } = opts;
  const collide = makeCollider();
  const px = (v) => v * pxScale;                       // CSS px → canvas px
  const mapX = (x) => (x * TR * z + vx) * k;           // sim tile → feature-canvas px
  const mapY = (y) => (toScreenY(y * TR) * z + vy) * k;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // ── Realm names: EVERY realm on screen gets one ────────────────────────
  // · Type sizes live in a TIGHT small band graded by the realm's own
  //   on-screen footprint — a continental empire reads a step larger than a
  //   duchy, never billboard-sized. Zooming in raises the ceiling gently.
  // · Names freely overflow small realms (this is a strategy map, not a
  //   purist atlas — completeness wins). Only a true dot of a realm
  //   (screen footprint under ~6px) waits for zoom.
  // · Collision is the ONLY other limiter: greedy by area, so big realms
  //   win contested ground and crowded minors yield until you zoom.
  if (showRealms && anchors && anchors.list.length) {
    const dbg = [];   // per-realm decision trace → globalThis.__labelDebug (cheap; QA reads it)
    for (const a of anchors.list) {
      const X = mapX(a.x), Y = mapY(a.y);
      if (X < -100 || X > featW + 100 || Y < -50 || Y > featH + 50) { dbg.push({ n: a.name, r: "offscreen" }); continue; }
      // the realm's rough on-screen diameter, in CSS px
      const footCss = (Math.sqrt(a.area) * TR * z * k) / pxScale;
      if (footCss < 6) { dbg.push({ n: a.name, foot: footCss | 0, r: "speck" }); continue; }
      let fsCss = 4 + footCss * 0.11;                // graded by footprint…
      fsCss = Math.min(fsCss, 13 + (z - 1) * 2.2);   // …under a low world-zoom ceiling
      fsCss = Math.min(Math.max(fsCss, 9.5), 17);
      const fs = px(fsCss);
      const sel = a.id === selRealm;
      ctx.font = `${sel ? 700 : 600} ${fs}px Cinzel, Georgia, serif`;
      const name = a.name.toUpperCase();
      const w = ctx.measureText(name).width;
      const em = emblemFor ? emblemFor(a.id) : null;
      const emH = em ? fs * 1.05 : 0, emW = emH * 0.88;
      const totW = w + (em ? emW + px(4) : 0);
      if (!collide.place(X - totW / 2 - px(2), Y - fs * 0.75, totW + px(4), fs * 1.5)) { dbg.push({ n: a.name, foot: footCss | 0, r: "collide" }); continue; }
      dbg.push({ n: a.name, foot: footCss | 0, fs: fsCss.toFixed(1), r: "drawn" });
      const tx = X + (em ? (emW + px(4)) / 2 : 0);
      // pale halo so the name reads on any tint, then ink
      ctx.lineJoin = "round";
      ctx.strokeStyle = sel ? "rgba(255,238,180,0.95)" : "rgba(236,222,186,0.78)";
      ctx.lineWidth = Math.max(1.8, fs * 0.12);
      ctx.strokeText(name, tx, Y);
      ctx.fillStyle = sel ? "#1d1206" : "rgba(43,26,10,0.92)";
      ctx.fillText(name, tx, Y);
      if (em && em.complete && em.naturalWidth) {
        ctx.drawImage(em, tx - w / 2 - emW - px(4), Y - emH / 2, emW, emH);
      }
    }
    globalThis.__labelDebug = dbg;
  }

  // ── Settlement names: tier-gated by zoom; small caps under the icon.
  if (showSettlements && psw && psw.settlements) {
    const minTier = z < 1.6 ? 3 : z < 2.6 ? 2 : z < 4.2 ? 1 : 0;
    const capIds = opts.capitalIds;
    const rows = [];
    for (const s of psw.settlements) {
      if (!s || s.mode !== "settled") continue;
      const tier = s.tier | 0;
      const isCap = capIds && capIds.has(s.id);
      if (tier < minTier && !(isCap && z >= 1.6)) continue;
      const X = mapX(s.pos.x), Y = mapY(s.pos.y);
      if (X < -40 || X > featW + 40 || Y < -20 || Y > featH + 20) continue;
      rows.push({ s, X, Y, pri: (isCap ? 10 : 0) + tier + Math.min(0.9, (s.people || 0) / 5000) });
    }
    rows.sort((a, b) => b.pri - a.pri);
    for (const { s, X, Y } of rows) {
      const fs = px(s.tier >= 3 ? 12.5 : s.tier >= 2 ? 11.5 : 10.5);
      ctx.font = `500 ${fs}px "Alegreya Sans", "Segoe UI", sans-serif`;
      const name = s.name.charAt(0).toUpperCase() + s.name.slice(1);
      const w = ctx.measureText(name).width;
      const ly = Y + px(9) + fs * 0.5;
      if (!collide.place(X - w / 2 - px(2), ly - fs * 0.7, w + px(4), fs * 1.4)) continue;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(236,222,186,0.85)";
      ctx.lineWidth = Math.max(1.6, fs * 0.16);
      ctx.strokeText(name, X, ly);
      ctx.fillStyle = s.id === opts.selSettlement ? "#1d1206" : "rgba(48,30,12,0.92)";
      ctx.fillText(name, X, ly);
    }
  }

  ctx.restore();
}
