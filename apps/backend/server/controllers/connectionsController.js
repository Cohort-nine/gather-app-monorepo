// ---------------------------------------------------------------------------
// Connections — the social graph.
//
// GET    /api/users/search                     find people by handle or exact email
// POST   /api/connections                       send a request
// GET    /api/connections                       my connections (+ direction)
// PATCH  /api/connections/:otherUserId/accept
// PATCH  /api/connections/:otherUserId/decline
// DELETE /api/connections/:otherUserId
// GET    /api/events/:id/mutual-attendees
// GET    /api/me/friends-events
//
// connections is a symmetric edge stored ONCE, canonically ordered so
// userLow < userHigh (CHECK connections_canonical_order in the database).
// This file derives that order itself on every read and write — it is never
// trusted from the caller, since either user id could be "low" depending on
// who's asking.
//
// UserBlock is the actual block mechanism this codebase uses elsewhere (see
// rsvpController.js's RSVP gate) — it is checked here too and always wins
// over a connection. Connection.status also has a 'blocked' value in the
// schema, but nothing in this file writes it; UserBlock stays the single
// source of truth for blocking, so the two can't disagree.
// ---------------------------------------------------------------------------

import prisma from "../db/prisma.js";
import { isUuid } from "../lib/validateEvent.js";

const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 20;
const MUTUAL_PREVIEW_LIMIT = 6;

const smallUser = { id: true, handle: true, displayName: true, avatarUrl: true };

/** Deterministic pair regardless of who calls it. Mirrors CHECK (user_low < user_high). */
function canonicalPair(a, b) {
  const [x, y] = [String(a).toLowerCase(), String(b).toLowerCase()];
  return x < y ? { userLow: x, userHigh: y } : { userLow: y, userHigh: x };
}

async function blockExistsBetween(userA, userB) {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA }
      ]
    }
  });
  return Boolean(block);
}

/** Shape one connections row for the current viewer. */
function shapeConnection(row, viewerId) {
  const peer = row.userLow === viewerId ? row.high : row.low;
  return {
    peer,
    status: row.status,
    // Only meaningful while status is 'pending' — it's what tells the
    // frontend whether to show "accept/decline" (incoming) or "requested"
    // (outgoing).
    direction: row.requestedBy === viewerId ? "outgoing" : "incoming",
    requestedAt: row.requestedAt,
    acceptedAt: row.acceptedAt
  };
}

/** GET /api/users/search?q=&limit= */
export async function searchUsers(req, res, next) {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(
    SEARCH_LIMIT_MAX,
    Math.max(1, Number(req.query.limit) || SEARCH_LIMIT_DEFAULT)
  );

  if (!q) {
    return res.status(400).json({ message: "q is required" });
  }

  try {
    // Blocks run either direction: someone who blocked me shouldn't be
    // findable by me, and someone I blocked shouldn't be either.
    const blocks = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: req.user.id }, { blockedId: req.user.id }] },
      select: { blockerId: true, blockedId: true }
    });
    const blockedIds = new Set(
      blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== req.user.id)
    );

    // Handle search stays partial/substring — handles are the public,
    // searchable identity here, same as any @username. Email is different:
    // it's private by default, so it only matches EXACT (not contains), or
    // "search" becomes "list everyone whose email contains @gmail.com" —
    // a real enumeration leak handle search doesn't have. Only attempted
    // when q looks like an email at all, so a plain name search doesn't
    // pay for a pointless second clause.
    const looksLikeEmail = q.includes("@");
    const nameOrEmailMatch = looksLikeEmail
      ? { OR: [{ handle: { contains: q } }, { email: { equals: q } }] }
      : { handle: { contains: q } };

    const users = await prisma.user.findMany({
      where: {
        AND: [
          nameOrEmailMatch,
          { id: { notIn: [req.user.id, ...blockedIds] } },
          { deletedAt: null },
          // Absence of a privacy row (shouldn't happen post-signup, but not
          // guaranteed for older/seeded rows) defaults to discoverable. Same
          // flag gates the email-exact match too — someone who opted out of
          // being found stays opted out, even if you already know their email.
          { OR: [{ privacySettings: null }, { privacySettings: { discoverableByHandle: true } }] }
        ]
      },
      select: smallUser,
      take: limit,
      orderBy: { handle: "asc" }
    });

    res.json({
      message: users.length ? "Users found" : "No users matched your search",
      data: users
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/connections — body: { userId }. */
export async function sendConnectionRequest(req, res, next) {
  const targetId = req.body.userId;

  if (!isUuid(targetId)) {
    return res.status(400).json({
      message: "Validation failed",
      errors: ["userId must be a valid UUID"]
    });
  }
  if (targetId.toLowerCase() === req.user.id.toLowerCase()) {
    return res.status(400).json({ message: "You can't send a connection request to yourself." });
  }

  try {
    const target = await prisma.user.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    if (await blockExistsBetween(req.user.id, targetId)) {
      return res.status(403).json({ message: "You can't connect with this user." });
    }

    const { userLow, userHigh } = canonicalPair(req.user.id, targetId);

    const existing = await prisma.connection.findUnique({
      where: { userLow_userHigh: { userLow, userHigh } }
    });

    if (existing) {
      const message =
        existing.status === "accepted"
          ? "You're already connected."
          : existing.status === "pending"
            ? "A connection request already exists between you and this user."
            : "You can't connect with this user.";
      return res.status(409).json({ message });
    }

    const connection = await prisma.connection.create({
      data: { userLow, userHigh, requestedBy: req.user.id, status: "pending" },
      include: { low: { select: smallUser }, high: { select: smallUser } }
    });

    res.status(201).json({
      message: "Connection request sent",
      data: shapeConnection(connection, req.user.id)
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/connections?status=pending|accepted|blocked */
export async function listConnections(req, res, next) {
  const { status } = req.query;
  const VALID_STATUS = ["pending", "accepted", "blocked"];

  if (status && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ message: `status must be one of: ${VALID_STATUS.join(", ")}` });
  }

  try {
    const rows = await prisma.connection.findMany({
      where: {
        OR: [{ userLow: req.user.id }, { userHigh: req.user.id }],
        ...(status ? { status } : {})
      },
      include: { low: { select: smallUser }, high: { select: smallUser } },
      orderBy: { requestedAt: "desc" }
    });

    res.json({
      message: rows.length ? "Connections retrieved successfully" : "No connections yet",
      data: rows.map((r) => shapeConnection(r, req.user.id))
    });
  } catch (error) {
    next(error);
  }
}

/** Shared lookup for accept/decline/remove — finds the row regardless of who's low/high. */
async function findConnectionWith(userId, otherUserId) {
  const { userLow, userHigh } = canonicalPair(userId, otherUserId);
  return prisma.connection.findUnique({ where: { userLow_userHigh: { userLow, userHigh } } });
}

/** PATCH /api/connections/:otherUserId/accept — only valid on an INCOMING pending request. */
export async function acceptConnection(req, res, next) {
  const { otherUserId } = req.params;
  if (!isUuid(otherUserId)) {
    return res.status(400).json({ message: "otherUserId must be a valid UUID" });
  }

  try {
    const connection = await findConnectionWith(req.user.id, otherUserId);
    if (!connection) {
      return res.status(404).json({ message: "No connection request with this user." });
    }
    if (connection.status !== "pending") {
      return res.status(409).json({ message: `This connection is already ${connection.status}.` });
    }
    if (connection.requestedBy === req.user.id) {
      return res.status(400).json({
        message: "You sent this request — the other person needs to accept it."
      });
    }

    const updated = await prisma.connection.update({
      where: { userLow_userHigh: { userLow: connection.userLow, userHigh: connection.userHigh } },
      data: { status: "accepted", acceptedAt: new Date() },
      include: { low: { select: smallUser }, high: { select: smallUser } }
    });

    res.json({ message: "Connection accepted", data: shapeConnection(updated, req.user.id) });
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/connections/:otherUserId/decline — valid only on a pending request. */
export async function declineConnection(req, res, next) {
  const { otherUserId } = req.params;
  if (!isUuid(otherUserId)) {
    return res.status(400).json({ message: "otherUserId must be a valid UUID" });
  }

  try {
    const connection = await findConnectionWith(req.user.id, otherUserId);
    if (!connection) {
      return res.status(404).json({ message: "No connection request with this user." });
    }
    if (connection.status !== "pending") {
      return res.status(409).json({
        message: "Only a pending request can be declined — use DELETE to remove an existing connection."
      });
    }

    // There's no ConnectionStatus for "declined" — declining (an incoming
    // request) or cancelling (your own outgoing one) both just remove the
    // row, so either side is free to send a fresh request later.
    await prisma.connection.delete({
      where: { userLow_userHigh: { userLow: connection.userLow, userHigh: connection.userHigh } }
    });

    res.json({ message: "Connection request declined" });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/connections/:otherUserId — unfriend an accepted connection, or cancel a pending one. */
export async function removeConnection(req, res, next) {
  const { otherUserId } = req.params;
  if (!isUuid(otherUserId)) {
    return res.status(400).json({ message: "otherUserId must be a valid UUID" });
  }

  try {
    const connection = await findConnectionWith(req.user.id, otherUserId);
    if (!connection) {
      return res.status(404).json({ message: "No connection with this user." });
    }

    await prisma.connection.delete({
      where: { userLow_userHigh: { userLow: connection.userLow, userHigh: connection.userHigh } }
    });

    res.json({
      message: connection.status === "accepted" ? "Connection removed" : "Connection request cancelled"
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/events/:id/mutual-attendees
 *
 * optionalAuth: an anonymous visitor gets an empty result, not an error — this
 * is a "nice extra" on the event page, not something worth a 401 over.
 */
export async function mutualAttendees(req, res, next) {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  if (!req.user) {
    return res.json({
      message: "Sign in to see which connections are going",
      data: { attendees: [], total: 0 }
    });
  }

  try {
    const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // connection_edges is the raw-SQL VIEW over accepted connections only —
    // one row per direction, so "peer_id" is always the other person.
    const edges = await prisma.$queryRaw`
      SELECT peer_id AS "peerId" FROM connection_edges WHERE user_id = ${req.user.id}::uuid
    `;
    const connectionIds = edges.map((e) => e.peerId);

    if (!connectionIds.length) {
      return res.json({
        message: "Mutual attendees retrieved successfully",
        data: { attendees: [], total: 0 }
      });
    }

    const rsvps = await prisma.rsvp.findMany({
      where: { eventId: id, status: "going", userId: { in: connectionIds } },
      select: {
        user: {
          select: {
            ...smallUser,
            privacySettings: { select: { attendeeVisibility: true, surfaceAsMutual: true } }
          }
        }
      }
    });

    // 'connections_and_mutuals' is exactly this case — the viewer IS a
    // connection — so it counts as visible here, same as 'everyone'.
    // surfaceAsMutual is the more specific opt-out ("don't list me as a
    // mutual") and wins regardless of the visibility band.
    const visible = rsvps
      .map((r) => r.user)
      .filter((u) => {
        const p = u.privacySettings;
        if (!p) return true;
        if (p.surfaceAsMutual === false) return false;
        return p.attendeeVisibility === "everyone" || p.attendeeVisibility === "connections_and_mutuals";
      })
      .map(({ privacySettings, ...u }) => u);

    res.json({
      message: "Mutual attendees retrieved successfully",
      data: {
        attendees: visible.slice(0, MUTUAL_PREVIEW_LIMIT),
        total: visible.length
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/me/friends-events
 *
 * Upcoming, published, public events where at least one accepted connection
 * has RSVP'd 'going'. Mirrors listEvents' public-browse visibility rule
 * (status='published', visibility='public') rather than reimplementing a
 * separate set of visibility rules for a friends feed.
 */
export async function listMyFriendsEvents(req, res, next) {
  try {
    const edges = await prisma.$queryRaw`
      SELECT peer_id AS "peerId" FROM connection_edges WHERE user_id = ${req.user.id}::uuid
    `;
    const connectionIds = edges.map((e) => e.peerId);

    if (!connectionIds.length) {
      return res.json({ message: "None of your connections have upcoming plans yet", data: [] });
    }

    const events = await prisma.event.findMany({
      where: {
        status: "published",
        visibility: "public",
        startsAt: { gte: new Date() },
        rsvps: { some: { userId: { in: connectionIds }, status: "going" } }
      },
      orderBy: { startsAt: "asc" },
      include: {
        host: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
            hostReputation: { select: { score: true, ratingCount: true } }
          }
        },
        category: { select: { slug: true, name: true } },
        // Only the RSVPs that make this event show up at all — i.e. exactly
        // the connections going, for a "Maya and 2 others are going" line.
        rsvps: {
          where: { userId: { in: connectionIds }, status: "going" },
          select: { user: { select: smallUser } }
        },
        _count: { select: { rsvps: { where: { status: "going" } } } }
      }
    });

    // Seats (people + their guests) per event, so spotsLeft means the same
    // thing here as on the browse grid.
    const seatRows = events.length
      ? await prisma.rsvp.groupBy({
          by: ["eventId"],
          where: { eventId: { in: events.map((e) => e.id) }, status: "going" },
          _count: { _all: true },
          _sum: { guestCount: true }
        })
      : [];
    const seatsByEvent = new Map(
      seatRows.map((row) => [row.eventId, row._count._all + (row._sum.guestCount ?? 0)])
    );

    const data = events.map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      description: e.description,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      timezone: e.timezone,
      isOnline: e.isOnline,
      placeName: e.placeName,
      city: e.city,
      region: e.region,
      capacity: e.capacity,
      visibility: e.visibility,
      status: e.status,
      imageUrl: e.imageUrl,
      goingCount: e._count.rsvps,
      spotsLeft:
        e.capacity === null ? null : Math.max(0, e.capacity - (seatsByEvent.get(e.id) ?? 0)),
      isFull: e.capacity !== null && (seatsByEvent.get(e.id) ?? 0) >= e.capacity,
      host: {
        id: e.host.id,
        handle: e.host.handle,
        displayName: e.host.displayName,
        avatarUrl: e.host.avatarUrl,
        rating: e.host.hostReputation?.score ?? 0,
        ratingCount: e.host.hostReputation?.ratingCount ?? 0
      },
      category: e.category ? { slug: e.category.slug, name: e.category.name } : null,
      friendsGoing: e.rsvps.map((r) => r.user)
    }));

    res.json({
      message: data.length
        ? "Friends' events retrieved successfully"
        : "None of your connections have upcoming plans yet",
      data
    });
  } catch (error) {
    next(error);
  }
}
