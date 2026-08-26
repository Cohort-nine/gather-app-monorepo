import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import GatherIntro from './GatherIntro';
import GatherLogo from './GatherLogo';
import { resolveMediaUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import './Home.css';

/**
 * Homepage: nav + hero video + the intro overlay.
 *
 * This is an EXAMPLE of how to wire GatherIntro up. Change the copy, the nav
 * links, the layout, all of it — the only parts that matter are:
 *
 *   1. a ref on the <video>            -> passed to GatherIntro
 *   2. a ref on the navbar logo slot   -> passed to GatherIntro
 *   3. onDone -> flip some state so the nav logo and hero copy appear
 *
 * Everything else is yours.
 */
export default function Home() {
  const videoRef = useRef(null);
  const logoSlotRef = useRef(null);
  const [introDone, setIntroDone] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="home">
      <nav className="home__nav">
        {/* Pills rather than bare text. These sit on a video whose brightness
            changes frame to frame, so a plain link has no reliable contrast —
            each one carries its own scrim and border and stays legible over
            sky, crowd, or rooftop alike. */}
        <div className="home__nav-side">
          <Link className="home__nav-btn home__nav-btn--primary" to="/events/new">
            Host a gathering
          </Link>
        </div>

        {/* The logo flies into this slot. It reserves its space from the first
            paint, so nothing shifts when the logo lands. */}
        <div
          className="home__logo-slot"
          ref={logoSlotRef}
          style={{ opacity: introDone ? 1 : 0 }}
        >
          <GatherLogo />
        </div>

        <div className="home__nav-side home__nav-side--end">
          {user ? (
            <>
              {/* An avatar chip linking to the profile, the same pattern the
                  inner NavBar uses — so the account control looks like itself
                  on every page. As bare text it had nothing anchoring it and
                  read as a stray label floating beside a button. */}
              <Link
                className="home__nav-account"
                to="/profile"
                title={`${user.displayName} — edit profile`}
              >
                {user.avatarUrl ? (
                  <img
                    className="home__nav-avatar"
                    src={resolveMediaUrl(user.avatarUrl)}
                    alt=""
                  />
                ) : (
                  <span
                    className="home__nav-avatar home__nav-avatar--placeholder"
                    aria-hidden="true"
                  >
                    {user.displayName?.[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
                <span className="home__nav-handle">@{user.handle}</span>
              </Link>
              <button type="button" className="home__nav-btn" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link className="home__nav-btn" to="/login">
                Sign in
              </Link>
              <Link className="home__nav-btn home__nav-btn--primary" to="/signup">
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>

      <header className="home__hero">
        {/*
          autoplay + the soft class are in MARKUP, not set from JS. The browser
          starts fetching during HTML parse. Calling .play() from an effect puts
          the video behind React hydration and webfont loading, which is a
          visible delay.

          Paths are root-absolute because Vite serves everything in public/ at
          the site root. public/media/hero-1080.mp4 -> /media/hero-1080.mp4
        */}
        <video
          ref={videoRef}
          className="home__video gi-video--soft"
          autoPlay
          playsInline
          muted
          loop
          preload="auto"
          poster="/media/hero-poster.webp"
          aria-hidden="true"
        >
          {/* First source whose type is supported AND whose media query matches
              wins. WebM leads: 42% smaller here at higher measured quality.
              Safari falls through to mp4. 720p is the catch-all, so phones
              never pull the 1080p file. */}
          <source src="/media/hero-1080.webm" type="video/webm" media="(min-width: 768px)" />
          <source src="/media/hero-1080.mp4" type="video/mp4" media="(min-width: 768px)" />
          <source src="/media/hero-720.webm" type="video/webm" />
          <source src="/media/hero-720.mp4" type="video/mp4" />
        </video>

        <div className={`home__copy ${introDone ? 'home__copy--in' : ''}`}>
          <h1>
            Small gatherings.
            <br />
            People who show up.
          </h1>
          <p>
            Block parties, potlucks, hobby meetups. See who you know before you go, and give your
            host a headcount they can actually plan around.
          </p>
          <Link className="home__cta" to="/events">
            Find something near you
          </Link>
        </div>

        {/* Home skips SiteFooter entirely (see App.jsx) since its own hero
            already closes the page -- but that meant this was the one page
            with no copyright line at all. */}
        <p className="home__copyright">
          &copy; {new Date().getFullYear()}{' '}
          <a href="https://github.com/cohortjuan" target="_blank" rel="noopener noreferrer">
            github.com/cohortjuan
          </a>
        </p>
      </header>

      {/* Meetup-style social proof: only worth showing once someone has
          connections and RSVPs to draw from, so it's signed-in-only rather
          than a permanent section with nothing in it for a new visitor. */}

      <GatherIntro
        videoRef={videoRef}
        logoSlotRef={logoSlotRef}
        onDone={() => setIntroDone(true)}
      />
    </div>
  );
}
