import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { resolveMediaUrl } from "../api/client.js";
import { cancelRsvp, fetchEvent, rsvpToEvent } from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./EventDetailPage.css";

// ---------------------------------------------------------------------------
// One event, in full.
//
// GET /api/events/:id already does the hard part — it returns the host, the
// attendee list with each person's privacy setting honored, and the waitlist.
// This page's job is to render that faithfully, including the parts that are
// deliberately withheld.
//
// The address is the interesting case. When a host sets
// hideExactAddressUntilRsvp, the API returns addressHidden: true and nulls out
// the street fields. Saying so plainly ("shared once you RSVP") is better than
// rendering a blank line that reads like missing data.
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

/* An end time on a different calendar day needs the day, or the range reads
   backwards: a hike running 8:27 PM to 2:27 AM looked like it finished six
   hours before it started. Same-day events keep the bare time — repeating the
   date there is noise. */
const endDayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  hour: "numeric",
  minute: "2-digit"
});

function formatEnd(startsAt, endsAt) {
  const end = new Date(endsAt);
  const sameDay = end.toDateString() === new Date(startsAt).toDateString();
  return sameDay ? timeFormatter.format(end) : endDayFormatter.format(end);
}

/** "Excellent" reads better than "excellent" next to a name. */
const titleCase = (value) =>
  typeof value === "string" && value.length ? value[0].toUpperCase() + value.slice(1) : value;

export default function EventDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchEvent(id)
      .then((res) => setEvent(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRsvp() {
    setWorking(true);
    setActionMessage("");
    try {
      const res = await rsvpToEvent(id);
      const status = res.data.rsvp.status;

      // A small identity nudge, not a lecture — only for a confirmed spot,
      // and only once we actually know their standing.
      const encouragement =
        status === "going" && user?.reliability
          ? " Showing up like this is what keeps your reliability score strong."
          : "";
      setActionMessage(`${res.message}${encouragement}`);

      // Refetch rather than patching state by hand: RSVPing can change the
      // attendee list, the spot count, and whether you can see the address.
      await load();

      if (status === "going") {
        setJustConfirmed(true);
        setTimeout(() => setJustConfirmed(false), 650);
      }
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleCancel() {
    const confirmed = window.confirm(
      `Cancel your RSVP to "${event.title}"? Your spot goes to the next person on the waitlist.`
    );
    if (!confirmed) return;

    setWorking(true);
    setActionMessage("");
    try {
      const res = await cancelRsvp(id);
      setActionMessage(res.message);
      await load();
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <section className="panel">
          <div className="skeleton-line skeleton-line--title" />
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-line--short" />
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <section className="panel">
          <h1>Couldn't load this event</h1>
          <p className="status status--error">{error}</p>
          <Link to="/events">Back to browse</Link>
        </section>
      </main>
    );
  }

  if (!event) return null;

  const startsAt = new Date(event.startsAt);
  const isPast = startsAt < new Date();
  const isHost = user && event.host?.id === user.id;

  // The API returns the going list with ids, but the waitlist only by handle —
  // it's a public-facing view, so it doesn't expose user ids.
  const myAttendance = event.attendees?.find((a) => user && a.id === user.id);
  const myWaitlist = event.waitlist?.find((w) => user && w.handle === user.handle);
  const myRsvpStatus = myAttendance ? "going" : myWaitlist ? "waitlisted" : null;

  const canRsvp =
    user && !isHost && !myRsvpStatus && !isPast && event.status === "published";

  return (
    <main className="page event-detail">
      <p className="event-detail__back">
        <Link to="/events">← All gatherings</Link>
      </p>

      <section className="panel">
        {event.imageUrl ? (
          <div className="event-detail__cover">
            <img src={resolveMediaUrl(event.imageUrl)} alt="" />
          </div>
        ) : null}

        <div className="event-detail__header">
          <div>
            {event.category ? (
              <p className="eyebrow">{event.category.name}</p>
            ) : (
              <p className="eyebrow">Gathering</p>
            )}
            <h1>{event.title}</h1>
          </div>

          {event.status !== "published" ? (
            <span className={`event-detail__status event-detail__status--${event.status}`}>
              {titleCase(event.status)}
            </span>
          ) : null}
        </div>

        {event.status === "cancelled" ? (
          <p className="status status--error event-detail__cancelled">
            This event was cancelled
            {event.cancellationReason ? `: ${event.cancellationReason}` : "."}
          </p>
        ) : null}

        <dl className="event-detail__facts">
          <div>
            <dt>When</dt>
            <dd>
              {dateFormatter.format(startsAt)}
              {event.endsAt ? ` – ${formatEnd(startsAt, event.endsAt)}` : ""}
              {isPast ? <span className="event-detail__past"> · already happened</span> : null}
            </dd>
          </div>

          <div>
            <dt>Where</dt>
            <dd>
              {event.isOnline ? (
                <>
                  Online
                  {event.onlineUrl ? (
                    <>
                      {" · "}
                      <a href={event.onlineUrl} target="_blank" rel="noopener noreferrer">
                        Join link
                      </a>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  {event.placeName ? <div>{event.placeName}</div> : null}

                  {event.addressHidden ? (
                    <div className="event-detail__hidden-address">
                      {event.city ? `${event.city}${event.region ? `, ${event.region}` : ""}` : null}
                      <span> — exact address shared once you RSVP</span>
                    </div>
                  ) : (
                    <>
                      {event.addressLine1 ? <div>{event.addressLine1}</div> : null}
                      {event.addressLine2 ? <div>{event.addressLine2}</div> : null}
                      <div>
                        {[event.city, event.region, event.postalCode].filter(Boolean).join(", ")}
                      </div>
                    </>
                  )}
                </>
              )}
            </dd>
          </div>

          {/* Capacity is the one fact people scan for, so it gets the numeral
              treatment — the number large and alone, the qualifiers demoted to
              a caption beneath. Reading "3" at a glance and "of 12 · 9 going"
              only if you care is faster than parsing one run-on sentence. */}
          <div>
            <dt>Spots</dt>
            <dd
              className={
                !event.isFull && event.spotsLeft !== null && event.spotsLeft <= 3
                  ? "text-urgent"
                  : ""
              }
            >
              <span className="event-detail__stat">
                {event.capacity === null
                  ? event.goingCount
                  : event.isFull
                    ? "Full"
                    : event.spotsLeft}
              </span>
              <span className="event-detail__stat-caption">
                {event.capacity === null
                  ? "going · no limit"
                  : event.isFull
                    ? `${event.goingCount} going${
                        event.waitlistCount ? ` · ${event.waitlistCount} waitlisted` : ""
                      }`
                    : `of ${event.capacity} left · ${event.goingCount} going`}
              </span>
            </dd>
          </div>

          <div>
            <dt>Host</dt>
            <dd>
              <span className="event-detail__host-name">{event.host?.displayName}</span>
              <span className="event-detail__handle">@{event.host?.handle}</span>
              {event.host?.hostReputation?.ratingCount > 0 ? (
                <div className="event-detail__rating">
                  ★ {Number(event.host.hostReputation.score).toFixed(1)} from{" "}
                  {event.host.hostReputation.ratingCount}{" "}
                  {event.host.hostReputation.ratingCount === 1 ? "rating" : "ratings"}
                </div>
              ) : (
                <div className="event-detail__rating event-detail__rating--none">
                  No ratings yet
                </div>
              )}
            </dd>
          </div>
        </dl>

        {/* Labelled sections. The description used to be a bare paragraph and
            the tags a bare pill row, both floating under the facts with no
            indication of what they were — "yes" sitting alone reads as a
            rendering bug rather than a host's note. */}
        {event.description ? (
          <section className="event-detail__section">
            <h2 className="event-detail__section-label">About</h2>
            <p className="event-detail__description">{event.description}</p>
          </section>
        ) : null}

        {event.tags?.length ? (
          <section className="event-detail__section">
            <h2 className="event-detail__section-label">Tags</h2>
            <ul className="event-detail__tags">
              {event.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="event-detail__actions">
          {isHost ? (
            <Link className="event-detail__button" to={`/events/${event.id}/edit`}>
              Edit your event
            </Link>
          ) : !user ? (
            <Link className="event-detail__button" to="/login">
              Sign in to RSVP
            </Link>
          ) : myRsvpStatus ? (
            <>
              {/* On a cancelled event, "You're going" contradicts the banner
                  directly above it. The RSVP is still on record — that's what
                  the ledger is for — but the gathering isn't happening, so say
                  that instead of implying it is. */}
              <span
                className={`event-detail__yourstatus ${
                  event.status === "cancelled" ? "event-detail__yourstatus--void" : ""
                } ${myRsvpStatus === "going" && justConfirmed ? "confirm-pulse" : ""}`}
              >
                {event.status === "cancelled"
                  ? "You were going — the host cancelled"
                  : myRsvpStatus === "going"
                    ? "You're going"
                    : `You're #${myWaitlist.position} on the waitlist`}
              </span>
              {!isPast && event.status !== "cancelled" ? (
                <button
                  type="button"
                  className="event-detail__cancel"
                  onClick={handleCancel}
                  disabled={working}
                >
                  {working ? "Working..." : "Cancel RSVP"}
                </button>
              ) : null}
            </>
          ) : canRsvp ? (
            <button
              type="button"
              className="event-detail__button"
              onClick={handleRsvp}
              disabled={working}
            >
              {working ? "Saving..." : event.isFull ? "Join the waitlist" : "RSVP"}
            </button>
          ) : (
            <span className="status">
              {isPast ? "This event has already happened." : "RSVPs aren't open."}
            </span>
          )}
        </div>

        {actionMessage ? <p className="status">{actionMessage}</p> : null}
      </section>

      <section className="panel">
        <h2>Who's going</h2>

        {/* The bands are the whole product and they arrive unexplained — a
            visitor sees "EXCELLENT" next to a stranger's name with no idea
            it's earned. One line, stated once, rather than a tooltip nobody
            hovers. */}
        {event.attendees?.length ? (
          <p className="event-detail__legend">
            Reliability is earned, not self-reported — each band is calculated from
            how often that person actually showed up after saying they would.
          </p>
        ) : null}

        {event.attendees?.length === 0 && event.hiddenAttendeeCount === 0 ? (
          <p className="status">Nobody yet — you could be first.</p>
        ) : (
          <>
            <ul className="event-detail__people">
              {event.attendees.map((person) => (
                <li key={person.id}>
                  {/* Same avatar treatment as the browse cards, initials as
                      the fallback — a list of names reads as rows, a list of
                      faces reads as people who are actually coming. */}
                  {person.avatarUrl ? (
                    <img
                      className="event-detail__avatar"
                      src={resolveMediaUrl(person.avatarUrl)}
                      alt=""
                    />
                  ) : (
                    <span
                      className="event-detail__avatar event-detail__avatar--placeholder"
                      aria-hidden="true"
                    >
                      {person.displayName?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                  <span className="event-detail__person-name">{person.displayName}</span>
                  <span className="event-detail__handle">@{person.handle}</span>
                  {person.guestCount > 0 ? (
                    <span className="event-detail__guests">
                      +{person.guestCount} guest{person.guestCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span
                    className={`event-detail__band event-detail__band--${person.reliabilityBand}`}
                  >
                    {titleCase(person.reliabilityBand)}
                  </span>
                </li>
              ))}
            </ul>

            {/* People who set their visibility to 'nobody' still count toward
                the headcount — the number stays honest without naming them. */}
            {event.hiddenAttendeeCount > 0 ? (
              <p className="status">
                + {event.hiddenAttendeeCount} other{event.hiddenAttendeeCount === 1 ? "" : "s"} who
                prefer not to be listed
              </p>
            ) : null}
          </>
        )}

        {event.waitlist?.length ? (
          <>
            <h3>Waitlist</h3>
            <ol className="event-detail__waitlist">
              {event.waitlist.map((person) => (
                <li key={person.handle}>
                  <span className="event-detail__position">#{person.position}</span>
                  {person.displayName}{" "}
                  <span className="event-detail__handle">@{person.handle}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </section>
    </main>
  );
}
