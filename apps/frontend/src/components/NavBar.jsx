import { Link, NavLink, useNavigate } from "react-router-dom";
import GatherLogo from "./GatherLogo.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { resolveMediaUrl } from "../api/client.js";
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
        {/* Logo and name together, far left.

            This used to be a three-track grid with the logo pinned dead-centre,
            echoing where the intro animation lands it. That reads nicely signed
            out, but signed in the right-hand side needs ~805px and its track
            only had 491px, so the links overflowed leftward and printed
            straight through the logo. Centring a mark between two tracks only
            works while both stay narrower than half the bar, and this one
            can't — the account row grows with the handle and the badge.

            One brand link, laid out left, cannot collide with anything. */}
        <Link className="nav__brand" to="/" aria-label="Gather home">
          <GatherLogo className="nav__logo" />
          <span className="nav__wordmark">Gather</span>
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
                {/* Avatar only. The handle was ~90px of text repeating what
                    the picture already says, in the most crowded part of the
                    bar. An avatar is the conventional account affordance —
                    people know it goes to their profile.

                    aria-label carries what the removed text used to, so this
                    is still announced as "@maya_ortiz, your profile" rather
                    than an unlabelled link. */}
                <Link
                  className="nav__handle"
                  to="/profile"
                  title={`${user.displayName} — your profile`}
                  aria-label={`@${user.handle} — your profile`}
                >
                  {user.avatarUrl ? (
                    <img className="nav__handle-avatar" src={resolveMediaUrl(user.avatarUrl)} alt="" />
                  ) : (
                    <span className="nav__handle-avatar nav__handle-avatar--placeholder">
                      {user.displayName?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                </Link>
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
