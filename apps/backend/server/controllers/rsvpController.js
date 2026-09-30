// ---------------------------------------------------------------------------
// RSVPs — the core action of the app
//
// POST   /api/events/:id/rsvp        RSVP (auto-waitlists when full)
// DELETE /api/events/:id/rsvp        cancel your own RSVP
// GET    /api/events/:id/rsvps       host view of the full list
// POST   /api/events/:id/attendance  host marks who actually showed
// GET    /api/me/rsvps               everything I'm signed up for
//
// The invariant this file protects: rsvps holds current state, and
// rsvp_status_events records how it got there. Every state change writes BOTH,
// inside one transaction, so the ledger can never disagree with the row.
// ---------------------------------------------------------------------------

import prisma from "../db/prisma.js";
import { isUuid } from "../lib/validateEvent.js";

const HOUR = 60 * 60 * 1000;

/** Hours between now and the event start. Negative once it has begun. */
const hoursUntil = (startsAt) => (new Date(startsAt).getTime() - Date.now()) / HOUR;

const RSVP_STATUSES = ["going", "waitlisted", "cancelled", "declined"];

/**
 * Seats in use: every 'going' RSVP plus the guests it brings. Capacity is a
 * headcount, so a person bringing two guests takes three seats — counting
 * RSVP rows alone would let an event quietly overfill.
 */
export async function seatsTaken(eventId, db = prisma) {
  const agg = await db.rsvp.aggregate({
    where: { eventId, status: "going" },
    _count: { _all: true },
    _sum: { guestCount: true }
  });
  return agg._count._all + (agg._sum.guestCount ?? 0);
}

/**
 * Shift everyone behind `fromPosition` up one place, one row at a time in
 * ascending order. A single `UPDATE ... SET position = position - 1` can trip
 * the unique (event_id, waitlist_position) index mid-statement, because
 * Postgres checks non-deferrable uniqueness row by row in physical order.
 * Waitlists are short, so the per-row loop costs nothing noticeable.
 */
async function closeWaitlistGap(tx, eventId, fromPosition) {
  const behind = await tx.rsvp.findMany({
    where: { eventId, status: "waitlisted", waitlistPosition: { gt: fromPosition } },
    orderBy: { waitlistPosition: "asc" },
    select: { id: true, waitlistPosition: true }
  });
  for (const row of behind) {
    await tx.rsvp.update({
      where: { id: row.id },
      data: { waitlistPosition: row.waitlistPosition - 1 }
    });
  }
}

/** POST /api/events/:id/rsvp */
export async function createOrUpdateRsvp(req, res, next) {
  const { id } = req.params;
  const userId = req.user.id;
  const guestCount = Number(req.body.guestCount ?? 0);
  const note = req.body.noteToHost ?? null;

  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  try {
    const event = await prisma.event.findUnique({ where: { id } });

    if (!event) return res.status(404).json({ message: "Event not found" });

    // ---- gate checks, most specific first --------------------------------
    if (event.status === "cancelled") {
      return res.status(409).json({ message: "This event was cancelled." });
    }
    if (event.status === "draft") {
      return res.status(409).json({ message: "This event isn't published yet." });
    }
    if (new Date(event.startsAt) < new Date()) {
      return res.status(409).json({ message: "This event has already happened." });
    }
    if (event.rsvpClosesAt && new Date(event.rsvpClosesAt) < new Date()) {
      return res.status(409).json({ message: "RSVPs are closed for this event." });
    }
    if (event.hostId === userId) {
      return res.status(409).json({ message: "You're hosting this event — you're already going." });
    }

    // The host may have blocked this person, or vice versa. Either direction
    // means no RSVP; blocks are always honored.
    const block = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: event.hostId, blockedId: userId },
          { blockerId: userId, blockedId: event.hostId }
        ]
      }
    });
    if (block) {
      return res.status(403).json({ message: "You can't RSVP to this event." });
    }

    if (!Number.isInteger(guestCount) || guestCount < 0) {
      return res.status(400).json({ message: "guestCount must be zero or a positive whole number" });
    }
    if (guestCount > 0 && !event.allowGuests) {
      return res.status(400).json({ message: "This event doesn't allow guests." });
    }
    if (guestCount > event.maxGuestsPerRsvp) {
      return res.status(400).json({
        message: `You can bring at most ${event.maxGuestsPerRsvp} guest(s) to this event.`
      });
    }

    const existing = await prisma.rsvp.findUnique({
      where: { eventId_userId: { eventId: id, userId } }
    });

    // Re-RSVPing after cancelling is normal — reuse the row, keep the history.
    if (existing && ["going", "waitlisted"].includes(existing.status)) {
      return res.status(409).json({
        message: `You've already RSVP'd (${existing.status}).`,
        data: { rsvp: existing }
      });
    }

    // ---- decide: going, or waitlisted? -----------------------------------
    const taken = event.capacity === null ? 0 : await seatsTaken(id);
    const full = event.capacity !== null && taken + 1 + guestCount > event.capacity;

    if (full && !event.allowWaitlist) {
      return res.status(409).json({ message: "This event is full." });
    }

    const status = full ? "waitlisted" : "going";

    let waitlistPosition = null;
    if (status === "waitlisted") {
      const last = await prisma.rsvp.findFirst({
        where: { eventId: id, status: "waitlisted" },
        orderBy: { waitlistPosition: "desc" },
        select: { waitlistPosition: true }
      });
      waitlistPosition = (last?.waitlistPosition ?? 0) + 1;
    }

    const rsvp = await prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.rsvp.update({
            where: { id: existing.id },
            data: {
              status,
              guestCount,
              waitlistPosition,
              statusChangedAt: new Date(),
              cancelledAt: null,
              noteToHost: note
            }
          })
        : await tx.rsvp.create({
            data: {
              eventId: id,
              userId,
              status,
              guestCount,
              waitlistPosition,
              noteToHost: note
            }
          });

      // hoursBeforeEvent is snapshotted now, not derived at read time — if the
      // host later moves the event, this person's timing can't change retroactively.
      await tx.rsvpStatusEvent.create({
        data: {
          rsvpId: saved.id,
          eventId: id,
          actorId: userId,
          fromStatus: existing?.status ?? null,
          toStatus: status,
          hoursBeforeEvent: hoursUntil(event.startsAt),
          eventStartsAtSnapshot: event.startsAt
        }
      });

      return saved;
    });

    res.status(existing ? 200 : 201).json({
      message:
        status === "waitlisted"
          ? `This event is full — you're #${waitlistPosition} on the waitlist.`
          : "You're going!",
      data: { rsvp, waitlistPosition }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/events/:id/rsvp
 *
 * Cancelling is never blocked — making it hard to cancel is exactly what
 * produces no-shows, which are worse for the host than an early cancellation.
 * Instead we record WHEN, and the reliability score reflects the notice given.
 */
export async function cancelRsvp(req, res, next) {
  const { id } = req.params;
  const userId = req.user.id;

  if (!isUuid(id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  try {
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Event not found" });

    const rsvp = await prisma.rsvp.findUnique({
      where: { eventId_userId: { eventId: id, userId } }
    });

    if (!rsvp || rsvp.status === "cancelled") {
      return res.status(404).json({ message: "You don't have an active RSVP for this event." });
    }

    const hours = hoursUntil(event.startsAt);
    const wasGoing = rsvp.status === "going";

    const result = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.rsvp.update({
        where: { id: rsvp.id },
        data: {
          status: "cancelled",
          // CHECK rsvps_waitlist_position: position must be null unless waitlisted.
          waitlistPosition: null,
          cancelledAt: new Date(),
          statusChangedAt: new Date()
        }
      });

      await tx.rsvpStatusEvent.create({
        data: {
          rsvpId: rsvp.id,
          eventId: id,
          actorId: userId,
          fromStatus: rsvp.status,
          toStatus: "cancelled",
          hoursBeforeEvent: hours,
          eventStartsAtSnapshot: event.startsAt,
          reason: req.body?.reason ?? null
        }
      });

      // Close the gap left in the waitlist so positions stay 1..n.
      if (rsvp.status === "waitlisted" && rsvp.waitlistPosition !== null) {
        await closeWaitlistGap(tx, id, rsvp.waitlistPosition);
      }

      return cancelled;
    });

    // A seat just opened. Promote whoever is next and eligible.
    let promoted = null;
    if (wasGoing) {
      promoted = await promoteFromWaitlist(id);
    }

    res.json({
      message:
        hours >= 48
          ? "RSVP cancelled. Thanks for the notice — this won't affect your reliability."
          : "RSVP cancelled.",
      data: {
        rsvp: result,
        hoursBeforeEvent: Math.round(hours * 10) / 10,
        gaveNotice: hours >= 48,
        promotedFromWaitlist: promoted
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Move the first eligible waitlisted person into the open seat.
 *
 * `waitlistReliabilityFloor` lets a host say "only people with a decent track
 * record get auto-promoted into my four-seat dinner". Anyone below the floor is
 * skipped rather than removed — they keep their place for a manual invite.
 */
async function promoteFromWaitlist(eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { capacity: true, startsAt: true, waitlistReliabilityFloor: true }
  });

  const taken = event.capacity === null ? 0 : await seatsTaken(eventId);
  if (event.capacity !== null && taken >= event.capacity) return null;

  const floor = Number(event.waitlistReliabilityFloor ?? 0);

  const candidates = await prisma.rsvp.findMany({
    where: { eventId, status: "waitlisted" },
    orderBy: { waitlistPosition: "asc" },
    include: { user: { select: { reliability: { select: { score: true } } } } }
  });

  // First in line who clears the host's reliability floor AND fits in the
  // seats that are actually free, guests included.
  const fits = (c) => event.capacity === null || taken + 1 + (c.guestCount ?? 0) <= event.capacity;
  const next = candidates.find(
    (c) => Number(c.user.reliability?.score ?? 1) >= floor && fits(c)
  );
  if (!next) return null;

  await prisma.$transaction(async (tx) => {
    await tx.rsvp.update({
      where: { id: next.id },
      data: {
        status: "going",
        waitlistPosition: null,
        promotedAt: new Date(),
        statusChangedAt: new Date()
      }
    });

    await tx.rsvpStatusEvent.create({
      data: {
        rsvpId: next.id,
        eventId,
        // actorId is null: the system promoted them, not a person.
        actorId: null,
        fromStatus: "waitlisted",
        toStatus: "going",
        hoursBeforeEvent: hoursUntil(event.startsAt),
        eventStartsAtSnapshot: event.startsAt,
        reason: "Auto-promoted from waitlist when a spot opened."
      }
    });

    await closeWaitlistGap(tx, eventId, next.waitlistPosition);

    await tx.notification.create({
      data: {
        userId: next.userId,
        eventId,
        channel: "in_app",
        type: "waitlist_promoted",
        title: "A spot opened up — you're in!",
        body: "You were on the waitlist and a seat just became available."
      }
    });
  });

  return { rsvpId: next.id, userId: next.userId };
}

/** GET /api/events/:id/rsvps — host/cohost only. */
export async function listEventRsvps(req, res, next) {
  try {
    const rsvps = await prisma.rsvp.findMany({
      where: { eventId: req.params.id },
      orderBy: [{ status: "asc" }, { waitlistPosition: "asc" }, { createdAt: "asc" }],
      include: {
        user: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
            reliability: {
              select: { score: true, band: true, attendedCount: true, noShowCount: true }
            },
            privacySettings: { select: { showReliabilityToHosts: true } }
          }
        }
      }
    });

    const data = rsvps.map((r) => ({
      id: r.id,
      status: r.status,
      guestCount: r.guestCount,
      waitlistPosition: r.waitlistPosition,
      noteToHost: r.noteToHost,
      respondedAt: r.firstRespondedAt,
      user: {
        id: r.user.id,
        handle: r.user.handle,
        displayName: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
        // A user can hide the exact number from hosts but not the band. The
        // host still gets a signal; the attendee isn't reduced to a decimal.
        reliabilityScore: r.user.privacySettings?.showReliabilityToHosts
          ? r.user.reliability?.score ?? null
          : null,
        reliabilityBand: r.user.reliability?.band ?? "unrated"
      }
    }));

    res.json({
      message: "RSVPs retrieved successfully",
      data,
      meta: {
        going: data.filter((r) => r.status === "going").length,
        waitlisted: data.filter((r) => r.status === "waitlisted").length,
        cancelled: data.filter((r) => r.status === "cancelled").length,
        declined: data.filter((r) => r.status === "declined").length
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/events/:id/attendance — host/cohost only.
 *
 * Body: { records: [{ userId, outcome, notes? }] }
 * outcome: attended | no_show | excused
 *
 * This is what feeds reliability. It's deliberately host-controlled and
 * per-person rather than a single "everyone showed" button — a bulk default
 * would make the resulting scores meaningless.
 */
export async function markAttendance(req, res, next) {
  const { id } = req.params;
  const records = Array.isArray(req.body.records) ? req.body.records : [];

  if (!records.length) {
    return res.status(400).json({
      message: "Validation failed",
      errors: ["records must be a non-empty array of { userId, outcome }"]
    });
  }

  const VALID = ["attended", "no_show", "excused"];
  const errors = [];

  records.forEach((r, i) => {
    if (!isUuid(r.userId)) errors.push(`records[${i}].userId must be a valid UUID`);
    if (!VALID.includes(r.outcome)) {
      errors.push(`records[${i}].outcome must be one of: ${VALID.join(", ")}`);
    }
  });

  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  try {
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: "Event not found" });

    if (new Date(event.startsAt) > new Date()) {
      return res.status(409).json({
        message: "You can't mark attendance before the event has started."
      });
    }

    const rsvps = await prisma.rsvp.findMany({
      where: { eventId: id, userId: { in: records.map((r) => r.userId) } }
    });
    const byUser = new Map(rsvps.map((r) => [r.userId, r]));

    const saved = [];
    const skipped = [];

    for (const record of records) {
      const rsvp = byUser.get(record.userId);
      if (!rsvp) {
        skipped.push({ userId: record.userId, reason: "No RSVP for this event" });
        continue;
      }

      // Re-marking should correct the record, not create a duplicate.
      const row = await prisma.attendance.upsert({
        where: { eventId_userId: { eventId: id, userId: record.userId } },
        update: {
          outcome: record.outcome,
          notes: record.notes ?? null,
          markedById: req.user.id,
          markedAt: new Date()
        },
        create: {
          eventId: id,
          userId: record.userId,
          rsvpId: rsvp.id,
          outcome: record.outcome,
          method: "host_marked",
          guestsBrought: record.guestsBrought ?? 0,
          checkedInAt: record.outcome === "attended" ? new Date() : null,
          markedById: req.user.id,
          notes: record.notes ?? null
        }
      });

      saved.push(row);
    }

    // Attendance changed, so the derived caches are now stale for these people.
    await recomputeReliabilityFor(saved.map((s) => s.userId));

    res.json({
      message: `Attendance recorded for ${saved.length} attendee(s).`,
      data: { saved: saved.length, skipped }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Rebuild attendee_reliability for specific users.
 *
 * Identical logic to the seed's compute step — the cache is always rebuildable
 * from the ledgers, never edited in place.
 */
const NOTICE_WINDOW_HOURS = 48;

function reliabilityBand(score, graded) {
  if (graded === 0) return "unrated";
  if (score >= 0.9) return "excellent";
  if (score >= 0.75) return "good";
  if (score >= 0.5) return "mixed";
  return "unreliable";
}

export async function recomputeReliabilityFor(userIds) {
  for (const userId of [...new Set(userIds)]) {
    const attendance = await prisma.attendance.findMany({
      where: { userId },
      select: { outcome: true }
    });
    const cancellations = await prisma.rsvpStatusEvent.findMany({
      where: { actorId: userId, toStatus: "cancelled" },
      select: { hoursBeforeEvent: true }
    });
    const rsvpCount = await prisma.rsvp.count({ where: { userId } });

    const attendedCount = attendance.filter((a) => a.outcome === "attended").length;
    const noShowCount = attendance.filter((a) => a.outcome === "no_show").length;
    const excusedCount = attendance.filter((a) => a.outcome === "excused").length;

    let cancelledWithNoticeCount = 0;
    let cancelledLateCount = 0;
    for (const c of cancellations) {
      if (Number(c.hoursBeforeEvent ?? 0) >= NOTICE_WINDOW_HOURS) cancelledWithNoticeCount += 1;
      else cancelledLateCount += 1;
    }

    const graded = attendedCount + noShowCount + cancelledLateCount;
    const credit = attendedCount + 0.5 * cancelledLateCount;
    const score = graded === 0 ? 1 : credit / graded;
    const clamped = Math.max(0, Math.min(1, score));

    const payload = {
      score: clamped.toFixed(2),
      rsvpCount,
      attendedCount,
      noShowCount,
      excusedCount,
      cancelledWithNoticeCount,
      cancelledLateCount,
      band: reliabilityBand(clamped, graded),
      computedAt: new Date()
    };

    await prisma.attendeeReliability.upsert({
      where: { userId },
      update: payload,
      create: { userId, ...payload }
    });
  }
}

/** GET /api/me/rsvps */
export async function listMyRsvps(req, res, next) {
  const { status, upcoming } = req.query;

  if (status && !RSVP_STATUSES.includes(status)) {
    return res.status(400).json({ message: `status must be one of: ${RSVP_STATUSES.join(", ")}` });
  }

  try {
    const rsvps = await prisma.rsvp.findMany({
      where: {
        userId: req.user.id,
        ...(status ? { status } : {}),
        ...(upcoming === "true" ? { event: { startsAt: { gte: new Date() } } } : {})
      },
      orderBy: { event: { startsAt: "asc" } },
      include: {
        event: {
          include: {
            host: { select: { handle: true, displayName: true, avatarUrl: true } },
            category: { select: { slug: true, name: true } }
          }
        }
      }
    });

    res.json({
      message: rsvps.length ? "RSVPs retrieved successfully" : "You haven't RSVP'd to anything yet",
      data: rsvps
    });
  } catch (error) {
    next(error);
  }
}
