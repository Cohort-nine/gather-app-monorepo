// ---------------------------------------------------------------------------
// Events — the main resource.
//
// GET    /api/events        list + search/filter/sort   (raw SQL with JOINs)
// GET    /api/events/:id    one event with everything attached
// POST   /api/events        create
// PUT    /api/events/:id    update
// DELETE /api/events/:id    delete
//
// Every response is JSON in the shape { message, data } so the frontend can
// treat success and failure the same way.
// ---------------------------------------------------------------------------

import { Prisma } from "@prisma/client";
import prisma from "../db/prisma.js";
import { isUuid, slugify, validateEventPayload } from "../lib/validateEvent.js";

// ORDER BY cannot be parameterized, so sort keys come from a fixed whitelist.
// Passing user input straight into the SQL string here would be an injection
// hole — this map is the reason it isn't one.
const SORT_OPTIONS = {
  soonest: Prisma.sql`e.starts_at ASC`,
  latest: Prisma.sql`e.starts_at DESC`,
  newest: Prisma.sql`e.created_at DESC`,
  title: Prisma.sql`e.title ASC`,
  popular: Prisma.sql`going_count DESC, e.starts_at ASC`
};

/**
 * GET /api/events
 *
 * Supports:  ?search=  ?category=  ?city=  ?from=  ?to=  ?includePast=
 *            ?sort=soonest|latest|newest|title|popular  ?page=  ?limit=
 *
 * This is the endpoint that satisfies the JOIN requirement. One query pulls
 * the event, its host, the host's reputation, the category, and live RSVP
 * counts — four JOINs and an aggregate, instead of N+1 round trips.
 *
 * Filtering happens in PostgreSQL, not in JavaScript, so we never load rows
 * we're about to throw away.
 */
export async function listEvents(req, res, next) {
  try {
    const {
      search,
      category,
      city,
      from,
      to,
      includePast,
      sort = "soonest",
      page = "1",
      limit = "20"
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(limit) || 20));
    const offset = (pageNum - 1) * perPage;

    if (!SORT_OPTIONS[sort]) {
      return res.status(400).json({
        message: `sort must be one of: ${Object.keys(SORT_OPTIONS).join(", ")}`
      });
    }

    // Build the WHERE clause from fragments. Each ${value} becomes a bound
    // parameter — never string concatenation.
    const conditions = [
      Prisma.sql`e.status = 'published'`,
      Prisma.sql`e.visibility = 'public'`
    ];

    if (!includePast || includePast === "false") {
      conditions.push(Prisma.sql`e.starts_at >= now()`);
    }
    if (search) {
      conditions.push(
        Prisma.sql`(e.title ILIKE ${"%" + search + "%"} OR e.description ILIKE ${"%" + search + "%"})`
      );
    }
    if (category) {
      conditions.push(Prisma.sql`c.slug = ${category}`);
    }
    if (city) {
      conditions.push(Prisma.sql`e.city ILIKE ${city}`);
    }
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: "from must be a valid date" });
      }
      conditions.push(Prisma.sql`e.starts_at >= ${d}`);
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: "to must be a valid date" });
      }
      conditions.push(Prisma.sql`e.starts_at <= ${d}`);
    }

    const where = Prisma.join(conditions, " AND ");

    const rows = await prisma.$queryRaw`
      SELECT
        e.id,
        e.title,
        e.slug,
        e.description,
        e.starts_at            AS "startsAt",
        e.ends_at              AS "endsAt",
        e.timezone,
        e.is_online            AS "isOnline",
        e.place_name           AS "placeName",
        e.city,
        e.region,
        e.capacity,
        e.visibility,
        e.status,
        e.hide_exact_address_until_rsvp AS "hideExactAddress",
        u.id                   AS "hostId",
        u.handle               AS "hostHandle",
        u.display_name         AS "hostDisplayName",
        u.avatar_url           AS "hostAvatarUrl",
        c.slug                 AS "categorySlug",
        c.name                 AS "categoryName",
        COALESCE(hr.score, 0)::float8            AS "hostRating",
        COALESCE(hr.rating_count, 0)::int        AS "hostRatingCount",
        COUNT(r.id) FILTER (WHERE r.status = 'going')::int      AS going_count,
        COUNT(r.id) FILTER (WHERE r.status = 'waitlisted')::int AS waitlist_count
      FROM events e
      JOIN      users           u  ON u.id      = e.host_id
      LEFT JOIN categories      c  ON c.id      = e.category_id
      LEFT JOIN host_reputation hr ON hr.user_id = e.host_id
      LEFT JOIN rsvps           r  ON r.event_id = e.id
      WHERE ${where}
      GROUP BY e.id, u.id, c.slug, c.name, hr.score, hr.rating_count
      ORDER BY ${SORT_OPTIONS[sort]}
      LIMIT ${perPage} OFFSET ${offset}
    `;

    // Separate count so pagination reports the real total, not the page size.
    const [{ total }] = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT e.id)::int AS total
      FROM events e
      JOIN      users      u ON u.id = e.host_id
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN rsvps      r ON r.event_id = e.id
      WHERE ${where}
    `;

    // Reshape flat SQL columns into something the frontend can use directly.
    const data = rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      description: r.description,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      timezone: r.timezone,
      isOnline: r.isOnline,
      placeName: r.placeName,
      city: r.city,
      region: r.region,
      capacity: r.capacity,
      visibility: r.visibility,
      status: r.status,
      // The exact address is withheld until someone RSVPs. The browse endpoint
      // never returns street-level detail for house-hosted events.
      hideExactAddress: r.hideExactAddress,
      goingCount: r.going_count,
      waitlistCount: r.waitlist_count,
      spotsLeft: r.capacity === null ? null : Math.max(0, r.capacity - r.going_count),
      isFull: r.capacity !== null && r.going_count >= r.capacity,
      host: {
        id: r.hostId,
        handle: r.hostHandle,
        displayName: r.hostDisplayName,
        avatarUrl: r.hostAvatarUrl,
        rating: r.hostRating,
        ratingCount: r.hostRatingCount
      },
      category: r.categorySlug ? { slug: r.categorySlug, name: r.categoryName } : null
    }));

    res.json({
      message: data.length ? "Events retrieved successfully" : "No events matched your filters",
      data,
      meta: {
        page: pageNum,
        limit: perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        filters: { search: search ?? null, category: category ?? null, city: city ?? null, sort }
      }
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/events/:id */
export async function getEvent(req, res, next) {
  const { id } = req.params;

  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        host: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
            hostReputation: { select: { score: true, ratingCount: true, eventsHosted: true } }
          }
        },
        category: true,
        series: { select: { id: true, title: true, slug: true, cadence: true } },
        tags: { select: { tag: true } },
        cohosts: {
          include: {
            user: { select: { id: true, handle: true, displayName: true, avatarUrl: true } }
          }
        },
        rsvps: {
          where: { status: { in: ["going", "waitlisted"] } },
          orderBy: [{ status: "asc" }, { waitlistPosition: "asc" }],
          include: {
            user: {
              select: {
                id: true,
                handle: true,
                displayName: true,
                avatarUrl: true,
                privacySettings: { select: { attendeeVisibility: true } },
                reliability: { select: { band: true } }
              }
            }
          }
        },
        _count: { select: { rsvps: true, ratings: true } }
      }
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const going = event.rsvps.filter((r) => r.status === "going");

    // Respect each attendee's privacy setting. Someone set to 'nobody' is
    // counted but not named — the count stays honest without exposing them.
    const visibleAttendees = going
      .filter((r) => r.user.privacySettings?.attendeeVisibility !== "nobody")
      .map((r) => ({
        id: r.user.id,
        handle: r.user.handle,
        displayName: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
        reliabilityBand: r.user.reliability?.band ?? "unrated",
        guestCount: r.guestCount
      }));

    res.json({
      message: "Event retrieved successfully",
      data: {
        ...event,
        rsvps: undefined,
        tags: event.tags.map((t) => t.tag),
        goingCount: going.length,
        waitlistCount: event.rsvps.filter((r) => r.status === "waitlisted").length,
        spotsLeft: event.capacity === null ? null : Math.max(0, event.capacity - going.length),
        isFull: event.capacity !== null && going.length >= event.capacity,
        attendees: visibleAttendees,
        hiddenAttendeeCount: going.length - visibleAttendees.length,
        waitlist: event.rsvps
          .filter((r) => r.status === "waitlisted")
          .map((r) => ({
            position: r.waitlistPosition,
            handle: r.user.handle,
            displayName: r.user.displayName
          }))
      }
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/events */
export async function createEvent(req, res, next) {
  const { errors, data } = validateEventPayload(req.body);

  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  try {
    // Foreign keys are checked up front so the user gets a clear 400 rather
    // than a database-level foreign key error surfacing as a 500.
    const host = await prisma.user.findUnique({ where: { id: data.hostId } });
    if (!host) {
      return res.status(400).json({ message: "hostId does not match an existing user" });
    }

    if (data.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
      if (!category) {
        return res.status(400).json({ message: "categoryId does not match an existing category" });
      }
    }

    // slug is UNIQUE. Append a short suffix if the base is taken.
    let slug = slugify(data.title);
    if (await prisma.event.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    const tags = Array.isArray(req.body.tags) ? req.body.tags.filter(Boolean) : [];

    const event = await prisma.event.create({
      data: {
        ...data,
        slug,
        status: data.status ?? "draft",
        tags: tags.length ? { create: tags.map((tag) => ({ tag: String(tag) })) } : undefined
      },
      include: {
        host: { select: { id: true, handle: true, displayName: true } },
        category: true,
        tags: { select: { tag: true } }
      }
    });

    res.status(201).json({
      message: "Event created successfully",
      data: { ...event, tags: event.tags.map((t) => t.tag) }
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/events/:id */
export async function updateEvent(req, res, next) {
  const { id } = req.params;

  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ message: "Event not found" });
  }

  const { errors, data } = validateEventPayload(req.body, { partial: true });

  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  // A partial update can still break a cross-field rule — a new endsAt has to
  // be checked against the STORED startsAt, not just whatever was sent.
  const startsAt = data.startsAt ?? existing.startsAt;
  const endsAt = data.endsAt ?? existing.endsAt;
  if (endsAt && endsAt <= startsAt) {
    return res.status(400).json({
      message: "Validation failed",
      errors: ["endsAt must be after startsAt"]
    });
  }

  if (!Object.keys(data).length) {
    return res.status(400).json({ message: "No valid fields to update" });
  }

  try {
    const event = await prisma.event.update({
      where: { id },
      data,
      include: {
        host: { select: { id: true, handle: true, displayName: true } },
        category: true,
        tags: { select: { tag: true } }
      }
    });

    res.json({
      message: "Event updated successfully",
      data: { ...event, tags: event.tags.map((t) => t.tag) }
    });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/events/:id */
export async function deleteEvent(req, res, next) {
  const { id } = req.params;

  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id },
      include: { _count: { select: { rsvps: true } } }
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Deleting an event with people counting on it is usually a mistake —
    // cancelling preserves the record and notifies attendees. Require an
    // explicit ?force=true to go through with it anyway.
    if (event._count.rsvps > 0 && req.query.force !== "true") {
      return res.status(409).json({
        message:
          `This event has ${event._count.rsvps} RSVP(s). Cancel it instead, ` +
          `or repeat the request with ?force=true to delete permanently.`,
        data: { id: event.id, title: event.title, rsvpCount: event._count.rsvps }
      });
    }

    await prisma.event.delete({ where: { id } });

    res.json({
      message: "Event deleted successfully",
      data: { id: event.id, title: event.title }
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/categories — used to populate the filter dropdown. */
export async function listCategories(_req, res, next) {
  try {
    const categories = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
    res.json({ message: "Categories retrieved successfully", data: categories });
  } catch (error) {
    next(error);
  }
}

/** GET /api/health */
export async function getHealth(_req, res) {
  res.json({ status: "ok", service: "gather-api" });
}
