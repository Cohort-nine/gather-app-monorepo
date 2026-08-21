import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCategories, fetchEvents } from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useEventRsvp } from "../lib/useEventRsvp.js";
import EventCard from "../components/EventCard.jsx";
import FriendsEventsSection from "../components/FriendsEventsSection.jsx";
import "./EventsPage.css";

export default function EventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ search: "", category: "", sort: "soonest" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waking, setWaking] = useState(false);

  function patchEvent(eventId, updater) {
    setEvents((current) => current.map((event) => (event.id === eventId ? updater(event) : event)));
  }

  const { rsvpMessage, rsvpStatus, justConfirmed, handleRsvp } = useEventRsvp(patchEvent);

  useEffect(() => {
    fetchCategories()
      // `?? []` is not paranoia: a response without `data` used to set this to
      // undefined and the `.map()` below threw, taking the whole app down.
      .then((res) => setCategories(res.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    setWaking(false);
    fetchEvents(filters, { onWaking: () => setWaking(true) })
      .then((res) => setEvents(res.data ?? []))
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setWaking(false);
      });
  }, [filters]);

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <main className="page">
      <section className="panel page-header">
        <p className="eyebrow">Gather</p>
        {/* "Your events" and "Host a gathering" used to sit here too. They were
            added before the persistent nav existed; now they are the same two
            destinations offered twice on one screen, which just makes the user
            decide between identical options. The nav owns them. */}
        <div className="events-heading">
          <h1>Browse gatherings</h1>
        </div>
        <p className="page-header__sub">
          Small, local, and hosted by people you can look up. Filter by what you're
          in the mood for, or just see what's soonest.
        </p>

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

      {/* A cold start is 30-60s of nothing. Saying so beats four skeleton cards
          that look frozen. role="status" announces it without stealing focus. */}
      {waking ? (
        <p className="status" role="status">
          Waking the server up — the free hosting tier sleeps when it's idle, so
          this first load can take up to a minute.
        </p>
      ) : null}

      {loading ? (
        <ul className="event-grid" aria-hidden="true" aria-label="Loading events">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="event-card event-card--skeleton">
              <div className="event-card__media event-card__media--skeleton" />
              <div className="event-card__body">
                <div className="skeleton-line skeleton-line--title" />
                <div className="skeleton-line" />
                <div className="skeleton-line skeleton-line--short" />
              </div>
            </li>
          ))}
        </ul>
      ) : events.length === 0 && !error ? (
        <p className="status">No events matched your filters.</p>
      ) : (
        <ul className="event-grid">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              rsvpStatus={rsvpStatus[event.id]}
              rsvpMessage={rsvpMessage[event.id]}
              justConfirmed={justConfirmed === event.id}
              onRsvp={handleRsvp}
            />
          ))}
        </ul>
      )}

      {/* Moved here from the homepage, and placed below the full listing on
          purpose. Browse's job is "show me what's on"; this is a narrower cut
          of the same events, so it belongs after the complete answer rather
          than in front of it — otherwise the first thing on a browse page is
          a partial list, which is the wrong promise.

          The homepage was the wrong home for a different reason: it's the one
          page signed-out visitors see, and this only ever renders for a
          signed-in user, so it was dead space in every first impression.

          Renders nothing at all when signed out, on error, or while loading. */}
      {user ? <FriendsEventsSection /> : null}
    </main>
  );
}
