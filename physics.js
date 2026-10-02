/* Golf physics + course generation. Units: yards, seconds. x = downrange (tee -> pin), z = lateral (+ = golfer's right), y = up. */
(function (root) {
  'use strict';

  const G = 10.73;          // gravity, yd/s^2
  const KD = 0.0043;        // drag coefficient
  const KL = 0.0030;        // lift coefficient
  const MPH = 0.488;        // mph -> yd/s
  const WIND_SCALE = 0.6;   // tone the wind down a little for playability
  const LIP = 2;            // bunker wall height (yd) a ball must get over to leave the sand
  const OB = 55;            // out of bounds beyond |z| > OB
  const GREEN_R = 24;  // greens are ~1.7x bigger than before
  // speed multipliers giving a chunk -75% and a top -85% of the shot's distance (calibrated on a flat fairway)
  const MISHIT_K = { chunk: 0.443, top: 0.56, chunkBy: {DR:0.426,'3W':0.437,'5W':0.441,'4I':0.44,'5I':0.441,'6I':0.445,'7I':0.446,'8I':0.444,'9I':0.443,PW:0.444,GW:0.447,SW:0.455,LW:0.468}, topBy: {DR:0.429,'3W':0.46,'5W':0.492,'4I':0.517,'5I':0.542,'6I':0.566,'7I':0.587,'8I':0.605,'9I':0.616,PW:0.615,GW:0.615,SW:0.623,LW:0.633} };
  const CUP_R = 0.2;   // forgiving cup

  // v = full-power ball speed (yd/s), ang = launch angle (deg), spin = fraction of ground speed lost on first bounce,
  // acc = accuracy sensitivity, rise = seconds for the power bar to fill
  const CLUBS = [
    { id: 'DR', name: 'Driver',        v: 85.25, ang: 11.97, spin: 0.10, acc: 1.10, rise: 1.5 },
    { id: '3W', name: '3 Wood',        v: 72.65, ang: 12.62,   spin: 0.14, acc: 1.05, rise: 1.5 },
    { id: '5W', name: '5 Wood',        v: 65.81,   ang: 14.21,   spin: 0.18, acc: 1.00, rise: 1.5 },
    { id: '4I', name: '4 Iron',        v: 61.4, ang: 15.88, spin: 0.22, acc: 0.95, rise: 1.5 },
    { id: '5I', name: '5 Iron',        v: 57.3,   ang: 17.5, spin: 0.26, acc: 0.92, rise: 1.5 },
    { id: '6I', name: '6 Iron',        v: 53.5, ang: 18.45, spin: 0.30, acc: 0.90, rise: 1.5 },
    { id: '7I', name: '7 Iron',        v: 50.75,   ang: 19.58, spin: 0.34, acc: 0.88, rise: 1.5 },
    { id: '8I', name: '8 Iron',        v: 46.7, ang: 24,   spin: 0.38, acc: 0.85, rise: 1.5 },
    { id: '9I', name: '9 Iron',        v: 44.05,   ang: 26.61,   spin: 0.42, acc: 0.82, rise: 1.5 },
    { id: 'PW', name: 'Pitching Wedge',v: 41,   ang: 31.63,   spin: 0.46, acc: 0.80, rise: 1.5 },
    { id: 'GW', name: 'Gap Wedge',     v: 38.45,   ang: 35.3,   spin: 0.50, acc: 0.78, rise: 1.5 },
    { id: 'SW', name: 'Sand Wedge',    v: 34.9,   ang: 37.8,   spin: 0.54, acc: 0.76, rise: 1.5 },
    { id: 'LW', name: 'Lob Wedge',     v: 30,   ang: 41.47,   spin: 0.58, acc: 0.74, rise: 1.5 },
    { id: 'PT', name: 'Putter',        v: 9.6,  ang: 0,    spin: 0,    acc: 0.3, rise: 2.4, putter: true },
  ];

  // e = bounce restitution, ret = tangential speed kept on a bounce, f = rolling decel (yd/s^2),
  // K/tau = extra "skid" friction right after landing from the air
  const SURF = {
    tee:     { e: 0.42, ret: 0.64, f: 2.2, K: 3.0, tau: 1.6 },
    fairway: { e: 0.42, ret: 0.64, f: 2.2, K: 3.0, tau: 1.6 },
    rough:   { e: 0,    ret: 0.15, f: 8.0, K: 1.0, tau: 1.0 },   // ball plugs: no bounce
    sand:    { e: 0,    ret: 0.06, f: 24,  K: 0,   tau: 1 },
    green:   { e: 0.30, ret: 0.50, f: 0.9, K: 9.0, tau: 1.8 },
  };

  const WEDGES = { PW: 1, GW: 1, SW: 1, LW: 1 };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smooth(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

  // Rough, bunkers and non-tee driver shots cost real speed (distance ~ speed^2)
  function strike(club, lie) {
    if (club.putter) return { speed: lie === 'green' ? 1 : 0.9, err: 1 };
    let speed = 1;
    if (lie === 'rough') speed = 0.86;
    else if (lie === 'sand') speed = WEDGES[club.id] ? 0.85 : 0.6;
    if (club.id === 'DR' && lie !== 'tee') speed *= lie === 'rough' ? 0.85 : 0.93;
    return { speed, err: 1 };
  }

  const TREE_TYPES = {
    round:   { rx: 0.22, ry: 0.32, cy: 0.65, rt: 0.045 },
    oak:     { rx: 0.30, ry: 0.25, cy: 0.62, rt: 0.065 },   // wide and lumpy
    pine:    { rx: 0.15, ry: 0.38, cy: 0.55, rt: 0.035 },   // tall tiered conifer
    cypress: { rx: 0.10, ry: 0.42, cy: 0.55, rt: 0.030 },   // slim column
    birch:   { rx: 0.18, ry: 0.30, cy: 0.68, rt: 0.035 },   // pale trunk, light canopy
  };
  const pickTreeType = (r) => { const u = r(); return u < 0.28 ? 'round' : u < 0.5 ? 'oak' : u < 0.75 ? 'pine' : u < 0.85 ? 'cypress' : 'birch'; };

  function makeHole(par, rnd) {
    rnd = rnd || Math.random;
    const R = (lo, hi) => lo + (hi - lo) * rnd();
    const total = Math.round(par === 3 ? R(125, 205) : par === 4 ? R(320, 440) : R(480, 570));

    // ---- layout: tee at (0,0) playing +x; at most ONE bend of 45..135 degrees (left or right) at 'corner'
    const bendy = par > 3 && rnd() < 0.5;      // half of the par 4s and 5s bend (par 3s stay straight)
    const sign = rnd() < 0.5 ? -1 : 1;                       // + = turns right (+z), - = turns left
    const deflect = bendy ? (rnd() < 0.75 ? R(45, 90) : R(90, 135)) : 0;   // mostly gentle-to-moderate bends; sharp ones (90-135) are the exception                   // degrees the hole turns at the corner
    const th = sign * deflect * Math.PI / 180;
    const L1 = bendy ? Math.round(total * R(0.5, 0.62)) : total, L2 = total - L1;
    const u2 = { x: Math.cos(th), z: Math.sin(th) };
    const gcx = bendy ? L1 + L2 * u2.x : total, gcz = bendy ? L2 * u2.z : 0;   // green centre = end of the centre line
    const pts = [{ x: 0, z: 0 }];
    if (bendy) pts.push({ x: L1, z: 0 });
    pts.push({ x: gcx, z: gcz });
    const segs = []; let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1], len = Math.hypot(B.x - A.x, B.z - A.z);
      segs.push({ a: A, ux: (B.x - A.x) / len, uz: (B.z - A.z) / len, len, s0: acc }); acc += len;
    }
    // nearest point on the hole's centre line: distance, position along it (s) and side (+ = right)
    const pathDist = (x, z) => {
      let best = null;
      for (const sg of segs) {
        const t = clamp((x - sg.a.x) * sg.ux + (z - sg.a.z) * sg.uz, 0, sg.len);
        const px = sg.a.x + sg.ux * t, pz = sg.a.z + sg.uz * t, d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) best = { d, s: sg.s0 + t, lat: (x - px) * -sg.uz + (z - pz) * sg.ux };
      }
      return best;
    };
    const pointAt = (s) => {
      s = clamp(s, 0, acc);
      for (const sg of segs) if (s <= sg.s0 + sg.len + 1e-6) { const t = s - sg.s0; return { x: sg.a.x + sg.ux * t, z: sg.a.z + sg.uz * t, ux: sg.ux, uz: sg.uz }; }
      const sg = segs[segs.length - 1]; return { x: gcx, z: gcz, ux: sg.ux, uz: sg.uz };
    };

    // ---- green outline: a rounded blob (ovals, kidneys, lobes) rather than a circle, radius varies with angle
    const gs = { a2: R(0.08, 0.2), p2: R(0, 6.28), a3: R(0.04, 0.1), p3: R(0, 6.28), a5: R(0.02, 0.05), p5: R(0, 6.28) };
    const shapeR = (t) => GREEN_R * (1 + gs.a2 * Math.cos(2 * t + gs.p2) + gs.a3 * Math.cos(3 * t + gs.p3) + gs.a5 * Math.cos(5 * t + gs.p5));
    const edge = [];
    for (let i = 0; i < 120; i++) { const t = i / 120 * Math.PI * 2, r = shapeR(t); edge.push({ x: gcx + Math.cos(t) * r, z: gcz + Math.sin(t) * r }); }
    let greenMax = 0; for (let i = 0; i < 120; i++) greenMax = Math.max(greenMax, shapeR(i / 120 * Math.PI * 2));
    const edgeDist = (x, z) => { let m = 1e9; for (const e of edge) m = Math.min(m, Math.hypot(x - e.x, z - e.z)); return m; };
    const inGreen = (x, z) => { const dx = x - gcx, dz = z - gcz; return Math.hypot(dx, dz) <= shapeR(Math.atan2(dz, dx)); };
    // the flag can sit anywhere on the green provided it is at least 5 ft (1.67 yd; we use 2.2) from the edge
    let pinX = gcx, pinZ = gcz;
    for (let tries = 0; tries < 60; tries++) {
      const t = R(0, Math.PI * 2), rho = Math.sqrt(rnd()) * (shapeR(t) - 2), x = gcx + Math.cos(t) * rho, z = gcz + Math.sin(t) * rho;
      if (inGreen(x, z) && edgeDist(x, z) >= 2.2) { pinX = x; pinZ = z; break; }
    }

    // ---- terrain: one gentle uphill/downhill tilt along x, plus a faint ripple; green flattened to a plane
    const g = (rnd() < 0.5 ? -1 : 1) * R(0.012, 0.035);
    // rolling topology: a few crossed waves give mounds and hollows with side slopes in every direction
    const waves = [];
    for (let i = 0; i < 3; i++) {
      const wl = R(80, 160), ang = R(0, Math.PI * 2);
      waves.push({ kx: Math.cos(ang) * 2 * Math.PI / wl, kz: Math.sin(ang) * 2 * Math.PI / wl, A: R(0.6, 1.1) / (1 + 0.5 * i), ph: R(0, 6.28) });
    }
    const sg = R(-0.03, 0.03);       // green slope along x
    const sz = R(-0.025, 0.025);     // green slope sideways (+ = rises to the right => ball breaks left)
    const mountains = [];   // filled in below, only on some doglegs
    const raw = (x, z) => {
      let y = g * Math.max(x, 0) + smooth(Math.hypot(x, z) / 40) * waves.reduce((sum, w) => sum + w.A * Math.sin(w.kx * x + w.kz * z + w.ph), 0);
      for (const m of mountains) { const d = Math.hypot(x - m.x, z - m.z); if (d < m.R) { const u = 1 - (d / m.R) * (d / m.R); y += m.A * u * u; } }
      return y;
    };
    const rawPin = raw(gcx, gcz);
    const bumps = [];
    for (let i = 0, nb = 2 + Math.floor(rnd() * 3); i < nb; i++) {
      const a = R(0, Math.PI * 2), r = R(5, GREEN_R * 0.85);
      bumps.push({ x: gcx + Math.cos(a) * r, z: gcz + Math.sin(a) * r, A: (rnd() < 0.5 ? -1 : 1) * R(0.3, 0.7), s2: 2 * Math.pow(R(5, 9), 2) });
    }
    const greenH = (x, z) => rawPin + sg * (x - gcx) + sz * (z - gcz) + bumps.reduce((sum, b) => sum + b.A * Math.exp(-((x - b.x) ** 2 + (z - b.z) ** 2) / b.s2), 0);

    const mph = Math.pow(rnd(), 1.4) * 19;
    const dir = R(0, Math.PI * 2);   // direction the wind blows toward, 0 = tailwind
    const wind = { mph, dir, x: Math.cos(dir) * mph * MPH * WIND_SCALE, z: Math.sin(dir) * mph * MPH * WIND_SCALE };

    // ---- hazards
    // ---- water: irregular ponds (no rivers). Par 3s and 4s get a greenside pond or one beside the landing area; par 5s
    // usually play around a pond (a big lake beside the second-shot zone, or one guarding the green), so you have to choose a line.
    const waters = [];
    const makePond = (cx, cz, aa, bb, rot) => {
      const h2 = R(0.06, 0.16), h3 = R(0.04, 0.11), h4 = R(0.02, 0.06), p2 = R(0, 6.28), p3 = R(0, 6.28), p4 = R(0, 6.28), pts = [];
      for (let i = 0; i < 40; i++) {
        const t = i / 40 * Math.PI * 2, k = Math.max(0.5, 1 + h2 * Math.cos(2 * t + p2) + h3 * Math.cos(3 * t + p3) + h4 * Math.cos(4 * t + p4));
        const lx = Math.cos(t) * aa * k, lz = Math.sin(t) * bb * k;
        pts.push({ x: cx + lx * Math.cos(rot) - lz * Math.sin(rot), z: cz + lx * Math.sin(rot) + lz * Math.cos(rot) });
      }
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, mx = 0, mz = 0;
      for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); mx += q.x; mz += q.z; }
      mx /= pts.length; mz /= pts.length;
      let r = 0; for (const q of pts) r = Math.max(r, Math.hypot(q.x - mx, q.z - mz));
      const inside = (x, z) => {
        let on = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const A = pts[i], B = pts[j];
          if ((A.z > z) !== (B.z > z) && x < (B.x - A.x) * (z - A.z) / (B.z - A.z) + A.x) on = !on;
        }
        return on;
      };
      const contains = (x, z, m) => {
        m = m || 0;
        if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) return false;
        if (inside(x, z)) return true;
        if (m <= 0) return false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {     // within m of the shore
          const A = pts[j], B = pts[i], dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / l2));
          if (Math.hypot(x - (A.x + dx * t), z - (A.z + dz * t)) <= m) return true;
        }
        return false;
      };
      return { pts, cx: mx, cz: mz, r, x0, x1, z0, z1, contains };
    };
    // a pond is acceptable if it stays off the centre line, off the green and the tee, and inside the out-of-bounds stakes
    const pondOK = (w, clear) => w.pts.every(q => {
      const pd = pathDist(q.x, q.z);
      return pd.d >= clear && pd.d <= OB - 3 && Math.hypot(q.x - gcx, q.z - gcz) >= shapeR(Math.atan2(q.z - gcz, q.x - gcx)) + 8 && (q.x > 14 || Math.abs(q.z) > 18);
    });
    const tryPond = (gen, clear) => { for (let t = 0; t < 40; t++) { const w = gen(); if (pondOK(w, clear)) return w; } return null; };
    const sideOf = () => (rnd() < 0.5 ? -1 : 1);
    // beside the green: on one flank or a little short of it, leaving a clear way in along the hole
    const greenPond = () => tryPond(() => {
      const end = pointAt(total), ang = Math.atan2(end.uz, end.ux) + (rnd() < 0.5 ? -1 : 1) * R(1.15, 2.6), rr = R(11, 17), aa = rr * R(1.0, 1.5), bb = rr;
      const d = shapeR(ang) + R(4, 8) + Math.max(aa, bb) * 0.85;
      return makePond(gcx + Math.cos(ang) * d, gcz + Math.sin(ang) * d, aa, bb, R(0, 3.14));
    }, 6);
    // beside the landing area / second-shot zone: the near edge eats into the side of the fairway
    const fairwayPond = (sLo, sHi, big) => tryPond(() => {
      const s = clamp(R(sLo, sHi), 90, total - (GREEN_R + 25)), c = pointAt(s), side = sideOf(), rr = big ? R(22, 32) : R(15, 22), aa = rr * R(1.0, 1.4), bb = rr;
      const lat = side * (bb + R(4, 10)), nx = -c.uz, nz = c.ux;
      return makePond(c.x + nx * lat, c.z + nz * lat, aa, bb, Math.atan2(c.uz, c.ux) + R(-0.4, 0.4));
    }, 4.5);
    let pond = null;
    if (par === 3) { if (rnd() < 0.6) pond = greenPond(); }
    else if (par === 4) { const u = rnd(); if (u < 0.3) pond = greenPond(); else if (u < 0.6) pond = fairwayPond(total * 0.4, total * 0.68, false); }
    else {
      const u = rnd();
      if (u < 0.5) pond = fairwayPond(total - 140, total - 85, true);      // a lake to play around on the second shot
      else if (u < 0.85) pond = greenPond();
      if (pond && rnd() < 0.3) { const p2 = rnd() < 0.5 ? greenPond() : fairwayPond(total * 0.3, total * 0.45, false); if (p2 && !p2.pts.some(q => pond.contains(q.x, q.z, 10))) waters.push(p2); }
    }
    if (pond) waters.push(pond);
    const inWaterZone = (x, z, m) => waters.some(w => w.contains(x, z, m));
    // ---- bunkers: varied polygon shapes (ovals, long fairway bunkers, kidneys, clovers, crescents that wrap the green),
    // placed with clearance checks so they never overlap the green, the tee, water or each other
    const sands = [];
    const angDiff = (u, v) => Math.atan2(Math.sin(u - v), Math.cos(u - v));
    const polyContains = (pts, x, z) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const A = pts[i], B = pts[j];
        if ((A.z > z) !== (B.z > z) && x < (B.x - A.x) * (z - A.z) / (B.z - A.z) + A.x) inside = !inside;
      }
      return inside;
    };
    const makeBunker = (pts, kind) => {
      let cx = 0, cz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const q of pts) { cx += q.x; cz += q.z; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
      cx /= pts.length; cz /= pts.length;
      let r = 0; for (const q of pts) r = Math.max(r, Math.hypot(q.x - cx, q.z - cz));
      return { pts, kind, cx, cz, r, contains: (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && polyContains(pts, x, z) };
    };
    // a lumpy blob: elliptical base (a x b, rotated) with a few harmonics, optionally with a dent (kidney)
    const blob = (cx, cz, aa, bb, rot, o) => {
      o = o || {};
      const h2 = R(0.05, 0.16), h3 = o.h3 !== undefined ? o.h3 : R(0.03, 0.1), h4 = R(0.02, 0.06), p2 = R(0, 6.28), p3 = R(0, 6.28), p4 = R(0, 6.28), dentA = R(0, 6.28);
      const pts = [];
      for (let i = 0; i < 44; i++) {
        const t = i / 44 * Math.PI * 2;
        let k = 1 + h2 * Math.cos(2 * t + p2) + h3 * Math.cos(3 * t + p3) + h4 * Math.cos(4 * t + p4);
        if (o.dent) k -= o.dent * Math.exp(-Math.pow(angDiff(t, dentA) / 0.55, 2));
        k = Math.max(0.4, k);
        const lx = Math.cos(t) * aa * k, lz = Math.sin(t) * bb * k;
        pts.push({ x: cx + lx * Math.cos(rot) - lz * Math.sin(rot), z: cz + lx * Math.sin(rot) + lz * Math.cos(rot) });
      }
      return pts;
    };
    // a crescent that wraps around the green edge (thickness tapers to a point at both ends)
    const crescent = (centerA, span, gap, thick) => {
      const outer = [], inner = [];
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, t = centerA - span / 2 + span * u, rIn = shapeR(t) + gap, rOut = rIn + thick * Math.pow(Math.sin(Math.PI * u), 0.7) + 0.01;
        outer.push({ x: gcx + Math.cos(t) * rOut, z: gcz + Math.sin(t) * rOut });
        inner.push({ x: gcx + Math.cos(t) * rIn, z: gcz + Math.sin(t) * rIn });
      }
      return outer.concat(inner.reverse());
    };
    const okBunker = (bk, fairway) => {
      for (const q of bk.pts) {
        const dg = Math.hypot(q.x - gcx, q.z - gcz);
        if (dg < shapeR(Math.atan2(q.z - gcz, q.x - gcx)) + 3.2) return false;         // stays clear of the green + fringe
        if (inWaterZone(q.x, q.z, 3)) return false;                                     // and of water
        if (q.x < 28 && Math.abs(q.z) < 22) return false;                                // and the tee
        const pd = pathDist(q.x, q.z).d;
        if (pd > 48) return false;                                                       // stays in bounds
        if (fairway && pd < 11) return false;                                            // fairway bunkers flank the fairway, not the middle
      }
      for (const o of sands) {
        if (Math.hypot(bk.cx - o.cx, bk.cz - o.cz) < (bk.r + o.r) * 0.85) return false;
        for (const q of bk.pts) if (o.contains(q.x, q.z)) return false;
        for (const q of o.pts) if (bk.contains(q.x, q.z)) return false;
      }
      return true;
    };
    const place = (build, fairway, kind) => {
      for (let tries = 0; tries < 14; tries++) { const bk = makeBunker(build(), kind); if (okBunker(bk, fairway)) { sands.push(bk); return true; } }
      return false;
    };
    // fairway bunkers: hug the fairway edge; long, oval, kidney or clover shaped
    const fwBunker = (s) => {
      const kinds = ['long', 'oval', 'kidney', 'clover'], kind = kinds[Math.floor(rnd() * kinds.length)];
      place(() => {
        const c = pointAt(s + R(-12, 12)), side = rnd() < 0.5 ? -1 : 1, rot = Math.atan2(c.uz, c.ux);
        const aa = kind === 'long' ? R(13, 19) : R(8, 12), bb = kind === 'long' ? R(3.8, 5.2) : R(5, 8);
        const off = side * (16 + bb * R(0.5, 1.0) + R(0, 4));
        const cx = c.x - c.uz * off, cz = c.z + c.ux * off;
        return blob(cx, cz, aa, bb, kind === 'long' ? rot : rot + R(-0.6, 0.6), kind === 'kidney' ? { dent: 0.4 } : kind === 'clover' ? { h3: R(0.2, 0.3) } : {});
      }, true, kind);
    };
    if (par > 3) fwBunker(clamp(R(200, 255), 0.4 * L1, 0.85 * L1));
    if (par === 5) fwBunker(bendy ? L1 + L2 * R(0.35, 0.6) : total * R(0.55, 0.65));
    if (par > 3 && rnd() < 0.45) fwBunker(clamp(R(150, 300), 0.3 * L1, 0.9 * L1));
    // greenside bunkers: crescents hugging the edge and pot/kidney bunkers, on different sides
    const ue = segs[segs.length - 1], frontA = Math.atan2(-ue.uz, -ue.ux), nGreen = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < nGreen; i++) {
      const side = i % 2 === 0 ? -1 : 1, crescentKind = rnd() < 0.5;
      place(() => {
        const al = frontA + side * R(0.35, 1.7) + (i === 2 ? Math.PI * side * R(0.5, 0.9) : 0);
        if (crescentKind) return crescent(al, R(1.3, 2.3), R(3.8, 5.5), R(7, 12));
        const bb = R(4.5, 7.5), aa = R(7, 12), gap = R(3.8, 6.5), d = shapeR(al) + gap + bb;
        return blob(gcx + Math.cos(al) * d, gcz + Math.sin(al) * d, aa, bb, al + Math.PI / 2 + R(-0.4, 0.4), rnd() < 0.4 ? { dent: 0.35 } : {});
      }, false, crescentKind ? 'crescent' : 'pot');
    }
    const trees = [];
    for (let s = 12, i = 0; s < total + 30; s += R(14, 34), i++) {
      const c = pointAt(s), off = (i % 2 ? 1 : -1) * (24 + rnd() * 26);
      trees.push({ x: c.x - c.uz * off, z: c.z + c.ux * off, size: R(6, 13), shade: rnd(), type: pickTreeType(rnd) });
    }

    // ---- on SOME doglegs (more often the sharp ones, where the green is within easy reach) put a wall of tall trees or
    // a mountain across the corner shortcut
    if (bendy) {
      const D = Math.hypot(pinX, pinZ), cu = { x: pinX / D, z: pinZ / D }, cn = { x: -cu.z, z: cu.x };
      const wantBlock = rnd() < (D < 320 ? 0.85 : 0.35);
      let kind = wantBlock ? (rnd() < 0.35 ? 'mountain' : 'woods') : null;
      const clearOfBunkers = (x, z, m) => sands.every(s => Math.hypot(x - s.cx, z - s.cz) > s.r + m);
      if (kind === 'mountain') {
        let done = false;
        for (let tries = 0; tries < 50 && !done; tries++) {
          const f = R(0.28, 0.75), Rm = R(24, 40), cx = cu.x * D * f, cz = cu.z * D * f;
          if (pathDist(cx, cz).d >= Rm * 0.9 + 14 && Math.hypot(cx - gcx, cz - gcz) >= Rm + 42 && Math.hypot(cx, cz) >= Rm + 35 &&
              !inWaterZone(cx, cz, Rm) && clearOfBunkers(cx, cz, Rm * 0.9)) {
            mountains.push({ x: cx, z: cz, R: Rm, A: R(14, 26) }); done = true;
          }
        }
        if (!done) kind = 'woods';
      }
      if (kind === 'woods') {
        // try several spots along the shortcut until a decent-sized wood fits without touching the fairway
        for (let spot = 0; spot < 14; spot++) {
          const f = R(0.28, 0.75), cx = cu.x * D * f, cz = cu.z * D * f, want = Math.round(R(12, 20)), placed = [];
          for (let tries = 0; tries < want * 8 && placed.length < want; tries++) {
            const al = R(-10, 10), ac = R(-20, 20), x = cx + cu.x * al + cn.x * ac, z = cz + cu.z * al + cn.z * ac, pd = pathDist(x, z).d;
            if (pd < 20 || pd > 48 || inWaterZone(x, z, 3) || !clearOfBunkers(x, z, 3)) continue;
            if (Math.hypot(x - gcx, z - gcz) < shapeR(Math.atan2(z - gcz, x - gcx)) + 10) continue;
            if (placed.some(q => Math.hypot(q.x - x, q.z - z) < 4.2)) continue;
            placed.push({ x, z, size: R(15, 22), shade: rnd(), block: true, type: ['pine', 'oak', 'round', 'pine', 'cypress'][Math.floor(rnd() * 5)] });
          }
          if (placed.length >= 7) { for (const q of placed) trees.push(q); break; }
        }
      }
    }

    // ---- about a quarter of the holes are tree-lined: a row of trees runs down each side of the fairway
    if (rnd() < 0.25) {
      const clearOfSand = (x, z, m) => sands.every(s => Math.hypot(x - s.cx, z - s.cz) > s.r + m);
      for (const side of [-1, 1]) {
        for (let s = R(18, 26); s < total - 10; s += R(6, 11)) {
          const c = pointAt(s), off = side * R(20, 27), x = c.x - c.uz * off + R(-1.5, 1.5), z = c.z + c.ux * off + R(-1.5, 1.5);
          if (pathDist(x, z).d < 19 || inWaterZone(x, z, 3) || !clearOfSand(x, z, 3)) continue;
          if (Math.hypot(x - gcx, z - gcz) < shapeR(Math.atan2(z - gcz, x - gcx)) + 8) continue;
          if (trees.some(q => Math.hypot(q.x - x, q.z - z) < 5)) continue;
          trees.push({ x, z, size: R(9, 15), shade: rnd(), type: pickTreeType(rnd), lined: true });
        }
      }
    }

    const hole = {
      par, len: total, yards: total, pinX, pinZ, gcx, gcz, greenR: GREEN_R, greenMax, shapeR, inGreen, wind, sg, sz, waters, sands, trees,
      mountains, bend: sign * deflect, corner: bendy ? { x: L1, z: 0 } : null, L1, L2, deflect, pts, pathDist, pointAt,
      // height at (x,z): rolling terrain, blended into a flat tilted plane over the green
      h(x, z) {
        z = z || 0;
        const dx = x - gcx, dz = z - gcz, w = 1 - smooth((Math.hypot(dx, dz) - (shapeR(Math.atan2(dz, dx)) - 2)) / 12);
        return (1 - w) * raw(x, z) + w * greenH(x, z);
      },
      grad(x, z) { z = z || 0; return { gx: (hole.h(x + 0.25, z) - hole.h(x - 0.25, z)) / 0.5, gz: (hole.h(x, z + 0.25) - hole.h(x, z - 0.25)) / 0.5 }; },
      slope(x, z) { return hole.grad(x, z).gx; },
      surface(x, z) {
        if (inGreen(x, z)) return 'green';
        if (inWaterZone(x, z, 0)) return 'water';
        for (const s of hole.sands) if (s.contains(x, z)) return 'sand';
        if (x < 6 && x > -6 && Math.abs(z) < 7) return 'tee';
        if (x > -2 && pathDist(x, z).d <= 16) return 'fairway';
        return 'rough';
      },
    };
    hole.dh = hole.h(pinX, pinZ) - hole.h(0, 0);
    // tree collision geometry: a thin trunk, and a leafy canopy ellipsoid around the upper trunk
    const cell = 16, grid = new Map();
    for (const t of trees) {
      t.H = 1.3 * t.size; t.gy = hole.h(t.x, t.z);
      const tt = TREE_TYPES[t.type] || TREE_TYPES.round;
      t.rx = tt.rx * t.H; t.ry = tt.ry * t.H; t.cy = t.gy + tt.cy * t.H; t.rt = tt.rt * t.H; t.trunkTop = t.gy + 0.95 * t.H;
      const key = Math.floor(t.x / cell) + ',' + Math.floor(t.z / cell);
      (grid.get(key) || grid.set(key, []).get(key)).push(t);
    }
    hole.treesNear = (x, z) => {
      const ix = Math.floor(x / cell), iz = Math.floor(z / cell), out = [];
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = grid.get((ix + i) + ',' + (iz + j)); if (l) for (const t of l) out.push(t); }
      return out;
    };
    return hole;
  }

  /**
   * Simulate one stroke.
   * s = {x, z}, o = {club, power 0..1, az (rad, absolute), err (rad), lie, dt, hint}
   * Returns {path:[[x,y,z]...], end:{x,z,type}, carry, apex}
   */
  function simulate(hole, s, o) {
    // 'free': the flight as if there were no trees or mountains (used for the blue tracer, which shows the pure carry)
    if (o.free && hole.mountains && hole.mountains.length) {
      const saved = hole.mountains.splice(0);
      try { return simulate(hole, s, Object.assign({}, o, { free: false, noTrees: true })); } finally { hole.mountains.push(...saved); }
    }
    if (o.free) o = Object.assign({}, o, { free: false, noTrees: true });
    const club = o.club, dt = o.dt || 1 / 120;
    const st = strike(club, o.lie);
    let dirA = o.az + (o.err || 0);
    let x = s.x, z = s.z, y = hole.h(x, z);
    // ---- sloped lie: slope along the shot changes the launch, side slope pushes/pulls the ball
    let lieUp = 0, lieDir = 0;
    if (!club.putter) {
      const g0 = hole.grad(x, z), ux0 = Math.cos(dirA), uz0 = Math.sin(dirA);
      const along = g0.gx * ux0 + g0.gz * uz0;        // > 0: ball is on an upslope (ground rises toward the target)
      const across = g0.gx * -uz0 + g0.gz * ux0;      // > 0: ground rises to the golfer's right (ball above feet)
      lieUp = Math.atan(along) * 0.9;                 // rad: uphill = higher launch, downhill = lower
      lieDir = -Math.atan(across) * 0.8;              // ball above feet pulls left, below feet pushes right
      dirA += lieDir;
    }
    let vx, vy, vz;
    let air = !club.putter;
    let rollAge = 0, fromAir = false, bounces = 0;
    const path = [[x, y, z]];
    let carry = null, apex = y, type = 'rest';
    const treeInfo = { leaf: false, trunk: false }, uMap = new Map(), rng = o.rng || Math.random;
    let nearKey = '', near = [];
    // putter: speed ~ power (distance ~ power^2) so short putts get more of the bar; full shots: distance ~ power
    let speed = club.v * (club.putter ? Math.max(o.power, 0) : Math.sqrt(Math.max(o.power, 0))) * st.speed;
    if (o.mishit && !club.putter) speed *= o.mishit.k !== undefined ? o.mishit.k : o.mishit.type === 'chunk' ? (MISHIT_K.chunkBy[club.id] || MISHIT_K.chunk) : (MISHIT_K.topBy[club.id] || MISHIT_K.top);
    let sx = 0, sz = 0;
    if (air) {
      let phi = Math.max(club.ang * Math.PI / 180 * 0.4, club.ang * Math.PI / 180 * (o.lie === 'rough' ? 0.92 : 1) + lieUp);
      // mishits: a chunk (fat) loses speed and pops up, a top skims the ball along the ground
      if (o.mishit && o.mishit.type === 'chunk') { phi *= 1.15; }
      else if (o.mishit && o.mishit.type === 'top') { phi = Math.max(2 * Math.PI / 180, phi * 0.2); }
      const vh = speed * Math.cos(phi);
      vy = speed * Math.sin(phi); vx = vh * Math.cos(dirA); vz = vh * Math.sin(dirA);
    } else {
      sx = speed * Math.cos(dirA); sz = speed * Math.sin(dirA);
    }
    const wx = hole.wind.x, wz = hole.wind.z;
    // a deep bunker: its walls rise LIP yards above the sand, so a ball that leaves the bunker below that height is stopped by the wall and
    // drops back in. Only the bunker the ball starts in counts, and once the ball has cleared the lip it is out for good.
    const startSand = o.lie === 'sand' ? (hole.sands || []).find(b => b.contains(s.x, s.z)) : null;
    let lipDone = !startSand, lastIn = { x: s.x, z: s.z }, lipHit = false;
    let t = 0, k = 0;
    const maxT = 70;
    while (t < maxT) {
      t += dt; k++;
      if (air) {
        const rx = vx - wx, rz = vz - wz, rvy = vy;
        const rs = Math.sqrt(rx * rx + rvy * rvy + rz * rz);
        const hs = Math.hypot(vx, vz) || 1e-6, ux = vx / hs, uz = vz / hs;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const ax = -KD * rs * rx + KL * sp * (-vy * ux);
        const ay = -G - KD * rs * rvy + KL * sp * hs;
        const az = -KD * rs * rz + KL * sp * (-vy * uz);
        vx += ax * dt; vy += ay * dt; vz += az * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        if (y > apex) apex = y;
        {
          const key = Math.floor(x / 16) + ',' + Math.floor(z / 16);
          if (key !== nearKey) { nearKey = key; near = o.noTrees ? [] : hole.treesNear(x, z); }
          for (const T of near) {
            const dx = x - T.x, dz = z - T.z, dxz = Math.hypot(dx, dz);
            if (dxz > T.rx + 0.4 || y > T.gy + T.H) continue;
            if (dxz < T.rt + 0.06 && y > T.gy - 0.2 && y < T.trunkTop) {
              // trunk: solid, the ball bounces off it
              const nx = dxz > 1e-6 ? dx / dxz : 1, nz = dxz > 1e-6 ? dz / dxz : 0, vn = vx * nx + vz * nz;
              if (vn < 0) { vx -= 1.3 * vn * nx; vz -= 1.3 * vn * nz; vx *= 0.75; vz *= 0.75; vy *= 0.85; }
              x = T.x + nx * (T.rt + 0.09); z = T.z + nz * (T.rt + 0.09); treeInfo.trunk = true;
            } else {
              const qy = (y - T.cy) / T.ry, q2 = (dxz / T.rx) * (dxz / T.rx) + qy * qy;
              if (q2 < 1) {
                // leaves: slow the ball by a random amount (per tree), much more toward the centre of the canopy
                if (!uMap.has(T)) uMap.set(T, o.treeRandom ? 0.5 + rng() : 1);
                const w = Math.max(0, 1.15 - Math.sqrt(q2)), lam = uMap.get(T) * 7 * Math.pow(w, 1.5), f = Math.exp(-lam * dt);
                if (lam > 0.15) treeInfo.leaf = true;
                vx *= f; vy *= f; vz *= f;
                if (o.treeRandom && lam > 0) { const jn = 0.12 * lam * dt * Math.hypot(vx, vy, vz); vx += (rng() - 0.5) * jn; vz += (rng() - 0.5) * jn; vy += (rng() - 0.5) * jn * 0.5; }
              }
            }
          }
        }
        if (!lipDone) {
          if (startSand.contains(x, z)) lastIn = { x, z };
          else if (y - hole.h(x, z) < LIP) { x = lastIn.x; z = lastIn.z; vx *= -0.15; vz *= -0.15; vy = Math.min(vy, 0) * 0.3; lipHit = true; }
          else lipDone = true;
        }
        const gy = hole.h(x, z);
        if (y <= gy && vy < 0) {
          if (carry === null) carry = Math.hypot(x - s.x, z - s.z);
          const surf = hole.surface(x, z);
          y = gy;
          if (surf === 'water') { type = 'water'; path.push([x, y, z]); break; }
          const gr = hole.grad(x, z), nl = Math.sqrt(1 + gr.gx * gr.gx + gr.gz * gr.gz), nx = -gr.gx / nl, ny = 1 / nl, nz = -gr.gz / nl;
          const vn = vx * nx + vy * ny + vz * nz;
          const P = SURF[surf];
          let ret = P.ret * (bounces === 0 ? (1 - club.spin) : 1);
          if (vn < -4) {
            // reflect about the true surface normal: side slopes kick the ball left/right
            const vtx = vx - vn * nx, vty = vy - vn * ny, vtz = vz - vn * nz;
            const vnn = -vn * P.e;
            vx = vtx * ret + vnn * nx; vy = vty * ret + vnn * ny; vz = vtz * ret + vnn * nz;
            bounces++;
            if (vnn < 3) { air = false; sx = vx; sz = vz; fromAir = true; rollAge = 0; }
          } else {
            air = false; sx = vx * ret; sz = vz * ret; fromAir = true; rollAge = 0;
          }
        }
      } else {
        const gr = hole.grad(x, z), gq = 1 + gr.gx * gr.gx + gr.gz * gr.gz;
        const surf = hole.surface(x, z);
        if (surf === 'water') { type = 'water'; path.push([x, hole.h(x, z), z]); break; }
        const P = SURF[surf];
        const ax = -0.7 * G * gr.gx / gq, az = -0.7 * G * gr.gz / gq;   // rolls downhill in any direction
        const spd = Math.hypot(sx, sz);
        let f = P.f;
        if (fromAir) f *= 1 + P.K * Math.exp(-rollAge / P.tau);
        rollAge += dt;
        if (spd < 0.06 && Math.hypot(ax, az) <= P.f * 1.05) { sx = sz = 0; break; }
        sx += ax * dt; sz += az * dt;
        const spd2 = Math.hypot(sx, sz);
        if (spd2 > 0) {
          const ns = Math.max(0, spd2 - f * dt);
          sx *= ns / spd2; sz *= ns / spd2;
        }
        x += sx * dt; z += sz * dt; y = hole.h(x, z);
        if (!lipDone) {
          if (startSand.contains(x, z)) lastIn = { x, z };
          else { x = lastIn.x; z = lastIn.z; sx *= -0.12; sz *= -0.12; lipHit = true; }   // rolled into the wall
        }
        {
          const key = Math.floor(x / 16) + ',' + Math.floor(z / 16);
          if (key !== nearKey) { nearKey = key; near = o.noTrees ? [] : hole.treesNear(x, z); }
          for (const T of near) {
            const dx = x - T.x, dz = z - T.z, dxz = Math.hypot(dx, dz);
            if (dxz < T.rt + 0.06) {
              const nx = dxz > 1e-6 ? dx / dxz : 1, nz = dxz > 1e-6 ? dz / dxz : 0, vn = sx * nx + sz * nz;
              if (vn < 0) { sx -= 1.4 * vn * nx; sz -= 1.4 * vn * nz; sx *= 0.7; sz *= 0.7; }
              x = T.x + nx * (T.rt + 0.09); z = T.z + nz * (T.rt + 0.09); treeInfo.trunk = true;
            }
          }
        }
        if (!o.noCup && Math.hypot(x - hole.pinX, z - hole.pinZ) < CUP_R && Math.hypot(sx, sz) < 8) {
          type = 'hole'; x = hole.pinX; z = hole.pinZ; y = hole.h(x, z); path.push([x, y - 0.15, z]); break;
        }
      }
      if (k % 2 === 0) path.push([x, y, z]);
    }
    if (carry === null) carry = Math.hypot(x - s.x, z - s.z);
    if (type === 'rest' && hole.pathDist(x, z).d > OB) type = 'ob';
    path.push([x, y, z]);
    return { path, tree: treeInfo, lip: lipHit, end: { x, z, y, type }, carry, apex: apex - hole.h(s.x, s.z), total: Math.hypot(x - s.x, z - s.z), time: t };
  }

  /**
   * Power (0..1) that gets the ball to `dist` yards along `az`. Uses the exact same simulation (and time step)
   * as a real shot, and where a hazard makes total distance jump (carrying water / rough) it returns the side of
   * the jump that clears it, so the predicted flight always matches what the shot really does.
   */
  function solvePower(hole, s, club, lie, az, dist, iters) {
    const run = (pw) => simulate(hole, s, { club, power: pw, az, err: 0, lie });
    const bad = (r) => r.end.type === 'water' || r.end.type === 'ob';
    if (run(1).total <= dist && !bad(run(1))) return 1;
    let lo = 0.02, hi = 1;
    for (let i = 0; i < (iters || 13); i++) {
      const mid = (lo + hi) / 2, r = run(mid);
      if (r.total < dist || bad(r)) lo = mid; else hi = mid;
    }
    // hi is the smallest power that reaches the target without ending in a hazard
    return hi;
  }

  /** Power that makes the ball finish level with the target measured along the aim line (used for putts, where the break bends the roll). */
  function solvePowerAlong(hole, s, club, lie, az, tx, tz, iters, past, from) {
    const ux = Math.cos(az), uz = Math.sin(az);
    const run = (pw) => simulate(hole, s, { club, power: pw, az, err: 0, lie, noCup: !!past });   // 'past': ignore the cup, so the pace is what would carry the ball to the target
    let lo = 0.02, hi = 1;
    if (past) {   // the roll isn't monotonic in power (a fast ball can run off the green), so walk up from a soft stroke to the FIRST power that finishes beyond the target, then refine
      const beyond = (r) => r.end.type !== 'hole' && (r.end.x - tx) * ux + (r.end.z - tz) * uz >= 0;
      const step = from ? 0.04 : 0.08; let prev = from ? Math.max(0.02, from - step) : 0.02;
      for (let pw = from || 0.08; pw <= 1.0001; pw += step) { if (beyond(run(pw))) { hi = pw; lo = prev; break; } prev = pw; hi = 1; lo = pw; }
    }
    for (let i = 0; i < (iters || 12); i++) {
      const mid = (lo + hi) / 2, r = run(mid);
      if (r.end.type === 'hole') { if (!past) return mid; lo = mid; continue; }   // 'past': keep going until the ball would finish at the target (just beyond the cup)
      if ((r.end.x - tx) * ux + (r.end.z - tz) * uz < 0) lo = mid; else hi = mid;
    }
    return hi;
  }

  /** Chance of a mishit from the locked aim-swing angle (deg, + = right). Inside 1 degree it can't happen. */
  function mishitChance(angDeg) {
    const a = Math.abs(angDeg);
    if (a <= 1) return 0;
    return Math.min(0.85, Math.pow((a - 1) / 4, 1.1) * 0.85);
  }
  function rollMishit(angDeg, rng) {
    const r = rng || Math.random;
    if (r() >= mishitChance(angDeg)) return null;
    const a = Math.abs(angDeg);
    return { type: angDeg > 0 ? 'chunk' : 'top', sev: 1 };
  }

  const api = { G, MPH, OB, LIP, CUP_R, CLUBS, SURF, makeHole, simulate, solvePower, solvePowerAlong, MISHIT_K, mishitChance, rollMishit, GREEN_R, strike };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GolfPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
