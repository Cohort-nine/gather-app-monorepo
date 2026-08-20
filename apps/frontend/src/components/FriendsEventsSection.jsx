import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchFriendsEvents } from "../api/events.js";
import { useEventRsvp } from "../lib/useEventRsvp.js";
import EventCard from "./EventCard.jsx";
import "./FriendsEventsSection.css";

/**
 * "From your friends" — upcoming events where at least one of your accepted
 * connections is going. Only ever mounted for a signed-in user (see Home.jsx).
 *
 * Unlike MutualAttendees (which fails silently on a card), this is a whole
 * homepage section, so it earns an honest empty/error state instead of just
 * disappearing — the point is partly to nudge someone toward finding friends
 * or RSVPing, so "nothing yet" is worth saying out loud.
 */
export default function FriendsEventsSection() {
  const [events, setEvents] = useState(null); // null = still loading
  const [error, setError] = useState("");

  function patchEvent(eventId, updater) {
    setEvents((current) => current?.map((event) => (event.id === eventId ? updater(event) : event)));
  }

  const { rsvpMessage, rsvpStatus, justConfirmed, handleRsvp } = useEventRsvp(patchEvent);

  useEffect(() => {
    fetchFriendsEvents()
      .then((res) => setEvents(res.data ?? []))
      .catch((err) => setError(err.message));
  }, []);

  if (error || events === null) return null;

  return (
    <section className="friends-events">
      <div className="friends-events__heading">
        <h2>From your friends</h2>
        <Link to="/connections">Find more people</Link>
      </div>

      {events.length === 0 ? (
        <p className="status">
          Nobody you know has RSVP'd to anything upcoming yet —{" "}
          <Link to="/connections">connect with more people</Link> or{" "}
          <Link to="/events">browse gatherings</Link> to get things started.
        </p>
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
    </section>
  );
}
