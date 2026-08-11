// ---------------------------------------------------------------------------
// Host ratings
//
// POST /api/events/:id/ratings   rate the host of an event you attended
// GET  /api/events/:id/ratings   public list of ratings for one event
//
// host_ratings is a LEDGER; host_reputation.score is a DERIVED CACHE built from
// it. Nothing here ever writes a reputation number directly — it writes the
// rating, then rebuilds the cache from every rating that host has. Delete
// host_reputation entirely and this code reconstructs it.
//
// The rules below exist because a rating carries weight in event listings. If
// anyone could rate anything, the number would mean nothing:
//   - you must have RSVP'd, so strangers can't brigade a host
//   - the event must have happened, so nobody rates a party they haven't been to
//   - a marked no-show can't rate, since they weren't there to have an opinion
//   - hosts can't rate themselves
// ---------------------------------------------------------------------------

import prisma from "../db/prisma.js";
import { isUuid } from "../lib/validateEvent.js";

/** Ratings that can't be interpreted are worse than no rating at all. */
const MIN_RATING = 1;
const MAX_RATING = 5;
const MAX_COMMENT_LENGTH = 1000;

/**
 * Validate a rating payload.
 *
 * Mirrors the host_ratings_range CHECK constraint. The database would reject a
 * bad value anyway, but a 400 with a readable message beats a 500 from a
 * constraint violation.
 */
export function validateRatingPayload(body) {
  const errors = [];
  const data = {};

  if (body.rating === undefined || body.rating === null || body.rating === "") {
    errors.push("rating is required");
  } else {
    const rating = Number(body.rating);

    if (!Number.isInteger(rating)) {
      errors.push("rating must be a whole number");
    } else if (rating < MIN_RATING || rating > MAX_RATING) {
      errors.push(`rating must be between ${MIN_RATING} and ${MAX_RATING}`);
    } else {
      data.rating = rating;
    }
  }

  if (body.comment !== undefined && body.comment !== null && body.comment !== "") {
    const comment = String(body.comment).trim();

    if (comment.length > MAX_COMMENT_LENGTH) {
      errors.push(`comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
    } else {
      data.comment = comment;
    }
  } else {
    // An explicit null clears a previous comment on re-rating.
    data.comment = null;
  }

  return { errors, data };
}

/**
 * Rebuild host_reputation for one host from the ledger.
 *
 * Same shape as recomputeReliabilityFor in rsvpController.js, and the same rule:
 * the cache is always rebuildable, never edited in place. `score` is the average
 * of every rating this host has received, which is why it is recomputed from
 * scratch rather than nudged by the new row.
 */
export async function recomputeHostReputationFor(hostId) {
  const hosted = await prisma.event.findMany({
    where: { hostId },
    select: { status: true }
  });

  const ratings = await prisma.hostRating.findMany({
    where: { hostId },
    select: { rating: true }
  });

  const ratingCount = ratings.length;
  const average =
    ratingCount === 0 ? 0 : ratings.reduce((sum, r) => sum + r.rating, 0) / ratingCount;

  const payload = {
    // host_reputation_score_range CHECK keeps this within 0.00–5.00.
    score: average.toFixed(2),
    eventsHosted: hosted.length,
    eventsCompleted: hosted.filter((e) => e.status === "completed").length,
    eventsCancelled: hosted.filter((e) => e.status === "cancelled").length,
    ratingCount,
    computedAt: new Date()
  };

  await prisma.hostReputation.upsert({
    where: { userId: hostId },
    update: payload,
    create: { userId: hostId, ...payload }
  });

  return payload;
}

/**
 * POST /api/events/:id/ratings
 *
 * One rating per person per event — enforced by the host_ratings_event_id_rater_id_key
 * unique index. Re-submitting updates the existing row rather than erroring,
 * because changing your mind about an event is legitimate and a duplicate-key
 * 409 would just make the frontend do a read-then-write dance.
 */
export async function createOrUpdateRating(req, res, next) {
  const { id } = req.params;
  const raterId = req.user.id;

  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  const { errors, data } = validateRatingPayload(req.body);
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id },
      select: { id: true, hostId: true, title: true, status: true, startsAt: true }
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // ---- gate checks, most specific first ---------------------------------
    if (event.hostId === raterId) {
      return res.status(409).json({ message: "You can't rate an event you hosted." });
    }

    if (new Date(event.startsAt) > new Date()) {
      return res.status(409).json({
        message: "You can't rate an event that hasn't happened yet."
      });
    }

    if (event.status === "cancelled") {
      return res.status(409).json({
        message: "This event was cancelled, so there's nothing to rate."
      });
    }

    if (event.status === "draft") {
      return res.status(409).json({ message: "This event isn't published yet." });
    }

    // You have to have signed up. A cancelled RSVP still counts as "no" —
    // someone who backed out didn't experience the event.
    const rsvp = await prisma.rsvp.findUnique({
      where: { eventId_userId: { eventId: id, userId: raterId } },
      select: { status: true }
    });

    if (!rsvp || !["going", "waitlisted"].includes(rsvp.status)) {
      return res.status(403).json({
        message: "Only people who RSVP'd to this event can rate the host."
      });
    }

    // If the host already marked attendance and recorded this person as a
    // no-show, they weren't there. Absence of an attendance row is fine —
    // plenty of hosts never get around to marking it.
    const attendance = await prisma.attendance.findUnique({
      where: { eventId_userId: { eventId: id, userId: raterId } },
      select: { outcome: true }
    });

    if (attendance?.outcome === "no_show") {
      return res.status(403).json({
        message: "You were marked as a no-show for this event, so you can't rate it."
      });
    }

    const existing = await prisma.hostRating.findUnique({
      where: { eventId_raterId: { eventId: id, raterId } }
    });

    const rating = existing
      ? await prisma.hostRating.update({
          where: { id: existing.id },
          data: { rating: data.rating, comment: data.comment }
        })
      : await prisma.hostRating.create({
          data: {
            eventId: id,
            hostId: event.hostId,
            raterId,
            rating: data.rating,
            comment: data.comment
          }
        });

    // The ledger changed, so the host's cached reputation is now stale.
    const reputation = await recomputeHostReputationFor(event.hostId);

    res.status(existing ? 200 : 201).json({
      message: existing ? "Rating updated successfully" : "Rating submitted successfully",
      data: {
        rating,
        hostReputation: {
          score: Number(reputation.score),
          ratingCount: reputation.ratingCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/events/:id/ratings
 *
 * Public. Returns the ratings plus the average, so an event page can show
 * "4.7 from 11 people" without a second request.
 */
export async function listEventRatings(req, res, next) {
  const { id } = req.params;

  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const ratings = await prisma.hostRating.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "desc" },
      include: {
        rater: { select: { handle: true, displayName: true, avatarUrl: true } }
      }
    });

    const average =
      ratings.length === 0
        ? null
        : Number((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(2));

    res.json({
      message: ratings.length
        ? "Ratings retrieved successfully"
        : "No ratings for this event yet",
      data: {
        ratings,
        summary: { average, count: ratings.length }
      }
    });
  } catch (error) {
    next(error);
  }
}
