// ---------------------------------------------------------------------------
// Event validation
//
// The frontend validates too, but the backend never assumes it ran. Anyone can
// POST straight to the API with curl or Thunder Client, so every rule the
// database enforces with a CHECK constraint is also checked here — that way
// the user gets a readable 400 instead of a 500 from a constraint violation.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);

/** Turn a title into a URL-safe slug. Events have a UNIQUE slug column. */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const parseDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Validate a create or update payload.
 *
 * @param {object} body      the request body
 * @param {boolean} partial  true for PUT, where only the sent fields are checked
 * @returns {{errors: string[], data: object}}
 */
export function validateEventPayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};
  const has = (key) => body[key] !== undefined && body[key] !== null && body[key] !== "";

  // ---- required on create ------------------------------------------------
  if (!partial || has("title")) {
    if (!has("title")) {
      errors.push("title is required");
    } else if (String(body.title).trim().length < 3) {
      errors.push("title must be at least 3 characters");
    } else {
      data.title = String(body.title).trim();
    }
  }

  if (!partial || has("hostId")) {
    if (!has("hostId")) {
      errors.push("hostId is required");
    } else if (!isUuid(body.hostId)) {
      errors.push("hostId must be a valid UUID");
    } else {
      data.hostId = body.hostId;
    }
  }

  let startsAt = null;
  if (!partial || has("startsAt")) {
    if (!has("startsAt")) {
      errors.push("startsAt is required");
    } else {
      startsAt = parseDate(body.startsAt);
      if (!startsAt) errors.push("startsAt must be a valid date");
      else data.startsAt = startsAt;
    }
  }

  // ---- optional, but checked when present --------------------------------
  let endsAt = null;
  if (has("endsAt")) {
    endsAt = parseDate(body.endsAt);
    if (!endsAt) errors.push("endsAt must be a valid date");
    else data.endsAt = endsAt;
  }

  // Mirrors CHECK events_end_after_start.
  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.push("endsAt must be after startsAt");
  }

  if (has("rsvpClosesAt")) {
    const closes = parseDate(body.rsvpClosesAt);
    if (!closes) {
      errors.push("rsvpClosesAt must be a valid date");
    } else {
      // Mirrors CHECK events_rsvp_before_start.
      if (startsAt && closes > startsAt) {
        errors.push("rsvpClosesAt cannot be after startsAt");
      }
      data.rsvpClosesAt = closes;
    }
  }

  if (has("capacity")) {
    const capacity = Number(body.capacity);
    // Mirrors CHECK events_capacity_positive.
    if (!Number.isInteger(capacity) || capacity < 1) {
      errors.push("capacity must be a positive whole number");
    } else {
      data.capacity = capacity;
    }
  }

  if (body.isOnline !== undefined) {
    data.isOnline = Boolean(body.isOnline);
    // Mirrors CHECK events_online_has_url.
    if (data.isOnline && !has("onlineUrl")) {
      errors.push("onlineUrl is required when isOnline is true");
    }
  }

  if (has("onlineUrl")) {
    try {
      new URL(body.onlineUrl);
      data.onlineUrl = body.onlineUrl;
    } catch {
      errors.push("onlineUrl must be a valid URL");
    }
  }

  if (has("categoryId")) {
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      errors.push("categoryId must be a positive whole number");
    } else {
      data.categoryId = categoryId;
    }
  }

  if (has("seriesId")) {
    if (!isUuid(body.seriesId)) errors.push("seriesId must be a valid UUID");
    else data.seriesId = body.seriesId;
  }

  const VISIBILITY = ["public", "unlisted", "invite_only"];
  if (has("visibility")) {
    if (!VISIBILITY.includes(body.visibility)) {
      errors.push(`visibility must be one of: ${VISIBILITY.join(", ")}`);
    } else {
      data.visibility = body.visibility;
    }
  }

  const STATUS = ["draft", "published", "cancelled", "completed"];
  if (has("status")) {
    if (!STATUS.includes(body.status)) {
      errors.push(`status must be one of: ${STATUS.join(", ")}`);
    } else {
      data.status = body.status;
      // Mirrors CHECK events_cancelled_has_time.
      if (body.status === "cancelled") data.cancelledAt = new Date();
      if (body.status === "published") data.publishedAt = new Date();
      if (body.status === "completed") data.completedAt = new Date();
    }
  }

  if (has("maxGuestsPerRsvp")) {
    const max = Number(body.maxGuestsPerRsvp);
    if (!Number.isInteger(max) || max < 0 || max > 20) {
      errors.push("maxGuestsPerRsvp must be between 0 and 20");
    } else {
      data.maxGuestsPerRsvp = max;
    }
  }

  if (has("waitlistReliabilityFloor")) {
    const floor = Number(body.waitlistReliabilityFloor);
    if (Number.isNaN(floor) || floor < 0 || floor > 1) {
      errors.push("waitlistReliabilityFloor must be between 0 and 1");
    } else {
      data.waitlistReliabilityFloor = floor;
    }
  }

  // ---- plain passthrough fields -------------------------------------------
  for (const key of [
    "description",
    "timezone",
    "placeName",
    "addressLine1",
    "addressLine2",
    "city",
    "region",
    "postalCode",
    "cancellationReason"
  ]) {
    if (body[key] !== undefined) data[key] = body[key] === "" ? null : body[key];
  }

  if (has("countryCode")) {
    if (String(body.countryCode).length !== 2) {
      errors.push("countryCode must be a 2-letter ISO code");
    } else {
      data.countryCode = String(body.countryCode).toUpperCase();
    }
  }

  for (const key of ["lat", "lng"]) {
    if (has(key)) {
      const n = Number(body[key]);
      if (Number.isNaN(n)) errors.push(`${key} must be a number`);
      else data[key] = n;
    }
  }

  for (const key of ["allowWaitlist", "allowGuests", "hideExactAddressUntilRsvp"]) {
    if (body[key] !== undefined) data[key] = Boolean(body[key]);
  }

  return { errors, data };
}
