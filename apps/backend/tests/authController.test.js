import { beforeEach, describe, expect, it, vi } from "vitest";

// Same pattern as connectionsController.test.js / reportController.test.js:
// mock db/prisma.js so nothing here touches real Postgres. lib/auth.js is
// mocked too -- hashPassword/verifyPassword's actual bcrypt behavior is
// already covered by auth.test.js, and running real bcrypt (12 rounds) here
// would just make every test slow for no extra coverage.
const prismaMock = {
  user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() }
};

const verifyPasswordMock = vi.fn();
const hashPasswordMock = vi.fn();

vi.mock("../server/db/prisma.js", () => ({ default: prismaMock }));
vi.mock("../server/lib/auth.js", () => ({
  verifyPassword: (...args) => verifyPasswordMock(...args),
  hashPassword: (...args) => hashPasswordMock(...args),
  signToken: vi.fn()
}));

const { changeEmail, changePassword } = await import("../server/controllers/authController.js");

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const existingUser = {
  id: USER_ID,
  handle: "maya",
  email: "maya@example.com",
  passwordHash: "stored-hash",
  displayName: "Maya",
  avatarUrl: null,
  bio: null,
  homeCity: null,
  joinedAt: new Date()
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue(existingUser);
});

describe("changePassword", () => {
  it("rejects when the current password is wrong, without touching the row", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "wrong-password", newPassword: "brand-new-password" }
    };
    const res = mockRes();
    await changePassword(req, res, vi.fn());

    expect(verifyPasswordMock).toHaveBeenCalledWith("wrong-password", "stored-hash");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Current password is incorrect." })
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("hashes and saves the new password once the current one checks out", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    hashPasswordMock.mockResolvedValue("new-hash");
    prismaMock.user.update.mockResolvedValue({ ...existingUser, passwordHash: "new-hash" });

    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "correct-password", newPassword: "brand-new-password" }
    };
    const res = mockRes();
    await changePassword(req, res, vi.fn());

    expect(hashPasswordMock).toHaveBeenCalledWith("brand-new-password");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { passwordHash: "new-hash" }
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Password updated successfully" })
    );
  });

  it("400s on a weak new password before ever checking the current one", async () => {
    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "correct-password", newPassword: "short" }
    };
    const res = mockRes();
    await changePassword(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("requires currentPassword", async () => {
    const req = { user: { id: USER_ID }, body: { newPassword: "brand-new-password" } };
    const res = mockRes();
    await changePassword(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.arrayContaining(["currentPassword is required"]) })
    );
  });
});

describe("changeEmail", () => {
  it("rejects when the current password is wrong, without touching the row", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "wrong-password", newEmail: "new@example.com" }
    };
    const res = mockRes();
    await changeEmail(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Current password is incorrect." })
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("updates the email once the password checks out and the address is free", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    prismaMock.user.findFirst.mockResolvedValue(null); // no other account has it
    prismaMock.user.update.mockResolvedValue({ ...existingUser, email: "new@example.com" });

    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "correct-password", newEmail: "new@example.com" }
    };
    const res = mockRes();
    await changeEmail(req, res, vi.fn());

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { email: "new@example.com", id: { not: USER_ID } },
      select: { id: true }
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { email: "new@example.com" }
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Email updated successfully",
        data: expect.objectContaining({ email: "new@example.com" })
      })
    );
  });

  it("409s cleanly when another account already has that email, instead of hitting the DB constraint", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    prismaMock.user.findFirst.mockResolvedValue({ id: OTHER_USER_ID });

    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "correct-password", newEmail: "taken@example.com" }
    };
    const res = mockRes();
    await changeEmail(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "That email is already registered to another account." })
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("still returns the clean 409 message if a P2002 slips through a race condition", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    prismaMock.user.findFirst.mockResolvedValue(null);
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prismaMock.user.update.mockRejectedValue(p2002);

    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "correct-password", newEmail: "new@example.com" }
    };
    const res = mockRes();
    const next = vi.fn();
    await changeEmail(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "That email is already registered to another account." })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("400s on a malformed email before ever checking the password", async () => {
    const req = {
      user: { id: USER_ID },
      body: { currentPassword: "correct-password", newEmail: "not-an-email" }
    };
    const res = mockRes();
    await changeEmail(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });
});
