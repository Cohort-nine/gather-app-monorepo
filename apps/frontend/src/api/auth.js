import { apiFetch } from "./client.js";

export const signup = (payload) =>
  apiFetch("/auth/signup", { method: "POST", body: payload, auth: false });

export const login = (payload) =>
  apiFetch("/auth/login", { method: "POST", body: payload, auth: false });

export const fetchMe = () => apiFetch("/auth/me");

export const logout = () => apiFetch("/auth/logout", { method: "POST" });
