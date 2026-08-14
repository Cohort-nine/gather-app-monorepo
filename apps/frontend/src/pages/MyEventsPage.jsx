import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchMyEvents } from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./MyEventsPage.css";

// ---------------------------------------------------------------------------
// Everything you host, in any state.
//
// This exists because the browse endpoint only returns published + public
// events. Without it a host could save a draft and never find it again, which
// makes the draft status in the schema effectively unusable.
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const STATUS_LABELS = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
  completed: "Completed"
};

export default function MyEventsPage() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const savedTitle = searchParams.get("saved");
  const justDeleted = searchParams.get("deleted");

  useEffect(() => {
    if (authLoading || !user) return;

    setLoading(true);
    setError("");
    fetchMyEvents()
      .then((res) => setEvents(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  // Clear the confirmation out of the URL so a refresh doesn't replay it.
  function dismissNotice() {
    searchParams.delete("saved");
    searchParams.delete("deleted");
    setSearchParams(searchParams, { replace: true });
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
          <h1>Your events</h1>
          <p className="status">Sign in to see the gatherings you're hosting.</p>
          <Link to="/login">Sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">Gather</p>
        <div className="my-events__heading">
          <h1>Your events</h1>
          <Link className="my-events__new" to="/events/new">
            Host a gathering
          </Link>
        </div>

        {savedTitle ? (
          <p className="status my-events__notice" role="status">
            Saved “{savedTitle}”.{" "}
            <button type="button" className="my-events__dismiss" onClick={dismissNotice}>
              Dismiss
            </button>
          </p>
        ) : null}

        {justDeleted ? (
          <p className="status my-events__notice" role="status">
            Event deleted.{" "}
            <button type="button" className="my-events__dismiss" onClick={dismissNotice}>
              Dismiss
            </button>
          </p>
        ) : null}

        {error ? <p className="status status--error">{error}</p> : null}
      </section>

      {loading ? (
        <p className="status">Loading your events...</p>
      ) : events.length === 0 && !error ? (
        <section className="panel my-events__empty">
          <h2>You haven't hosted anything yet</h2>
          <p>
            A gathering can be four people and a pot of soup. Start there.
          </p>
          <Link to="/events/new">Create your first event</Link>
        </section>
      ) : (
        <ul className="event-list">
          {events.map((event) => (
            <li key={event.id} className="event-card">
              <div className="event-card__header">
                <h3>{event.title}</h3>
                <span className={`my-events__status my-events__status--${event.status}`}>
                  {STATUS_LABELS[event.status] ?? event.status}
                </span>
              </div>

              <p className="event-card__meta">
                {dateFormatter.format(new Date(event.startsAt))}
                {" · "}
                {event.isOnline ? "Online" : event.city || "Location TBD"}
                {event.visibility !== "public" ? ` · ${event.visibility.replace("_", " ")}` : ""}
              </p>

              <p className="event-card__meta">
                {event.goingCount} going
                {event.waitlistCount > 0 ? ` · ${event.waitlistCount} waitlisted` : ""}
                {event.capacity ? ` · capacity ${event.capacity}` : ""}
              </p>

              <div className="my-events__actions">
                <Link to={`/events/${event.id}/edit`}>Edit</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
