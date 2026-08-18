/**
 * GATHER — primary mark.
 *
 * Six people arriving on one point: the intro animation frozen at the moment
 * everyone has landed. Geometry sits on a 60° radial grid with a 22px orbit
 * and a 9px hub — that ratio keeps it legible down to 16px favicon size.
 *
 * Uses currentColor throughout, so it takes the colour of whatever it sits in.
 * Set `color` on the parent; no second file for light backgrounds.
 */
export default function GatherLogo({ className = '', title = 'Gather' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      role="img"
      aria-label={title}
    >
      <circle cx="32" cy="32" r="27" stroke="currentColor" strokeWidth="2.5" opacity="0.4" />
      <circle cx="32" cy="32" r="9" fill="currentColor" />
      <circle cx="32" cy="10" r="4.6" fill="currentColor" />
      <circle cx="51.05" cy="21" r="4.6" fill="currentColor" />
      <circle cx="51.05" cy="43" r="4.6" fill="currentColor" />
      <circle cx="32" cy="54" r="4.6" fill="currentColor" />
      <circle cx="12.95" cy="43" r="4.6" fill="currentColor" />
      <circle cx="12.95" cy="21" r="4.6" fill="currentColor" />
    </svg>
  );
}
