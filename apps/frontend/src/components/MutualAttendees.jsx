import { useEffect, useState } from "react";
import { resolveMediaUrl } from "../api/client.js";
import { fetchMutualAttendees } from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./MutualAttendees.css";

/**
 * "People you know are going" — an avatar stack + count, sourced from the
 * current user's accepted connections who've RSVP'd going to this event.
 *
 * Renders nothing (no skeleton, no error text) when signed out, still
 * loading, the request fails, or nobody you know is attending — this is a
 * social-proof nudge, not a feature the card's layout should ever depend on.
 */
export default function MutualAttendees({ eventId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!user) {
      setData(null);
      return;
    }

    let cancelled = false;
    fetchMutualAttendees(eventId)
      .then((res) => {
        if (!cancelled) setData(res.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, user]);

  if (!data || !data.attendees || data.attendees.length === 0) return null;

  const { attendees, total } = data;
  const overflow = total - attendees.length;

  return (
    <p className="mutual-attendees">
      <span className="mutual-attendees__stack">
        {attendees.map((person) =>
          person.avatarUrl ? (
            <img
              key={person.id}
              className="mutual-attendees__avatar"
              src={resolveMediaUrl(person.avatarUrl)}
              alt={person.displayName}
              title={person.displayName}
            />
          ) : (
            <span
              key={person.id}
              className="mutual-attendees__avatar mutual-attendees__avatar--placeholder"
              title={person.displayName}
            >
              {person.displayName?.[0]?.toUpperCase() ?? "?"}
            </span>
          )
        )}
      </span>
      {attendees
        .slice(0, 2)
        .map((p) => p.displayName.split(" ")[0])
        .join(", ")}
      {overflow > 0 ? ` + ${overflow} more` : ""} you know {total === 1 ? "is" : "are"} going
    </p>
  );
}
