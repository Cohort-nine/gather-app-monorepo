/**
 * GATHER — intro canvas engine
 * ===========================================================================
 * Framework-agnostic on purpose. No React in here, so it can be tested,
 * profiled, or reused without mounting a component tree.
 *
 * Everything visual lives in ONE canvas: the dots and the wordmark are drawn
 * into the same pixel buffer, so the dots literally become the letters.
 * There is no second layer to crossfade, which is what removes the flash.
 *
 * Motion is modelled on people walking, not particles firing:
 *   - smootherstep easing (zero velocity AND acceleration at both ends).
 *     ease-out means maximum speed on frame one, which reads as a rush.
 *   - every dot gets its own departure time AND its own travel duration, so
 *     arrivals trickle instead of landing as a wave.
 *   - paths are quadratic curves with a perpendicular bow and a damped sway.
 * ===========================================================================
 */

export const DEFAULT_T = {
  converge: 4000, // full arrival window — the main "speed" knob
  merge: 800,     // dots resolving into solid letterforms
  logoIn: 780,
  hold: 900,
  flip: 950,
  fadeOut: 600,
};

export const DEFAULT_FEEL = {
  departSpread: 0.46, // higher = more trickle, less wave
  travelMin: 0.44,
  travelMax: 0.62,
  wanderMin: 0.06,    // lateral drift; 0 = beeline, looks robotic
  wanderMax: 0.22,
  swayAmp: 7,
  // Dot radius as a multiple of sample spacing. Below ~0.7 the landed dots
  // stop overlapping and the letterforms go visibly gappy. Real bug, not taste.
  radiusFactor: 0.72,
  radiusJitter: 0.22,
  mergeSwell: 1.55,
};

const MAX_DOTS_DESKTOP = 2600;
const MAX_DOTS_MOBILE = 1300;

const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const quad = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
};

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {HTMLElement} opts.stage      element the canvas fills; supplies size
 * @param {string} opts.fontFamily      resolved CSS font-family string
 * @param {object} [opts.T]
 * @param {object} [opts.FEEL]
 * @returns {{ run: () => Promise<boolean>, cancel: () => void }}
 *          run() resolves true if it completed, false if cancelled.
 */
export function createIntroEngine({ canvas, stage, fontFamily, T = DEFAULT_T, FEEL = DEFAULT_FEEL }) {
  const ctx = canvas.getContext('2d');

  // Two device-pixel ratios on purpose.
  //
  // Phones are commonly DPR 3. Animating 1,300 dots into a 3x backing store
  // costs real fill rate, so the walk-in renders at 2x. But the final frame
  // just sits there being looked at, and a 2x buffer upscaled to a 3x screen
  // is visibly soft — so that one frame re-renders at the true ratio.
  const DPR_DEVICE = window.devicePixelRatio || 1;
  const DPR_ANIM = Math.min(DPR_DEVICE, 2);
  const DPR_FINAL = Math.min(DPR_DEVICE, 3);

  let dpr = DPR_ANIM;
  let W = 0;
  let H = 0;
  let dots = [];
  let sampleStep = 4;
  let rafId = null;
  let cancelled = false;
  const timers = new Set();

  const wordBox = { cx: 0, cy: 0, fontSize: 0, font: '' };

  function sizeCanvas() {
    W = stage.clientWidth || window.innerWidth;
    H = stage.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function computeWordBox() {
    const fontSize = Math.max(46, Math.min(W * 0.155, 172));
    wordBox.fontSize = fontSize;
    wordBox.font = `700 ${fontSize}px ${fontFamily}`;
    wordBox.cx = W / 2;
    wordBox.cy = H / 2;

    // The logo needs to clear the top of the actual rendered glyphs, and a
    // fixed pixel offset in CSS can't know that — fontSize (and therefore cap
    // height) scales with viewport width, so a gap tuned for a phone overlaps
    // on a wide desktop where fontSize hits its 172px ceiling. measureText's
    // actualBoundingBoxAscent asks the browser for the real answer, for the
    // font that's actually loaded, instead of guessing a font-metric ratio.
    ctx.save();
    ctx.font = wordBox.font;
    // actualBoundingBoxAscent is measured relative to whatever textBaseline
    // is set at measure time — it must match paintWordmark's 'middle', or
    // this reports the gap to the alphabetic baseline instead of to cy.
    // Left at the canvas default ('alphabetic') this over-reports the gap by
    // a fixed fraction of fontSize, so the logo floats further and further
    // above the wordmark as fontSize climbs toward its desktop ceiling,
    // instead of holding the intended constant 20px clearance at any size.
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = `${(-0.045 * fontSize).toFixed(2)}px`;
    }
    const metrics = ctx.measureText('GATHER');
    ctx.restore();

    const capTop = metrics.actualBoundingBoxAscent || fontSize * 0.8;
    stage.style.setProperty('--gi-wordmark-cap-top', `${Math.ceil(capTop)}px`);
  }

  /**
   * Paint "GATHER" at the shared position. Used both for sampling the dot
   * destinations and for the final render, so the dots land exactly where the
   * letters will be.
   */
  function paintWordmark(c, alpha, withShadow) {
    c.save();
    c.globalAlpha = alpha;
    c.font = wordBox.font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    if ('letterSpacing' in c) {
      c.letterSpacing = `${(-0.045 * wordBox.fontSize).toFixed(2)}px`;
    }
    if (withShadow) {
      c.shadowColor = 'rgba(0,0,0,0.34)';
      c.shadowBlur = Math.max(4, wordBox.fontSize * 0.06);
      c.shadowOffsetY = 1;
    }
    c.fillText('GATHER', wordBox.cx, wordBox.cy);
    c.restore();
  }

  /** Rasterize the wordmark offscreen; every opaque pixel becomes a seat. */
  function sampleSeats() {
    const off = document.createElement('canvas');
    off.width = Math.round(W * dpr);
    off.height = Math.round(H * dpr);

    const octx = off.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // No shadow here — a blurred shadow leaks semi-opaque pixels outside the
    // glyphs and would scatter seats into empty space.
    paintWordmark(octx, 1, false);

    const isMobile = W < 700;
    const cap = isMobile ? MAX_DOTS_MOBILE : MAX_DOTS_DESKTOP;
    sampleStep = isMobile ? 4 : 3;

    const px = Math.max(1, Math.round(sampleStep * dpr));
    const data = octx.getImageData(0, 0, off.width, off.height).data;
    const seats = [];

    for (let y = 0; y < off.height; y += px) {
      for (let x = 0; x < off.width; x += px) {
        if (data[(y * off.width + x) * 4 + 3] > 128) {
          seats.push({ x: x / dpr, y: y / dpr });
        }
      }
    }

    if (seats.length > cap) {
      // Random thinning, not strided — striding a grid bands diagonally.
      for (let i = seats.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [seats[i], seats[j]] = [seats[j], seats[i]];
      }
      // Survivors sit further apart, so dots must grow by the same factor or
      // the letterforms go patchy. Spacing scales with sqrt of density change.
      sampleStep *= Math.sqrt(seats.length / cap);
      seats.length = cap;
    }

    return seats;
  }

  function buildDots(seats) {
    dots = [];
    const baseR = Math.max(1.1, sampleStep * FEEL.radiusFactor);
    const diag = Math.sqrt(W * W + H * H);

    for (const seat of seats) {
      // Start on a ring around the SEAT, not the screen centre, so dots
      // converge from every direction like a crowd rather than an explosion
      // running backwards.
      const angle = Math.random() * Math.PI * 2;
      const dist = diag * rand(0.42, 0.78);
      const sx = seat.x + Math.cos(angle) * dist;
      const sy = seat.y + Math.sin(angle) * dist;

      const dx = seat.x - sx;
      const dy = seat.y - sy;
      const len = Math.hypot(dx, dy) || 1;
      const wander = rand(FEEL.wanderMin, FEEL.wanderMax) * len;
      const side = Math.random() < 0.5 ? 1 : -1;

      dots.push({
        sx,
        sy,
        tx: seat.x,
        ty: seat.y,
        cx: (sx + seat.x) / 2 + (-dy / len) * wander * side,
        cy: (sy + seat.y) / 2 + (dx / len) * wander * side,
        depart: Math.random() * FEEL.departSpread,
        travel: rand(FEEL.travelMin, FEEL.travelMax),
        r: baseR * rand(1 - FEEL.radiusJitter, 1 + FEEL.radiusJitter),
        alpha: rand(0.72, 1),
        swayPhase: Math.random() * Math.PI * 2,
        swayRate: rand(0.6, 1.5),
      });
    }
  }

  /**
   * A pool of shade sized to the real text bounds. The page scrim lifts to
   * reveal the video, which would eat the wordmark — this keeps contrast
   * constant exactly where the letters are while the frame brightens.
   */
  function paintVignette(strength) {
    if (strength <= 0.01) return;

    ctx.save();
    ctx.font = wordBox.font;
    const w = ctx.measureText('GATHER').width;
    ctx.restore();

    const rx = Math.max(w * 0.78, W * 0.28);
    const ry = Math.max(wordBox.fontSize * 2.4, H * 0.2);

    ctx.save();
    ctx.translate(wordBox.cx, wordBox.cy);
    ctx.scale(1, ry / rx);

    const g = ctx.createRadialGradient(0, 0, rx * 0.12, 0, 0, rx);
    g.addColorStop(0, `rgba(6,8,10,${0.26 * strength})`);
    g.addColorStop(0.55, `rgba(6,8,10,${0.13 * strength})`);
    g.addColorStop(1, 'rgba(6,8,10,0)');

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * @param {number} p       0..1 through the arrival window
   * @param {number} mergeT  0..1 through the merge
   */
  function draw(p, mergeT) {
    ctx.clearRect(0, 0, W, H);
    paintVignette(Math.min(1, p * 1.15));
    ctx.fillStyle = '#ffffff';

    const swell = 1 + (FEEL.mergeSwell - 1) * easeOutCubic(mergeT);

    // Dots retire during the back half of the merge. Without this they stay
    // under the finished text at swollen size, and the ones that landed a hair
    // outside a glyph edge poke past it — a lumpy, bubbly outline. The letters
    // are opaque by 45% in, so fading after that is invisible.
    const dotFade = 1 - smootherstep(clamp01((mergeT - 0.45) / 0.55));

    if (dotFade <= 0.002 && mergeT > 0) {
      paintWordmark(ctx, smootherstep(mergeT), true);
      return;
    }

    for (const d of dots) {
      const local = clamp01((p - d.depart) / d.travel);
      const e = smootherstep(local);

      let x = quad(d.sx, d.cx, d.tx, e);
      let y = quad(d.sy, d.cy, d.ty, e);

      // Sway while waiting and in transit, damped to nothing on arrival so
      // the final letterforms are crisp.
      const damp = 1 - e;
      if (damp > 0.001) {
        const phase = d.swayPhase + p * Math.PI * 2 * d.swayRate;
        x += Math.cos(phase) * FEEL.swayAmp * damp;
        y += Math.sin(phase * 0.8) * FEEL.swayAmp * 0.6 * damp;
      }

      ctx.globalAlpha = d.alpha * Math.min(1, 0.18 + p * 4) * dotFade;
      ctx.beginPath();
      ctx.arc(x, y, d.r * swell, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    if (mergeT > 0) paintWordmark(ctx, smootherstep(mergeT), true);
  }

  function animate(duration, onFrame) {
    return new Promise((resolve) => {
      let start = null;
      const frame = (ts) => {
        if (cancelled) return resolve();
        if (start === null) start = ts;
        const t = Math.min(1, (ts - start) / duration);
        onFrame(t);
        if (t < 1) rafId = requestAnimationFrame(frame);
        else resolve();
      };
      rafId = requestAnimationFrame(frame);
    });
  }

  function wait(ms) {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        timers.delete(id);
        resolve();
      }, ms);
      timers.add(id);
    });
  }

  async function run(onPhase = () => {}) {
    sizeCanvas();
    computeWordBox();

    // Sampling before the webfont lands would trace the fallback's outlines
    // and every dot would sit in the wrong place.
    try {
      if (document.fonts?.ready) await document.fonts.ready;
    } catch {
      /* proceed with whatever is loaded */
    }
    if (cancelled) return false;

    computeWordBox();
    const seats = sampleSeats();

    // Canvas blocked, font failed, or zero-size stage. Don't sit on black.
    if (!seats.length) return true;

    buildDots(seats);
    onPhase('converge');

    await animate(T.converge, (t) => draw(t, 0));
    if (cancelled) return false;

    await animate(T.merge, (t) => draw(1, t));
    if (cancelled) return false;

    // Re-render the resting frame at the screen's true pixel density. Seats
    // and wordBox are in CSS px, so only the backing store changes.
    if (DPR_FINAL > DPR_ANIM) {
      dpr = DPR_FINAL;
      sizeCanvas(); // resizing clears the buffer...
      draw(1, 1);   // ...so repaint the finished state into it
    }

    onPhase('logo');
    await wait(T.logoIn + T.hold);
    if (cancelled) return false;

    onPhase('flip');
    await wait(T.flip);

    return !cancelled;
  }

  function cancel() {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    timers.forEach(clearTimeout);
    timers.clear();
  }

  return { run, cancel };
}
