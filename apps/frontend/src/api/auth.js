import { apiFetch, apiUpload } from "./client.js";

export const signup = (payload) =>
  apiFetch("/auth/signup", { method: "POST", body: payload, auth: false });

export const login = (payload) =>
  apiFetch("/auth/login", { method: "POST", body: payload, auth: false });

export const fetchMe = () => apiFetch("/auth/me");

export const logout = () => apiFetch("/auth/logout", { method: "POST" });

export const uploadAvatar = (file) => {
  const formData = new FormData();
  formData.append("avatar", file);
  return apiUpload("/me/avatar", formData);
};

// Both require { currentPassword, ... } — see server/controllers/authController.js.
export const changePassword = (payload) =>
  apiFetch("/auth/password", { method: "PATCH", body: payload });

export const changeEmail = (payload) =>
  apiFetch("/auth/email", { method: "PATCH", body: payload });
