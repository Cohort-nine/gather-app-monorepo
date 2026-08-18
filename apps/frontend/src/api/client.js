// Where the API lives. Set VITE_API_BASE_URL at build time — Vite inlines env
// vars into the bundle, so this is baked in when `npm run build` runs, not read
// at runtime. On Vercel that means setting it in the project's Environment
// Variables and REDEPLOYING; changing it alone does nothing to the live site.
//
// The localhost fallback keeps `npm run dev` working with no setup. It is only
// a sane default for local development; a production build with the variable
// unset would ship a bundle pointing every visitor at their own machine, so the
// warning below makes that loud instead of mysterious.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api";

if (import.meta.env.PROD && !import.meta.env.VITE_API_BASE_URL) {
  console.warn(
    "[gather] VITE_API_BASE_URL is not set — this production build is pointing " +
      "at http://localhost:3001/api and every request will fail. Set " +
      "VITE_API_BASE_URL in your hosting provider's environment variables and " +
      "redeploy."
  );
}

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
