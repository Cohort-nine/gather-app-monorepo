// ---------------------------------------------------------------------------
// Auth — signup, login, "who am I", and account-settings changes
//
// POST  /api/auth/signup
// POST  /api/auth/login
// GET   /api/auth/me
// PATCH /api/auth/password  change the signed-in user's password
// PATCH /api/auth/email     change the signed-in user's login email
//
// Rule followed throughout: passwordHash never leaves this file. Every response
// runs through publicUser().
// ---------------------------------------------------------------------------

import prisma from "../db/prisma.js";
import { hashPassword, signToken, verifyPassword } from "../lib/auth.js";

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The only shape of a user that's ever sent to a client. */
export const publicUser = (u) => ({
  id: u.id,
  handle: u.handle,
  email: u.email,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
  bio: u.bio,
  homeCity: u.homeCity,
  joinedAt: u.joinedAt
});

// Shared by signup and changePassword so the two never drift apart. Length is
// the property that actually matters — composition rules push people toward
// "Password1!", which is predictable and no harder to crack.
function passwordStrengthErrors(password, field = "password") {
  const errors = [];
  if (!password) {
    errors.push(`${field} is required`);
  } else {
    if (password.length < 10) errors.push(`${field} must be at least 10 characters`);
    if (password.length > 200) errors.push(`${field} must be under 200 characters`);
    if (/^\d+$/.test(password)) errors.push(`${field} cannot be only numbers`);
  }
  return errors;
}

function validateSignup({ handle, email, password, displayName }) {
  const errors = [];

  if (!handle) errors.push("handle is required");
  // Mirrors CHECK users_handle_format in the database.
  else if (!HANDLE_RE.test(handle)) {
    errors.push("handle must be 3-30 characters, lowercase letters, numbers, or underscores");
  }

  if (!email) errors.push("email is required");
  else if (!EMAIL_RE.test(email)) errors.push("email must be a valid email address");

  if (!displayName) errors.push("displayName is required");
  else if (String(displayName).trim().length < 2) {
    errors.push("displayName must be at least 2 characters");
  }

  errors.push(...passwordStrengthErrors(password));

  return errors;
}

/** POST /api/auth/signup */
export async function signup(req, res, next) {
  const { handle, email, password, displayName, bio, homeCity } = req.body;

  const errors = validateSignup({ handle, email, password, displayName });
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  try {
    // handle and email are citext, so this comparison is case-insensitive —
    // "Maya" and "maya" are the same account, which is what users expect.
    const existing = await prisma.user.findFirst({
      where: { OR: [{ handle }, { email }] },
      select: { handle: true, email: true }
    });

    if (existing) {
      const field = existing.handle.toLowerCase() === handle.toLowerCase() ? "handle" : "email";
      return res.status(409).json({
        message: `That ${field} is already taken.`,
        errors: [`${field} is already registered`]
      });
    }

    const user = await prisma.user.create({
      data: {
        handle,
        email,
        passwordHash: await hashPassword(password),
        displayName: String(displayName).trim(),
        bio: bio ?? null,
        homeCity: homeCity ?? null,
        lastLoginAt: new Date(),
        // Every account gets a privacy row and a reliability row up front, so
        // the rest of the app never has to handle "settings might be missing".
        privacySettings: { create: {} },
        reliability: { create: { score: 1, band: "unrated" } }
      }
    });

    res.status(201).json({
      message: "Account created successfully",
      data: { user: publicUser(user), token: signToken(user) }
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/login */
export async function login(req, res, next) {
  const { identifier, handle, email, password } = req.body;
  // Accept a handle or an email under one field so the form can have a single
  // "handle or email" input.
  const lookup = identifier ?? handle ?? email;

  if (!lookup || !password) {
    return res.status(400).json({
      message: "Validation failed",
      errors: ["identifier (handle or email) and password are required"]
    });
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ handle: lookup }, { email: lookup }],
        deletedAt: null
      }
    });

    // Same message and same code whether the account is missing or the password
    // is wrong. Distinguishing them would let anyone enumerate which handles
    // and emails are registered.
    const invalid = () =>
      res.status(401).json({ message: "Incorrect handle/email or password." });

    if (!user || !user.passwordHash) return invalid();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return invalid();

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    res.json({
      message: "Signed in successfully",
      data: { user: publicUser(user), token: signToken(user) }
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/auth/me — used by the frontend on load to restore the session. */
export async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        privacySettings: true,
        reliability: { select: { score: true, band: true, attendedCount: true, noShowCount: true } },
        hostReputation: { select: { score: true, ratingCount: true, eventsHosted: true } },
        badges: { include: { badge: true } }
      }
    });

    res.json({
      message: "Session is valid",
      data: {
        ...publicUser(user),
        privacySettings: user.privacySettings,
        reliability: user.reliability,
        hostReputation: user.hostReputation,
        badges: user.badges.map((b) => b.badge)
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/logout
 *
 * With stateless JWTs there's nothing server-side to revoke — the client drops
 * the token. This endpoint exists so the frontend has something honest to call,
 * and so there's an obvious place to add a revocation list later.
 */
export async function logout(_req, res) {
  res.json({ message: "Signed out. Discard the token on the client." });
}

/**
 * PATCH /api/auth/password
 *
 * Requires the current password so nobody can change it just by grabbing a
 * signed-in browser tab or a leaked token — same "prove you know the old
 * secret" reasoning as any account-settings password change.
 */
export async function changePassword(req, res, next) {
  const { currentPassword, newPassword } = req.body;

  const errors = [];
  if (!currentPassword) errors.push("currentPassword is required");
  errors.push(...passwordStrengthErrors(newPassword, "newPassword"));

  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  try {
    // req.user (from requireAuth) is the trimmed select used for every
    // request — it doesn't carry passwordHash, so re-fetch the full row.
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Current password is incorrect." });

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) }
    });

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/auth/email
 *
 * Also requires the current password, for the same identity-confirmation
 * reason as changePassword — the login email is effectively a second factor
 * for account recovery, so changing it needs the same proof of ownership.
 */
export async function changeEmail(req, res, next) {
  const { currentPassword, newEmail } = req.body;

  const errors = [];
  if (!currentPassword) errors.push("currentPassword is required");
  if (!newEmail) errors.push("newEmail is required");
  else if (!EMAIL_RE.test(newEmail)) errors.push("newEmail must be a valid email address");

  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Current password is incorrect." });

    // email is citext, so this catches "Maya@x.com" vs "maya@x.com" too.
    // Checked up front (same pattern as signup) so the common case gets a
    // clean, field-specific message instead of a raw DB error.
    const existing = await prisma.user.findFirst({
      where: { email: newEmail, id: { not: user.id } },
      select: { id: true }
    });

    if (existing) {
      return res.status(409).json({
        message: "That email is already registered to another account.",
        errors: ["email is already registered"]
      });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail }
    });

    res.json({ message: "Email updated successfully", data: publicUser(updated) });
  } catch (error) {
    // Race-condition safety net: two requests could both pass the check above
    // before either commits. The database's own unique constraint is the real
    // guarantee — this just keeps its error from leaking through as a raw
    // Prisma error instead of the same clean message used above.
    if (error.code === "P2002") {
      return res.status(409).json({
        message: "That email is already registered to another account.",
        errors: ["email is already registered"]
      });
    }
    next(error);
  }
}
