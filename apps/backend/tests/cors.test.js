import { describe, expect, it, vi } from "vitest";

import {
  DEV_ORIGINS,
  buildCorsOptions,
  describeCorsPolicy,
  isOriginAllowed,
  originMatches,
  parseAllowedOrigins
} from "../server/lib/cors.js";

/** Run the cors middleware's origin callback and return what it decided. */
function decide(env, origin) {
  const { origin: check } = buildCorsOptions(env);
  const callback = vi.fn();
  check(origin, callback);
  return callback.mock.calls[0][1];
}

describe("parseAllowedOrigins", () => {
  it("splits a comma-separated list", () => {
    expect(parseAllowedOrigins("https://a.com,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com"
    ]);
  });

  it("tolerates the typos people make pasting into a hosting dashboard", () => {
    expect(parseAllowedOrigins(" https://a.com/ , https://b.com , ")).toEqual([
      "https://a.com",
      "https://b.com"
    ]);
  });

  it("returns an empty list for undefined or empty input", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });
});

describe("originMatches", () => {
  it("matches an exact origin", () => {
    expect(originMatches("https://gather.vercel.app", "https://gather.vercel.app")).toBe(true);
  });

  it("rejects a different origin", () => {
    expect(originMatches("https://evil.com", "https://gather.vercel.app")).toBe(false);
  });

  it("matches one subdomain level with a wildcard", () => {
    expect(originMatches("https://gather-abc123.vercel.app", "https://*.vercel.app")).toBe(true);
  });

  // The whole point of restricting to one label: an attacker registering
  // something like vercel.app.evil.com must not slip through.
  it("does not let a wildcard swallow extra domain levels", () => {
    expect(originMatches("https://a.b.vercel.app", "https://*.vercel.app")).toBe(false);
    expect(originMatches("https://gather.vercel.app.evil.com", "https://*.vercel.app")).toBe(false);
  });

  it("requires the scheme to match, so https rules don't allow http", () => {
    expect(originMatches("http://gather.vercel.app", "https://*.vercel.app")).toBe(false);
  });

  it("treats dots literally rather than as regex wildcards", () => {
    expect(originMatches("https://gatherXvercel.app", "https://gather.vercel.app")).toBe(false);
  });

  it("handles empty input without throwing", () => {
    expect(originMatches(undefined, "https://a.com")).toBe(false);
    expect(originMatches("https://a.com", undefined)).toBe(false);
  });
});

describe("isOriginAllowed", () => {
  it("passes if any pattern in the list matches", () => {
    const allowed = ["https://gather.com", "https://*.vercel.app"];
    expect(isOriginAllowed("https://preview-9.vercel.app", allowed)).toBe(true);
    expect(isOriginAllowed("https://gather.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://nope.com", allowed)).toBe(false);
  });

  it("allows nothing when the list is empty", () => {
    expect(isOriginAllowed("https://gather.com", [])).toBe(false);
  });
});

describe("buildCorsOptions", () => {
  it("allows the configured origin", () => {
    expect(decide({ CORS_ORIGIN: "https://gather.vercel.app" }, "https://gather.vercel.app")).toBe(
      true
    );
  });

  it("denies an origin that isn't configured", () => {
    expect(decide({ CORS_ORIGIN: "https://gather.vercel.app" }, "https://evil.com")).toBe(false);
  });

  // Denying with `false` rather than an Error keeps this a blocked request
  // instead of a 500 that looks like the server fell over.
  it("denies without raising an error", () => {
    const { origin: check } = buildCorsOptions({ CORS_ORIGIN: "https://gather.vercel.app" });
    const callback = vi.fn();
    check("https://evil.com", callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it("allows requests with no Origin header — curl, health checks, server-to-server", () => {
    expect(decide({ NODE_ENV: "production", CORS_ORIGIN: "https://gather.com" }, undefined)).toBe(
      true
    );
  });

  it("falls back to Vite's dev server outside production", () => {
    expect(decide({}, DEV_ORIGINS[0])).toBe(true);
    expect(decide({}, "https://random.com")).toBe(false);
  });

  it("allows nothing in production when CORS_ORIGIN is unset", () => {
    expect(decide({ NODE_ENV: "production" }, "https://gather.vercel.app")).toBe(false);
    // Not even localhost, which is the point — an unconfigured production
    // deploy should fail loudly rather than quietly trusting dev origins.
    expect(decide({ NODE_ENV: "production" }, DEV_ORIGINS[0])).toBe(false);
  });

  it("sets credentials so Authorization headers survive the preflight", () => {
    expect(buildCorsOptions({}).credentials).toBe(true);
  });
});

describe("describeCorsPolicy", () => {
  it("lists the configured origins", () => {
    expect(describeCorsPolicy({ CORS_ORIGIN: "https://a.com,https://b.com" })).toContain(
      "https://a.com, https://b.com"
    );
  });

  it("warns clearly when production is unconfigured", () => {
    const message = describeCorsPolicy({ NODE_ENV: "production" });
    expect(message).toContain("no CORS_ORIGIN set in production");
    expect(message).toContain("CORS_ORIGIN");
  });

  it("says it's using dev defaults locally", () => {
    expect(describeCorsPolicy({})).toContain("development defaults");
  });
});
