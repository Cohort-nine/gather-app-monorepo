import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCategories, fetchEvents, rsvpToEvent } from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./EventsPage.css";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export default function EventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ search: "", category: "", sort: "soonest" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rsvpMessage, setRsvpMessage] = useState({});
  const [rsvpStatus, setRsvpStatus] = useState({});
  const [justConfirmed, setJustConfirmed] = useState(null);

  useEffect(() => {
    fetchCategories()
      .then((res) => setCategories(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetchEvents(filters)
      .then((res) => setEvents(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters]);

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function handleRsvp(eventId) {
    setRsvpMessage((current) => ({ ...current, [eventId]: "Saving..." }));
    try {
      const res = await rsvpToEvent(eventId);
      const status = res.data.rsvp.status;
      setRsvpStatus((current) => ({ ...current, [eventId]: status }));

      // Patched locally rather than refetched: the list endpoint doesn't
      // return "did I RSVP" per event, so a refetch wouldn't even show this
      // confirmation — and the response already told us exactly what changed.
      if (status === "going") {
        setEvents((current) =>
          current.map((event) => {
            if (event.id !== eventId) return event;
            const spotsLeft = event.spotsLeft === null ? null : Math.max(0, event.spotsLeft - 1);
            return { ...event, goingCount: event.goingCount + 1, spotsLeft, isFull: spotsLeft === 0 };
          })
        );

        setJustConfirmed(eventId);
        setTimeout(() => setJustConfirmed((current) => (current === eventId ? null : current)), 650);
      }

      // A small identity nudge, not a lecture — only for confirmed RSVPs, and
      // only once we actually know their standing.
      const encouragement =
        status === "going" && user?.reliability
          ? " Showing up like this is what keeps your reliability score strong."
          : "";
      setRsvpMessage((current) => ({ ...current, [eventId]: `${res.message}${encouragement}` }));
    } catch (err) {
      setRsvpMessage((current) => ({ ...current, [eventId]: err.message }));
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">Gather</p>
        <div className="events-heading">
          <h1>Browse gatherings</h1>
          {user ? (
            <span className="events-heading__links">
              <Link to="/my-events">Your events</Link>
              <Link to="/events/new">Host a gathering</Link>
            </span>
          ) : null}
        </div>

        <form className="events-filters" onSubmit={(e) => e.preventDefault()}>
          <input
            name="search"
            value={filters.search}
            onChange={handleFilterChange}
            placeholder="Search by title or description"
          />

          <select name="category" value={filters.category} onChange={handleFilterChange}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>

          <select name="sort" value={filters.sort} onChange={handleFilterChange}>
            <option value="soonest">Soonest</option>
            <option value="newest">Newest</option>
            <option value="popular">Popular</option>
            <option value="title">Title</option>
          </select>
        </form>
      </section>

      {error ? <p className="status status--error">{error}</p> : null}

      {loading ? (
        <ul className="event-list" aria-hidden="true" aria-label="Loading events">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="event-card event-card--skeleton">
              <div className="skeleton-line skeleton-line--title" />
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line--short" />
            </li>
          ))}
        </ul>
      ) : events.length === 0 && !error ? (
        <p className="status">No events matched your filters.</p>
      ) : (
        <ul className="event-list">
          {events.map((event) => (
            <li key={event.id} className="event-card">
              <div className="event-card__header">
                {/* The whole point of the detail page — cards were previously
                    dead ends with no way through. */}
                <h3>
                  <Link to={`/events/${event.id}`}>{event.title}</Link>
                </h3>
                {event.category ? <span>{event.category.name}</span> : null}
              </div>

              <p className="event-card__meta">
                {dateFormatter.format(new Date(event.startsAt))}
                {" · "}
                {event.isOnline ? "Online" : event.city || "Location TBD"}
                {" · "}
                hosted by {event.host.displayName}
              </p>

              <p
                className={`event-card__meta ${
                  !event.isFull && event.spotsLeft !== null && event.spotsLeft > 0 && event.spotsLeft <= 3
                    ? "text-urgent"
                    : ""
                }`}
              >
                {event.isFull
                  ? "Full"
                  : event.spotsLeft === null
                    ? `${event.goingCount} going`
                    : `${event.spotsLeft} spot(s) left`}
              </p>

              {/* Hosting your own event isn't an RSVP — the API rejects it, so
                  offer the useful action instead of a button that 409s. */}
              <div className="event-card__actions">
                <Link to={`/events/${event.id}`}>View details</Link>

                {user && event.host.id === user.id ? (
                  <Link to={`/events/${event.id}/edit`}>Edit your event</Link>
                ) : rsvpStatus[event.id] === "going" ? (
                  <span
                    className={`event-card__confirmed ${
                      justConfirmed === event.id ? "confirm-pulse" : ""
                    }`}
                  >
                    ✓ You're going
                  </span>
                ) : rsvpStatus[event.id] === "waitlisted" ? (
                  <span className="event-card__confirmed event-card__confirmed--waitlist">
                    On the waitlist
                  </span>
                ) : user ? (
                  <button type="button" onClick={() => handleRsvp(event.id)}>
                    RSVP
                  </button>
                ) : (
                  <Link to="/login">Sign in to RSVP</Link>
                )}
              </div>

              {rsvpMessage[event.id] ? (
                <p className="status">{rsvpMessage[event.id]}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
