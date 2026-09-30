import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller only ever reaches the database through prisma.js, so
// replacing that one module lets every business rule below run with no
// Postgres involved. $transaction just invokes its callback with the same
// mock, since none of these tests care about real transactional isolation.
const prismaMock = {
  event: { findUnique: vi.fn() },
  userBlock: { findFirst: vi.fn() },
  rsvp: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn()
  },
  rsvpStatusEvent: { create: vi.fn() },
  notification: { create: vi.fn() },
  $transaction: vi.fn(async (cb) => cb(prismaMock))
};

vi.mock("../server/db/prisma.js", () => ({ default: prismaMock }));

const { cancelRsvp, createOrUpdateRsvp } = await import("../server/controllers/rsvpController.js");

const HOST_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const WAITLISTED_USER_ID = "44444444-4444-4444-4444-444444444444";

const futureDate = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000);

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));
  seats(0);
});

/** How many seats 'going' RSVPs (people + their guests) already occupy. */
function seats(people, guests = 0) {
  prismaMock.rsvp.aggregate.mockResolvedValue({
    _count: { _all: people },
    _sum: { guestCount: guests }
  });
}

describe("createOrUpdateRsvp", () => {
  const baseEvent = {
    id: EVENT_ID,
    hostId: HOST_ID,
    status: "published",
    startsAt: futureDate(48),
    rsvpClosesAt: null,
    allowGuests: true,
    maxGuestsPerRsvp: 3,
    allowWaitlist: true,
    capacity: 2,
  };

  const req = (overrides = {}) => ({
    params: { id: EVENT_ID },
    user: { id: USER_ID },
    body: {},
    ...overrides
  });

  it("confirms 'going' when the event has room", async () => {
    prismaMock.event.findUnique.mockResolvedValue(baseEvent);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.rsvp.findUnique.mockResolvedValue(null);
    prismaMock.rsvp.create.mockResolvedValue({ id: "rsvp-1", status: "going" });

    const res = mockRes();
    await createOrUpdateRsvp(req(), res, vi.fn());

    expect(prismaMock.rsvp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "going" }) })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("waitlists once capacity is reached instead of rejecting outright", async () => {
    prismaMock.event.findUnique.mockResolvedValue(baseEvent);
    seats(2);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.rsvp.findUnique.mockResolvedValue(null);
    prismaMock.rsvp.findFirst.mockResolvedValue(null); // nobody else on the waitlist yet
    prismaMock.rsvp.create.mockResolvedValue({ id: "rsvp-2", status: "waitlisted" });

    const res = mockRes();
    await createOrUpdateRsvp(req(), res, vi.fn());

    expect(prismaMock.rsvp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "waitlisted", waitlistPosition: 1 })
      })
    );
  });

  it("rejects when full and the host disabled the waitlist", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      ...baseEvent,
      allowWaitlist: false
    });
    seats(2);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.rsvp.findUnique.mockResolvedValue(null);

    const res = mockRes();
    await createOrUpdateRsvp(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prismaMock.rsvp.create).not.toHaveBeenCalled();
  });

  it("counts guests toward capacity, not just RSVP rows", async () => {
    // One person is going with a guest: both seats of a two-seat event are taken.
    prismaMock.event.findUnique.mockResolvedValue(baseEvent);
    seats(1, 1);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.rsvp.findUnique.mockResolvedValue(null);
    prismaMock.rsvp.findFirst.mockResolvedValue(null);
    prismaMock.rsvp.create.mockResolvedValue({ id: "rsvp-3", status: "waitlisted" });

    const res = mockRes();
    await createOrUpdateRsvp(req(), res, vi.fn());

    expect(prismaMock.rsvp.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "waitlisted" }) })
    );
  });

  it("blocks a host from RSVPing to their own event", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ ...baseEvent, hostId: USER_ID });

    const res = mockRes();
    await createOrUpdateRsvp(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("honors a block between host and attendee in either direction", async () => {
    prismaMock.event.findUnique.mockResolvedValue(baseEvent);
    prismaMock.userBlock.findFirst.mockResolvedValue({ blockerId: HOST_ID, blockedId: USER_ID });

    const res = mockRes();
    await createOrUpdateRsvp(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects a guest count above the event's per-RSVP maximum", async () => {
    prismaMock.event.findUnique.mockResolvedValue(baseEvent);
    prismaMock.userBlock.findFirst.mockResolvedValue(null);

    const res = mockRes();
    await createOrUpdateRsvp(req({ body: { guestCount: 5 } }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.rsvp.create).not.toHaveBeenCalled();
  });
});

describe("cancelRsvp", () => {
  const req = () => ({ params: { id: EVENT_ID }, user: { id: USER_ID }, body: {} });

  it("promotes the first eligible waitlisted person into the seat that opened up", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: EVENT_ID,
      capacity: 1,
      startsAt: futureDate(72),
      waitlistReliabilityFloor: 0
    });
    prismaMock.rsvp.findUnique.mockResolvedValue({
      id: "rsvp-going",
      status: "going",
      waitlistPosition: null
    });
    prismaMock.rsvp.update.mockResolvedValue({ id: "rsvp-going", status: "cancelled" });
    seats(0); // the cancellation just freed the only seat
    prismaMock.rsvp.findMany.mockResolvedValue([
      {
        id: "rsvp-waiting",
        userId: WAITLISTED_USER_ID,
        waitlistPosition: 1,
        user: { reliability: { score: 1 } }
      }
    ]);

    const res = mockRes();
    await cancelRsvp(req(), res, vi.fn());

    expect(prismaMock.rsvp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rsvp-waiting" },
        data: expect.objectContaining({ status: "going" })
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promotedFromWaitlist: { rsvpId: "rsvp-waiting", userId: WAITLISTED_USER_ID }
        })
      })
    );
  });

  it("skips a waitlisted person below the host's reliability floor and leaves the seat open", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: EVENT_ID,
      capacity: 1,
      startsAt: futureDate(72),
      waitlistReliabilityFloor: 0.8
    });
    prismaMock.rsvp.findUnique.mockResolvedValue({
      id: "rsvp-going",
      status: "going",
      waitlistPosition: null
    });
    prismaMock.rsvp.update.mockResolvedValue({ id: "rsvp-going", status: "cancelled" });
    seats(0);
    prismaMock.rsvp.findMany.mockResolvedValue([
      {
        id: "rsvp-waiting",
        userId: WAITLISTED_USER_ID,
        waitlistPosition: 1,
        user: { reliability: { score: 0.4 } }
      }
    ]);

    const res = mockRes();
    await cancelRsvp(req(), res, vi.fn());

    // Only the cancellation itself touched rsvp.update — nobody got promoted.
    expect(prismaMock.rsvp.update).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ promotedFromWaitlist: null }) })
    );
  });

  it("skips a waitlisted person whose guests wouldn't fit and promotes the next one who does", async () => {
    prismaMock.event.findUnique.mockResolvedValue({
      id: EVENT_ID,
      capacity: 1,
      startsAt: futureDate(72),
      waitlistReliabilityFloor: 0
    });
    prismaMock.rsvp.findUnique.mockResolvedValue({
      id: "rsvp-going",
      status: "going",
      waitlistPosition: null
    });
    prismaMock.rsvp.update.mockResolvedValue({ id: "rsvp-going", status: "cancelled" });
    seats(0);
    prismaMock.rsvp.findMany.mockResolvedValue([
      {
        id: "rsvp-with-guests",
        userId: "55555555-5555-5555-5555-555555555555",
        waitlistPosition: 1,
        guestCount: 2,
        user: { reliability: { score: 1 } }
      },
      {
        id: "rsvp-solo",
        userId: WAITLISTED_USER_ID,
        waitlistPosition: 2,
        guestCount: 0,
        user: { reliability: { score: 1 } }
      }
    ]);

    const res = mockRes();
    await cancelRsvp(req(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promotedFromWaitlist: { rsvpId: "rsvp-solo", userId: WAITLISTED_USER_ID }
        })
      })
    );
  });
});
