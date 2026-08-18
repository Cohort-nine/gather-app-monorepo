// ---------------------------------------------------------------------------
// Reports — trust & safety
//
// POST /api/reports        file a report against a user OR an event
// GET  /api/me/reports     reports I have filed
//
// A report has exactly ONE subject: a user or an event, never both and never
// neither. That's enforced in the database by the reports_one_subject CHECK
// (num_nonnulls(subject_user_id, subject_event_id) = 1) and again here, so the
// caller gets a readable 400 instead of a constraint violation surfacing as 500.
//
// Reports are intentionally write-mostly for regular users. You can file one and
// see your own, but you cannot read anyone else's or see resolution state — a
// reporting system that lets the reported party enumerate reports about them is
// worse than no reporting system. Moderation happens outside this API for now.
// ---------------------------------------------------------------------------

import prisma from "../db/prisma.js";
import { isUuid } from "../lib/validateEvent.js";

/**
 * A closed vocabulary rather than free text. Open-ended `type` fields turn into
 * a hundred spellings of "spam" and become impossible to triage or count.
 */
export const REPORT_TYPES = [
  "harassment",
  "spam",
  "unsafe_venue",
  "no_show_abuse",
  "impersonation",
  "inappropriate_content",
  "other"
];

const MAX_DETAILS_LENGTH = 2000;

export function validateReportPayload(body) {
  const errors = [];
  const data = {};

  const hasUser = body.subjectUserId !== undefined && body.subjectUserId !== null && body.subjectUserId !== "";
  const hasEvent = body.subjectEventId !== undefined && body.subjectEventId !== null && body.subjectEventId !== "";

  // Mirrors the reports_one_subject CHECK constraint.
  if (hasUser && hasEvent) {
    errors.push("Provide either subjectUserId or subjectEventId, not both");
  } else if (!hasUser && !hasEvent) {
    errors.push("Either subjectUserId or subjectEventId is required");
  } else if (hasUser) {
    if (!isUuid(body.subjectUserId)) {
      errors.push("subjectUserId must be a valid UUID");
    } else {
      data.subjectUserId = body.subjectUserId;
    }
  } else if (!isUuid(body.subjectEventId)) {
    errors.push("subjectEventId must be a valid UUID");
  } else {
    data.subjectEventId = body.subjectEventId;
  }

  if (body.type === undefined || body.type === null || body.type === "") {
    errors.push("type is required");
  } else if (!REPORT_TYPES.includes(body.type)) {
    errors.push(`type must be one of: ${REPORT_TYPES.join(", ")}`);
  } else {
    data.type = body.type;
  }

  if (body.details !== undefined && body.details !== null && body.details !== "") {
    const details = String(body.details).trim();

    if (details.length > MAX_DETAILS_LENGTH) {
      errors.push(`details must be ${MAX_DETAILS_LENGTH} characters or fewer`);
    } else {
      data.details = details;
    }
  } else {
    data.details = null;
  }

  return { errors, data };
}

/** POST /api/reports */
export async function createReport(req, res, next) {
  const reporterId = req.user.id;

  const { errors, data } = validateReportPayload(req.body);
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  try {
    // ---- the subject has to exist ----------------------------------------
    if (data.subjectUserId) {
      if (data.subjectUserId === reporterId) {
        return res.status(400).json({ message: "You can't report yourself." });
      }

      const subject = await prisma.user.findFirst({
        where: { id: data.subjectUserId, deletedAt: null },
        select: { id: true }
      });

      if (!subject) {
        return res.status(404).json({ message: "That user doesn't exist." });
      }
    } else {
      const subject = await prisma.event.findUnique({
        where: { id: data.subjectEventId },
        select: { id: true, hostId: true }
      });

      if (!subject) {
        return res.status(404).json({ message: "Event not found" });
      }

      if (subject.hostId === reporterId) {
        return res.status(400).json({
          message: "You can't report your own event. Cancel or edit it instead."
        });
      }
    }

    // ---- don't let one person file the same report repeatedly -------------
    // Not a unique index, because filing again after a moderator has resolved
    // the first one is legitimate — the same thing happening twice is new
    // information. Only an UNRESOLVED duplicate is rejected.
    const openDuplicate = await prisma.report.findFirst({
      where: {
        reporterId,
        resolvedAt: null,
        ...(data.subjectUserId
          ? { subjectUserId: data.subjectUserId }
          : { subjectEventId: data.subjectEventId })
      },
      select: { id: true, createdAt: true }
    });

    if (openDuplicate) {
      return res.status(409).json({
        message: "You've already reported this and it's still under review.",
        data: { report: openDuplicate }
      });
    }

    const report = await prisma.report.create({
      data: {
        reporterId,
        subjectUserId: data.subjectUserId ?? null,
        subjectEventId: data.subjectEventId ?? null,
        type: data.type,
        details: data.details
      }
    });

    // 201 with the report echoed back, but deliberately no information about
    // the subject — the response should not become a way to probe accounts.
    res.status(201).json({
      message: "Report submitted. Thanks for flagging it — someone will review this.",
      data: { report }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/me/reports
 *
 * Always the current user's own reports, never an id in the URL, so there's no
 * way to read someone else's by guessing a UUID.
 */
export async function listMyReports(req, res, next) {
  try {
    const reports = await prisma.report.findMany({
      where: { reporterId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        subjectUser: { select: { handle: true, displayName: true } },
        subjectEvent: { select: { slug: true, title: true } }
      }
    });

    res.json({
      message: reports.length
        ? "Reports retrieved successfully"
        : "You haven't filed any reports",
      data: reports.map((r) => ({
        id: r.id,
        type: r.type,
        details: r.details,
        subject: r.subjectUser
          ? { kind: "user", handle: r.subjectUser.handle, displayName: r.subjectUser.displayName }
          : { kind: "event", slug: r.subjectEvent?.slug, title: r.subjectEvent?.title },
        // Whether it's been dealt with, but not the moderator's notes.
        status: r.resolvedAt ? "resolved" : "under_review",
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
}
