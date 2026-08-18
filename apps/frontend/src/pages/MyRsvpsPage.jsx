import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cancelRsvp, fetchMyRsvps } from "../api/events.js";
import GatherLogo from "../components/GatherLogo.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import "./MyRsvpsPage.css";

// ---------------------------------------------------------------------------
// Everything you've signed up for.
//
// GET /api/me/rsvps returns them ordered by event start, oldest first. Splitting
// upcoming from past here rather than making two requests: the list is small,
// and the whole point of the page is seeing both at once.
//
// Cancelled RSVPs stay visible under "past" instead of disappearing. The record
// that you backed out — and when — is what the reliability score is built from,
// so hiding it would misrepresent your own history to you.
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const STATUS_LABELS = {
  going: "Going",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
  declined: "Declined"
};

export default function MyRsvpsPage() {
  const { user, loading: authLoading } = useAuth();

  const [rsvps, setRsvps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cancellingId, setCancellingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchMyRsvps()
      .then((res) => setRsvps(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    load();
  }, [authLoading, user, load]);

  async function handleCancel(rsvp) {
    const confirmed = window.confirm(
      `Cancel your RSVP to "${rsvp.event.title}"? Your spot goes to the next person on the waitlist.`
    );
    if (!confirmed) return;

    setCancellingId(rsvp.id);
    setMessage("");
    try {
      const res = await cancelRsvp(rsvp.event.id);
      setMessage(res.message);
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setCancellingId(null);
    }
  }

  if (authLoading) {
    return (
      <main className="page">
        <p className="status">Checking your session...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="page">
        <section className="panel">
          <h1>Your RSVPs</h1>
          <p className="status">Sign in to see what you're signed up for.</p>
          <Link to="/login">Sign in</Link>
        </section>
      </main>
    );
  }

  const now = new Date();
  const upcoming = rsvps.filter((r) => new Date(r.event.startsAt) >= now);
  const past = rsvps.filter((r) => new Date(r.event.startsAt) < now);

  function renderRsvp(rsvp, { canCancel }) {
    const { event } = rsvp;
    const active = ["going", "waitlisted"].includes(rsvp.status);

    return (
      <li key={rsvp.id} className="event-card my-rsvps__card">
        <div className="event-card__header">
          <h3>
            <Link to={`/events/${event.id}`}>{event.title}</Link>
          </h3>
          <span className={`my-rsvps__status my-rsvps__status--${rsvp.status}`}>
            {STATUS_LABELS[rsvp.status] ?? rsvp.status}
            {rsvp.status === "waitlisted" && rsvp.waitlistPosition
              ? ` #${rsvp.waitlistPosition}`
              : ""}
          </span>
        </div>

        <p className="event-card__meta">
          {dateFormatter.format(new Date(event.startsAt))}
          {" · "}
          {event.isOnline ? "Online" : event.city || "Location TBD"}
          {" · "}
          hosted by {event.host.displayName}
        </p>

        {rsvp.guestCount > 0 ? (
          <p className="event-card__meta">
            Bringing {rsvp.guestCount} guest{rsvp.guestCount === 1 ? "" : "s"}
          </p>
        ) : null}

        {event.status === "cancelled" ? (
          <p className="status status--error">The host cancelled this event.</p>
        ) : null}

        <div className="my-rsvps__actions">
          <Link to={`/events/${event.id}`}>View details</Link>

          {canCancel && active && event.status !== "cancelled" ? (
            <button
              type="button"
              className="my-rsvps__cancel"
              onClick={() => handleCancel(rsvp)}
              disabled={cancellingId === rsvp.id}
            >
              {cancellingId === rsvp.id ? "Cancelling..." : "Cancel RSVP"}
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">Gather</p>
        <div className="my-rsvps__heading">
          <h1>Your RSVPs</h1>
          <Link to="/events">Find something else</Link>
        </div>

        {message ? <p className="status">{message}</p> : null}
        {error ? <p className="status status--error">{error}</p> : null}
      </section>

      {loading ? (
        <p className="status">Loading your RSVPs...</p>
      ) : rsvps.length === 0 && !error ? (
        <section className="panel my-rsvps__empty">
          <GatherLogo className="empty-state__icon" />
          <h2>You haven't RSVP'd to anything yet</h2>
          <p>Once you sign up for a gathering, it'll show up here.</p>
          <Link to="/events">Browse gatherings</Link>
        </section>
      ) : (
        <>
          <section>
            <h2 className="my-rsvps__section-title">
              Upcoming {upcoming.length > 0 ? `(${upcoming.length})` : ""}
            </h2>
            {upcoming.length === 0 ? (
              <p className="status">
                Nothing coming up. <Link to="/events">Find a gathering</Link>
              </p>
            ) : (
              <ul className="event-list">
                {upcoming.map((rsvp) => renderRsvp(rsvp, { canCancel: true }))}
              </ul>
            )}
          </section>

          {past.length > 0 ? (
            <section>
              <h2 className="my-rsvps__section-title">Past ({past.length})</h2>
              <ul className="event-list my-rsvps__past">
                {past.map((rsvp) => renderRsvp(rsvp, { canCancel: false }))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
