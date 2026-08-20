import { Link } from "react-router-dom";
import { resolveMediaUrl } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import GatherLogo from "./GatherLogo.jsx";
import MutualAttendees from "./MutualAttendees.jsx";
import "./EventCard.css";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

/**
 * The card used everywhere an event gets listed — EventsPage's grid and
 * Home's "from your friends" section share this exact markup, so a design
 * change (or a new badge, a new stat) only has to happen once.
 *
 * RSVP state lives in the caller (see useEventRsvp) since each page owns a
 * different events array to patch on a successful RSVP.
 */
export default function EventCard({ event, rsvpStatus, rsvpMessage, justConfirmed, onRsvp }) {
  const { user } = useAuth();

  return (
    <li className="event-card">
      {/* The whole point of the detail page — cards were previously dead
          ends with no way through. */}
      <Link to={`/events/${event.id}`} className="event-card__media">
        {event.imageUrl ? (
          <img src={resolveMediaUrl(event.imageUrl)} alt="" loading="lazy" />
        ) : (
          <div className="event-card__media-placeholder" aria-hidden="true">
            <GatherLogo />
          </div>
        )}
        {event.category ? <span className="event-card__category">{event.category.name}</span> : null}
      </Link>

      <div className="event-card__body">
        <h3>
          <Link to={`/events/${event.id}`}>{event.title}</Link>
        </h3>

        <p className="event-card__meta">
          {dateFormatter.format(new Date(event.startsAt))}
          <br />
          {event.isOnline ? "Online" : event.city || "Location TBD"}
        </p>

        <div className="event-card__host">
          {event.host.avatarUrl ? (
            <img className="event-card__host-avatar" src={resolveMediaUrl(event.host.avatarUrl)} alt="" />
          ) : (
            <span className="event-card__host-avatar event-card__host-avatar--placeholder">
              {event.host.displayName?.[0]?.toUpperCase() ?? "?"}
            </span>
          )}
          <span className="event-card__meta">hosted by {event.host.displayName}</span>
        </div>

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

        {/* Social proof: people you already know who are going. Renders
            nothing (not even a loading flicker) when signed out or when none
            of your connections are attending. */}
        <MutualAttendees eventId={event.id} />

        {/* Hosting your own event isn't an RSVP — the API rejects it, so
            offer the useful action instead of a button that 409s. */}
        <div className="event-card__actions">
          {user && event.host.id === user.id ? (
            <Link to={`/events/${event.id}/edit`}>Edit your event</Link>
          ) : rsvpStatus === "going" ? (
            <span className={`event-card__confirmed ${justConfirmed ? "confirm-pulse" : ""}`}>
              ✓ You're going
            </span>
          ) : rsvpStatus === "waitlisted" ? (
            <span className="event-card__confirmed event-card__confirmed--waitlist">On the waitlist</span>
          ) : user ? (
            <button type="button" onClick={() => onRsvp(event.id)}>
              RSVP
            </button>
          ) : (
            <Link to="/login">Sign in to RSVP</Link>
          )}
        </div>

        {rsvpMessage ? <p className="status">{rsvpMessage}</p> : null}
      </div>
    </li>
  );
}
