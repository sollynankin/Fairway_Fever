(() => {
  'use strict';
  const P = window.GolfPhysics;
  const CLUBS = P.CLUBS;
  const PUTTER = CLUBS.length - 1;
  const D2R = Math.PI / 180;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const cv = $('view'); let ctx = cv.getContext('2d');
  const mainCtx = ctx, tCv = document.createElement('canvas'), tCtx = tCv.getContext('2d');
  let dprNow = 1, tKey = '';
  const miniCv = $('miniCv'), mctx = miniCv.getContext('2d');
  const windCv = $('windCv'), wctx = windCv.getContext('2d');
  let W = 0, H = 0, mobile = false;
  const detectMobile = () => (window.innerWidth <= 700 && window.innerHeight > window.innerWidth) || /[?&]mobile=1/.test(location.search);

  function resize() {
    mobile = detectMobile(); document.body.classList.toggle('mobile', mobile);
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 2 : 3); dprNow = dpr; tKey = '';
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------------------------------------------------------------- handicap */
  const KEY = 'fairwayFever.rounds.v1';
  const loadRounds = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  const saveRounds = (r) => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) { /* storage blocked */ } };
  function calcHandicap(rounds) {
    const last = rounds.slice(-20), n = last.length;
    if (!n) return null;
    const diffs = last.map(r => (r.score - r.par) * 18 / r.holes).sort((a, b) => a - b);
    const k = Math.max(1, Math.round(n * 0.4));
    const idx = diffs.slice(0, k).reduce((a, b) => a + b, 0) / k * 0.96;
    const avg = last.reduce((a, r) => a + r.score * 18 / r.holes, 0) / n;
    const best = Math.min(...last.map(r => r.score * 18 / r.holes));
    return { idx, avg, n, best };
  }
  const fmtIdx = (v) => v < 0 ? '+' + (-v).toFixed(1) : v.toFixed(1);
  const fmtPar = (d) => d === 0 ? 'E' : d > 0 ? '+' + d : '' + d;

  function renderHandicapBox() {
    const rounds = loadRounds(), h = calcHandicap(rounds);
    let html = '<div class="label">Your handicap</div>';
    if (!h) {
      html += '<p style="color:var(--dim)">Finish a 9 or 18 hole round and your handicap index and scoring average will be tracked here.</p>';
    } else {
      html += `<div class="stats">
        <div class="stat"><div class="v">${fmtIdx(h.idx)}</div><div class="k">Handicap index${h.n < 3 ? ' (provisional)' : ''}</div></div>
        <div class="stat"><div class="v">${h.avg.toFixed(1)}</div><div class="k">Avg score (18 holes)</div></div>
        <div class="stat"><div class="v">${h.n}</div><div class="k">Rounds counted</div></div></div>`;
      html += '<div class="hist"><table><tr><th class="l">Date</th><th>Holes</th><th>Score</th><th>vs par</th></tr>';
      rounds.slice(-8).reverse().forEach(r => {
        const d = r.score - r.par;
        html += `<tr><td class="l">${new Date(r.date).toLocaleDateString()}</td><td>${r.holes}</td><td>${r.score}</td><td class="${d < 0 ? 'under' : d > 0 ? 'over' : ''}">${fmtPar(d)}</td></tr>`;
      });
      html += '</table></div>';
      html += `<div class="sub" style="color:var(--dim);font-size:12px;margin-top:6px">Index = average of your best ${Math.max(1, Math.round(h.n * 0.4))} of last ${h.n} round(s), scaled to 18 holes. 3-hole rounds are practice only.</div>`;
      html += '<div style="margin-top:8px"><button class="btn ghost small" id="btnReset">Reset history</button></div>';
    }
    $('hcapBox').innerHTML = html;
    const b = $('btnReset');
    if (b) b.onclick = () => { if (confirm('Erase all saved rounds and handicap?')) { saveRounds([]); renderHandicapBox(); } };
  }

  /* ---------------------------------------------------------------- audio */
  let actx = null;
  function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* none */ } } return actx; }
  function tone(freq, dur, type, vol, when, slide) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + (when || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol || 0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, hp) {
    const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
    const g = a.createGain(); g.gain.value = vol || 0.3;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start();
  }
  const sfx = {
    tick: () => tone(660, 0.06, 'square', 0.05),
    hit: (p) => { noise(0.12, 0.35, 1200); tone(140, 0.15, 'sine', 0.3, 0, 60 + 0 * p); },
    putt: () => { tone(300, 0.06, 'triangle', 0.25, 0, 180); },
    splash: () => noise(0.5, 0.35, 300),
    cup: () => { tone(520, 0.12, 'triangle', 0.2); tone(660, 0.12, 'triangle', 0.2, 0.1); tone(880, 0.25, 'triangle', 0.2, 0.2); },
    perfect: () => { tone(880, 0.1, 'sine', 0.12); tone(1320, 0.18, 'sine', 0.12, 0.07); },
  };

  /* ---------------------------------------------------------------- state */
  const S = {
    mode: 'menu', phase: 'idle', holes: [], hi: 0, nHoles: 9, hole: null, scores: [],
    ball: { x: 0, z: 0 }, lie: 'tee', strokes: 0, clubIdx: 0, aim: 0, caddie: true,
    sw: { m: 0, power: 0, b: 0 }, fl: null, cam: { left: 0, scale: 2, yc: 0 }, hint: null, ghost: null,
    clubDist: [], prev: null, time: 0, waitT: 0, view: 'behind', camUp: 0, camTilt: 0, greenView: false, closeup: false, zoom: 1, camYaw: 0, markers: false, msg: '', roundActive: false, trail: [],
  };
  window.__golf = S; // handy for debugging

  const holeOf = () => S.hole;
  const distToPin = () => Math.hypot(S.hole.pinX - S.ball.x, S.hole.pinZ - S.ball.z);
  // does the straight line a -> b stay in bounds and out of the water?
  function lineOK(a, b, maxOff) {
    const h = S.hole;
    for (let i = 1; i <= 14; i++) {
      const x = a.x + (b.x - a.x) * i / 14, z = a.z + (b.z - a.z) * i / 14;
      if (h.pathDist(x, z).d > (maxOff || P.OB - 4) || h.surface(x, z) === 'water') return false;
    }
    return true;
  }
  // is the straight line a -> b free of trees and mountains (so the pin is a sensible direct target)?
  function lineClear(a, b) {
    const h = S.hole;
    for (let i = 1; i <= 24; i++) {
      const x = a.x + (b.x - a.x) * i / 24, z = a.z + (b.z - a.z) * i / 24;
      if (h.trees.some(t => Math.hypot(t.x - x, t.z - z) < t.size * 0.35 + 3)) return false;
      if (h.mountains.some(m => Math.hypot(m.x - x, m.z - z) < m.R + 4)) return false;
    }
    return true;
  }
  // Default aim point: the pin, or - on a bent hole - a point along the first leg, no further than a little past the corner.
  // 'reach' is how far the club goes (defaults to the selected club).
  function aimTarget(reach) {
    const h = S.hole, b = S.ball, pin = { x: h.pinX, z: h.pinZ, pin: true };
    if (!h.corner || S.lie === 'green') return pin;
    if (reach === undefined) reach = S.clubDist[S.clubIdx] || 200;
    const pd = h.pathDist(b.x, b.z), D = distToPin();
    if (pd.s >= h.L1 - 1) {                                   // already on the second leg
      if (D <= reach * 0.98) return pin;
      const q = h.pointAt(Math.min(pd.s + reach, h.yards)); return { x: q.x, z: q.z, pin: false };
    }
    if (D <= reach * 0.98 && lineOK(b, pin, 24) && lineClear(b, pin)) return pin;  // pin reachable along the fairway (e.g. after a layup) - never a corner cut
    const ext = 8 / Math.max(0.5, Math.sin(h.deflect * D2R));  // how far past the corner still lands well inside the fairway (8 yd off its centre, not on the edge)
    const tS = Math.min(pd.s + reach, h.L1 + ext);
    return tS <= h.L1 ? (() => { const q = h.pointAt(tS); return { x: q.x, z: q.z, pin: false }; })() : { x: tS, z: 0, pin: false };
  }
  const targetDist = () => { const t = aimTarget(); return Math.hypot(t.x - S.ball.x, t.z - S.ball.z); };
  const baseAz = () => { const t = aimTarget(); return Math.atan2(t.z - S.ball.z, t.x - S.ball.x); };
  const curAz = () => baseAz() + S.aim * D2R;

  function startRound(n) {
    S.nHoles = n;
    const pattern = n === 3 ? [4, 3, 5] : [4, 3, 4, 5, 4, 3, 4, 5, 4];
    S.holes = []; S.scores = [];
    // the mix of pars is fixed (9 holes: two par 3s, five par 4s, two par 5s) but the order is shuffled every round, so a par 5 can come up at any point
    const pars = []; for (let i = 0; i < n; i++) pars.push(pattern[i % pattern.length]);
    for (let i = pars.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pars[i], pars[j]] = [pars[j], pars[i]]; }
    for (let i = 0; i < n; i++) S.holes.push(P.makeHole(pars[i]));
    S.hi = 0; S.roundActive = true;
    startHole();
  }

  function startHole() {
    S.hole = S.holes[S.hi];
    S.ball = { x: 0, z: 0 }; S.lie = 'tee'; S.strokes = 0; S.aim = 0; S.fl = null; S.trail = []; S.greenView = false; setGreenBtn();
    S.prev = { x: 0, z: 0, lie: 'tee' };
    S.phase = 'aim'; S.msg = '';
    $('result').classList.add('hidden');
    prepareShot(true);
    snapCamera();
    toast(`Hole ${S.hi + 1} · Par ${S.hole.par} · ${S.hole.yards} yds${S.hole.bend ? ' · dogleg ' + (S.hole.bend > 0 ? 'right ' : 'left ') + Math.round(Math.abs(S.hole.bend)) + '°' : ''}`, 2200);
  }

  function prepareShot(suggest) {
    S.camYaw = 0; S.closeup = false;
    S.aim = 0;
    updateDistances();
    if (suggest) suggestClub();
    if (S.caddie) caddieAim();
    updateCaddie();
    updateHud();
  }

  // The distance shown beside each club: its full-power CARRY (how far it flies before the first bounce) on perfectly flat fairway in calm air, with no trees or hazards,
  // so it never changes with the wind, slope or lie (those only affect the live numbers the caddie and the aim line use).
  const BALL_R = 0.11;   // drawn ball radius in yards (the cup is P.CUP_R = 0.2, so the ball is a bit over half its width)
  let maxDist = null;
  function clubMaxDist() {
    if (!maxDist) {
      const flat = { h: () => 0, grad: () => ({ gx: 0, gz: 0 }), surface: () => 'fairway', treesNear: () => [], wind: { mph: 0, dir: 0, x: 0, z: 0 }, pathDist: () => ({ d: 0, s: 0, lat: 0 }), pinX: 1e6, pinZ: 0 };
      maxDist = CLUBS.map(c => c.putter ? 0 : P.simulate(flat, { x: 0, z: 0 }, { club: c, power: 1, az: 0, err: 0, lie: 'fairway' }).carry);
    }
    return maxDist;
  }
  function updateDistances() {
    const az = Math.atan2(S.hole.pinZ - S.ball.z, S.hole.pinX - S.ball.x);
    S.clubDist = CLUBS.map(c => P.simulate(S.hole, S.ball, { club: c, power: 1, az, err: 0, lie: S.lie }).total);
  }

  function suggestClub() {
    if (S.lie === 'green') { S.clubIdx = PUTTER; return; }
    const t0 = aimTarget(1e9), D = Math.hypot(t0.x - S.ball.x, t0.z - S.ball.z);
    let best = -1, bestT = Infinity, longest = 0;
    for (let i = 0; i < PUTTER; i++) {
      const t = S.clubDist[i];
      if (t >= D && t < bestT) { best = i; bestT = t; }
      if (t > S.clubDist[longest]) longest = i;
    }
    S.clubIdx = best >= 0 ? best : longest;
    if (S.lie === 'sand' && S.clubIdx < 9) S.clubIdx = Math.max(S.clubIdx, 11);
  }

  // Caddie line: try aims either side of the target, solve the power for each, and score the landing spot
  // (also with small misses left/right). Water/OB and bunkers are heavily penalised, so it picks a safe line.
  // Putting: the caddie wants the ball to finish 1 ft past the cup (the pace that holes out), so the target is a foot beyond the pin on the ball->pin line
  const PAST = 1 / 3;
  function puttTarget() {
    const h = S.hole, dx = h.pinX - S.ball.x, dz = h.pinZ - S.ball.z, d = Math.hypot(dx, dz) || 1;
    return { x: h.pinX + dx / d * PAST, z: h.pinZ + dz / d * PAST };
  }
  function caddieAim() {
    const club = CLUBS[S.clubIdx], t = aimTarget(), base = baseAz(), h = S.hole;
    const D = Math.hypot(t.x - S.ball.x, t.z - S.ball.z), putt = club.putter;
    const pen = (r) => {
      if (r.end.type === 'water' || r.end.type === 'ob') return 400;
      const s = h.surface(r.end.x, r.end.z);
      return s === 'sand' ? 35 : s === 'rough' ? 22 : 0;
    };
    const pt = putt ? puttTarget() : null;
    const score = (a) => {
      const az = base + a * D2R, p = putt ? P.solvePowerAlong(h, S.ball, club, S.lie, az, pt.x, pt.z, 10, true) : P.solvePower(h, S.ball, club, S.lie, az, D, 8);
      const r0 = P.simulate(h, S.ball, { club, power: p, az, err: 0, lie: S.lie });
      if (putt) return r0.end.type === 'hole' ? -1 : Math.hypot(r0.end.x - pt.x, r0.end.z - pt.z);
      let pn = pen(r0);
      if (!putt) for (const e of [-1.5, 1.5]) pn += pen(P.simulate(h, S.ball, { club, power: p, az, err: e * D2R, lie: S.lie }));
      return Math.hypot(r0.end.x - t.x, r0.end.z - t.z) + (putt ? 0 : pn / 3) + (putt ? 0 : Math.abs(a) * 0.05);
    };
    if (putt) {
      // shooting method: aim, let the solver find the 1 ft-past power, see where it finishes sideways, correct the aim, repeat
      const perp = { x: -Math.sin(base), z: Math.cos(base) };
      let a = 0, bestA = 0, bestS = Infinity, p0 = 0;
      for (let it = 0; it < 7; it++) {
        const az = base + a * D2R, p = P.solvePowerAlong(h, S.ball, club, S.lie, az, pt.x, pt.z, 7, true, p0 ? p0 * 0.8 : 0), r = P.simulate(h, S.ball, { club, power: p, az, err: 0, lie: S.lie, noCup: true });
        p0 = p;
        // closest approach of the rolling ball to the cup: how far it misses, and to which side
        let mi = 0, md = Infinity;
        for (let k = 0; k < r.path.length; k++) { const d2 = Math.hypot(r.path[k][0] - h.pinX, r.path[k][2] - h.pinZ); if (d2 < md) { md = d2; mi = k; } }
        if (md < bestS) { bestS = md; bestA = a; }
        if (md < 0.06) break;
        const lat = (r.path[mi][0] - h.pinX) * perp.x + (r.path[mi][2] - h.pinZ) * perp.z;
        a = clamp(a - lat / Math.max(D, 1) / D2R * 0.9, -25, 25);
      }
      S.aim = clamp(Math.round(bestA * 10) / 10, -25, 25);
      return;
    }
    let best = 0, bs = score(0);
    for (let a = -24; a <= 24; a += 3) { if (a === 0) continue; const s = score(a); if (s < bs - 0.01) { bs = s; best = a; } }
    for (let a = best - 1.5; a <= best + 1.5; a += 0.5) { const s = score(a); if (s < bs - 0.01) { bs = s; best = a; } }
    S.aim = clamp(Math.round(best * 2) / 2, -25, 25);
    if (putt) { for (let a = S.aim - 0.4; a <= S.aim + 0.41; a += 0.1) { const s = score(a); if (s < bs - 0.001) { bs = s; best = a; } } S.aim = clamp(Math.round(best * 10) / 10, -25, 25); }
  }

  function updateCaddie() {
    S.hint = null; S.ghost = null; S.maxShot = null; S.live = null;
    if (!S.caddie) return;
    const club = CLUBS[S.clubIdx], D = targetDist();
    const az = curAz();
    const p = club.putter ? P.solvePowerAlong(S.hole, S.ball, club, S.lie, az, puttTarget().x, puttTarget().z, 12, true) : P.solvePower(S.hole, S.ball, club, S.lie, az, D);
    S.hint = p;
    S.ghost = P.simulate(S.hole, S.ball, { club, power: p, az, err: 0, lie: S.lie });
    S.maxShot = P.simulate(S.hole, S.ball, { club, power: 1, az, err: 0, lie: S.lie });
  }

  /* ---------------------------------------------------------------- input */
  function pickClub(i) {
    if (S.phase !== 'aim') return;
    S.clubIdx = (i + CLUBS.length) % CLUBS.length;
    sfx.tick(); updateCaddie(); updateHud();   // keep the aim angle you set when switching clubs
  }
  function setMarkersBtn() {
    const b = document.querySelector('#camctl [data-cam="markers"]'); if (b) b.textContent = S.markers ? 'Distance markers: On (M)' : 'Distance markers: Off (M)';
  }
  function toggleMarkers() {
    S.markers = !S.markers; setMarkersBtn();
    try { localStorage.setItem('fairwayFever.markers2', S.markers ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  try { if (localStorage.getItem('fairwayFever.markers2') === '1') S.markers = true; } catch (e) { /* ignore */ }
  function toggleCaddie() {
    S.caddie = !S.caddie; $('chkCaddie').checked = S.caddie; S.aim = 0; if (S.caddie) caddieAim(); updateCaddie(); updateHud();
    const b = document.querySelector('#camctl [data-cam="caddie"]'); if (b) b.textContent = S.caddie ? 'Caddie: On (H)' : 'Caddie: Off (H)';
  }
  function setGreenBtn() {
    const b = document.querySelector('#camctl [data-cam="green"]'); if (b) b.textContent = S.greenView ? 'Back to my shot (G)' : 'View green (G)';
  }
  function toggleGreenView() { S.greenView = !S.greenView; setGreenBtn(); updateHud(); }
  function adjustCam(up, tilt) {
    S.camUp = clamp(S.camUp + up, -6, 70); S.camTilt = clamp(S.camTilt + tilt, -25, 30);
  }
  window.addEventListener('wheel', (e) => {
    if (S.mode !== 'play' || e.target.closest('#clubs')) return;
    e.preventDefault();
    if (e.shiftKey) adjustCam(0, e.deltaY > 0 ? -2 : 2); else adjustCam(e.deltaY > 0 ? -3 : 3, 0);
  }, { passive: false });
  document.querySelectorAll('#camctl [data-cam]').forEach(b => b.onclick = () => {
    const k = b.dataset.cam;
    if (k === 'up') adjustCam(4, 0); else if (k === 'down') adjustCam(-4, 0);
    else if (k === 'tu') adjustCam(0, 3); else if (k === 'td') adjustCam(0, -3);
    else if (k === 'green') { toggleGreenView(); document.body.classList.remove('sheet'); }
    else if (k === 'markers') toggleMarkers();
    else if (k === 'caddie') toggleCaddie();
    else if (k === 'menu') { document.body.classList.remove('sheet'); openMenu(); }
    else { S.camUp = 0; S.camTilt = 0; S.camYaw = 0; }
    b.blur();
  });
  // Hide/show the controls legend (key hints under the power bar); everything else stays
  function setControls(show) {
    document.body.classList.toggle('compact', !show);
    $('btnControls').textContent = show ? 'Hide controls legend' : 'Show controls legend';
    try { localStorage.setItem('fairwayFever.controls', show ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  $('btnControls').onclick = (e) => { setControls(document.body.classList.contains('compact')); e.target.blur(); };
  try { if (localStorage.getItem('fairwayFever.controls') === '0') setControls(false); } catch (e) { /* ignore */ }
  function nudgeAim(d) {
    if (S.phase !== 'aim') return;
    // +-90 deg either side of the default line, but always enough to swing round to the pin (e.g. from the bend of a sharp dogleg)
    let lim = 90;
    if (S.hole && S.lie !== 'green') {
      let off = Math.atan2(S.hole.pinZ - S.ball.z, S.hole.pinX - S.ball.x) - baseAz(); off = Math.atan2(Math.sin(off), Math.cos(off));
      lim = Math.max(90, Math.min(180, Math.abs(off) / D2R + 15));
    }
    S.aim = clamp(Math.round((S.aim + d) * 10) / 10, -lim, lim);
    updateCaddie(); updateHud();
  }

  function action() {
    audio();
    if (S.mode !== 'play') return;
    const club = CLUBS[S.clubIdx];
    if (S.phase === 'aim') {
      // 1st click: the aim indicator starts swinging left/right of the angle you set
      S.phase = 'sweep'; S.sw = { t: 0, ang: 0, m: 0, dir: 1, power: 0, b: 0 }; S.msg = ''; S.live = null;
      $('meterMsg').textContent = `1 · ${mobile ? 'Tap' : 'Click'} to lock your AIM`; sfx.tick();
    } else if (S.phase === 'sweep') {
      // 2nd click: lock the aim, the power bar starts
      S.phase = 'rise'; S.sw.m = 0; S.sw.dir = 1;
      $('meterMsg').textContent = `2 · ${mobile ? 'Tap' : 'Click'} to lock your POWER`; sfx.tick();
    } else if (S.phase === 'rise') {
      hit(clamp(S.sw.m / 100, 0.02, 1));   // 3rd click: lock power and swing
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (S.mode === 'play' && (S.phase === 'rise' || S.phase === 'sweep')) { S.phase = 'aim'; S.live = null; $('meterMsg').textContent = ''; } else toggleMenu(); e.preventDefault(); return; }
    if (S.mode === 'menu') return;
    if (S.mode === 'result') {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); const b = $('btnNext'); if (b) b.click(); }
      return;
    }
    switch (e.key) {
      case ' ': case 'Enter': e.preventDefault(); action(); break;
      case 'ArrowUp': case 'w': case 'W': e.preventDefault(); pickClub(S.clubIdx - 1); break;
      case 'ArrowDown': case 's': case 'S': e.preventDefault(); pickClub(S.clubIdx + 1); break;
      case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); nudgeAim(-(e.shiftKey ? 5 : e.repeat ? 2 : 0.5)); break;
      case 'ArrowRight': case 'd': case 'D': e.preventDefault(); nudgeAim(e.shiftKey ? 5 : e.repeat ? 2 : 0.5); break;
      case 'Tab': e.preventDefault(); setControls(document.body.classList.contains('compact')); break;
      case 'g': case 'G': toggleGreenView(); break;
      case 'm': case 'M': toggleMarkers(); break;
      case 'q': case 'Q': adjustCam(-3, 0); break;
      case 'e': case 'E': adjustCam(3, 0); break;
      case 'r': case 'R': adjustCam(0, 2); break;
      case 'f': case 'F': adjustCam(0, -2); break;
      case 'c': case 'C': S.camUp = 0; S.camTilt = 0; S.camYaw = 0; break;
      case 'v': case 'V': S.view = S.view === 'behind' ? 'side' : 'behind'; break;
      case 'h': case 'H': toggleCaddie(); break;
    }
  });
  // a click/tap anywhere on the game (including the power meter itself) advances the swing
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || S.mode !== 'play') return;
    if (mobile) { if (!e.target.closest('#camctl, #btnMenuM')) document.body.classList.remove('sheet'); return; }   // phones: only the buttons act
    if (e.target.closest('#clubs, #camctl, #menu, #result, button, input, label')) return;
    e.preventDefault(); action();
  });

  /* ---------------------------------------------------------------- swing / flight */
  function hit(power) {
    const club = CLUBS[S.clubIdx];
    // the locked aim-swing angle (deg, + = right) is the whole direction error
    const b = S.sw.ang, errDeg = b;
    S.sw.power = power; S.sw.b = b;
    // the worse the aim-swing angle, the likelier a chunk (angle > 0) or a top (angle < 0); inside 1 degree it can't happen
    const mishit = club.putter ? null : P.rollMishit(b);
    const res = P.simulate(S.hole, S.ball, { club, power, az: curAz(), err: errDeg * D2R, lie: S.lie, mishit, treeRandom: true });
    S.camYaw = 0; S.closeup = false;
    S.fl = { res, i: 0, club, power, b, az0: curAz() };
    S.prev = { x: S.ball.x, z: S.ball.z, lie: S.lie };
    S.phase = 'flight'; S.trail = []; S.live = null;
    const q = Math.abs(b) < 0.4 ? 'Dead straight' : `${Math.abs(b).toFixed(1)}° ${b > 0 ? 'right' : 'left'}`;
    S.msg = `${Math.round(power * 100)}% power · ${q}${mishit ? (mishit.type === 'chunk' ? ' · CHUNKED it!' : ' · TOPPED it!') : ''}`;
    if (mishit) toast(mishit.type === 'chunk' ? 'Chunked it!' : 'Topped it!', 1500);
    if (Math.abs(b) < 0.4) sfx.perfect();
    club.putter ? sfx.putt() : sfx.hit(power);
    $('meterMsg').textContent = S.msg;
  }

  function flightPos() {
    const f = S.fl, path = f.res.path;
    const i = Math.min(Math.floor(f.i), path.length - 1), j = Math.min(i + 1, path.length - 1), t = f.i - Math.floor(f.i);
    const a = path[i], b = path[j];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function finishShot() {
    const f = S.fl, r = f.res, end = r.end;
    S.strokes++;
    const par = S.hole.par;
    S.fl = null; S.trail = [];
    if (r.lip) toast('Caught the lip!', 1800);
    if (r.tree && r.tree.trunk) toast('Hit the trunk!', 1600); else if (r.tree && r.tree.leaf) toast('Through the leaves', 1600);
    if (end.type === 'hole') {
      S.ball = { x: S.hole.pinX, z: S.hole.pinZ }; sfx.cup();
      return holeDone(S.strokes, false);
    }
    if (end.type === 'rest' && S.hole.surface(end.x, end.z) === 'green' && Math.hypot(end.x - S.hole.pinX, end.z - S.hole.pinZ) < 1.0) {  // inside 3 ft = gimme
      // leave the ball where it stopped and zoom in so you can see how close it was, then give the putt
      const ft = Math.hypot(end.x - S.hole.pinX, end.z - S.hole.pinZ) * 3;
      S.ball = { x: end.x, z: end.z }; S.lie = 'green';
      toast(ft < 0.5 ? 'Gimme! Tap-in' : `Gimme! ${ft.toFixed(1)} ft from the cup`, 2200);
      S.phase = 'gimme'; S.waitT = 2.2;
      return;
    }
    if (end.type === 'water' || end.type === 'ob') {
      S.strokes++;
      end.type === 'water' ? (sfx.splash(), toast(S.prev.lie === 'tee' ? '💦 Splash! +1 stroke — re-tee' : '💦 Splash! +1 stroke — replay shot', 2400)) : toast('Out of bounds! +1 stroke', 2200);
      S.ball = { x: S.prev.x, z: S.prev.z }; S.lie = S.prev.lie;
    } else {
      S.ball = { x: end.x, z: end.z };
      S.lie = S.hole.surface(end.x, end.z);
      if (S.lie === 'tee') S.lie = 'fairway';
      $('meterMsg').textContent = `${S.msg} — carry ${Math.round(r.carry)} · total ${Math.round(r.total)} yds`;
      if (S.lie === 'sand') toast('In the bunker', 1500);
    }
    if (S.strokes >= par + 5) { toast('Pick up — max strokes', 1800); return holeDone(par + 5, true); }
    S.phase = 'wait'; S.waitT = 0.7;
    S.after = true;
  }

  function holeDone(strokes, pickup) {
    S.scores[S.hi] = strokes;
    S.phase = 'holeout'; S.waitT = 1.6;
  }

  function showHoleResult() {
    S.mode = 'result'; S.phase = 'idle';
    const s = S.scores[S.hi], par = S.hole.par, d = s - par;
    let name = d === 0 ? 'Par' : d === -1 ? 'Birdie!' : d === -2 ? 'Eagle!' : d <= -3 ? 'Albatross!!' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : `+${d}`;
    if (s === 1) name = 'HOLE IN ONE!';
    const total = S.scores.reduce((a, b) => a + b, 0);
    const parSoFar = S.holes.slice(0, S.hi + 1).reduce((a, h) => a + h.par, 0);
    const last = S.hi === S.nHoles - 1;
    $('resultCard').innerHTML = `
      <h2 style="text-align:center;font-size:34px;margin-bottom:2px" class="${d < 0 ? 'under' : d > 0 ? 'over' : ''}">${name}</h2>
      <p class="lead" style="text-align:center">Hole ${S.hi + 1} · Par ${par} · ${s} stroke${s === 1 ? '' : 's'}</p>
      <div class="stats"><div class="stat"><div class="v">${total}</div><div class="k">Total strokes</div></div>
      <div class="stat"><div class="v">${fmtPar(total - parSoFar)}</div><div class="k">To par</div></div>
      <div class="stat"><div class="v">${S.hi + 1}/${S.nHoles}</div><div class="k">Holes played</div></div></div>
      <div class="actions" style="justify-content:center"><button class="btn" id="btnNext">${last ? 'Finish round' : 'Next hole'} (Space)</button></div>`;
    $('result').classList.remove('hidden');
    $('btnNext').onclick = () => {
      $('result').classList.add('hidden');
      if (last) showRoundEnd(); else { S.hi++; S.mode = 'play'; startHole(); }
    };
  }

  function showRoundEnd() {
    S.mode = 'result'; S.roundActive = false;
    const par = S.holes.reduce((a, h) => a + h.par, 0), score = S.scores.reduce((a, b) => a + b, 0);
    const counts = S.nHoles >= 9;
    if (counts) { const r = loadRounds(); r.push({ date: Date.now(), holes: S.nHoles, par, score }); saveRounds(r); }
    const hc = calcHandicap(loadRounds());
    let card = '<table><tr><th class="l">Hole</th>' + S.holes.map((_, i) => `<th>${i + 1}</th>`).join('') + '<th>Tot</th></tr>';
    card += '<tr><td class="l">Par</td>' + S.holes.map(h => `<td>${h.par}</td>`).join('') + `<td>${par}</td></tr>`;
    card += '<tr><td class="l">Score</td>' + S.scores.map((s, i) => { const d = s - S.holes[i].par; return `<td class="${d < 0 ? 'under' : d > 0 ? 'over' : ''}">${s}</td>`; }).join('') + `<td><b>${score}</b></td></tr></table>`;
    $('resultCard').innerHTML = `
      <h2>Round complete — ${score} (${fmtPar(score - par)})</h2>
      <div style="overflow:auto;margin-bottom:14px">${card}</div>
      ${counts && hc ? `<div class="stats">
        <div class="stat"><div class="v">${fmtIdx(hc.idx)}</div><div class="k">Handicap index${hc.n < 3 ? ' (provisional)' : ''}</div></div>
        <div class="stat"><div class="v">${hc.avg.toFixed(1)}</div><div class="k">Avg score (18 holes)</div></div>
        <div class="stat"><div class="v">${hc.n}</div><div class="k">Rounds counted</div></div></div>`
        : '<p class="lead">Practice round (under 9 holes) — not counted toward your handicap.</p>'}
      <div class="actions"><button class="btn" id="btnAgain">Play again</button><button class="btn ghost" id="btnMenu">Main menu</button></div>`;
    $('btnAgain').onclick = () => { $('result').classList.add('hidden'); S.mode = 'play'; startRound(S.nHoles); };
    $('btnMenu').onclick = () => { $('result').classList.add('hidden'); openMenu(); };
  }

  /* ---------------------------------------------------------------- menu */
  function openMenu() {
    S.mode = 'menu'; renderHandicapBox();
    $('menu').classList.remove('hidden'); $('hud').classList.add('hidden');
    $('btnStart').textContent = S.roundActive ? 'New round' : 'Tee off';
    let r = $('btnResume');
    if (S.roundActive && !r) {
      r = document.createElement('button'); r.id = 'btnResume'; r.className = 'btn ghost'; r.textContent = 'Resume round';
      $('btnStart').parentNode.appendChild(r);
      r.onclick = () => { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); S.mode = 'play'; };
    } else if (!S.roundActive && r) r.remove();
  }
  function toggleMenu() {
    if (S.mode === 'menu') { if (S.roundActive) $('btnResume').click(); }
    else if (S.mode === 'play') openMenu();
  }
  document.querySelectorAll('#segHoles button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#segHoles button').forEach(x => x.classList.remove('on')); b.classList.add('on'); b.blur();
  });
  $('chkCaddie').onchange = (e) => { S.caddie = e.target.checked; };
  $('btnStart').onclick = () => {
    audio();
    const n = +document.querySelector('#segHoles button.on').dataset.v;
    S.caddie = $('chkCaddie').checked;
    $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
    const r = $('btnResume'); if (r) r.remove();
    S.mode = 'play'; startRound(n);
    $('btnStart').blur();
  };

  /* ---------------------------------------------------------------- HUD */
  let toastT = 0;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 1800);
  }

  const LIE_NAMES = { tee: 'Tee box', fairway: 'Fairway', rough: 'Rough', sand: 'Bunker', green: 'Green' };

  function buildClubList() {
    $('clubList').innerHTML = CLUBS.map((c, i) => `<div class="club" data-i="${i}"><span class="n">${c.name.replace('Wedge', 'Wdg').replace('Pitching', 'Pitch.')}</span><span class="d" id="cd${i}"></span></div>`).join('');
    $('clubList').querySelectorAll('.club').forEach(el => el.onclick = () => pickClub(+el.dataset.i));
  }
  buildClubList();

  function updateHud() {
    const h = S.hole; if (!h) return;
    const D = distToPin();
    const dh = h.h(h.pinX, h.pinZ) - h.h(S.ball.x, S.ball.z);
    const parSoFar = S.holes.slice(0, S.hi).reduce((a, x) => a + x.par, 0);
    const soFar = S.scores.slice(0, S.hi).reduce((a, b) => a + b, 0);
    // what the ground under the ball does to the shot along the current aim
    const lst = P.strike(CLUBS[S.clubIdx], S.lie), lostPct = Math.round((1 - lst.speed * lst.speed) * 100);
    const lieCost = lostPct > 0 ? ` (−${lostPct}% dist)` : '';
    let slopeRow = '';
    if (S.lie !== 'green') {
      const gr = h.grad(S.ball.x, S.ball.z), az0 = curAz(), R2D = 180 / Math.PI;
      const along = Math.atan(gr.gx * Math.cos(az0) + gr.gz * Math.sin(az0)) * R2D, across = Math.atan(-gr.gx * Math.sin(az0) + gr.gz * Math.cos(az0)) * R2D;
      const bits = [];
      if (Math.abs(along) >= 0.8) bits.push((along > 0 ? 'uphill ' : 'downhill ') + Math.abs(along).toFixed(0) + '°');
      if (Math.abs(across) >= 0.8) bits.push(across > 0 ? 'ball above feet' : 'ball below feet');
      slopeRow = `<div class="row"><span>Slope</span><b>${bits.length ? bits.join(' · ') : 'Flat'}</b></div>`;
    }
    const elevTxt = Math.abs(dh) < 1 ? 'Level' : `${Math.abs(dh).toFixed(0)} yd ${dh > 0 ? 'uphill ▲' : 'downhill ▼'}`;
    let extra = '';
    if (S.lie === 'green') {
      const gb = h.grad(S.ball.x, S.ball.z), az0 = curAz(), R2D = 180 / Math.PI;
      const al = Math.atan(gb.gx * Math.cos(az0) + gb.gz * Math.sin(az0)) * R2D, ac = Math.atan(-gb.gx * Math.sin(az0) + gb.gz * Math.cos(az0)) * R2D;
      const bits = [];
      if (Math.abs(al) >= 0.5) bits.push((al > 0 ? 'uphill ' : 'downhill ') + Math.abs(al).toFixed(1) + '°');
      if (Math.abs(ac) >= 0.5) bits.push('breaks ' + (ac > 0 ? 'right → left' : 'left → right'));
      extra = `<div class="sub">Under ball: ${bits.length ? bits.join(' · ') : 'flat'}<br>Arrows: <span style="color:#5fe08a">gentle</span> → <span style="color:#ffd54a">medium</span> → <span style="color:#ff5046">steep</span></div>`;
    }
    if (S.greenView && S.lie !== 'green') extra = `<div class="sub">Green view · arrows: <span style="color:#5fe08a">gentle</span> → <span style="color:#ffd54a">medium</span> → <span style="color:#ff5046">steep</span></div>`;
    $('info').innerHTML = `
      <div class="big">Hole ${S.hi + 1} <span style="color:var(--dim);font-weight:500;font-size:14px">/ ${S.nHoles} · Par ${h.par} · ${h.yards} yd${h.bend ? ' · dogleg ' + (h.bend > 0 ? 'R' : 'L') + ' ' + Math.round(Math.abs(h.bend)) + '°' : ''}</span></div>
      <div class="row"><span>To pin</span><b>${Math.round(D)} yd${D < 40 ? ` (${Math.round(D * 3)} ft)` : ''}</b></div>
      <div class="row"><span>Elevation</span><b>${elevTxt}</b></div>
      <div class="row"><span>Lie</span><b>${LIE_NAMES[S.lie]}${lieCost}${Math.abs(S.ball.z) > 1 ? ` · ${Math.abs(S.ball.z).toFixed(0)} yd ${S.ball.z > 0 ? 'right' : 'left'}` : ''}</b></div>${slopeRow}
      <div class="row"><span>Strokes</span><b>${S.strokes} <span style="color:var(--dim);font-weight:400">(round ${fmtPar(soFar - parSoFar)})</span></b></div>${extra}`;

    CLUBS.forEach((c, i) => {
      const el = $('cd' + i); if (!el) return;
      el.textContent = c.putter ? '' : Math.round(clubMaxDist()[i]) + ' y';
      el.parentNode.classList.toggle('sel', i === S.clubIdx);
    });

    // wind relative to the direction you are aiming right now (rotates as you change your angle)
    const w = h.wind, rel = w.dir - curAz(), along = w.mph * Math.cos(rel), cross = w.mph * Math.sin(rel);
    $('windT').textContent = `${w.mph.toFixed(0)} mph`;
    $('windS').textContent = w.mph < 1.5 ? 'Calm' : `${along >= 0 ? 'Tail' : 'Head'} ${Math.abs(along).toFixed(0)} · Cross ${cross >= 0 ? 'L→R' : 'R→L'} ${Math.abs(cross).toFixed(0)}`;
    drawWind(w, rel);

    const club = CLUBS[S.clubIdx];
    $('meterClub').innerHTML = `<b>${club.name}</b> ${club.putter ? '' : `· full ≈ ${Math.round(S.clubDist[S.clubIdx])} yd`}`;
    $('aimTxt').textContent = (S.aim === 0 ? '0°' : (S.aim > 0 ? '→ ' : '← ') + Math.abs(S.aim).toFixed(1) + '°');
    $('meterHintTxt').textContent = S.caddie && S.hint != null ? `Caddie: ${Math.round(S.hint * 100)}% (gold)${S.hint >= 1 ? ' — max, short of target' : ''} · full = white` : '';
    $('miniL').textContent = S.lie === 'green' ? 'Putting' : 'Overhead';
    layoutMeter();
  }

  const mpos = (m) => clamp(m, 0, 100);
  function layoutMeter() {
    ['meterHook', 'meterZero', 'meterPerfect'].forEach(id => { $(id).style.display = 'none'; });
    const hint = $('meterHint');
    if (S.caddie && S.hint != null && S.phase !== 'flight') { hint.style.display = 'block'; hint.style.left = `calc(${mpos(S.hint * 100)}% - 1.5px)`; }
    else hint.style.display = 'none';
  }

  function updateMeter() {
    const amp = CLUBS[S.clubIdx].putter ? 1.5 : 7.5, ac = $('aimCursor'), showAim = S.phase === 'sweep' || S.phase === 'rise' || S.phase === 'flight' || S.phase === 'wait';
    $('aimTxt2').innerHTML = showAim ? `${Math.abs(S.sw.ang).toFixed(1)}° ${Math.abs(S.sw.ang) < 0.05 ? '' : S.sw.ang > 0 ? 'R' : 'L'}` : `±${amp}°`;
    ac.style.display = showAim ? 'block' : 'none'; ac.style.left = `calc(${50 + S.sw.ang / amp * 50}% - 2px)`;
    ac.style.background = S.phase === 'sweep' ? '#fff' : '#7dd3ff';
    const fill = $('meterFill'), cur = $('meterCursor'), pw = $('meterPower');
    if (S.phase === 'rise') {
      fill.style.width = mpos(S.sw.m) + '%';
      cur.style.display = 'block'; cur.style.left = `calc(${mpos(S.sw.m)}% - 2px)`; pw.style.display = 'none';
    } else if (S.phase === 'flight' || S.phase === 'wait') {
      fill.style.width = mpos(S.sw.power * 100) + '%'; cur.style.display = 'none'; pw.style.display = 'none';
    } else { fill.style.width = '0'; cur.style.display = 'none'; pw.style.display = 'none'; }
  }

  function drawWind(w, rel) {
    const c = wctx, s = 184, m = s / 2;
    c.clearRect(0, 0, s, s);
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2;
    c.beginPath(); c.arc(m, m, 78, 0, 7); c.stroke();
    c.fillStyle = '#a9c2b0'; c.font = '600 16px sans-serif'; c.textAlign = 'center';
    c.fillText('AIM', m, 24); c.fillText('BACK', m, s - 12);
    const len = 12 + 60 * Math.min(1, w.mph / 20);
    c.save(); c.translate(m, m); c.rotate(rel);
    // dir 0 = toward pin = up on screen
    c.rotate(0);
    c.fillStyle = w.mph < 1.5 ? '#6a8' : '#ffd54a'; c.strokeStyle = c.fillStyle; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, len * 0.6); c.lineTo(0, -len * 0.6); c.stroke();
    c.beginPath(); c.moveTo(0, -len * 0.6 - 16); c.lineTo(-13, -len * 0.6 + 4); c.lineTo(13, -len * 0.6 + 4); c.closePath(); c.fill();
    c.restore();
  }

  /* ---------------------------------------------------------------- camera & rendering */
  const plotL = () => Math.min(270, W * 0.28);
  const plotR = () => W - 50;
  const y0 = () => H * 0.66;

  function camTarget() {
    const h = S.hole, D = Math.max(6, h.pinX - S.ball.x);
    const range = clamp(D * 1.12 + 40, 95, 720);
    const scale = (plotR() - plotL()) / range;
    return { left: S.ball.x, scale, yc: (h.h(S.ball.x, S.ball.z) + h.h(h.pinX, h.pinZ)) / 2 + 4 };
  }
  function snapCamera() { S.cam = camTarget(); snapCamera3(); }

  function updateCamera(dt) {
    const t = camTarget(), c = S.cam, k = Math.min(1, dt * 4);
    if (S.phase === 'flight' && S.fl) {
      const p = flightPos();
      const need = p[0] - (plotR() - plotL()) * 0.72 / c.scale;
      t.left = Math.max(S.prev.x, need);
      t.scale = c.scale;
      t.yc = c.yc + (S.hole.h(p[0], p[2]) + 4 - c.yc) * 0.4;
    }
    c.left += (t.left - c.left) * k; c.scale += (t.scale - c.scale) * k; c.yc += (t.yc - c.yc) * k;
  }

  const VEX = 2; // vertical exaggeration so hills and ball flight read clearly
  const w2s = (x, y) => [plotL() + (x - S.cam.left) * S.cam.scale, y0() - (y - S.cam.yc) * S.cam.scale * VEX];
  const s2x = (sx) => S.cam.left + (sx - plotL()) / S.cam.scale;

  const COL = { tee: '#3fa15a', fairway: '#4fb85f', rough: '#2d7a43', sand: '#e6d192', green: '#78e08a', water: '#3b8fd6' };

  function drawScene() {
    const h = S.hole; if (!h) return;
    const cam = S.cam, sc = cam.scale;
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6db8f2'); g.addColorStop(0.65, '#cdeaff'); g.addColorStop(1, '#e8f6ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,244,190,.9)'; ctx.beginPath(); ctx.arc(W * 0.82, H * 0.14, 34, 0, 7); ctx.fill();
    // clouds
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 330 + S.time * (6 + i * 2) - cam.left * 0.05) % (W + 300)) - 150, cy = 50 + (i * 47) % 130;
      ctx.beginPath(); ctx.ellipse(cx, cy, 70, 16, 0, 0, 7); ctx.ellipse(cx + 40, cy - 10, 42, 15, 0, 0, 7); ctx.ellipse(cx - 38, cy - 6, 36, 12, 0, 0, 7); ctx.fill();
    }
    // distant hills (parallax)
    for (let l = 0; l < 2; l++) {
      ctx.fillStyle = l ? '#7fbf90' : '#a2d4ae';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let px = 0; px <= W; px += 12) {
        const wx = px + cam.left * sc * (0.08 + l * 0.06) * 0.3;
        const y = H * (0.5 + l * 0.05) - 36 * (1 + l * 0.4) * Math.sin(wx / (170 - l * 60) + l * 2) - 18 * Math.sin(wx / (61 + l * 20));
        ctx.lineTo(px, y);
      }
      ctx.lineTo(W, H); ctx.fill();
    }

    // terrain sampling
    const step = 4, n = Math.ceil(W / step) + 1, zRef = S.ball.z;
    const xs = new Float32Array(n), ys = new Float32Array(n), sf = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = s2x(i * step); xs[i] = x;
      const hy = h.h(x, S.ball.z); ys[i] = y0() - (hy - cam.yc) * sc * VEX;
      sf[i] = h.surface(x, zRef);
    }

    // trees (behind terrain)
    for (const t of h.trees) {
      if (t.x < xs[0] - 15 || t.x > xs[n - 1] + 15) continue;
      const [sx, sy] = w2s(t.x, h.h(t.x, t.z) - 1);
      const th = t.size * sc * 1.4, tw = th * 0.3;
      ctx.fillStyle = '#5b3d22'; ctx.fillRect(sx - tw * 0.12, sy - th * 0.45, tw * 0.24, th * 0.5);
      ctx.fillStyle = t.shade > 0.5 ? '#2a6e3b' : '#358247';
      ctx.beginPath(); ctx.ellipse(sx, sy - th * 0.62, tw * 0.75, th * 0.42, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx, sy - th * 0.85, tw * 0.5, th * 0.3, 0, 0, 7); ctx.fill();
    }

    // dirt
    const dg = ctx.createLinearGradient(0, y0() - 60, 0, H);
    dg.addColorStop(0, '#6b4e2c'); dg.addColorStop(1, '#2b2013');
    ctx.fillStyle = dg; ctx.beginPath(); ctx.moveTo(0, H);
    for (let i = 0; i < n; i++) ctx.lineTo(i * step, ys[i]);
    ctx.lineTo(W, H); ctx.fill();

    // surface strip
    const thick = clamp(sc * 1.1, 6, 16);
    for (let i = 0; i < n - 1; i++) {
      const s = sf[i];
      if (s === 'water') continue;
      ctx.fillStyle = COL[s] || COL.rough;
      ctx.beginPath(); ctx.moveTo(i * step, ys[i]); ctx.lineTo((i + 1) * step + 0.5, ys[i + 1]);
      ctx.lineTo((i + 1) * step + 0.5, ys[i + 1] + thick); ctx.lineTo(i * step, ys[i] + thick); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < n; i++) i ? ctx.lineTo(i * step, ys[i]) : ctx.moveTo(0, ys[0]); ctx.stroke();

    // water
    for (const w of h.waters) {
      const xa = w.x0 - 3.5, xb = w.x1 + 3.5;
      const lvl = Math.min(h.h(xa, S.ball.z), h.h(xb, S.ball.z)) - 0.35;
      const [sa] = w2s(xa, 0), [sb] = w2s(xb, 0);
      if (sb < 0 || sa > W) continue;
      const ly = y0() - (lvl - cam.yc) * sc * VEX;
      ctx.fillStyle = 'rgba(46,130,214,.92)'; ctx.beginPath(); ctx.moveTo(sa, ly);
      for (let px = Math.floor(sa / step) * step; px <= sb + step; px += step) {
        const x = s2x(px), y = y0() - (Math.min(h.h(x, S.ball.z), lvl) - cam.yc) * sc * VEX; ctx.lineTo(px, Math.max(y, ly));
      }
      ctx.lineTo(sb, ly); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sa, ly); ctx.lineTo(sb, ly); ctx.stroke();
    }

    // pin
    {
      const px = h.pinX, [sx, sy] = w2s(px, h.h(px, h.pinZ));
      const ph = clamp(2.6 * sc, 30, 110), fl = ph * (0.22 + 0.34 * Math.min(1, h.wind.mph / 20));
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(sx, sy + 1, Math.max(2, P.CUP_R * sc), 2.2, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#eee'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - ph); ctx.stroke();
      const dir = h.wind.x >= 0 ? 1 : -1, amp = 2 + 0.06 * h.wind.mph;
      ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(sx, sy - ph);
      const wave = Math.sin(S.time * (4 + h.wind.mph * 0.4)) * amp;
      ctx.quadraticCurveTo(sx + dir * fl * 0.5, sy - ph + fl * 0.15 + wave, sx + dir * fl, sy - ph + fl * 0.3 + wave * 0.5);
      ctx.lineTo(sx, sy - ph + fl * 0.6); ctx.fill();
    }

    // wind streaks
    {
      const spd = h.wind.x * 9;
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) {
        const base = (i * 173) % W, yy = 60 + (i * 97) % (H * 0.45);
        const x = ((base + S.time * spd * 2) % (W + 100) + W + 100) % (W + 100) - 50;
        const L = 10 + Math.abs(h.wind.x) * 6;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + Math.sign(spd || 1) * L, yy); ctx.stroke();
      }
    }

    // ghost path (caddie prediction)
    for (const A of arcs()) {
      const path = A.res.path; ctx.fillStyle = 'rgba(' + A.col + ',' + A.a + ')';
      for (let i = 0; i < path.length; i += 4) {
        const [sx, sy] = w2s(path[i][0], path[i][1]);
        if (sx < -10 || sx > W + 10) continue;
        ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, 7); ctx.fill();
      }
      const e = path[path.length - 1], [ex, ey] = w2s(e[0], e[1]);
      ctx.strokeStyle = A.ring; ctx.globalAlpha = A.a; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ex, ey, 7, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }

    // ball
    if (!(S.fl && S.fl.res.end.type === 'hole' && S.fl.i >= S.fl.res.path.length - 1)) {
      let bx, by, bz = S.ball.z;
      if (S.fl) { const p = flightPos(); bx = p[0]; by = p[1]; }
      else { bx = S.ball.x; by = h.h(bx, S.ball.z); }
      const r = clamp(sc * 0.35, 3.5, 7);
      const [sx, sy] = w2s(bx, by);
      const gy = w2s(bx, h.h(bx, S.ball.z))[1];
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.28)'; const sh = clamp(1 - (by - h.h(bx, S.ball.z)) / 60, 0.3, 1);
      ctx.beginPath(); ctx.ellipse(sx, gy + 1, r * 1.3 * sh, 1.8, 0, 0, 7); ctx.fill();
      // trail
      if (S.fl) {
        S.trail.push([sx, sy]); if (S.trail.length > 40) S.trail.shift();
        for (let i = 0; i < S.trail.length; i++) {
          ctx.fillStyle = `rgba(255,255,255,${i / S.trail.length * 0.5})`;
          ctx.beginPath(); ctx.arc(S.trail[i][0], S.trail[i][1], r * 0.6 * (i / S.trail.length), 0, 7); ctx.fill();
        }
      }
      const lift = S.fl ? 0 : r;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy - lift, r, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  /* ---------------------------------------------------------------- behind-the-ball 3D view */
  const cam3 = { px: 0, py: 6, pz: 0, lx: 30, ly: 0, lz: 0 };
  const FOG = [168, 212, 184];
  const SURFC = { tee: [63, 161, 90], fairway: [80, 186, 96], rough: [45, 122, 67], sand: [232, 211, 148], green: [120, 224, 138], water: [52, 140, 214] };
  const mixc = (c, m, f) => 'rgb(' + ((c[0] * m * (1 - f) + FOG[0] * f) | 0) + ',' + ((c[1] * m * (1 - f) + FOG[1] * f) | 0) + ',' + ((c[2] * m * (1 - f) + FOG[2] * f) | 0) + ')';
  const onGreen = () => S.lie === 'green';
  // yardage markers (yards from the pin): line across the fairway + a numbered post either side
  const MARKERS = [
    { d: 50, col: '#ffd23f', txt: '#222' }, { d: 100, col: '#ff5a4d', txt: '#fff' }, { d: 150, col: '#f4f4f4', txt: '#222' },
    { d: 200, col: '#3f7dff', txt: '#fff' }, { d: 250, col: '#a35cff', txt: '#fff' }, { d: 300, col: '#ff9a2e', txt: '#222' }, { d: 350, col: '#2fc7b4', txt: '#222' },
  ];

  // prediction arcs: gold = suggested power for the target, white = this club at full power, cyan = live bar power
  function arcs() {
    if (S.mode !== 'play' || (S.phase !== 'aim' && S.phase !== 'sweep' && S.phase !== 'rise')) return [];
    const out = [];
    // the blue tracer follows the power bar on every shot; the gold / white predictions are caddie-only
    if (!S.caddie) { if (S.live) out.push({ res: S.live, col: '90,220,255', a: 1, ring: '#5adcff' }); return out; }
    if (S.maxShot && !(S.hint != null && S.hint >= 0.995)) out.push({ res: S.maxShot, col: '255,255,255', a: 0.5, ring: '#fff' });
    if (S.ghost) out.push({ res: S.ghost, col: '255,213,74', a: 0.95, ring: '#ffd54a' });
    if (S.live) out.push({ res: S.live, col: '90,220,255', a: 1, ring: '#5adcff' });
    return out;
  }

  // the higher the camera, the further back it sits so the ball stays in view
  function pullBack(t) {
    const k = Math.max(0, S.camUp) * 0.9, hd = Math.hypot(t.lx - t.px, t.lz - t.pz) || 1;
    t.px += (t.px - t.lx) / hd * k; t.pz += (t.pz - t.lz) / hd * k;
  }
  const PUTT_TILT = 12;   // degrees off the line of the putt
  // the bunker the ball is sitting in (if any)
  const inBunker = () => (S.hole.sands || []).find(b => b.contains(S.ball.x, S.ball.z));
  function addressCam() {
    const t = addressCamBase(), h = S.hole;
    pullBack(t);
    const yaw = S.camYaw + (onGreen() ? PUTT_TILT : 0);   // putts are viewed from a little off to one side, not dead on, which shows the break better
    if (yaw) {   // finger-drag look: orbit the camera (and what it looks at) around the ball, or around the putt when reading the green
      const b = S.ball, pivot = onGreen() ? { x: (b.x + h.pinX) / 2, z: (b.z + h.pinZ) / 2 } : S.greenView ? { x: h.gcx, z: h.gcz } : b, cs = Math.cos(yaw * D2R), sn = Math.sin(yaw * D2R);
      const rot = (x, z) => { const dx = x - pivot.x, dz = z - pivot.z; return [pivot.x + dx * cs - dz * sn, pivot.z + dx * sn + dz * cs]; };
      [t.px, t.pz] = rot(t.px, t.pz); [t.lx, t.lz] = rot(t.lx, t.lz); t.ly = h.h(t.lx, t.lz);
    }
    t.py = Math.max(h.h(t.px, t.pz) + 1.2, t.py + S.camUp);
    t.ly += Math.tan(S.camTilt * D2R) * Math.hypot(t.lx - t.px, t.lz - t.pz);
    return t;
  }
  function addressCamBase() {
    const h = S.hole, b = S.ball, D = distToPin(), az = curAz();
    const fx = Math.cos(az), fz = Math.sin(az);
    if (S.greenView && !onGreen()) {
      // cut to the green: steep view over its centre, oriented along the approach
      const cx = h.gcx, cz = h.gcz, ga = Math.atan2(cz - b.z, cx - b.x), gfx = Math.cos(ga), gfz = Math.sin(ga);
      const ht = clamp(h.greenMax * 1.75 + 18, 55, 90);
      return { px: cx - gfx * 8, pz: cz - gfz * 8, py: h.h(cx, cz) + ht, lx: cx, ly: h.h(cx, cz), lz: cz };
    }
    if (onGreen()) {
      // putting: steep view centred between ball and hole so the slope can be read
      const mx = (b.x + h.pinX) / 2, mz = (b.z + h.pinZ) / 2;
      const back = clamp(D * 0.22 + 2, 2.5, 12), ht = clamp(D * 0.75 + 8, 9, 55);   // auto-zoom: the camera drops in close on short putts and lifts to frame long ones
      return { px: mx - fx * back, pz: mz - fz * back, py: h.h(mx, mz) + ht, lx: mx, ly: h.h(mx, mz), lz: mz };
    }
    if (S.lie === 'sand' && inBunker()) {   // down in the bunker: camera low behind the ball, looking up at the wall you have to clear
      const gy = h.h(b.x, b.z), px = b.x - fx * 8, pz = b.z - fz * 8, lx = b.x + fx * 30, lz = b.z + fz * 30;
      return { px, py: gy + 0.8, pz, lx, ly: h.h(lx, lz) + 3, lz };
    }
    const back = clamp(11 + D * 0.06, 12, 32), ht = clamp(4.5 + D * 0.05, 5, 20);
    const px = b.x - fx * back, pz = b.z - fz * back;
    const py = Math.max(h.h(px, pz) + 1.5, h.h(b.x, b.z) + ht);
    const Dt = clamp(3.7 * ht - back, 10, 120);
    const lx = b.x + fx * Dt, lz = b.z + fz * Dt;
    return { px, py, pz, lx, ly: h.h(lx, lz), lz };
  }
  function snapCamera3() { Object.assign(cam3, addressCam()); }

  // a full shot that is rolling out on the green close to the cup: cut in tight so you can watch it (or see how near it finished)
  function nearCup() {
    const h = S.hole, f = S.fl;
    if (S.closeup) return true;   // once cut in, stay in (no flicking in and out while it bounces)
    if (f.lastAir === undefined) {   // index of the last sample where the ball is still in the air / bouncing; the cut-in waits for it to settle into its roll
      f.lastAir = 0;
      f.res.path.forEach((q, k) => { if (q[1] > h.h(q[0], q[2]) + 0.25) f.lastAir = k; });
    }
    const p = flightPos();
    return f.i > f.lastAir + 1 && Math.hypot(p[0] - h.pinX, p[2] - h.pinZ) < 12 && h.surface(p[0], p[2]) === 'green';
  }
  function closeupCam() {
    const h = S.hole;
    let bx, bz, ux, uz;
    if (S.fl) { const p = flightPos(), q = S.fl.res.path[Math.max(0, Math.floor(S.fl.i) - 3)]; bx = p[0]; bz = p[2]; ux = p[0] - q[0]; uz = p[2] - q[2]; }
    else { bx = S.ball.x; bz = S.ball.z; ux = h.pinX - bx; uz = h.pinZ - bz; }
    if (Math.hypot(ux, uz) < 1e-4) { ux = Math.cos(S.prev ? Math.atan2(h.pinZ - S.prev.z, h.pinX - S.prev.x) : 0); uz = Math.sin(S.prev ? Math.atan2(h.pinZ - S.prev.z, h.pinX - S.prev.x) : 0); }
    const dx = h.pinX - bx, dz = h.pinZ - bz;
    if (Math.hypot(dx, dz) > 0.4) { ux = dx; uz = dz; }                     // look from behind the ball toward the cup
    const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
    const px = bx - ux * 3.4, pz = bz - uz * 3.4, lx = (bx + h.pinX) / 2 + ux * 0.4, lz = (bz + h.pinZ) / 2 + uz * 0.4;
    return { px, pz, py: h.h(px, pz) + 1.3, lx, lz, ly: h.h(lx, lz) };
  }
  function updateCamera3(dt) {
    let t, kp = Math.min(1, dt * 4), kl = Math.min(1, dt * 5);
    if (S.phase === 'flight' && S.fl && !S.fl.club.putter && nearCup()) {
      S.closeup = true; t = closeupCam(); kp = Math.min(1, dt * 4); kl = Math.min(1, dt * 5);
    } else if (S.phase === 'flight' && S.fl && !S.fl.club.putter) {
      const p = flightPos(), a = S.fl.az0, fx = Math.cos(a), fz = Math.sin(a), gy = S.hole.h(p[0], p[2]);
      t = { px: p[0] - fx * 32, pz: p[2] - fz * 32, py: Math.max(gy + 9, p[1] * 0.6 + 7),
            lx: p[0] + fx * 20, lz: p[2] + fz * 20, ly: p[1] * 0.85 };
      pullBack(t); t.py += S.camUp; t.ly += Math.tan(S.camTilt * D2R) * Math.hypot(t.lx - t.px, t.lz - t.pz);
      kp = Math.min(1, dt * 2.6); kl = Math.min(1, dt * 3.5);
    } else if (S.phase === 'holeout') return;
    else if (S.phase === 'gimme') { S.closeup = true; t = closeupCam(); kp = Math.min(1, dt * 3); kl = Math.min(1, dt * 4); }
    else t = addressCam();
    cam3.px += (t.px - cam3.px) * kp; cam3.py += (t.py - cam3.py) * kp; cam3.pz += (t.pz - cam3.pz) * kp;
    cam3.lx += (t.lx - cam3.lx) * kl; cam3.ly += (t.ly - cam3.ly) * kl; cam3.lz += (t.lz - cam3.lz) * kl;
  }

  function drawBehind() {
    const h = S.hole; if (!h) return;
    if (!onGreen() && !S.greenView) S.zoom = 1;
    const c = cam3, zf = mobile && (onGreen() || S.greenView) && !S.closeup ? S.zoom : 1, foc = (mobile ? W * 1.15 : H * 0.85) * zf;
    let PY = mobile ? (H - 290) * 0.5 : H * 0.5;
    let Fx = c.lx - c.px, Fy = c.ly - c.py, Fz = c.lz - c.pz;
    const n = Math.hypot(Fx, Fy, Fz) || 1; Fx /= n; Fy /= n; Fz /= n;
    const hn = Math.hypot(Fx, Fz) || 1e-6, Rx = -Fz / hn, Rz = Fx / hn;
    const Ux = -Rz * Fy, Uy = Rz * Fx - Rx * Fz, Uz = Rx * Fy;
    const proj = (x, y, z) => {
      const dx = x - c.px, dy = y - c.py, dz = z - c.pz;
      const d = dx * Fx + dy * Fy + dz * Fz; if (d < 0.4) return null;
      return [W / 2 + foc * (dx * Rx + dz * Rz) / d, PY - foc * (dx * Ux + dy * Uy + dz * Uz) / d, d];
    };
    // phone putting: slide the picture so the whole putt (ball to cup) sits between the info panel above and the meter below, instead of the cup hiding under the info
    if (mobile && onGreen() && !S.closeup && S.puttDraw) {
      const pb = proj(S.ball.x, h.h(S.ball.x, S.ball.z) + 0.1, S.ball.z), pp = proj(h.pinX, h.h(h.pinX, h.pinZ), h.pinZ);
      if (pb && pp) {
        const top = $('info').getBoundingClientRect().bottom + 26, bot = $('meterWrap').getBoundingClientRect().top - 26;
        const want = clamp((top + bot) / 2 - (pb[1] + pp[1]) / 2, -300, 300);
        S.pyAdj = Math.abs(want - (S.pyAdj || 0)) < 1 ? want : (S.pyAdj || 0) + (want - (S.pyAdj || 0)) * 0.25;
        PY += Math.round(S.pyAdj);
      }
    } else S.pyAdj = 0;
    const hy = PY + foc * Fy / hn;
    const gv = S.greenView && !onGreen();      // 'cut to the green' from the fairway
    // the tight putting render (green-only ground, big flag, small ball) only starts once the camera has actually flown in over the green,
    // and then stays on until the putt view ends: switching it while the camera is still out on the fairway made the picture flash
    const wantPutt = onGreen() || S.greenView || S.closeup;
    if (!wantPutt) S.puttDraw = false;
    else if (!S.puttDraw) { const tg = addressCam(); if (Math.hypot(c.px - tg.px, c.py - tg.py, c.pz - tg.pz) < 9 && Math.hypot(c.lx - tg.lx, c.lz - tg.lz) < 9) S.puttDraw = true; }
    const putting = wantPutt && !!S.puttDraw;
    const key = [c.px, c.py, c.pz, c.lx, c.ly, c.lz].map(v => v.toFixed(2)).join() + putting + zf.toFixed(2) + PY + W + H + S.ball.x.toFixed(1) + S.hi + S.markers + (S.lie === 'sand' && inBunker() ? 'S' : '');
    // terrain mesh
    const vh = (x, z) => h.h(x, z);
    // --- smooth terrain: one flat-coloured base (rough) plus clean polygon overlays for each surface
    const NEAR = 0.4;
    const cam = (x, y, z) => { const dx = x - c.px, dy = y - c.py, dz = z - c.pz;
      return { d: dx * Fx + dy * Fy + dz * Fz, xs: dx * Rx + dz * Rz, ys: dx * Ux + dy * Uy + dz * Uz }; };
    const poly = (pts, col, rim) => {          // fill a 3D polygon, clipped against the near plane
      const Pc = pts.map(p => cam(p[0], p[1], p[2])), out = [];
      for (let i = 0; i < Pc.length; i++) {
        const p = Pc[i], q = Pc[(i + 1) % Pc.length], pin = p.d >= NEAR, qin = q.d >= NEAR;
        if (pin) out.push(p);
        if (pin !== qin) { const t = (NEAR - p.d) / (q.d - p.d); out.push({ d: NEAR, xs: p.xs + (q.xs - p.xs) * t, ys: p.ys + (q.ys - p.ys) * t }); }
      }
      if (out.length < 3) return;
      ctx.beginPath();
      out.forEach((p, i) => { const sx = W / 2 + foc * p.xs / p.d, sy = PY - foc * p.ys / p.d; i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.closePath(); ctx.fillStyle = col; ctx.strokeStyle = rim || col; ctx.lineWidth = rim ? 1.2 : 0.8; ctx.fill(); ctx.stroke();
    };
    const fogAt = () => 0;   // no camera-dependent haze on the ground: colours must not change as the camera moves
    const Y = (x, z) => vh(x, z) + 0.03;
    // light from behind the tee: faces sloping toward the target read brighter, faces sloping away darker
    const shade = (x, z) => { const gr = h.grad(x, z); return clamp(1 + (gr.gx * 0.8 - gr.gz * 0.4) * 9, 0.68, 1.32); };
    if (key !== tKey) {
    tKey = key;
    if (tCv.width !== W * dprNow || tCv.height !== H * dprNow) { tCv.width = W * dprNow; tCv.height = H * dprNow; }
    tCtx.setTransform(dprNow, 0, 0, dprNow, 0, 0); ctx = tCtx;
    // sky + haze
    const sg = ctx.createLinearGradient(0, 0, 0, Math.max(hy, 10));
    sg.addColorStop(0, '#5aaeee'); sg.addColorStop(1, '#d8f0ff');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = mixc(SURFC.rough, 1, 0.7); ctx.fillRect(0, Math.max(hy, 0), W, H);
    const yaw = Math.atan2(Fz, Fx);
    if (hy > -50) for (let l = 0; l < 2; l++) {
      ctx.fillStyle = l ? 'rgb(118,180,138)' : 'rgb(150,200,165)';
      ctx.beginPath(); ctx.moveTo(0, hy + 2);
      for (let px = 0; px <= W; px += 14) {
        const a = yaw * 700 + px * (1 + l * 0.3);
        ctx.lineTo(px, hy - (22 + l * 10) - 16 * Math.sin(a / 130 + l * 2) - 9 * Math.sin(a / 47));
      }
      ctx.lineTo(W, hy + 2); ctx.fill();
    }


    // ground base: dark out-of-bounds tone over the whole area, then in-bounds rough, fairway and features on top
    const xs = h.pts.map(p => p.x), zs = h.pts.map(p => p.z);
    const bx0 = putting ? h.gcx - (h.greenMax + 30) : Math.min(...xs, S.ball.x, c.px) - 150, bx1 = putting ? h.gcx + (h.greenMax + 30) : Math.max(...xs, S.ball.x) + 150;
    const bz0 = putting ? h.gcz - (h.greenMax + 30) : Math.min(...zs, S.ball.z, c.pz) - 150, bz1 = putting ? h.gcz + (h.greenMax + 30) : Math.max(...zs, S.ball.z) + 150;
    for (let x = bx0; x < bx1;) {
      const dx = clamp(0.05 * Math.abs(x - c.px) + 2, putting ? 1 : 2, 14), xc = x + dx / 2, zc = (bz0 + bz1) / 2, y0v = vh(x, zc), y1v = vh(x + dx, zc);
      poly([[x, y0v, bz0], [x + dx, y1v, bz0], [x + dx, y1v, bz1], [x, y0v, bz1]], mixc(SURFC.rough, 0.72, fogAt(xc, zc)));
      x += dx;
    }
    const legs = [];
    for (let i = 0; i < h.pts.length - 1; i++) {
      const A = h.pts[i], B = h.pts[i + 1], len = Math.hypot(B.x - A.x, B.z - A.z);
      legs.push({ A, B, len, ux: (B.x - A.x) / len, uz: (B.z - A.z) / len });
    }
    const disc = (cx, cz, rad, col) => {
      const pts = [];
      for (let i = 0; i < 28; i++) { const t = i / 28 * Math.PI * 2, x = cx + Math.cos(t) * rad; const z = cz + Math.sin(t) * rad; pts.push([x, Y(x, z), z]); }
      poly(pts, col);
    };
    // a band of the course centre line, half-width `half`, coloured per stripe
    // A band of the course centre line, built from flat-coloured square cells of a fixed size
    const strip = (half, step, colOf) => {
      const nSub = Math.max(1, Math.round(2 * half / (half > 30 ? 12 : 8)));
      let sAcc = 0;
      for (const L of legs) {
        for (let t = 0; t < L.len; t += step) {
          const t2 = Math.min(t + step, L.len), ax = L.A.x + L.ux * t, az = L.A.z + L.uz * t, bxp = L.A.x + L.ux * t2, bzp = L.A.z + L.uz * t2;
          for (let k = 0; k < nSub; k++) {
            const o0 = -half + 2 * half * k / nSub, o1 = -half + 2 * half * (k + 1) / nSub, nx = -L.uz, nz = L.ux;
            const p00 = [ax + nx * o0, az + nz * o0], p10 = [bxp + nx * o0, bzp + nz * o0], p11 = [bxp + nx * o1, bzp + nz * o1], p01 = [ax + nx * o1, az + nz * o1];
            const mx = (p00[0] + p11[0]) / 2, mz = (p00[1] + p11[1]) / 2;
            poly([[p00[0], Y(p00[0], p00[1]), p00[1]], [p10[0], Y(p10[0], p10[1]), p10[1]], [p11[0], Y(p11[0], p11[1]), p11[1]], [p01[0], Y(p01[0], p01[1]), p01[1]]],
              colOf(Math.floor((sAcc + t) / step), mx, mz));
          }
        }
        sAcc += L.len;
      }
    };
    const inb = (i, xm, zm) => mixc(SURFC.rough, shade(xm, zm), fogAt(xm, zm));
    strip(P.OB, 12, inb);
    for (const p of h.pts) disc(p.x, p.z, P.OB, mixc(SURFC.rough, 1, fogAt(p.x, p.z)));
    // fairway in mowed bands, with a round join at the corner
    strip(16, 7, (i, xm, zm) => mixc(SURFC.fairway, shade(xm, zm) * ((i & 1) ? 1.06 : 0.95), fogAt(xm, zm)));
    if (h.corner) disc(h.corner.x, h.corner.z, 16, mixc(SURFC.fairway, 1, fogAt(h.corner.x, h.corner.z)));
    poly([[-4, Y(-4, -7), -7], [6, Y(6, -7), -7], [6, Y(6, 7), 7], [-4, Y(-4, 7), 7]], mixc(SURFC.tee, 1.05, fogAt(1, 0)));
    // distance lines across the fairway (yards to the pin, measured along the hole)
    if (!putting && S.markers) for (const m of MARKERS) {
      const s = h.yards - m.d; if (s < 12) continue;
      const q = h.pointAt(s); if (h.surface(q.x, q.z) === 'water') continue;
      const nx = -q.uz * 16, nz = q.ux * 16, tx = q.ux * 0.5, tz = q.uz * 0.5;
      const cn = (dx, dz) => [q.x + dx, Y(q.x + dx, q.z + dz), q.z + dz];
      poly([cn(-tx + nx, -tz + nz), cn(tx + nx, tz + nz), cn(tx - nx, tz - nz), cn(-tx - nx, -tz - nz)], m.col);
    }
    // water
    for (const w of h.waters) {
      poly(w.pts.map(q => [q.x, Y(q.x, q.z) - 0.05, q.z]), mixc(SURFC.water, 1, 0), 'rgba(255,255,255,.35)');
    }
    // bunkers: each is a polygon (oval, long, kidney, clover or a crescent wrapping the green)
    for (const s of h.sands) {
      poly(s.pts.map(q => [q.x, Y(q.x, q.z) + 0.02, q.z]), mixc(SURFC.sand, 1, 0), 'rgba(150,120,60,.5)');
    }
    // bunker rims: a clean grass lip stroked around the outline (no shading inside the bunker)
    for (const s of h.sands) {
      const P0 = s.pts, n = P0.length;
      let area = 0; for (let i = 0; i < n; i++) { const A = P0[i], B = P0[(i + 1) % n]; area += A.x * B.z - B.x * A.z; }
      const sgn = area >= 0 ? 1 : -1;
      const en = P0.map((A, i) => { const B = P0[(i + 1) % n], dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz) || 1; return { x: sgn * dz / l, z: -sgn * dx / l }; });
      const vn = P0.map((_, i) => { const a = en[(i + n - 1) % n], b = en[i], nx = a.x + b.x, nz = a.z + b.z, l = Math.hypot(nx, nz) || 1; return { x: nx / l, z: nz / l }; });
      const at = (i, off, up) => { const x = P0[i].x + vn[i].x * off, z = P0[i].z + vn[i].z * off; return [x, Y(x, z) + 0.02 + up, z]; };
      // rim
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = proj(...at(i, 0.5, 0.35)), b = proj(...at(j, 0.5, 0.35));
        if (!a || !b) continue;
        const w = clamp(foc * 1.5 / ((a[2] + b[2]) / 2), 1.5, 16);
        ctx.strokeStyle = mixc(SURFC.fairway, 0.86, 0); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    // green with a fringe
    for (const [extra, col, mul] of [[2.6, SURFC.fairway, 1.12], [0, SURFC.green, 1]]) {
      const pts = [];
      for (let i = 0; i < 64; i++) { const t = i / 64 * Math.PI * 2, r = h.shapeR(t) + extra, x = h.gcx + Math.cos(t) * r, z = h.gcz + Math.sin(t) * r; pts.push([x, Y(x, z) + 0.04, z]); }
      poly(pts, mixc(col, mul, fogAt(h.gcx, h.gcz)));
    }

    ctx = mainCtx;
    }
    ctx.drawImage(tCv, 0, 0, W, H);

    // green-reading arrows: which way the ball rolls at each spot. Colour and length show the slope: green = gentle, red = steep
    if (putting) {
      const GR = h.greenMax, stepA = 4;
      const slopeCol = (t) => t < 0.5 ? `rgb(${95 + (255 - 95) * t * 2 | 0},${224 - 11 * t * 2 | 0},${138 - 64 * t * 2 | 0})` : `rgb(255,${213 - 133 * (t - 0.5) * 2 | 0},${74 - 4 * (t - 0.5) * 2 | 0})`;
      ctx.lineWidth = 2.6;
      for (let gx = -GR; gx <= GR; gx += stepA) for (let gz = -GR; gz <= GR; gz += stepA) {
        const x = h.gcx + gx, z = h.gcz + gz;
        if (!h.inGreen(x, z) || Math.hypot(x - h.gcx, z - h.gcz) > h.shapeR(Math.atan2(z - h.gcz, x - h.gcx)) - 1.5) continue;
        const gr = h.grad(x, z), mag = Math.hypot(gr.gx, gr.gz) || 1e-6;
        const t = clamp(mag / 0.095, 0, 1), len = clamp(1 + 26 * mag, 1, 3.4), ux = -gr.gx / mag, uz = -gr.gz / mag, y = h.h(x, z) + 0.05;
        const a = proj(x - ux * len / 2, y, z - uz * len / 2), tip = proj(x + ux * len / 2, y, z + uz * len / 2);
        if (!a || !tip) continue;
        const col = slopeCol(t); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.globalAlpha = 0.92;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
        const dx = tip[0] - a[0], dy = tip[1] - a[1], l = Math.hypot(dx, dy) || 1, hx = dx / l, hyy = dy / l, s = Math.min(10, l * 0.42);
        ctx.beginPath(); ctx.moveTo(tip[0] + hx * s * 0.3, tip[1] + hyy * s * 0.3);
        ctx.lineTo(tip[0] - hx * s - hyy * s * 0.6, tip[1] - hyy * s + hx * s * 0.6);
        ctx.lineTo(tip[0] - hx * s + hyy * s * 0.6, tip[1] - hyy * s - hx * s * 0.6); ctx.fill(); ctx.globalAlpha = 1;
      }
    }

    // aim line + caddie prediction
    const az = curAz() + ((S.phase === 'sweep' || S.phase === 'rise') ? S.sw.ang * D2R : 0), bx = S.ball.x, bz = S.ball.z, D = distToPin();
    if (!gv && (S.phase === 'aim' || S.phase === 'sweep' || S.phase === 'rise')) {
      const L = putting ? Math.min(D + 3, 60) : (S.clubDist[S.clubIdx] || 150), a0 = proj(bx, h.h(bx, bz) + 0.2, bz);
      const ex2 = bx + Math.cos(az) * L, ez2 = bz + Math.sin(az) * L, a1 = proj(ex2, h.h(ex2, ez2) + 0.2, ez2);
      if (a0 && a1) {
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.setLineDash([9, 8]);
        ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke(); ctx.setLineDash([]);
      }
      for (const A of arcs()) {
        const path = A.res.path; ctx.fillStyle = 'rgba(' + A.col + ',' + A.a + ')';
        for (let i = 0; i < path.length; i += putting ? 6 : 4) {
          const p = proj(path[i][0], path[i][1], path[i][2]); if (!p) continue;
          ctx.beginPath(); ctx.arc(p[0], p[1], clamp(foc * 0.18 / p[2], 1.5, 4), 0, 7); ctx.fill();
        }
        const e = A.res.end, pe = proj(e.x, h.h(e.x, e.z) + 0.1, e.z);
        if (pe) {
          const rr = clamp(foc * (putting ? 0.5 : 2.2) / pe[2], 6, 40);
          ctx.strokeStyle = A.ring; ctx.globalAlpha = A.a; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(pe[0], pe[1], rr, rr * 0.5, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
    }

    // sprites (trees, pin, ball) sorted far -> near
    const sprites = [];
    // deep bunker: while you are in one, its far walls stand up out of the sand. They are depth-sorted with the other sprites so that
    // trees, mountains and the flag behind the wall are hidden by it, and the ball and anything in front still show over it.
    if (S.lie === 'sand' && !putting) {
      const bk = inBunker();
      if (bk) {
        const P0 = bk.pts, n = P0.length, LIP = P.LIP;
        let area = 0; for (let i = 0; i < n; i++) { const A = P0[i], B = P0[(i + 1) % n]; area += A.x * B.z - B.x * A.z; }
        const sgn = area >= 0 ? 1 : -1;
        for (let i = 0; i < n; i++) {
          const A = P0[i], B = P0[(i + 1) % n], dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz) || 1, nx = sgn * dz / l, nz = -sgn * dx / l;
          const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
          if (-(nx * (c.px - mx) + nz * (c.pz - mz)) <= 0) continue;     // only the walls that face the camera
          const ya = h.h(A.x, A.z) + 0.02, yb = h.h(B.x, B.z) + 0.02, d = Math.hypot(mx - c.px, mz - c.pz);
          sprites.push({ d: d + 0.3, f: () => {
            poly([[A.x, ya, A.z], [B.x, yb, B.z], [B.x, yb + LIP, B.z], [A.x, ya + LIP, A.z]], mixc(SURFC.sand, 0.66, 0));
            poly([[A.x, ya + LIP * 0.8, A.z], [B.x, yb + LIP * 0.8, B.z], [B.x, yb + LIP, B.z], [A.x, ya + LIP, A.z]], mixc(SURFC.sand, 0.5, 0));   // shadowed upper face
            poly([[A.x, ya + LIP, A.z], [B.x, yb + LIP, B.z], [B.x, yb + LIP + 0.3, B.z], [A.x, ya + LIP + 0.3, A.z]], mixc(SURFC.fairway, 0.9, 0));   // grass edge on top
          } });
        }
      }
    }
    // mountains: a polar mesh of quads, green at the foot -> rock -> pale summit, shaded by slope.
    // The geometry and colours never change, so they are built once per mountain and only projected each frame.
    for (const m of h.mountains) {
      if (!m.quads) {
        const rings = 9, secs = 28, base = h.h(m.x + m.R * 1.02, m.z);
        const vert = (r, t) => { const x = m.x + Math.cos(t) * r, z = m.z + Math.sin(t) * r; return [x, h.h(x, z) + 0.03, z]; };
        m.quads = [];
        for (let k = 0; k < rings; k++) for (let j = 0; j < secs; j++) {
          const r0 = m.R * k / rings, r1 = m.R * (k + 1) / rings, t0 = j / secs * Math.PI * 2, t1 = (j + 1) / secs * Math.PI * 2, tm = (t0 + t1) / 2, rm = (r0 + r1) / 2;
          const qx = m.x + Math.cos(tm) * rm, qz = m.z + Math.sin(tm) * rm, hf = clamp((h.h(qx, qz) - base) / m.A, 0, 1), gr = h.grad(qx, qz);
          const sh = clamp(1 + (gr.gx * 0.8 - gr.gz * 0.4) * 9, 0.68, 1.32), grass = SURFC.rough, rock = [128, 116, 98], snow = [214, 210, 200];
          const col = hf < 0.28 ? grass.map((v, i) => v + (rock[i] - v) * (hf / 0.28)) : hf < 0.8 ? rock : rock.map((v, i) => v + (snow[i] - v) * ((hf - 0.8) / 0.2));
          m.quads.push({ v: [vert(r0, t0), vert(r0, t1), vert(r1, t1), vert(r1, t0)], col, sh, qx, qz, qy: h.h(qx, qz) });
        }
      }
      for (const q of m.quads) {
        const qd = cam(q.qx, q.qy, q.qz).d;
        if (qd < 1) continue;
        sprites.push({ d: qd + 0.5, f: () => poly(q.v, mixc(q.col, q.sh, fogAt(q.qx, q.qz))) });
      }
    }
    const LEAF = [[36, 104, 56], [46, 128, 70], [60, 140, 66], [30, 92, 62], [86, 140, 50]];
    if (!putting) h.trees.forEach((t, i) => {
      const p = proj(t.x, h.h(t.x, t.z), t.z);
      if (!p || p[2] < 3) return;
      sprites.push({ d: p[2], f: () => {
        const th = foc * t.size * 1.3 / p[2], fog = clamp((p[2] - 140) / 750, 0, 0.7), x = p[0], y = p[1], type = t.type || 'round';
        if (x < -th || x > W + th) return;
        let leaf = LEAF[Math.floor(t.shade * 997) % LEAF.length];
        if (t.shade > 0.94 && type !== 'pine' && type !== 'cypress') leaf = [[214, 120, 40], [204, 160, 44], [176, 70, 44]][Math.floor(t.shade * 1000) % 3];   // the odd autumn tree
        if (type === 'pine' || type === 'cypress') leaf = leaf.map(v => v * 0.82);
        const col = (c2, k) => mixc(c2, k || 1, fog), ell = (cx, cy, rx, ry) => { ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, 7); ctx.fill(); };
        if (type === 'pine') {
          ctx.fillStyle = col([88, 62, 38]); ctx.fillRect(x - th * 0.022, y - th * 0.22, th * 0.044, th * 0.22);
          for (let k = 0; k < 4; k++) {
            const by = y - th * (0.14 + 0.2 * k), hw = th * (0.17 - 0.03 * k);
            ctx.fillStyle = col(leaf, 0.9 + 0.06 * k); ctx.beginPath(); ctx.moveTo(x - hw, by); ctx.lineTo(x + hw, by); ctx.lineTo(x, by - th * 0.3); ctx.closePath(); ctx.fill();
          }
        } else if (type === 'cypress') {
          ctx.fillStyle = col([88, 62, 38]); ctx.fillRect(x - th * 0.015, y - th * 0.12, th * 0.03, th * 0.12);
          ctx.fillStyle = col(leaf, 0.95); ell(x, y - th * 0.55, th * 0.1, th * 0.42);
          ctx.fillStyle = col(leaf, 1.08); ell(x - th * 0.02, y - th * 0.6, th * 0.05, th * 0.32);
        } else if (type === 'oak') {
          ctx.fillStyle = col([84, 58, 34]); ctx.fillRect(x - th * 0.032, y - th * 0.42, th * 0.064, th * 0.42);
          ctx.fillStyle = col(leaf, 0.92); ell(x, y - th * 0.6, th * 0.3, th * 0.24);
          ctx.fillStyle = col(leaf, 1); ell(x - th * 0.17, y - th * 0.5, th * 0.17, th * 0.15); ell(x + th * 0.18, y - th * 0.52, th * 0.16, th * 0.14);
          ctx.fillStyle = col(leaf, 1.1); ell(x + th * 0.02, y - th * 0.72, th * 0.19, th * 0.15);
        } else if (type === 'birch') {
          ctx.fillStyle = col([228, 226, 216]); ctx.fillRect(x - th * 0.018, y - th * 0.5, th * 0.036, th * 0.5);
          ctx.fillStyle = col([70, 70, 64]); for (let k = 1; k < 5; k++) ctx.fillRect(x - th * 0.018, y - th * 0.1 * k * 1.2, th * 0.036, Math.max(1, th * 0.012));
          ctx.fillStyle = col([leaf[0] + 40, leaf[1] + 34, leaf[2] + 26]); ell(x, y - th * 0.68, th * 0.17, th * 0.27);
          ctx.fillStyle = col([leaf[0] + 62, leaf[1] + 50, leaf[2] + 36]); ell(x - th * 0.04, y - th * 0.76, th * 0.09, th * 0.15);
        } else {
          ctx.fillStyle = col([91, 61, 34]); ctx.fillRect(x - th * 0.026, y - th * 0.4, th * 0.052, th * 0.4);
          ctx.fillStyle = col(leaf, 0.95); ell(x, y - th * 0.62, th * 0.21, th * 0.3);
          ctx.fillStyle = col(leaf, 1.08); ell(x - th * 0.02, y - th * 0.78, th * 0.13, th * 0.2);
        }
      } });
    });
    {
      const px = h.pinX, pz = h.pinZ, gy = h.h(px, pz), base = proj(px, gy, pz);
      if (base) {
        sprites.push({ d: base[2], f: () => {
          const fh = putting ? 6 : Math.max(2.6, 30 * base[2] / foc), top = proj(px, gy + fh, pz) || base;
          const ring = (rad) => { const q = []; for (let i = 0; i < 24; i++) { const t = i / 24 * Math.PI * 2, x = px + Math.cos(t) * rad, z = pz + Math.sin(t) * rad; q.push([x, h.h(x, z) + 0.04, z]); } return q; };
          // The cup is always BALL_R : CUP_R (about 0.55 : 1) against the ball. Putting uses the true sizes; from further away both are
          // scaled by the same on-screen minimum, so the proportion never changes as the ball flies or the camera moves.
          let cupR = P.CUP_R;
          if (!putting) {
            const bq = S.fl ? flightPos() : [S.ball.x, h.h(S.ball.x, S.ball.z), S.ball.z], pb = proj(bq[0], bq[1], bq[2]);
            if (pb) cupR = clamp(foc * BALL_R / pb[2], 4, 15) * (P.CUP_R / BALL_R) * base[2] / foc;
          }
          poly(ring(cupR * 1.18), '#cfd3c8');      // lip of the cup
          poly(ring(cupR), '#0a0a0a');
          ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = clamp(foc * 0.05 / base[2], 1.5, 4);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
          const wd = h.wind, wm = Math.hypot(wd.x, wd.z) || 1, k = fh * 0.5 * (0.35 + 0.65 * Math.min(1, wd.mph / 18));
          const wave = Math.sin(S.time * (4 + wd.mph * 0.4)) * 0.06 * fh;
          const t1 = proj(px + wd.x / wm * k, gy + fh - fh * 0.06 + wave, pz + wd.z / wm * k);
          const t2 = proj(px + wd.x / wm * k * 0.15, gy + fh * 0.7, pz + wd.z / wm * k * 0.15);
          if (t1 && t2) { ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(t1[0], t1[1]); ctx.lineTo(t2[0], t2[1]); ctx.fill(); }
        } });
      }
    }
    if (!putting && S.markers) for (const m of MARKERS) {
      const s = h.yards - m.d; if (s < 12) continue;
      const q = h.pointAt(s); if (h.surface(q.x, q.z) === 'water') continue;
      for (const side of [-1, 1]) {
        const mx = q.x - q.uz * 20 * side, mz = q.z + q.ux * 20 * side, p = proj(mx, h.h(mx, mz), mz);
        if (!p || p[2] < 8 || p[2] > 420) continue;
        sprites.push({ d: p[2], f: () => {
          const pw = Math.max(20, foc * 2.6 / p[2]), ph = pw * 0.7, post = ph * 1.15;
          if (p[0] < -pw || p[0] > W + pw) return;
          ctx.fillStyle = '#3a3a3a'; ctx.fillRect(p[0] - pw * 0.05, p[1] - post - ph, pw * 0.1, post + ph);
          ctx.fillStyle = m.col; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
          ctx.fillRect(p[0] - pw / 2, p[1] - post - ph, pw, ph); ctx.strokeRect(p[0] - pw / 2, p[1] - post - ph, pw, ph);
          ctx.fillStyle = m.txt; ctx.font = '800 ' + Math.round(ph * 0.66) + 'px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(m.d, p[0], p[1] - post - ph / 2 + 1);
        } });
      }
    }
    const holed = S.fl && S.fl.res.end.type === 'hole' && S.fl.i >= S.fl.res.path.length - 1;
    if (!holed && S.phase !== 'holeout') {
      const bp = S.fl ? flightPos() : [S.ball.x, h.h(S.ball.x, S.ball.z) + 0.12, S.ball.z];
      const p = proj(bp[0], bp[1], bp[2]), gp = proj(bp[0], h.h(bp[0], bp[2]), bp[2]);
      if (S.fl) { S.trail.push([bp[0], bp[1], bp[2]]); if (S.trail.length > 45) S.trail.shift(); }
      if (p) sprites.push({ d: p[2], f: () => {
        const r = putting ? Math.max(2.5, foc * BALL_R / p[2]) : clamp(foc * BALL_R / p[2], 4, 15);   // true size when putting, with a minimum so it stays visible from far away
        if (gp) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(gp[0], gp[1], r * 1.1, r * 0.4, 0, 0, 7); ctx.fill(); }
        for (let i = 0; i < S.trail.length; i++) {
          const q = proj(S.trail[i][0], S.trail[i][1], S.trail[i][2]); if (!q) continue;
          ctx.fillStyle = 'rgba(255,255,255,' + (i / S.trail.length * 0.5) + ')';
          ctx.beginPath(); ctx.arc(q[0], q[1], r * 0.6 * (i / S.trail.length), 0, 7); ctx.fill();
        }
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p[0], p[1] - (S.fl ? 0 : r * 0.8), r, 0, 7); ctx.fill(); ctx.stroke();
      } });
    }
    sprites.sort((a, b) => b.d - a.d).forEach(s => s.f());
  }

  function drawMini() {
    const h = S.hole; if (!h) return;
    const c = mctx, MW = 640, MH = 340;
    const D = distToPin();
    // fit the ball, the pin, the corner and the aim point in view
    const tg = aimTarget(), keyPts = [S.ball, { x: h.pinX, z: h.pinZ }, { x: tg.x, z: tg.z }];
    if (h.corner && S.lie !== 'green') keyPts.push(h.corner);
    const kx = keyPts.map(p => p.x), kz = keyPts.map(p => p.z);
    const minX = Math.min(...kx) - 22, maxX = Math.max(...kx) + 22, minZ = Math.min(...kz) - 22, maxZ = Math.max(...kz) + 22;
    const spanX = Math.max(maxX - minX, 50), spanZ = Math.max(maxZ - minZ, 26);
    const sM = Math.min((MW - 36) / spanX, (MH - 30) / spanZ), cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const X = (x) => MW / 2 + (x - cx) * sM, Z = (z) => MH / 2 + (z - cz) * sM;
    const trace = (half, col) => {
      c.strokeStyle = col; c.lineWidth = half * 2 * sM; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); h.pts.forEach((p, i) => i ? c.lineTo(X(p.x), Z(p.z)) : c.moveTo(X(p.x), Z(p.z))); c.stroke(); c.lineCap = 'butt';
    };
    c.clearRect(0, 0, MW, MH);
    c.fillStyle = '#1b3a26'; c.fillRect(0, 0, MW, MH);   // out of bounds
    trace(P.OB, '#2d7a43');                                // in-bounds rough
    trace(16, '#4fb85f');                                  // fairway
    c.fillStyle = '#3fa15a'; c.fillRect(X(-3), Z(-7), 9 * sM, 14 * sM);
    // water
    for (const w of h.waters) {
      c.fillStyle = '#3b8fd6'; c.beginPath();
      w.pts.forEach((q, i) => i ? c.lineTo(X(q.x), Z(q.z)) : c.moveTo(X(q.x), Z(q.z)));
      c.closePath(); c.fill();
    }
    // mountains and woods
    for (const m of h.mountains) {
      c.fillStyle = '#7a6f5e'; c.beginPath(); c.arc(X(m.x), Z(m.z), m.R * sM, 0, 7); c.fill();
      c.fillStyle = '#9b917f'; c.beginPath(); c.arc(X(m.x), Z(m.z), m.R * 0.6 * sM, 0, 7); c.fill();
      c.fillStyle = '#d6d2c8'; c.beginPath(); c.arc(X(m.x), Z(m.z), m.R * 0.25 * sM, 0, 7); c.fill();
    }
    c.fillStyle = '#1d5c33';
    for (const t of h.trees) if (t.block) { c.beginPath(); c.arc(X(t.x), Z(t.z), Math.max(3, 3.4 * sM), 0, 7); c.fill(); }
    // sand
    c.fillStyle = '#e6d192';
    for (const s of h.sands) { c.beginPath(); s.pts.forEach((q, i) => i ? c.lineTo(X(q.x), Z(q.z)) : c.moveTo(X(q.x), Z(q.z))); c.closePath(); c.fill(); }
    // green
    c.fillStyle = '#78e08a'; c.beginPath();
    for (let i = 0; i < 64; i++) { const t = i / 64 * Math.PI * 2, r = h.shapeR(t), px = X(h.gcx + Math.cos(t) * r), pz = Z(h.gcz + Math.sin(t) * r); i ? c.lineTo(px, pz) : c.moveTo(px, pz); }
    c.closePath(); c.fill();
    // pin
    c.fillStyle = '#111'; c.beginPath(); c.arc(X(h.pinX), Z(h.pinZ), Math.max(2, P.CUP_R * sM), 0, 7); c.fill();
    c.fillStyle = '#ff4d4d'; c.beginPath(); const pzs = Z(h.pinZ); c.moveTo(X(h.pinX), pzs); c.lineTo(X(h.pinX), pzs - 20); c.lineTo(X(h.pinX) + 14, pzs - 15); c.lineTo(X(h.pinX), pzs - 10); c.fill();
    // aim line
    const az = curAz() + ((S.phase === 'sweep' || S.phase === 'rise') ? S.sw.ang * D2R : 0), bx = X(S.ball.x), bz2 = Z(S.ball.z);
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2; c.setLineDash([8, 7]);
    c.beginPath(); c.moveTo(bx, bz2); const aimLen = CLUBS[S.clubIdx].putter ? Math.min(D + 3, 60) : (S.clubDist[S.clubIdx] || 150);
    c.lineTo(bx + Math.cos(az) * aimLen * sM, bz2 + Math.sin(az) * aimLen * sM); c.stroke(); c.setLineDash([]);
    if (!tg.pin) { c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2; c.beginPath(); c.moveTo(X(tg.x) - 6, Z(tg.z) - 6); c.lineTo(X(tg.x) + 6, Z(tg.z) + 6); c.moveTo(X(tg.x) + 6, Z(tg.z) - 6); c.lineTo(X(tg.x) - 6, Z(tg.z) + 6); c.stroke(); }
    // ghost landing
    for (const A of arcs()) {
      const e = A.res.end;
      // solid, outlined markers so they stay readable over water, sand and fairway
      const full = A.ring === '#fff', mx = X(e.x), mz = Z(e.z);
      c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.65)'; c.beginPath(); c.arc(mx, mz, full ? 8 : 10, 0, 7); c.stroke();
      if (full) { c.fillStyle = '#c9ced1'; c.beginPath(); c.arc(mx, mz, 8, 0, 7); c.fill(); }
      c.lineWidth = 3.5; c.strokeStyle = full ? '#f2f4f5' : A.ring; c.beginPath(); c.arc(mx, mz, full ? 8 : 10, 0, 7); c.stroke();
    }
    // shot in flight / ball
    let px = S.ball.x, pz = S.ball.z;
    if (S.fl) { const p = flightPos(); px = p[0]; pz = p[2]; }
    c.fillStyle = '#fff'; c.strokeStyle = '#333'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(X(px), Z(pz), 6, 0, 7); c.fill(); c.stroke();
  }

  /* ---------------------------------------------------------------- main loop */
  let last = performance.now();
  function frame(now) {
    // fixed 30 fps target: skip animation frames that arrive early (e.g. on 60/144 Hz displays)
    if (now - last < 1000 / 30 - 2) { requestAnimationFrame(frame); return; }
    const dt = Math.min(0.25, (now - last) / 1000); last = now; S.time += dt;
    if (S.hole && (S.mode === 'play' || S.mode === 'result' || S.mode === 'menu')) update(dt);
    if (S.hole) { if (S.view === 'behind') { updateCamera3(dt); drawBehind(); } else { updateCamera(dt); drawScene(); } if (!$('hud').classList.contains('hidden')) { drawMini(); updateMeter(); } }
    else { ctx.fillStyle = '#6db8f2'; ctx.fillRect(0, 0, W, H); }
    requestAnimationFrame(frame);
  }

  function update(dt) {
    const club = CLUBS[S.clubIdx];
    if (S.phase === 'sweep') {
      // aim indicator swings +-5 deg (putter +-1.5) around the angle you set
      S.sw.t += dt; S.sw.ang = (club.putter ? 1.5 : 7.5) * Math.sin(S.sw.t * Math.PI * 2 / 1.7);
    } else if (S.phase === 'rise') {
      // bar sweeps 0 -> 100 -> 0 until the player clicks
      S.sw.m += S.sw.dir * 100 / club.rise * dt;
      if (S.sw.m >= 100) { S.sw.m = 100; S.sw.dir = -1; } else if (S.sw.m <= 0) { S.sw.m = 0; S.sw.dir = 1; }
      S.live = P.simulate(S.hole, S.ball, { club, power: Math.max(0.02, S.sw.m / 100), az: curAz(), err: S.sw.ang * D2R, lie: S.lie, free: true });   // the blue line is the pure flight: it ignores trees and mountains
    } else if (S.phase === 'flight' && S.fl) {
      const f = S.fl, path = f.res.path;
      const p = path[Math.min(Math.floor(f.i), path.length - 1)];
      const air = p[1] > S.hole.h(p[0], p[2]) + 0.08;
      let rate = air ? 1 : 1.9;
      if (S.closeup && !air) rate = 1;   // the roll into the cup plays at real pace
      if (f.club.putter) rate = 1;   // putts play at the physics' real-time pace (a 10 ft putt takes ~1.7 s, 35 ft ~3 s)
      f.i += dt * 60 * rate;
      if (f.i >= path.length - 1) { f.i = path.length - 1; finishShot(); }
    } else if (S.phase === 'gimme') {
      S.waitT -= dt;
      if (S.waitT <= 0) { S.strokes++; S.ball = { x: S.hole.pinX, z: S.hole.pinZ }; sfx.cup(); holeDone(S.strokes, false); }
    } else if (S.phase === 'wait') {
      S.waitT -= dt;
      if (S.waitT <= 0) { S.phase = 'aim'; const keepMsg = $('meterMsg').textContent; prepareShot(true); $('meterMsg').textContent = keepMsg; }
    } else if (S.phase === 'holeout') {
      S.waitT -= dt;
      if (S.waitT <= 0) showHoleResult();
    }
  }

  setMarkersBtn();
  // --- touch on the playfield (phones): one finger drags to look left / right, two fingers pinch-zoom while putting
  const tp = new Map(); let pd0 = 0, z0 = 1;
  const canvasTouch = (e) => mobile && e.pointerType === 'touch' && S.mode === 'play' && !e.target.closest('#clubs, #camctl, #menu, #result, #mBtns, #clubChip, #btnMenuM, #meterWrap, #mini');
  const puttView = () => onGreen() || S.greenView;
  const pdist = () => { const [a, b] = [...tp.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  document.addEventListener('pointerdown', (e) => {
    if (!canvasTouch(e)) return;
    tp.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tp.size === 2) { pd0 = pdist() || 1; z0 = S.zoom; }
  });
  document.addEventListener('pointermove', (e) => {
    const prev = tp.get(e.pointerId); if (!prev) return;
    tp.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tp.size === 1) { if (S.phase === 'aim' || S.phase === 'sweep' || S.phase === 'rise') S.camYaw = clamp(S.camYaw + (e.clientX - prev.x) * 0.35, -120, 120); }
    else if (tp.size === 2 && puttView()) S.zoom = clamp(z0 * pdist() / pd0, 0.45, 3.5);
  });
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, (e) => { tp.delete(e.pointerId); }));
  cv.style.touchAction = 'none';
  // --- touch controls (portrait phones)
  const swingBtn = $('btnSwing');
  swingBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); document.body.classList.remove('sheet'); if (navigator.vibrate) try { navigator.vibrate(12); } catch (x) { /* ignore */ } action(); });
  function holdButton(el, dir) {
    let timer = null, t0 = 0;
    const stop = () => { clearInterval(timer); timer = null; };
    const tick = () => { const held = performance.now() - t0; nudgeAim(dir * (held > 1400 ? 3 : held > 450 ? 1.2 : 0.5)); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); if (S.mode !== 'play') return; t0 = performance.now(); tick(); timer = setInterval(tick, 110); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, stop));
  }
  holdButton($('btnAimL'), -1); holdButton($('btnAimR'), 1);
  $('btnMenuM').addEventListener('pointerdown', (e) => { e.preventDefault(); document.body.classList.toggle('sheet'); });
  // the big button tells you what the next tap does
  function updateSwingBtn() {
    const t = { aim: 'SWING', sweep: 'LOCK AIM', rise: 'LOCK POWER' }[S.phase];
    swingBtn.textContent = t || '…'; swingBtn.classList.toggle('dis', !t);
    swingBtn.dataset.phase = S.phase;
    // the club chip / list only shows while you are lining up a shot: not in flight, and never over the hole result or menus
    document.body.classList.toggle('hideClub', !(S.mode === 'play' && (S.phase === 'aim' || S.phase === 'sweep' || S.phase === 'rise')));
  }
  setInterval(updateSwingBtn, 60);
  // the club bar is collapsed to one chip: tap it to open the full list, pick a club to drop it back down
  let lastClub = -1;
  const chip = $('clubChip');
  chip.addEventListener('pointerdown', (e) => { e.preventDefault(); document.body.classList.remove('sheet'); document.body.classList.toggle('clubs-open'); lastClub = -1; });
  $('clubList').addEventListener('click', () => document.body.classList.remove('clubs-open'));
  setInterval(() => {
    const el = $('clubs').querySelector('.club.sel'); if (!el) return;
    const n = el.querySelector('.n').textContent, d = el.querySelector('.d').textContent, html = `<span class="n">${n}</span><span class="d">${d}</span>`;   // no ids here: cdN must stay unique
    if (chip.dataset.h !== html) { chip.dataset.h = html; chip.innerHTML = html; }
  }, 120);
  // keep the selected club centred in the scrolling club bar
  setInterval(() => {
    if (!mobile || S.clubIdx === lastClub) return; lastClub = S.clubIdx;
    const box = $('clubs'), el = box.querySelector('.club.sel'); if (!el) return;
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
  }, 120);
  S.dbg = { closeupCam, updateCamera3, prepareShot, suggestClub, drawBehind, drawMini, cam3, addressCam, updateCaddie, updateDistances, aimTarget, caddieAim, update, hit };
  openMenu();
  requestAnimationFrame(frame);
})();
