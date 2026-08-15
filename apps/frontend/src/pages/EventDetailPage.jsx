import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchEvent, rsvpToEvent, cancelRsvp } from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./EventsPage.css";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatRange(startsAt, endsAt) {
  if (!startsAt) return "";
  const start = dateFormatter.format(new Date(startsAt));
  if (!endsAt) return start;
  const end = dateFormatter.format(new Date(endsAt));
  return `${start} – ${end}`;
}

function locationLine(event) {
  if (event.isOnline) return event.onlineUrl ? "Online" : "Online event";
  return [event.placeName, event.addressLine1, event.city, event.region]
    .filter(Boolean)
    .join(", ");
}

export default function EventDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const [event, setEvent] = useState(null);
  const [status, setStatus] = useState("Loading event...");
  const [rsvpStatus, setRsvpStatus] = useState("");

  function load() {
    setStatus("Loading event...");
    fetchEvent(id)
      .then((res) => {
        setEvent(res.data);
        setStatus("");
      })
      .catch((err) => setStatus(err.message));
  }

  useEffect(load, [id]);

  async function handleRsvp() {
    setRsvpStatus("Saving...");
    try {
      const res = await rsvpToEvent(id);
      setRsvpStatus(res.message);
      load();
    } catch (err) {
      setRsvpStatus(err.message);
    }
  }

  async function handleCancel() {
    setRsvpStatus("Cancelling...");
    try {
      await cancelRsvp(id);
      setRsvpStatus("");
      load();
    } catch (err) {
      setRsvpStatus(err.message);
    }
  }

  if (status) return <main className="page"><p className="status">{status}</p></main>;
  if (!event) return null;

  // NOTE: field names below (host.bio, attendees, waitlistCount, myRsvp, etc.)
  // are best-guess based on the ticket description. Once you see the real
  // GET /api/events/:id response shape in the browser network tab, adjust
  // any mismatched field names — everything here uses optional chaining
  // (?.) so a missing field just renders blank instead of crashing.

  const myRsvpStatus = event.myRsvp?.status;

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">{event.category?.name ?? "Gather"}</p>
        <h1>{event.title}</h1>

        <p className="event-card__meta">{formatRange(event.startsAt, event.endsAt)}</p>
        <p className="event-card__meta">{locationLine(event)}</p>
        <p className="event-card__meta">
          hosted by {event.host?.displayName ?? "Unknown host"}
        </p>
        {event.host?.bio && <p className="event-card__meta">{event.host.bio}</p>}

        {event.description && <p>{event.description}</p>}

        <p className="event-card__meta">
          {event.isFull
            ? "Full"
            : event.spotsLeft == null
              ? `${event.goingCount ?? 0} going`
              : `${event.spotsLeft} spot(s) left`}
          {typeof event.waitlistCount === "number" && event.waitlistCount > 0 && (
            <> · {event.waitlistCount} on waitlist</>
          )}
        </p>

        {myRsvpStatus === "waitlisted" && event.myRsvp?.waitlistPosition != null && (
          <p className="status">
            You're #{event.myRsvp.waitlistPosition} on the waitlist.
          </p>
        )}

        {user ? (
          myRsvpStatus === "going" || myRsvpStatus === "waitlisted" ? (
            <button type="button" onClick={handleCancel}>
              Cancel RSVP
            </button>
          ) : (
            <button type="button" onClick={handleRsvp}>
              RSVP
            </button>
          )
        ) : (
          <Link to="/login">Sign in to RSVP</Link>
        )}

        {rsvpStatus && <p className="status">{rsvpStatus}</p>}

        {Array.isArray(event.attendees) && event.attendees.length > 0 && (
          <>
            <h2>Who's going</h2>
            <ul className="event-list">
              {event.attendees.map((attendee) => (
                <li key={attendee.id} className="event-card">
                  {attendee.displayName}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
