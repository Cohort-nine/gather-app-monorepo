import { useState } from "react";
import { rsvpToEvent } from "../api/events.js";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * RSVP state/handler shared by any page that renders a list of EventCards
 * (EventsPage, Home's "from your friends" section, ...). Kept out of
 * EventCard itself so each page can decide how to patch its own events
 * array on a successful "going" RSVP — the list endpoint doesn't return
 * "did I RSVP" per event, so a refetch wouldn't even show the confirmation,
 * and the response already told us exactly what changed.
 */
export function useEventRsvp(patchEvent) {
  const { user } = useAuth();
  const [rsvpMessage, setRsvpMessage] = useState({});
  const [rsvpStatus, setRsvpStatus] = useState({});
  const [justConfirmed, setJustConfirmed] = useState(null);

  async function handleRsvp(eventId) {
    setRsvpMessage((current) => ({ ...current, [eventId]: "Saving..." }));
    try {
      const res = await rsvpToEvent(eventId);
      const status = res.data.rsvp.status;
      setRsvpStatus((current) => ({ ...current, [eventId]: status }));

      if (status === "going") {
        patchEvent(eventId, (event) => {
          const spotsLeft = event.spotsLeft === null ? null : Math.max(0, event.spotsLeft - 1);
          return { ...event, goingCount: event.goingCount + 1, spotsLeft, isFull: spotsLeft === 0 };
        });

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

  return { rsvpMessage, rsvpStatus, justConfirmed, handleRsvp };
}
