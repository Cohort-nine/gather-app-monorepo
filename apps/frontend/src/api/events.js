import { apiFetch } from "./client.js";

export const fetchEvents = (params = {}) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== "")
  ).toString();

  return apiFetch(`/events${query ? `?${query}` : ""}`, { auth: false });
};

export const fetchEvent = (id) => apiFetch(`/events/${id}`, { auth: false });

export const fetchCategories = () => apiFetch("/categories", { auth: false });

export const rsvpToEvent = (id, payload = {}) =>
  apiFetch(`/events/${id}/rsvp`, { method: "POST", body: payload });

export const cancelRsvp = (id) => apiFetch(`/events/${id}/rsvp`, { method: "DELETE" });

export const fetchMyRsvps = () => apiFetch("/me/rsvps");
