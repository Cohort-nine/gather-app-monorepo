import { beforeEach, describe, expect, it, vi } from "vitest";

// Same approach as rsvpController.test.js: the controller only reaches the
// database through prisma.js, so replacing that one module lets every rule below
// run with no Postgres involved.
const prismaMock = {
  event: { findUnique: vi.fn(), findMany: vi.fn() },
  rsvp: { findUnique: vi.fn() },
  attendance: { findUnique: vi.fn() },
  hostRating: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  hostReputation: { upsert: vi.fn() }
};

vi.mock("../server/db/prisma.js", () => ({ default: prismaMock }));

const { createOrUpdateRating, listEventRatings, validateRatingPayload } = await import(
  "../server/controllers/ratingController.js"
);

const HOST_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";

const hoursFromNow = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000);

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

/** An event that happened yesterday, which every happy path needs. */
const pastEvent = {
  id: EVENT_ID,
  hostId: HOST_ID,
  title: "Third Thursday Potluck",
  status: "completed",
  startsAt: hoursFromNow(-24)
};

const req = (overrides = {}) => ({
  params: { id: EVENT_ID },
  user: { id: USER_ID },
  body: { rating: 5 },
  ...overrides
});

/** Set up the four lookups the happy path performs. */
function allowRating({ event = pastEvent, rsvpStatus = "going", attendance = null } = {}) {
  prismaMock.event.findUnique.mockResolvedValue(event);
  prismaMock.rsvp.findUnique.mockResolvedValue(rsvpStatus ? { status: rsvpStatus } : null);
  prismaMock.attendance.findUnique.mockResolvedValue(attendance);
  prismaMock.event.findMany.mockResolvedValue([{ status: "completed" }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.hostReputation.upsert.mockResolvedValue({});
});

describe("validateRatingPayload", () => {
  it("accepts a whole number in range", () => {
    expect(validateRatingPayload({ rating: 4 })).toEqual({
      errors: [],
      data: { rating: 4, comment: null }
    });
  });

  it("rejects a rating outside 1–5, matching the host_ratings_range CHECK", () => {
    expect(validateRatingPayload({ rating: 9 }).errors).toContain("rating must be between 1 and 5");
    expect(validateRatingPayload({ rating: 0 }).errors).toContain("rating must be between 1 and 5");
  });

  it("rejects a fractional rating", () => {
    expect(validateRatingPayload({ rating: 4.5 }).errors).toContain("rating must be a whole number");
  });

  it("requires a rating", () => {
    expect(validateRatingPayload({}).errors).toContain("rating is required");
  });

  it("trims a comment and rejects one that's too long", () => {
    expect(validateRatingPayload({ rating: 5, comment: "  great host  " }).data.comment).toBe(
      "great host"
    );
    expect(validateRatingPayload({ rating: 5, comment: "x".repeat(1001) }).errors).toContain(
      "comment must be 1000 characters or fewer"
    );
  });
});

describe("createOrUpdateRating", () => {
  it("creates a rating and returns 201", async () => {
    allowRating();
    prismaMock.hostRating.findUnique.mockResolvedValue(null);
    prismaMock.hostRating.create.mockResolvedValue({ id: "rating-1", rating: 5 });
    prismaMock.hostRating.findMany.mockResolvedValue([{ rating: 5 }]);

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(prismaMock.hostRating.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: EVENT_ID, hostId: HOST_ID, raterId: USER_ID })
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("updates instead of duplicating when the same person rates twice", async () => {
    allowRating();
    prismaMock.hostRating.findUnique.mockResolvedValue({ id: "rating-1", rating: 3 });
    prismaMock.hostRating.update.mockResolvedValue({ id: "rating-1", rating: 5 });
    prismaMock.hostRating.findMany.mockResolvedValue([{ rating: 5 }]);

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(prismaMock.hostRating.update).toHaveBeenCalled();
    expect(prismaMock.hostRating.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("recomputes host_reputation from the whole ledger, not just the new row", async () => {
    allowRating();
    prismaMock.hostRating.findUnique.mockResolvedValue(null);
    prismaMock.hostRating.create.mockResolvedValue({ id: "rating-1", rating: 4 });
    // 5, 4, 3 -> average 4.00
    prismaMock.hostRating.findMany.mockResolvedValue([{ rating: 5 }, { rating: 4 }, { rating: 3 }]);
    prismaMock.event.findMany.mockResolvedValue([
      { status: "completed" },
      { status: "published" },
      { status: "cancelled" }
    ]);

    await createOrUpdateRating(req(), mockRes(), vi.fn());

    expect(prismaMock.hostReputation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: HOST_ID },
        update: expect.objectContaining({
          score: "4.00",
          ratingCount: 3,
          eventsHosted: 3,
          eventsCompleted: 1,
          eventsCancelled: 1
        })
      })
    );
  });

  it("refuses to let a host rate their own event", async () => {
    allowRating();

    const res = mockRes();
    await createOrUpdateRating(req({ user: { id: HOST_ID } }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prismaMock.hostRating.create).not.toHaveBeenCalled();
  });

  it("refuses to rate an event that hasn't happened yet", async () => {
    allowRating({ event: { ...pastEvent, status: "published", startsAt: hoursFromNow(48) } });

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prismaMock.hostRating.create).not.toHaveBeenCalled();
  });

  it("refuses to rate a cancelled event", async () => {
    allowRating({ event: { ...pastEvent, status: "cancelled" } });

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("blocks someone who never RSVP'd", async () => {
    allowRating({ rsvpStatus: null });

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.hostRating.create).not.toHaveBeenCalled();
  });

  it("blocks someone who cancelled their RSVP", async () => {
    allowRating({ rsvpStatus: "cancelled" });

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("blocks someone the host marked as a no-show", async () => {
    allowRating({ attendance: { outcome: "no_show" } });

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.hostRating.create).not.toHaveBeenCalled();
  });

  it("still allows an excused absence to rate", async () => {
    allowRating({ attendance: { outcome: "excused" } });
    prismaMock.hostRating.findUnique.mockResolvedValue(null);
    prismaMock.hostRating.create.mockResolvedValue({ id: "rating-1", rating: 5 });
    prismaMock.hostRating.findMany.mockResolvedValue([{ rating: 5 }]);

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("400s on a rating out of range before touching the database", async () => {
    const res = mockRes();
    await createOrUpdateRating(req({ body: { rating: 11 } }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.event.findUnique).not.toHaveBeenCalled();
  });

  it("404s when the event doesn't exist", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null);

    const res = mockRes();
    await createOrUpdateRating(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("400s on a malformed event id", async () => {
    const res = mockRes();
    await createOrUpdateRating(req({ params: { id: "not-a-uuid" } }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.event.findUnique).not.toHaveBeenCalled();
  });
});

describe("listEventRatings", () => {
  it("returns ratings with an average", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT_ID });
    prismaMock.hostRating.findMany.mockResolvedValue([
      { rating: 5, rater: { handle: "devon_park" } },
      { rating: 4, rater: { handle: "sam_reyes" } }
    ]);

    const res = mockRes();
    await listEventRatings({ params: { id: EVENT_ID } }, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ summary: { average: 4.5, count: 2 } })
      })
    );
  });

  it("reports a null average rather than 0 when there are no ratings", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT_ID });
    prismaMock.hostRating.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listEventRatings({ params: { id: EVENT_ID } }, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ summary: { average: null, count: 0 } })
      })
    );
  });
});
