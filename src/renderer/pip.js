// Pip's brain: floating, gliding, turning, reacting and talking.
// The page fills the whole screen. Pip is one element moved around in it.

(() => {
  'use strict';

  // When opened in a normal browser (for quick testing) there is no pipApi.
  const api = window.pipApi || {
    setClickThrough() {},
    getPrefs: async () => ({}),
    onCommand() {},
  };
  const LINES = window.PIP_LINES;

  const DEFAULT_PREFS = {
    wander: true,
    bubbles: true,
    skin: 'classic',
    glow: 'blue',
    antenna: 'tubes',
    stickers: true,
    ambient: true,
    size: 'medium',
    roam: 'bottom',
  };
  const SIZES = { small: 0.8, medium: 1, large: 1.25 };

  // Pip's drawing is 140x175; his head (the grabbable part) sits inside it.
  const BASE_W = 140;
  const BASE_H = 175;
  const HEAD = { x0: 12, x1: 128, y0: 0, y1: 130 };
  const HEAD_CY = 80; // centre of the head, for eyes and effects
  const RING_Y = 161; // holo ring, for sparkle trails

  const MAX_SPEED = 150; // px/s while gliding
  const STEER = 2.6; // how quickly he changes velocity (higher = snappier)
  const SIDE_ON = 32; // px/s sideways before he turns to side profile
  const FRONT_AT = 12; // px/s sideways below which he faces you again

  const LONELY_MS = 150 * 1000; // looks sad after 2.5 quiet minutes
  const SLEEP_AFTER_MS = 210 * 1000; // naps after 3.5
  const LATE_NIGHT_EVERY_MS = 25 * 60 * 1000;

  const pipEl = document.getElementById('pip');
  const bubbleEl = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const lookEl = document.getElementById('look');
  const fxEl = document.getElementById('fx');

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const now = () => performance.now();

  const s = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    mode: 'idle', // idle | glide | drag | fling | sleep
    tx: 0,
    ty: 0,
    view: 'front',
    facing: 1,
    tilt: 0,
    scale: 1,
    nextDecision: 0,
    lastInteraction: now(),
    lonelyShown: false,
    lastLateNag: 0,
    trailAt: 0,
    interactive: false,
    prefs: { ...DEFAULT_PREFS },
    mouse: { x: null, y: null },
    pressed: false,
    pressAt: { x: 0, y: 0 },
    grabOffset: { x: 0, y: 0 },
    dragHistory: [],
    patDir: 0,
    patFlips: 0,
    patLastFlip: 0,
    patCooldownUntil: 0,
    pokeTimes: [],
  };

  const W = () => BASE_W * s.scale;
  const H = () => BASE_H * s.scale;
  const minX = () => -HEAD.x0 * s.scale;
  const maxX = () => Math.max(minX(), window.innerWidth - HEAD.x1 * s.scale);
  const minY = () => 30 * s.scale; // keep the antennas on screen
  const maxY = () => Math.max(minY(), window.innerHeight - H());

  // ---------------------------------------------------------------- helpers

  function setInteractive(on) {
    if (on === s.interactive) return;
    s.interactive = on;
    api.setClickThrough(!on);
  }

  function flash(cls, ms) {
    pipEl.classList.remove(cls);
    void pipEl.offsetWidth; // restart the animation
    pipEl.classList.add(cls);
    setTimeout(() => pipEl.classList.remove(cls), ms);
  }

  let faceTimer = null;
  function setFace(face, ms) {
    clearTimeout(faceTimer);
    pipEl.dataset.face = face;
    if (ms) {
      faceTimer = setTimeout(() => {
        pipEl.dataset.face = s.mode === 'sleep' ? 'sleepy' : 'normal';
      }, ms);
    }
  }

  function headCentre() {
    return { x: s.x + (BASE_W / 2) * s.scale, y: s.y + HEAD_CY * s.scale };
  }

  function spawnFx(text, cls, count = 1, opts = {}) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const c = headCentre();
        const el = document.createElement('div');
        el.className = `fx ${cls || ''}`;
        el.textContent = text;
        const x = opts.x ?? c.x + rand(-50, 40) * s.scale;
        const y = opts.y ?? c.y - rand(30, 60) * s.scale;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.setProperty('--dx', `${opts.dx ?? rand(-25, 25)}px`);
        fxEl.appendChild(el);
        setTimeout(() => el.remove(), 1700);
      }, i * 180);
    }
  }

  function touch() {
    s.lastInteraction = now();
    s.lonelyShown = false;
    if (s.mode === 'sleep') wake();
    else if (pipEl.dataset.face === 'sad') setFace('normal');
  }

  // ----------------------------------------------------------------- speech

  let typeTimer = null;
  let hideTimer = null;

  function say(text, { face, faceMs } = {}) {
    if (face) setFace(face, faceMs || 2500);
    if (!s.prefs.bubbles) {
      pipEl.classList.add('talking');
      setTimeout(() => pipEl.classList.remove('talking'), 600);
      return;
    }

    clearInterval(typeTimer);
    clearTimeout(hideTimer);
    bubbleText.textContent = '';
    bubbleEl.classList.remove('done');
    bubbleEl.classList.add('show');
    pipEl.classList.add('talking');

    let i = 0;
    typeTimer = setInterval(() => {
      i += 1;
      bubbleText.textContent = text.slice(0, i);
      placeBubble();
      if (i >= text.length) {
        clearInterval(typeTimer);
        bubbleEl.classList.add('done');
        pipEl.classList.remove('talking');
        hideTimer = setTimeout(hideBubble, 2200 + text.length * 45);
      }
    }, 32);
  }

  function hideBubble() {
    clearInterval(typeTimer);
    bubbleEl.classList.remove('show');
    pipEl.classList.remove('talking');
  }

  // Keep the bubble on screen: below Pip near the top, nudged near the sides.
  function placeBubble() {
    if (!bubbleEl.classList.contains('show')) return;
    bubbleEl.classList.toggle('below', s.y < 80 * s.scale);
    const half = (bubbleEl.offsetWidth / 2) * s.scale;
    const centre = s.x + (BASE_W / 2) * s.scale;
    const margin = 8;
    let nudge = 0;
    if (centre - half < margin) nudge = margin - (centre - half);
    else if (centre + half > window.innerWidth - margin)
      nudge = window.innerWidth - margin - (centre + half);
    bubbleEl.style.setProperty('--nudge', `${nudge / s.scale}px`);
  }

  function greetingFor(date = new Date()) {
    const h = date.getHours();
    if (h >= 5 && h < 12) return pick(LINES.greetMorning);
    if (h >= 12 && h < 17) return pick(LINES.greetAfternoon);
    if (h >= 17 && h < 23) return pick(LINES.greetEvening);
    return pick(LINES.greetNight);
  }

  // ---------------------------------------------------------------- look

  function applyLook() {
    const p = s.prefs;
    document.body.dataset.skin = p.skin;
    document.body.dataset.glow = p.glow;
    document.body.dataset.antenna = p.antenna;
    document.body.classList.toggle('no-stickers', !p.stickers);
    document.body.classList.toggle('no-ambient', !p.ambient);
    const newScale = SIZES[p.size] || 1;
    if (newScale !== s.scale) {
      // grow/shrink around his centre so he doesn't jump
      const c = headCentre();
      s.scale = newScale;
      s.x = c.x - (BASE_W / 2) * s.scale;
      s.y = c.y - HEAD_CY * s.scale;
      clampToScreen();
    }
  }

  // ---------------------------------------------------------------- actions

  function setMode(mode) {
    s.mode = mode;
    pipEl.classList.toggle('dragging', mode === 'drag');
    pipEl.classList.toggle('asleep', mode === 'sleep');
    pipEl.classList.toggle('moving', mode === 'glide' || mode === 'fling');
  }

  function wave() {
    flash('waving', 1300);
    spawnFx('✦', 'spark', 2);
  }

  function lookAround() {
    setFace('curious', 2600);
    if (Math.random() < 0.5) say(pick(LINES.curious), { face: 'curious', faceMs: 2600 });
  }

  function randomSpot() {
    const x = clamp(s.x + rand(-450, 450), minX(), maxX());
    let y;
    if (s.prefs.roam === 'anywhere') {
      // anywhere on screen, but a bit more often in the lower half
      y = Math.random() < 0.6 ? rand((minY() + maxY()) / 2, maxY()) : rand(minY(), maxY());
    } else {
      y = maxY() - rand(0, 70) * s.scale;
    }
    return { x, y };
  }

  function glideTo(x, y) {
    s.tx = clamp(x, minX(), maxX());
    s.ty = clamp(y, minY(), maxY());
    if (Math.hypot(s.tx - s.x, s.ty - s.y) < 12) return;
    setMode('glide');
  }

  function sleep() {
    setMode('sleep');
    s.vx = 0;
    s.vy = 0;
    setFace('sleepy');
    hideBubble();
  }

  function wake() {
    setMode('idle');
    setFace('surprised', 900);
    flash('hop', 450);
    s.nextDecision = now() + 4000;
    setTimeout(() => say(pick(LINES.wake), { face: 'excited', faceMs: 1800 }), 500);
  }

  function poke() {
    const t = now();
    s.pokeTimes = s.pokeTimes.filter((p) => t - p < 3000);
    s.pokeTimes.push(t);
    flash('hop', 450);
    if (s.pokeTimes.length >= 5) {
      s.pokeTimes = [];
      flash('shake', 450);
      say(pick(LINES.pokeSpam), { face: 'annoyed', faceMs: 2200 });
    } else {
      say(pick(LINES.poke), { face: 'surprised', faceMs: 900 });
    }
  }

  function headPat() {
    s.patCooldownUntil = now() + 3000;
    setFace('love', 2200);
    spawnFx('♥', 'heart', 3);
    say(pick(LINES.pat));
  }

  function decide() {
    const r = Math.random();
    if (s.prefs.wander && r < 0.45) {
      const spot = randomSpot();
      glideTo(spot.x, spot.y);
    } else if (r < 0.58) {
      say(pick(LINES.idle));
    } else if (r < 0.66) {
      lookAround();
    } else if (r < 0.72) {
      setFace('wink', 900);
      if (Math.random() < 0.4) say(pick(LINES.wink), { face: 'wink', faceMs: 1500 });
    } else if (r < 0.77) {
      say(pick(LINES.silly), { face: 'silly', faceMs: 2000 });
    } else if (r < 0.83) {
      wave();
    } else if (r < 0.87) {
      flash('spin', 850);
      spawnFx('✦', 'spark', 3);
    } else if (r < 0.92) {
      flash('hop', 450);
    }
    s.nextDecision = now() + rand(4000, 10000);
  }

  // ---------------------------------------------------------------- the eyes

  function updateLook() {
    if (s.mouse.x === null || s.mode === 'sleep' || s.view !== 'front') {
      lookEl.style.transform = '';
      return;
    }
    const c = headCentre();
    const dx = s.mouse.x - c.x;
    const dy = s.mouse.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, d / 250);
    lookEl.style.transform = `translate(${((dx / d) * 5 * reach).toFixed(2)}px, ${(
      (dy / d) * 3.5 * reach
    ).toFixed(2)}px)`;
  }

  function scheduleBlink() {
    setTimeout(() => {
      if (pipEl.dataset.face === 'normal' && s.mode !== 'sleep') {
        pipEl.classList.add('blink');
        setTimeout(() => pipEl.classList.remove('blink'), 130);
        if (Math.random() < 0.2) {
          setTimeout(() => {
            pipEl.classList.add('blink');
            setTimeout(() => pipEl.classList.remove('blink'), 120);
          }, 260);
        }
      }
      scheduleBlink();
    }, rand(2200, 6000));
  }

  // ------------------------------------------------------------------ mouse

  function local(x, y) {
    return { lx: (x - s.x) / s.scale, ly: (y - s.y) / s.scale };
  }

  function overPip(x, y) {
    const { lx, ly } = local(x, y);
    return lx >= HEAD.x0 && lx <= HEAD.x1 && ly >= HEAD.y0 && ly <= HEAD.y1;
  }

  function overHeadTop(x, y) {
    const { lx, ly } = local(x, y);
    return lx >= HEAD.x0 && lx <= HEAD.x1 && ly >= 0 && ly <= 70;
  }

  document.addEventListener('mousemove', (e) => {
    const { clientX: x, clientY: y } = e;
    const prevX = s.mouse.x;
    s.mouse.x = x;
    s.mouse.y = y;

    if (s.mode === 'drag') {
      s.x = x - s.grabOffset.x;
      s.y = y - s.grabOffset.y;
      s.dragHistory.push({ x, y, t: now() });
      if (s.dragHistory.length > 6) s.dragHistory.shift();
      const vx = s.dragHistory.length > 1 ? x - s.dragHistory[0].x : 0;
      s.tilt = clamp(-vx * 0.6, -25, 25);
      return;
    }

    if (s.pressed && Math.hypot(x - s.pressAt.x, y - s.pressAt.y) > 5) {
      setMode('drag');
      s.vx = 0;
      s.vy = 0;
      say(pick(LINES.grab), { face: 'excited', faceMs: 99999 });
      s.dragHistory = [{ x, y, t: now() }];
      return;
    }

    const hovering = overPip(x, y);
    setInteractive(hovering);
    if (hovering) touch();

    // Head pats: rub side-to-side over the top of his head.
    if (hovering && overHeadTop(x, y) && prevX !== null && now() > s.patCooldownUntil) {
      const dx = x - prevX;
      const dir = Math.abs(dx) < 2 ? 0 : Math.sign(dx);
      const t = now();
      if (t - s.patLastFlip > 900) s.patFlips = 0;
      if (dir !== 0 && dir !== s.patDir) {
        s.patDir = dir;
        s.patFlips += 1;
        s.patLastFlip = t;
        if (s.patFlips >= 5) {
          s.patFlips = 0;
          headPat();
        }
      }
    }
  });

  pipEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !overPip(e.clientX, e.clientY)) return;
    touch();
    s.pressed = true;
    s.pressAt = { x: e.clientX, y: e.clientY };
    s.grabOffset = { x: e.clientX - s.x, y: e.clientY - s.y };
  });

  document.addEventListener('mouseup', (e) => {
    if (!s.pressed) return;
    s.pressed = false;

    if (s.mode === 'drag') {
      // Let go: he keeps the throw's momentum, then steadies himself.
      const h = s.dragHistory;
      if (h.length > 1) {
        const a = h[0];
        const b = h[h.length - 1];
        const dt = Math.max(16, b.t - a.t) / 1000;
        s.vx = clamp((b.x - a.x) / dt, -1800, 1800);
        s.vy = clamp((b.y - a.y) / dt, -1800, 1800);
      }
      setMode('fling');
      setInteractive(overPip(e.clientX, e.clientY));
    } else if (overPip(e.clientX, e.clientY)) {
      poke();
    }
  });

  document.addEventListener('mouseleave', () => {
    if (s.mode !== 'drag') setInteractive(false);
  });

  // --------------------------------------------------------------- movement

  function clampToScreen() {
    s.x = clamp(s.x, minX(), maxX());
    s.y = clamp(s.y, minY(), maxY());
  }

  function glide(dt) {
    const dx = s.tx - s.x;
    const dy = s.ty - s.y;
    const d = Math.hypot(dx, dy);
    if (d < 2 && Math.hypot(s.vx, s.vy) < 15) {
      s.vx = 0;
      s.vy = 0;
      setMode('idle');
      s.nextDecision = now() + rand(2500, 7000);
      if (Math.random() < 0.3) setTimeout(lookAround, 450);
      return;
    }
    // ease in, cruise, ease out: aim for a speed that shrinks as he arrives
    const speed = Math.min(MAX_SPEED, d * 1.6);
    const k = Math.min(1, STEER * dt);
    s.vx += ((dx / (d || 1)) * speed - s.vx) * k;
    s.vy += ((dy / (d || 1)) * speed - s.vy) * k;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }

  function fling(dt) {
    const f = Math.exp(-2.4 * dt);
    s.vx *= f;
    s.vy *= f;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    let bonk = 0;
    if (s.x < minX()) { s.x = minX(); bonk = Math.abs(s.vx); s.vx = Math.abs(s.vx) * 0.55; }
    if (s.x > maxX()) { s.x = maxX(); bonk = Math.abs(s.vx); s.vx = -Math.abs(s.vx) * 0.55; }
    if (s.y < minY()) { s.y = minY(); bonk = Math.max(bonk, Math.abs(s.vy)); s.vy = Math.abs(s.vy) * 0.55; }
    if (s.y > maxY()) { s.y = maxY(); bonk = Math.max(bonk, Math.abs(s.vy)); s.vy = -Math.abs(s.vy) * 0.55; }
    if (bonk > 450) {
      flash('squash', 320);
      setFace('surprised', 700);
      spawnFx('✦', 'spark', 2);
    }

    if (Math.hypot(s.vx, s.vy) < 25) {
      s.vx = 0;
      s.vy = 0;
      setMode('idle');
      flash('hop', 450);
      say(pick(LINES.land), { face: Math.random() < 0.5 ? 'silly' : 'annoyed', faceMs: 1800 });
      s.nextDecision = now() + 5000;
    }
  }

  // Which way is he facing? Side profile while travelling sideways.
  function updateView() {
    const sideways = Math.abs(s.vx);
    const travelling = s.mode === 'glide' || s.mode === 'fling';
    let view = s.view;
    if (s.mode === 'drag' || s.mode === 'sleep') view = 'front';
    else if (travelling && sideways > SIDE_ON) view = 'side';
    else if (sideways < FRONT_AT) view = 'front';

    if (view === 'side' && sideways > SIDE_ON) s.facing = s.vx > 0 ? 1 : -1;

    if (view !== s.view) {
      s.view = view;
      pipEl.dataset.view = view;
    }
    pipEl.dataset.facing = String(s.facing);

    if (s.mode !== 'drag') {
      // lean into the motion: nose-down when speeding up sideways
      const lean = clamp(s.vx * 0.055, -9, 9) + clamp(-s.vy * 0.015, -3, 3) * s.facing;
      s.tilt += (lean - s.tilt) * 0.15;
    }
    pipEl.style.setProperty('--tilt', `${s.tilt.toFixed(2)}deg`);
  }

  function sparkleTrail(t) {
    const speed = Math.hypot(s.vx, s.vy);
    if (speed < 50 || t < s.trailAt) return;
    s.trailAt = t + 110;
    const ringX = s.x + (BASE_W / 2) * s.scale - Math.sign(s.vx) * 20 * s.scale;
    const ringY = s.y + RING_Y * s.scale;
    spawnFx(pick(['+', '✦', '·']), 'trail', 1, {
      x: ringX + rand(-16, 16) * s.scale,
      y: ringY + rand(-10, 2) * s.scale,
      dx: -Math.sign(s.vx) * rand(6, 18),
    });
  }

  // ------------------------------------------------------------------- loop

  let last = now();
  function frame() {
    const t = now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    switch (s.mode) {
      case 'glide':
        if (!s.prefs.wander && !s.summoned) {
          s.tx = s.x;
          s.ty = s.y;
        }
        glide(dt);
        sparkleTrail(t);
        break;
      case 'fling':
        fling(dt);
        sparkleTrail(t);
        break;
      case 'idle': {
        s.summoned = false;
        const quiet = t - s.lastInteraction;
        if (quiet > SLEEP_AFTER_MS) {
          sleep();
        } else if (quiet > LONELY_MS && !s.lonelyShown) {
          s.lonelyShown = true;
          say(pick(LINES.lonely), { face: 'sad', faceMs: 4000 });
          s.nextDecision = t + 8000;
        } else if (t > s.nextDecision) {
          decide();
        }
        break;
      }
      case 'sleep':
        if (Math.random() < dt / 1.6) spawnFx('z', 'z');
        break;
      default:
        break;
    }

    if (s.mode !== 'drag' && s.mode !== 'fling') clampToScreen();

    const hour = new Date().getHours();
    if (hour < 5 && s.mode === 'idle' && t - s.lastLateNag > LATE_NIGHT_EVERY_MS) {
      s.lastLateNag = t;
      if (t > 60000) say(pick(LINES.late), { face: 'sleepy', faceMs: 3000 });
    }

    updateView();
    render();
    requestAnimationFrame(frame);
  }

  function render() {
    pipEl.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) scale(${s.scale})`;
    updateLook();
    placeBubble();
  }

  window.addEventListener('resize', clampToScreen);

  // -------------------------------------------------------- tray commands

  api.onCommand((name, data) => {
    if (name === 'say-hi') {
      touch();
      if (s.mode === 'sleep') return;
      wave();
      say(pick(LINES.hi), { face: 'excited', faceMs: 2200 });
    } else if (name === 'summon') {
      // fly over to the bottom-right corner, near the tray
      touch();
      if (s.mode === 'drag') return;
      s.summoned = true;
      glideTo(maxX() - 30, maxY());
      say(pick(LINES.summon), { face: 'excited', faceMs: 2000 });
    } else if (name === 'prefs' && data) {
      const before = s.prefs;
      s.prefs = { ...s.prefs, ...data };
      applyLook();
      if (!s.prefs.bubbles) hideBubble();
      const changedLook = ['skin', 'glow', 'antenna', 'stickers', 'size'].some(
        (k) => before[k] !== s.prefs[k],
      );
      if (changedLook && s.mode !== 'sleep') {
        flash('spin', 850);
        spawnFx('✦', 'spark', 3);
        say(pick(LINES.newLook), { face: 'excited', faceMs: 2000 });
      }
    }
  });

  // ------------------------------------------------------------------ start

  async function start() {
    try {
      s.prefs = { ...DEFAULT_PREFS, ...(await api.getPrefs()) };
    } catch (err) {
      console.warn('Could not load prefs, using defaults', err);
    }
    s.scale = SIZES[s.prefs.size] || 1;
    applyLook();

    // Materialise near the bottom-right of the screen.
    s.x = rand(window.innerWidth * 0.55, maxX());
    s.y = maxY() - rand(0, 40);
    clampToScreen();
    flash('appear', 1300);
    setFace('normal');
    s.lastInteraction = now();
    s.nextDecision = now() + 7000;

    setTimeout(() => {
      wave();
      say(greetingFor(), { face: 'excited', faceMs: 2200 });
    }, 1300);

    scheduleBlink();
    requestAnimationFrame(frame);
  }

  // Opened in a plain browser? Expose a few handles for testing in DevTools.
  if (!window.pipApi) window.pipDebug = { state: s, glideTo, setFace, say, wave, sleep };

  start();
})();
