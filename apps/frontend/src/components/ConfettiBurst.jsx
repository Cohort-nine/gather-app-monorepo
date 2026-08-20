import { useEffect, useState } from "react";
import "./ConfettiBurst.css";

// Whites/silvers only, in step with the app's black-and-white brand — no
// leftover blue/violet from the old accent palette.
const COLORS = ["#ffffff", "#e5e7eb", "#9ca3af", "#f5f5f5", "#d1d5db"];

function makePieces(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 200,
    duration: 1100 + Math.random() * 700,
    rotate: Math.random() * 360 - 180,
    drift: (Math.random() - 0.5) * 80,
    color: COLORS[i % COLORS.length]
  }));
}

/**
 * A brief, one-shot celebratory burst — reserved for real milestones (a
 * hosted event actually happening), not routine actions like an RSVP. That
 * restraint is what keeps it feeling like a reward instead of noise.
 *
 * Skips itself entirely under prefers-reduced-motion; calls onDone either way
 * so callers don't need to special-case that.
 */
export default function ConfettiBurst({ count = 26, onDone }) {
  const [pieces] = useState(() => makePieces(count));

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      onDone?.();
      return;
    }

    const longest = Math.max(...pieces.map((p) => p.delay + p.duration));
    const timer = setTimeout(() => onDone?.(), longest + 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="confetti-burst" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-burst__piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            "--confetti-delay": `${p.delay}ms`,
            "--confetti-duration": `${p.duration}ms`,
            "--confetti-rotate": `${p.rotate}deg`,
            "--confetti-drift": `${p.drift}px`
          }}
        />
      ))}
    </div>
  );
}
