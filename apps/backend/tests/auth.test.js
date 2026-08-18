import { beforeEach, describe, expect, it, vi } from "vitest";

describe("password hashing", () => {
  // bcryptjs is a pure-JS implementation (no native binding), so 12 rounds —
  // the production cost factor — genuinely takes longer than Vitest's 5s
  // default here. That's a property of the test environment, not a bug.
  it(
    "round-trips a password through bcrypt without storing it in the clear",
    async () => {
      const { hashPassword, verifyPassword } = await import("../server/lib/auth.js");

      const hash = await hashPassword("correct horse battery staple");
      expect(hash).not.toBe("correct horse battery staple");
      await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
      await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
    },
    15000
  );
});

describe("signToken", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = originalSecret;
    vi.resetModules();
  });

  it("refuses to sign without a JWT_SECRET, so no deployment can ship a forgeable default", async () => {
    delete process.env.JWT_SECRET;
    const { signToken } = await import("../server/lib/auth.js");

    expect(() => signToken({ id: "u1", handle: "maya" })).toThrow(/JWT_SECRET/);
  });

  it("refuses a secret shorter than 32 characters", async () => {
    process.env.JWT_SECRET = "too-short";
    const { signToken } = await import("../server/lib/auth.js");

    expect(() => signToken({ id: "u1", handle: "maya" })).toThrow(/JWT_SECRET/);
  });

  it("signs a token that verifies back to the same user", async () => {
    process.env.JWT_SECRET = "x".repeat(32);
    const jwt = (await import("jsonwebtoken")).default;
    const { signToken } = await import("../server/lib/auth.js");

    const token = signToken({ id: "u1", handle: "maya" });
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    expect(payload.sub).toBe("u1");
    expect(payload.handle).toBe("maya");
  });
});
