import { Link, NavLink, useNavigate } from "react-router-dom";
import GatherLogo from "./GatherLogo.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { reliabilityLabel } from "../lib/reliability.js";
import "./NavBar.css";

// ---------------------------------------------------------------------------
// Persistent navigation for every page except the homepage.
//
// Home is excluded on purpose: it has its own nav built around the intro
// animation, where the logo flies into a reserved slot. Stacking a second bar
// on top of that would fight the choreography.
//
// NavLink (rather than Link) gives us an `isActive` flag, so the current
// section is marked with more than colour — the underline and the
// aria-current attribute both carry it, which matters for anyone who can't
// distinguish the blue.
// ---------------------------------------------------------------------------

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    // Landing on browse rather than the current page avoids stranding someone
    // on /my-events with a "sign in" wall the instant they sign out.
    navigate("/events");
  }

  return (
    <header className="nav">
      <div className="nav__inner">
        {/* Name far left, logo dead-center — mirrors where the intro lands its
            logo, so the mark reads as the same anchor point once the intro
            hands off to this persistent bar on every other page. */}
        <Link className="nav__wordmark" to="/">
          Gather
        </Link>

        <Link className="nav__logo-link" to="/" aria-label="Gather home">
          <GatherLogo className="nav__logo" />
        </Link>

        <div className="nav__right">
          <nav className="nav__links" aria-label="Main">
            <NavLink to="/events" className="nav__link">
              Browse
            </NavLink>

            {user ? (
              <>
                <NavLink to="/my-rsvps" className="nav__link">
                  Your RSVPs
                </NavLink>
                <NavLink to="/my-events" className="nav__link">
                  Your events
                </NavLink>
                <NavLink to="/events/new" className="nav__link nav__link--cta">
                  Host a gathering
                </NavLink>
              </>
            ) : null}
          </nav>

          <div className="nav__account">
            {user ? (
              <>
                <span className="nav__handle" title={user.displayName}>
                  @{user.handle}
                </span>
                {user.reliability ? (
                  <span
                    className={`reliability-badge reliability-badge--${user.reliability.band}`}
                    title="Your reliability score — built from RSVPs you honored vs. missed"
                  >
                    {reliabilityLabel(user.reliability.band)}
                  </span>
                ) : null}
                <button type="button" className="nav__signout" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="nav__link">
                  Sign in
                </NavLink>
                <NavLink to="/signup" className="nav__link nav__link--cta">
                  Sign up
                </NavLink>
              </>
            )}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
