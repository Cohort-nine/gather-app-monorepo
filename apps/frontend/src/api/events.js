import { apiFetch } from "./client.js";

export const fetchEvents = (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== "")
  ).toString();

  return apiFetch(`/events${query ? `?${query}` : ""}`, { auth: false });
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
