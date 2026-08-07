const API_BASE_URL = "http://localhost:3001/api";
const TOKEN_KEY = "gather.token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/**
 * Every Gather endpoint responds { message, data?, errors? } whether it
 * succeeds or fails, so callers can read response.message the same way
 * either way. This throws on non-2xx with that message attached.
 */
export async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };

  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.errors = payload.errors;
    throw error;
  }

  return payload;
}
