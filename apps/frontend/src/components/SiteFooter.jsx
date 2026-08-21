import { Link } from "react-router-dom";
import GatherLogo from "./GatherLogo.jsx";
import "./SiteFooter.css";

// ---------------------------------------------------------------------------
// The app had no footer at all. Every page simply stopped, which is one of the
// quieter reasons an otherwise-finished site reads as a prototype — real
// products close the page rather than running out of content.
//
// Deliberately quiet: the mark, one line about what this is, and the few links
// worth a second entry point. No link farm, no fake legal pages we don't have.
// ---------------------------------------------------------------------------

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <GatherLogo className="site-footer__logo" />
          <div>
            <p className="site-footer__wordmark">Gather</p>
            <p className="site-footer__tagline">
              Small gatherings, and the people who actually show up.
            </p>
          </div>
        </div>

        <nav className="site-footer__links" aria-label="Footer">
          <Link to="/events">Browse gatherings</Link>
          <Link to="/events/new">Host a gathering</Link>
          <Link to="/connections">Find people</Link>
        </nav>
      </div>

      <p className="site-footer__legal">
        Built as a capstone project. Reliability scores are derived from
        attendance history, not self-reported.
      </p>
    </footer>
  );
}
