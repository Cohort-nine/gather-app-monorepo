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

// Uploaded images (avatars, event covers) come back from the API as paths
// relative to the BACKEND's origin (e.g. "/uploads/abc.jpg"), served by
// express.static — not under /api, and not on the frontend's own origin.
// Rendered as-is in an <img src>, the browser resolves that path against
// whatever page it's on: in dev that's Vite's origin (localhost:5173, no
// such file), and in prod it's Vercel, whose catch-all rewrite serves
// index.html for literally any unmatched path — so the "image" would
// silently be an HTML document. Resolving against the API's own origin
// (stripping the "/api" suffix) is what actually reaches the backend.
const API_ORIGIN = new URL(API_BASE_URL, window.location.origin).origin;

export function resolveMediaUrl(path) {
  if (!path) return path;
  // Already a full/self-contained URL — a local file preview (blob:), an
  // inline data URI, or already-absolute http(s). Only a bare backend-
  // relative path like "/uploads/x.jpg" needs the origin prepended.
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${API_ORIGIN}${path}`;
}

// The API is on Render's free tier, which suspends the service after 15 minutes
// of no traffic. The next request wakes it, and while it boots Render answers
// with its own "Application loading" HTML page — at status 200, not 503. That
// detail matters: a naive `response.json().catch(() => ({}))` swallows the parse
// failure, `response.ok` is true, and the caller gets `{}` with no `data`. Every
// `.map()` downstream then throws on undefined and React unmounts the whole
// tree, which is why browse rendered as a black screen instead of an error.
//
// So: parse deliberately, treat a non-JSON body as a real failure, and retry a
// GET for a while rather than showing a failure the user can only fix by
// reloading. A cold start is roughly 30-60s and this is what that looks like.
const COLD_START_RETRY_MS = [2000, 4000, 6000, 8000, 10000, 12000, 15000];
const WAKEABLE_STATUSES = new Set([502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function wakingError() {
  const error = new Error(
    "The server is waking up — this can take up to a minute on the free hosting tier. Try again in a moment."
  );
  error.isWaking = true;
  return error;
}

/**
 * Every Gather endpoint responds { message, data?, errors? } whether it
 * succeeds or fails, so callers can read response.message the same way
 * either way. This throws on non-2xx with that message attached.
 *
 * @param {object} [options]
 * @param {(attempt: number) => void} [options.onWaking] Called each time the
 *   request is retried because the server appears to be asleep, so a page can
 *   tell the user what's happening instead of just spinning.
 */
export async function apiFetch(
  path,
  { method = "GET", body, auth = true, onWaking } = {}
) {
  const headers = { "Content-Type": "application/json" };

  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  // Only GETs are retried. Replaying a POST could create a duplicate record.
  const retryDelays = method === "GET" ? COLD_START_RETRY_MS : [];

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (cause) {
      // Network-level failure: offline, DNS, CORS preflight rejected.
      const error = new Error(
        "Couldn't reach the server. Check your connection and try again."
      );
      error.cause = cause;
      throw error;
    }

    const text = await response.text();

    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = null; // Not JSON — almost certainly a host's holding page.
    }

    const serverIsWaking =
      payload === null || WAKEABLE_STATUSES.has(response.status);

    if (serverIsWaking) {
      if (attempt < retryDelays.length) {
        onWaking?.(attempt + 1);
        await sleep(retryDelays[attempt]);
        continue;
      }
      throw wakingError();
    }

    if (!response.ok) {
      const error = new Error(
        payload.message || `Request failed with status ${response.status}`
      );
      error.status = response.status;
      error.errors = payload.errors;
      throw error;
    }

    return payload;
  }
}

/**
 * Same response contract as apiFetch, but for multipart/form-data (image
 * uploads). Deliberately not folded into apiFetch: that function always sets
 * Content-Type: application/json and JSON.stringifies the body, which would
 * corrupt a file upload — a FormData body needs the browser to set its own
 * Content-Type (with the multipart boundary) instead.
 *
 * No cold-start retry here, same reasoning as apiFetch's POST/PUT path:
 * blindly replaying a file upload risks saving it twice.
 */
export async function apiUpload(path, formData, { method = "POST" } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: formData });
  } catch (cause) {
    const error = new Error("Couldn't reach the server. Check your connection and try again.");
    error.cause = cause;
    throw error;
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = null;
  }

  if (payload === null || WAKEABLE_STATUSES.has(response.status)) {
    throw wakingError();
  }

  if (!response.ok) {
    const error = new Error(payload.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.errors = payload.errors;
    throw error;
  }

  return payload;
}
