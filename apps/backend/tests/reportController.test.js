import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { findFirst: vi.fn() },
  event: { findUnique: vi.fn() },
  report: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() }
};

vi.mock("../server/db/prisma.js", () => ({ default: prismaMock }));

const { createReport, listMyReports, validateReportPayload, REPORT_TYPES } = await import(
  "../server/controllers/reportController.js"
);

const REPORTER_ID = "33333333-3333-3333-3333-333333333333";
const SUBJECT_USER_ID = "44444444-4444-4444-4444-444444444444";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const HOST_ID = "22222222-2222-2222-2222-222222222222";

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body = {}) => ({
  user: { id: REPORTER_ID },
  body: { subjectUserId: SUBJECT_USER_ID, type: "harassment", ...body }
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.report.findFirst.mockResolvedValue(null);
});

describe("validateReportPayload", () => {
  it("accepts a user subject", () => {
    const { errors, data } = validateReportPayload({
      subjectUserId: SUBJECT_USER_ID,
      type: "spam"
    });

    expect(errors).toEqual([]);
    expect(data).toEqual({ subjectUserId: SUBJECT_USER_ID, type: "spam", details: null });
  });

  // This is the reports_one_subject CHECK: num_nonnulls(...) = 1.
  it("rejects two subjects", () => {
    expect(
      validateReportPayload({
        subjectUserId: SUBJECT_USER_ID,
        subjectEventId: EVENT_ID,
        type: "spam"
      }).errors
    ).toContain("Provide either subjectUserId or subjectEventId, not both");
  });

  it("rejects no subject", () => {
    expect(validateReportPayload({ type: "spam" }).errors).toContain(
      "Either subjectUserId or subjectEventId is required"
    );
  });

  it("rejects a type outside the closed vocabulary", () => {
    const { errors } = validateReportPayload({ subjectUserId: SUBJECT_USER_ID, type: "vibes" });
    expect(errors[0]).toContain("type must be one of");
  });

  it("accepts every documented type", () => {
    for (const type of REPORT_TYPES) {
      expect(validateReportPayload({ subjectUserId: SUBJECT_USER_ID, type }).errors).toEqual([]);
    }
  });

  it("rejects a malformed subject id", () => {
    expect(
      validateReportPayload({ subjectUserId: "nope", type: "spam" }).errors
    ).toContain("subjectUserId must be a valid UUID");
  });

  it("caps details length", () => {
    expect(
      validateReportPayload({
        subjectUserId: SUBJECT_USER_ID,
        type: "spam",
        details: "x".repeat(2001)
      }).errors
    ).toContain("details must be 2000 characters or fewer");
  });
});

describe("createReport", () => {
  it("files a report against a user and returns 201", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: SUBJECT_USER_ID });
    prismaMock.report.create.mockResolvedValue({ id: "report-1" });

    const res = mockRes();
    await createReport(req(), res, vi.fn());

    expect(prismaMock.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reporterId: REPORTER_ID,
          subjectUserId: SUBJECT_USER_ID,
          subjectEventId: null
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("files a report against an event", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT_ID, hostId: HOST_ID });
    prismaMock.report.create.mockResolvedValue({ id: "report-2" });

    const res = mockRes();
    await createReport(
      req({ subjectUserId: undefined, subjectEventId: EVENT_ID, type: "spam" }),
      res,
      vi.fn()
    );

    expect(prismaMock.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subjectEventId: EVENT_ID, subjectUserId: null })
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("refuses a self-report", async () => {
    const res = mockRes();
    await createReport(req({ subjectUserId: REPORTER_ID }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it("refuses to let a host report their own event", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT_ID, hostId: REPORTER_ID });

    const res = mockRes();
    await createReport(
      req({ subjectUserId: undefined, subjectEventId: EVENT_ID, type: "spam" }),
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it("404s when the reported user doesn't exist", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const res = mockRes();
    await createReport(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("409s on a duplicate that is still under review", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: SUBJECT_USER_ID });
    prismaMock.report.findFirst.mockResolvedValue({ id: "report-1", createdAt: new Date() });

    const res = mockRes();
    await createReport(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prismaMock.report.create).not.toHaveBeenCalled();
  });

  it("allows re-reporting once the earlier report was resolved", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: SUBJECT_USER_ID });
    // The duplicate lookup filters on resolvedAt: null, so a resolved report
    // simply isn't found and the new one goes through.
    prismaMock.report.findFirst.mockResolvedValue(null);
    prismaMock.report.create.mockResolvedValue({ id: "report-3" });

    const res = mockRes();
    await createReport(req(), res, vi.fn());

    expect(prismaMock.report.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ resolvedAt: null }) })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("400s on validation failure before touching the database", async () => {
    const res = mockRes();
    await createReport(req({ type: "vibes" }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });
});

describe("listMyReports", () => {
  it("returns only the caller's reports and hides moderator notes", async () => {
    prismaMock.report.findMany.mockResolvedValue([
      {
        id: "report-1",
        type: "harassment",
        details: "Kept messaging after I asked him to stop.",
        resolvedAt: null,
        resolutionNote: "internal moderator note",
        createdAt: new Date(),
        subjectUser: { handle: "jonah_webb", displayName: "Jonah Webb" },
        subjectEvent: null
      }
    ]);

    const res = mockRes();
    await listMyReports({ user: { id: REPORTER_ID } }, res, vi.fn());

    expect(prismaMock.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reporterId: REPORTER_ID } })
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.data[0].status).toBe("under_review");
    expect(payload.data[0].subject).toEqual({
      kind: "user",
      handle: "jonah_webb",
      displayName: "Jonah Webb"
    });
    expect(JSON.stringify(payload)).not.toContain("internal moderator note");
  });
});
