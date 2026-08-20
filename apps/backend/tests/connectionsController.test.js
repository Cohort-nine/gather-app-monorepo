import { beforeEach, describe, expect, it, vi } from "vitest";

// Same pattern as rsvpController.test.js: replace db/prisma.js with a mock so
// every rule below runs with no real Postgres involved.
const prismaMock = {
  user: { findFirst: vi.fn(), findMany: vi.fn() },
  userBlock: { findFirst: vi.fn(), findMany: vi.fn() },
  connection: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  event: { findUnique: vi.fn() },
  rsvp: { findMany: vi.fn() },
  $queryRaw: vi.fn()
};

vi.mock("../server/db/prisma.js", () => ({ default: prismaMock }));

const {
  acceptConnection,
  declineConnection,
  listConnections,
  mutualAttendees,
  removeConnection,
  searchUsers,
  sendConnectionRequest
} = await import("../server/controllers/connectionsController.js");

// A is lexicographically lower than B, so canonical ordering always puts
// A in userLow regardless of which one calls the endpoint.
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "99999999-9999-9999-9999-999999999999";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendConnectionRequest", () => {
  it("canonically orders userLow/userHigh regardless of who calls", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: USER_A });
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.connection.findUnique.mockResolvedValue(null);
    prismaMock.connection.create.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_B,
      status: "pending",
      requestedAt: new Date(),
      acceptedAt: null,
      low: { id: USER_A },
      high: { id: USER_B }
    });

    // USER_B (the "high" id) is the one sending the request, to a "low" id.
    const req = { user: { id: USER_B }, body: { userId: USER_A } };
    const res = mockRes();
    await sendConnectionRequest(req, res, vi.fn());

    expect(prismaMock.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userLow: USER_A,
          userHigh: USER_B,
          requestedBy: USER_B,
          status: "pending"
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects a request targeting yourself", async () => {
    const req = { user: { id: USER_A }, body: { userId: USER_A } };
    const res = mockRes();
    await sendConnectionRequest(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.connection.create).not.toHaveBeenCalled();
  });

  it("404s when the target user doesn't exist", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const req = { user: { id: USER_A }, body: { userId: USER_B } };
    const res = mockRes();
    await sendConnectionRequest(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prismaMock.connection.create).not.toHaveBeenCalled();
  });

  it("rejects when a block exists, in either direction", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: USER_B });
    prismaMock.userBlock.findFirst.mockResolvedValue({ blockerId: USER_B, blockedId: USER_A });

    const req = { user: { id: USER_A }, body: { userId: USER_B } };
    const res = mockRes();
    await sendConnectionRequest(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.connection.create).not.toHaveBeenCalled();
  });

  it("rejects when a connection (any status) already exists between the two", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: USER_B });
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    prismaMock.connection.findUnique.mockResolvedValue({ status: "pending" });

    const req = { user: { id: USER_A }, body: { userId: USER_B } };
    const res = mockRes();
    await sendConnectionRequest(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prismaMock.connection.create).not.toHaveBeenCalled();
  });
});

describe("acceptConnection", () => {
  it("accepts an incoming pending request", async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_B, // B sent it, A is accepting
      status: "pending"
    });
    prismaMock.connection.update.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_B,
      status: "accepted",
      requestedAt: new Date(),
      acceptedAt: new Date(),
      low: { id: USER_A },
      high: { id: USER_B }
    });

    const req = { user: { id: USER_A }, params: { otherUserId: USER_B } };
    const res = mockRes();
    await acceptConnection(req, res, vi.fn());

    expect(prismaMock.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Connection accepted" }));
  });

  it("rejects accepting your own outgoing request", async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_A, // A sent it -- A can't also accept it
      status: "pending"
    });

    const req = { user: { id: USER_A }, params: { otherUserId: USER_B } };
    const res = mockRes();
    await acceptConnection(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.connection.update).not.toHaveBeenCalled();
  });

  it("404s when there's no connection with that user", async () => {
    prismaMock.connection.findUnique.mockResolvedValue(null);
    const req = { user: { id: USER_A }, params: { otherUserId: USER_B } };
    const res = mockRes();
    await acceptConnection(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects accepting a connection that's already accepted", async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_B,
      status: "accepted"
    });

    const req = { user: { id: USER_A }, params: { otherUserId: USER_B } };
    const res = mockRes();
    await acceptConnection(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("declineConnection / removeConnection", () => {
  it("decline deletes a pending request", async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_B,
      status: "pending"
    });

    const req = { user: { id: USER_A }, params: { otherUserId: USER_B } };
    const res = mockRes();
    await declineConnection(req, res, vi.fn());

    expect(prismaMock.connection.delete).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Connection request declined" }));
  });

  it("decline refuses to touch an already-accepted connection", async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_B,
      status: "accepted"
    });

    const req = { user: { id: USER_A }, params: { otherUserId: USER_B } };
    const res = mockRes();
    await declineConnection(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(prismaMock.connection.delete).not.toHaveBeenCalled();
  });

  it("remove unfriends an accepted connection", async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      userLow: USER_A,
      userHigh: USER_B,
      requestedBy: USER_B,
      status: "accepted"
    });

    const req = { user: { id: USER_A }, params: { otherUserId: USER_B } };
    const res = mockRes();
    await removeConnection(req, res, vi.fn());

    expect(prismaMock.connection.delete).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Connection removed" }));
  });
});

describe("searchUsers", () => {
  it("excludes yourself and anyone in a blocking relationship, either direction", async () => {
    prismaMock.userBlock.findMany.mockResolvedValue([{ blockerId: USER_B, blockedId: USER_A }]);
    prismaMock.user.findMany.mockResolvedValue([]);

    const req = { user: { id: USER_A }, query: { q: "may" } };
    const res = mockRes();
    await searchUsers(req, res, vi.fn());

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: [USER_A, USER_B] } })
      })
    );
  });

  it("requires a non-empty query", async () => {
    const req = { user: { id: USER_A }, query: {} };
    const res = mockRes();
    await searchUsers(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
});

describe("mutualAttendees", () => {
  it("returns an empty result for an anonymous visitor instead of an error", async () => {
    const req = { params: { id: EVENT_ID }, user: undefined };
    const res = mockRes();
    await mutualAttendees(req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { attendees: [], total: 0 } }));
    expect(prismaMock.event.findUnique).not.toHaveBeenCalled();
  });

  it("returns only the 'going' attendees who are accepted connections of the viewer", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT_ID });
    // connection_edges only returns USER_B as an accepted connection.
    prismaMock.$queryRaw.mockResolvedValue([{ peerId: USER_B }]);
    prismaMock.rsvp.findMany.mockResolvedValue([
      {
        user: {
          id: USER_B,
          handle: "b",
          displayName: "B",
          avatarUrl: null,
          privacySettings: { attendeeVisibility: "everyone", surfaceAsMutual: true }
        }
      }
    ]);

    const req = { params: { id: EVENT_ID }, user: { id: USER_A } };
    const res = mockRes();
    await mutualAttendees(req, res, vi.fn());

    // The rsvp query is scoped to the viewer's connections, not every attendee.
    expect(prismaMock.rsvp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: [USER_B] } })
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          attendees: [{ id: USER_B, handle: "b", displayName: "B", avatarUrl: null }],
          total: 1
        }
      })
    );
  });

  it("excludes an attendee who opted out of being surfaced as a mutual connection", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT_ID });
    prismaMock.$queryRaw.mockResolvedValue([{ peerId: USER_B }]);
    prismaMock.rsvp.findMany.mockResolvedValue([
      {
        user: {
          id: USER_B,
          handle: "b",
          displayName: "B",
          avatarUrl: null,
          privacySettings: { attendeeVisibility: "everyone", surfaceAsMutual: false }
        }
      }
    ]);

    const req = { params: { id: EVENT_ID }, user: { id: USER_A } };
    const res = mockRes();
    await mutualAttendees(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { attendees: [], total: 0 } }));
  });

  it("returns empty without querying RSVPs when the viewer has no accepted connections", async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT_ID });
    prismaMock.$queryRaw.mockResolvedValue([]);

    const req = { params: { id: EVENT_ID }, user: { id: USER_A } };
    const res = mockRes();
    await mutualAttendees(req, res, vi.fn());

    expect(prismaMock.rsvp.findMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { attendees: [], total: 0 } }));
  });
});

describe("listConnections", () => {
  it("tells apart accepted, outgoing-pending, and incoming-pending for the viewer", async () => {
    prismaMock.connection.findMany.mockResolvedValue([
      {
        userLow: USER_A,
        userHigh: USER_B,
        requestedBy: USER_A,
        status: "pending",
        requestedAt: new Date(),
        acceptedAt: null,
        low: { id: USER_A },
        high: { id: USER_B }
      }
    ]);

    const req = { user: { id: USER_A }, query: {} };
    const res = mockRes();
    await listConnections(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ status: "pending", direction: "outgoing" })]
      })
    );
  });

  it("rejects an unknown status filter", async () => {
    const req = { user: { id: USER_A }, query: { status: "friends" } };
    const res = mockRes();
    await listConnections(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.connection.findMany).not.toHaveBeenCalled();
  });
});
