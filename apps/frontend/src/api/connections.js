import { apiFetch } from "./client.js";

export const searchUsers = (query) =>
  apiFetch(`/users/search?q=${encodeURIComponent(query)}`);

export const fetchConnections = (status) =>
  apiFetch(`/connections${status ? `?status=${status}` : ""}`);

export const sendConnectionRequest = (userId) =>
  apiFetch("/connections", { method: "POST", body: { userId } });

export const acceptConnection = (userId) =>
  apiFetch(`/connections/${userId}/accept`, { method: "PATCH" });

export const declineConnection = (userId) =>
  apiFetch(`/connections/${userId}/decline`, { method: "PATCH" });

export const removeConnection = (userId) =>
  apiFetch(`/connections/${userId}`, { method: "DELETE" });
