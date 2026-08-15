import { useEffect, useMemo, useState } from "react";
import { fetchMyRsvps, cancelRsvp } from "../api/events.js";

const STATUS_LABEL = {
  going: "Going",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
};

function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function locationLabel(event) {
  if (!event) return "";
  if (event.isOnline) return "Online";
  return [event.placeName, event.city].filter(Boolean).join(" · ");
}

function RsvpRow({ rsvp, onCancel, cancelling }) {
  const { event } = rsvp;
  return (
    <li className="rsvp-row">
      <div className="rsvp-row-main">
        <div className="rsvp-title">{event?.title ?? "Untitled event"}</div>
        <div className="rsvp-meta">
          <span>{formatDateTime(event?.startsAt)}</span>
          {locationLabel(event) && <span> · {locationLabel(event)}</span>}
        </div>
      </div>
      <div className="rsvp-row-side">
        <span className={`rsvp-status rsvp-status-${rsvp.status}`}>
          {STATUS_LABEL[rsvp.status] ?? rsvp.status}
        </span>
        {rsvp.status !== "cancelled" && (
          <button
            type="button"
            onClick={() => onCancel(event?.id)}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling..." : "Cancel RSVP"}
          </button>
        )}
      </div>
    </li>
  );
}

export default function MyRsvpsPage() {
  const [rsvps, setRsvps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchMyRsvps()
      .then((res) => setRsvps(res.data ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const upcoming = [];
    const past = [];

    for (const rsvp of rsvps) {
      const startsAt = rsvp.event?.startsAt ? new Date(rsvp.event.startsAt) : null;
      if (startsAt && startsAt >= now) upcoming.push(rsvp);
      else past.push(rsvp);
    }

    upcoming.sort((a, b) => new Date(a.event.startsAt) - new Date(b.event.startsAt));
    past.sort((a, b) => new Date(b.event.startsAt) - new Date(a.event.startsAt));

    return { upcoming, past };
  }, [rsvps]);

  async function handleCancel(eventId) {
    if (!eventId) return;
    setCancellingId(eventId);
    try {
      await cancelRsvp(eventId);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <p>Loading your RSVPs...</p>;

  return (
    <div className="my-rsvps-page">
      <h1>My RSVPs</h1>

      {error && <p className="my-rsvps-error">{error}</p>}

      <section>
        <h2>Upcoming ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <p>No upcoming events. Go find something to RSVP to!</p>
        ) : (
          <ul className="rsvp-list">
            {upcoming.map((rsvp) => (
              <RsvpRow
                key={rsvp.id}
                rsvp={rsvp}
                onCancel={handleCancel}
                cancelling={cancellingId === rsvp.event?.id}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Past ({past.length})</h2>
        {past.length === 0 ? (
          <p>Nothing here yet.</p>
        ) : (
          <ul className="rsvp-list">
            {past.map((rsvp) => (
              <RsvpRow key={rsvp.id} rsvp={rsvp} onCancel={handleCancel} cancelling={false} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
