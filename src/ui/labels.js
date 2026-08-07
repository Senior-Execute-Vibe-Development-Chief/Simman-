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
  const nNamed = psw.countries.size + (psw._landNames ? psw._landNames.size : 0);
  if (cache && cache.ver === ver && cache.count === nNamed) return cache;
  const tw = psw.tw, th = psw.th;
  const cents = centroidOf(claim, tw, th);
  const prev = new Map();
  if (cache && cache.list) for (const p of cache.list) prev.set(p.id, p);
  const list = [];
  const pushAnchor = (id, name) => {
    const cent = cents.get(id);
    if (!cent || cent.area < 4) return;
    const a = snapToOwned(cent, id, claim, tw, th);
    const old = prev.get(id);
    let x = a.x, y = a.y;
    if (old) {
      // damp: ~1/4 of the way per refresh; snap only on a big jump (secession
      // moved the heartland) so stale anchors can't strand off-territory.
      let dx = x - old.x; if (dx > tw / 2) dx -= tw; if (dx < -tw / 2) dx += tw;
      const dy = y - old.y;
      if (Math.hypot(dx, dy) < tw * 0.06) { x = ((old.x + dx * 0.25) % tw + tw) % tw; y = old.y + dy * 0.25; }
    }
    list.push({ id, name, x, y, area: cent.area });
  };
  for (const c of psw.countries.values())
    pushAnchor(c.id, c.name || (c.capital && c.capital.name) || ("realm " + c.id));
  // T.STATE_OF_LAND: nations of the land have no psw.countries entry (no
  // settlements), but the claim grid carries their territory (worker fill)
  // and the snapshot ships id → name. Same anchor machinery, so a tribal
  // nation's name sits on its ground exactly like a realm's; when it
  // materialises the id enters psw.countries and this loop simply yields.
  if (psw._landNames) for (const [id, r] of psw._landNames) {
    if (psw.countries.has(id)) continue;
    pushAnchor(id, r.name || "a people");
  }
  list.sort((p, q2) => q2.area - p.area);
  return { ver, count: nNamed, list };
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
  // ALL sizing below is in FEATURE-CANVAS pixels — map units, exactly like
  // the settlement icons. Labels therefore scale WITH the displayed map: the
  // same proportion of the world on a 27" monitor and a phone. Nothing here
  // may depend on the window's CSS size (an earlier version sized in CSS px;
  // on a phone the whole world spans a few hundred of them, so every name
  // rendered enormous relative to the map and the grading collapsed).
  const { z, vx, vy, k } = view;
  const { TR, toScreenY } = proj;
  const { showRealms, showSettlements, emblemFor, selRealm, featW, featH } = opts;
  const collide = makeCollider();
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
      // Grade by the realm's share of the map width (a pure fraction × zoom),
      // then set type in CANVAS px: ~13 for minors → ~22 for continental
      // empires at world zoom, rising gently as you zoom (cap 30). On a 1920
      // feature canvas that is ~0.7–1.2% of the map's width — small map text
      // at every display size.
      const frac = (Math.sqrt(a.area) / (psw && psw.tw ? psw.tw : 960)) * z;
      const foot = Math.sqrt(a.area) * TR * z * k;     // canvas-px diameter (visibility gate)
      if (foot < 9) { dbg.push({ n: a.name, foot: foot | 0, r: "speck" }); continue; }
      let fs = (13 + Math.min(frac, 0.28) * 34) * (1 + (z - 1) * 0.18);
      fs = Math.min(Math.max(fs, 13), 30);
      // physical floor (small displays): keep names legible; collision below
      // thins the crowd, and zoom restores the full graded set.
      if (opts.minFs) fs = Math.max(fs, opts.minFs);
      const sel = a.id === selRealm;
      ctx.font = `${sel ? 700 : 600} ${fs}px Cinzel, Georgia, serif`;
      const name = a.name.toUpperCase();
      const w = ctx.measureText(name).width;
      // shields only beside names with room for them — minors stay quiet text
      const em = emblemFor && fs >= 16 ? emblemFor(a.id) : null;
      const emH = em ? fs * 1.05 : 0, emW = emH * 0.88;
      const totW = w + (em ? emW + 4 : 0);
      if (!collide.place(X - totW / 2 - 3, Y - fs * 0.75, totW + 6, fs * 1.5)) { dbg.push({ n: a.name, foot: foot | 0, r: "collide" }); continue; }
      dbg.push({ n: a.name, foot: foot | 0, fs: fs.toFixed(1), r: "drawn" });
      const tx = X + (em ? (emW + 4) / 2 : 0);
      // pale halo so the name reads on any tint, then ink
      ctx.lineJoin = "round";
      ctx.strokeStyle = sel ? "rgba(255,238,180,0.95)" : "rgba(236,222,186,0.78)";
      ctx.lineWidth = Math.max(1.8, fs * 0.12);
      ctx.strokeText(name, tx, Y);
      ctx.fillStyle = sel ? "#1d1206" : "rgba(43,26,10,0.92)";
      ctx.fillText(name, tx, Y);
      if (em && em.complete && em.naturalWidth) {
        ctx.drawImage(em, tx - w / 2 - emW - 4, Y - emH / 2, emW, emH);
      }
    }
    globalThis.__labelDebug = dbg;
  }

  // ── Settlement names: tier-gated by zoom; small caps under the icon.
  // Canvas-px sizes, like the icons — they scale with the map.
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
      let fs = s.tier >= 3 ? 19 : s.tier >= 2 ? 17.5 : 16;
      if (opts.minFs) fs = Math.max(fs, opts.minFs);
      ctx.font = `500 ${fs}px "Alegreya Sans", "Segoe UI", sans-serif`;
      const name = s.name.charAt(0).toUpperCase() + s.name.slice(1);
      const w = ctx.measureText(name).width;
      const ly = Y + 14 + fs * 0.5;
      if (!collide.place(X - w / 2 - 3, ly - fs * 0.7, w + 6, fs * 1.4)) continue;
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
