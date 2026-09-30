import { useEffect, useRef, useState } from 'react';
import { createIntroEngine } from '../lib/gatherIntroEngine';
import GatherLogo from './GatherLogo';
import './GatherIntro.css';

const PREF_KEY = 'gather:intro:v2';

function readPref() {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'minimal' || v === 'full' ? v : 'full';
  } catch {
    return 'full'; // private mode / storage blocked
  }
}

function writePref(v) {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* non-fatal */
  }
}

/**
 * Full-screen intro overlay: dots gather into GATHER, then the logo travels
 * to the navbar.
 *
 * @param {object} props
 * @param {React.RefObject<HTMLVideoElement>} props.videoRef  hero video, owned
 *        by the parent so this component doesn't duplicate the decode
 * @param {React.RefObject<HTMLElement>} props.logoSlotRef  navbar destination
 * @param {() => void} props.onDone  fired once the page should be interactive
 */
export default function GatherIntro({ videoRef, logoSlotRef, onDone }) {
  const overlayRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const scrimRef = useRef(null);
  const logoRef = useRef(null);

  // StrictMode double-invokes effects in dev. Without this guard the intro
  // would start twice and the second run would fight the first.
  const startedRef = useRef(false);

  const [phase, setPhase] = useState('idle'); // idle | converge | logo | flip | done

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const skip = readPref() === 'minimal' || prefersReduced;

    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const scrim = scrimRef.current;
    const video = videoRef?.current;

    let engine = null;
    let safetyTimer = null;

    const finish = () => {
      setPhase('done');
      video?.classList.remove('gi-video--soft');
      document.body.classList.remove('gi-locked');
      onDone?.();
    };

    if (skip) {
      video?.classList.remove('gi-video--soft');
      finish();
      return;
    }

    document.body.classList.add('gi-locked');

    // Resolve the real font stack from CSS so the sampled glyphs and the
    // painted wordmark can never disagree.
    const fontFamily = getComputedStyle(stage).getPropertyValue('--gi-wordmark-font').trim()
      || 'Poppins, system-ui, sans-serif';

    engine = createIntroEngine({ canvas, stage, fontFamily });

    // The video is already playing (autoplay in markup). This only racks it
    // into focus across the arrival window. Durations derive from the engine's
    // timings so retiming can't desync the reveal.
    const revealMs = 4000 + 800; // T.converge + T.merge
    if (video) {
      video.style.transition =
        `filter ${revealMs}ms cubic-bezier(.4,0,.2,1), transform ${revealMs}ms cubic-bezier(.4,0,.2,1)`;
    }
    if (scrim) scrim.style.transition = 'opacity 4000ms cubic-bezier(.4,0,.35,1)';

    // Two frames, so the browser has a "before" state to transition from.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrim?.classList.add('gi-scrim--lifting');
        video?.classList.remove('gi-video--soft');
      });
    });

    engine
      .run(setPhase)
      .then((completed) => {
        if (completed) finish();
      })
      .catch((err) => {
        console.error('[gather:intro]', err);
        finish();
      });

    // Hard ceiling. An animation bug must never hold the page hostage.
    safetyTimer = setTimeout(finish, 12000);

    return () => {
      clearTimeout(safetyTimer);
      engine?.cancel();
      document.body.classList.remove('gi-locked');
    };
    // Intentionally empty: this runs once, guarded by startedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FLIP without reparenting.
  //
  // The vanilla version moved one DOM node between the overlay and the navbar.
  // In React that's dangerous — React owns those children and would be
  // reconciling a node that moved out from under it. Instead the overlay logo
  // is position:fixed and animates to the navbar slot's measured rect. The
  // navbar renders its own identical logo, revealed at the same instant, so
  // the handoff is invisible.
  useEffect(() => {
    if (phase !== 'flip') return;

    const logo = logoRef.current;
    const slot = logoSlotRef?.current;
    if (!logo || !slot) return;

    const from = logo.getBoundingClientRect();
    const to = slot.getBoundingClientRect();

    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const scale = to.width / from.width;

    logo.style.transition = 'transform 950ms cubic-bezier(.55,.06,.22,1)';
    logo.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  }, [phase, logoSlotRef]);

  const [prefLabel, setPrefLabel] = useState(() => readPref() === 'full');

  const toggle = () => {
    const next = readPref() === 'full' ? 'minimal' : 'full';
    writePref(next);
    setPrefLabel(next === 'full');
  };

  return (
    <>
      {phase !== 'done' && (
        <div
          className="gi-overlay"
          ref={overlayRef}
          role="status"
          aria-live="polite"
          aria-label="Loading Gather"
        >
          <div className="gi-stage" ref={stageRef}>
            <div className="gi-scrim" ref={scrimRef} aria-hidden="true" />
            <canvas className="gi-canvas" ref={canvasRef} aria-hidden="true" />
            {(phase === 'logo' || phase === 'flip') && (
              <div className="gi-logo gi-logo--pop" ref={logoRef} aria-hidden="true">
                <GatherLogo />
              </div>
            )}
          </div>
        </div>
      )}

      <button
        className="gi-toggle"
        type="button"
        aria-pressed={prefLabel}
        onClick={toggle}
        title={
          prefLabel
            ? 'Turn off the intro animation for future visits'
            : 'Turn the intro animation back on'
        }
      >
        <span className="gi-toggle__dot" aria-hidden="true" />
        <span>{prefLabel ? 'Intro on' : 'Intro off'}</span>
      </button>
    </>
  );
}
