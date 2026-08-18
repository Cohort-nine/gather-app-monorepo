import { useEffect, useState } from 'react';

const THEME_KEY = 'gather:theme'; // 'dark' | 'light'

export default function ThemeToggle({ className = '' }) {
  const [isLight, setIsLight] = useState(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v) return v === 'light';
    } catch {}
    // default to dark (false)
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
    } catch {}
    if (isLight) document.documentElement.classList.add('theme-light');
    else document.documentElement.classList.remove('theme-light');
  }, [isLight]);

  return (
    <button
      type="button"
      aria-pressed={isLight}
      className={`theme-toggle ${className}`}
      onClick={() => setIsLight((s) => !s)}
      title={isLight ? 'Switch to dark' : 'Switch to light'}
    >
      {isLight ? 'Light' : 'Dark'}
    </button>
  );
}
