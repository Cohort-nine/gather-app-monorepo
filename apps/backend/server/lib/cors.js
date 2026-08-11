// ---------------------------------------------------------------------------
// CORS origin policy
//
// `app.use(cors())` allows every origin on the internet to call this API with
// the browser's blessing. That's fine while everything is on localhost and
// actively wrong once the API is on a public domain: any site could serve a
// page that makes authenticated requests on behalf of a logged-in Gather user.
//
// So the allowed origins come from the CORS_ORIGIN environment variable:
//
//   CORS_ORIGIN="https://gather.vercel.app,https://*.vercel.app"
//
// Two forms are supported:
//   - exact       https://gather.vercel.app
//   - subdomain   https://*.vercel.app   (matches any single-level subdomain)
//
// The wildcard form exists because Vercel gives every branch its own preview
// URL. Without it you'd be editing an env var on every branch deploy.
// ---------------------------------------------------------------------------

/** What local development gets when CORS_ORIGIN isn't set. Vite's dev server. */
export const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

/**
 * Split the env var into a list. Tolerates spaces, trailing commas, and
 * trailing slashes, because those are exactly the typos people make when
 * pasting a URL into a hosting dashboard at 2am.
 */
export function parseAllowedOrigins(raw) {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Does `origin` match `pattern`?
 *
 * Wildcards only replace one label (`https://*.vercel.app` matches
 * `https://gather-abc.vercel.app` but NOT `https://evil.attacker.vercel.app.co`),
 * and the scheme must match too — otherwise `https://*.vercel.app` would
 * silently accept plain `http://`.
 */
export function originMatches(origin, pattern) {
  if (!origin || !pattern) return false;
  if (pattern === origin) return true;
  if (!pattern.includes("*")) return false;

  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    // A wildcard label may not contain a dot, so it can't swallow extra levels.
    .join("[^.]+");

  return new RegExp(`^${escaped}$`).test(origin);
}

export function isOriginAllowed(origin, allowed) {
  return allowed.some((pattern) => originMatches(origin, pattern));
}

/**
 * Build the options object for the `cors` middleware.
 *
 * @param {object} env  process.env, injected so this is testable
 */
export function buildCorsOptions(env = process.env) {
  const configured = parseAllowedOrigins(env.CORS_ORIGIN);
  const isProduction = env.NODE_ENV === "production";
  const allowed = configured.length > 0 ? configured : isProduction ? [] : DEV_ORIGINS;

  return {
    credentials: true,
    origin(origin, callback) {
      // No Origin header at all: curl, Postman, server-to-server calls, and
      // Render's health checks. CORS is a browser protection; there is no
      // browser here and nothing to protect, so let these through.
      if (!origin) return callback(null, true);

      if (isOriginAllowed(origin, allowed)) return callback(null, true);

      // Deny by returning `false` rather than an Error. An Error becomes a 500
      // and looks like the server broke; `false` just omits the CORS headers,
      // which is the honest answer — the browser then blocks it, as intended.
      return callback(null, false);
    }
  };
}

/**
 * One loud line at boot describing the actual policy.
 *
 * A misconfigured CORS setup fails in the browser console on someone else's
 * machine, which is a miserable thing to debug. Saying it out loud at startup
 * turns that into a thing you can see in your deploy logs.
 */
export function describeCorsPolicy(env = process.env) {
  const configured = parseAllowedOrigins(env.CORS_ORIGIN);
  const isProduction = env.NODE_ENV === "production";

  if (configured.length > 0) {
    return `CORS: allowing ${configured.join(", ")}`;
  }

  if (isProduction) {
    return (
      "CORS: no CORS_ORIGIN set in production — every cross-origin browser " +
      "request will be blocked. Set CORS_ORIGIN to your frontend's URL " +
      '(e.g. "https://your-app.vercel.app") and redeploy.'
    );
  }

  return `CORS: development defaults (${DEV_ORIGINS.join(", ")}). Set CORS_ORIGIN to override.`;
}
