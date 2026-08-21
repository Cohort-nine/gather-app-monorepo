import { apiFetch, apiUpload } from "./client.js";

export const fetchEvents = (params = {}, options = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== "")
  ).toString();

  return apiFetch(`/events${query ? `?${query}` : ""}`, { auth: false, ...options });
};

/**
 * Events you host, in any state — including drafts, which the public browse
 * endpoint filters out. Requires a session; the backend scopes it to the
 * signed-in user rather than accepting a host id.
 */
export const fetchMyEvents = () => apiFetch("/events?mine=true&sort=soonest");

// auth: false is wrong here — a signed-in user who has RSVP'd is shown the
// exact address, and that only happens if the token is sent.
export const fetchEvent = (id) => apiFetch(`/events/${id}`);

export const createEvent = (payload) =>
  apiFetch("/events", { method: "POST", body: payload });

export const updateEvent = (id, payload) =>
  apiFetch(`/events/${id}`, { method: "PUT", body: payload });

export const deleteEvent = (id) => apiFetch(`/events/${id}`, { method: "DELETE" });

export const fetchCategories = () => apiFetch("/categories", { auth: false });

export const rsvpToEvent = (id, payload = {}) =>
  apiFetch(`/events/${id}/rsvp`, { method: "POST", body: payload });

export const cancelRsvp = (id) => apiFetch(`/events/${id}/rsvp`, { method: "DELETE" });

export const fetchMyRsvps = () => apiFetch("/me/rsvps");

/**
 * Ratings left for an event's host. Public — anyone deciding whether to RSVP
 * should be able to read them without an account.
 */
export const fetchEventRatings = (id) => apiFetch(`/events/${id}/ratings`, { auth: false });

/**
 * Rate the host, 1-5, with an optional comment. The backend upserts on
 * (event, rater), so submitting again edits your existing rating rather than
 * adding a second one — no separate update call needed.
 */
export const rateHost = (id, { rating, comment }) =>
  apiFetch(`/events/${id}/ratings`, { method: "POST", body: { rating, comment } });

// Empty on purpose for a signed-out visitor rather than an error — see
// MutualAttendees.jsx, which relies on that to render nothing quietly.
export const fetchMutualAttendees = (id) => apiFetch(`/events/${id}/mutual-attendees`, { auth: true });

export const fetchFriendsEvents = () => apiFetch("/me/friends-events");

export const uploadEventImage = (id, file) => {
  const formData = new FormData();
  formData.append("image", file);
  return apiUpload(`/events/${id}/image`, formData);
};
