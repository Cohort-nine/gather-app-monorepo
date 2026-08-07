// ---------------------------------------------------------------------------
// Auth — signup, login, and "who am I"
//
// POST /api/auth/signup
// POST /api/auth/login
// GET  /api/auth/me
//
// Rule followed throughout: passwordHash never leaves this file. Every response
// runs through publicUser().
// ---------------------------------------------------------------------------

import prisma from "../db/prisma.js";
import { hashPassword, signToken, verifyPassword } from "../lib/auth.js";

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The only shape of a user that's ever sent to a client. */
const publicUser = (u) => ({
  id: u.id,
  handle: u.handle,
  email: u.email,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
  bio: u.bio,
  homeCity: u.homeCity,
  joinedAt: u.joinedAt
});

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

  if (!password) {
    errors.push("password is required");
  } else {
    // Length is the property that actually matters. Composition rules push
    // people toward "Password1!" — predictable, and no harder to crack.
    if (password.length < 10) errors.push("password must be at least 10 characters");
    if (password.length > 200) errors.push("password must be under 200 characters");
    if (/^\d+$/.test(password)) errors.push("password cannot be only numbers");
  }

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
