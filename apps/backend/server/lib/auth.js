// ---------------------------------------------------------------------------
// Authentication helpers
//
// Passwords are hashed with bcrypt and never stored, logged, or returned.
// Sessions are stateless JWTs sent in the Authorization header:
//
//     Authorization: Bearer <token>
//
// Stateless means there's no session table to keep in sync, which is the right
// tradeoff at this size. The cost is that a token stays valid until it expires
// — so tokens are short-lived, and anything destructive re-checks the database
// rather than trusting what's baked into the token.
// ---------------------------------------------------------------------------

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../db/prisma.js";
import { isUuid } from "./validateEvent.js";

const TOKEN_TTL = "7d";
const BCRYPT_ROUNDS = 12;

/**
 * Refuse to boot without a secret. A default value here would mean every
 * deployment that forgot to set JWT_SECRET shares the same signing key, and
 * anyone could forge a token for any account.
 */
function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be set and at least 32 characters. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  return secret;
}

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, handle: user.handle },
    requireSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

function readToken(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

const SESSION_USER_SELECT = {
  id: true,
  handle: true,
  email: true,
  displayName: true,
  avatarUrl: true
};

/**
 * Verify a token's signature and expiry. Returns the payload, or an error name
 * ("TokenExpiredError", "JsonWebTokenError") when the token is bad. Kept apart
 * from the database lookup so a database outage surfaces as a 500 — not as
 * "invalid session", which would make the frontend sign everyone out.
 */
function verifyToken(token) {
  try {
    return { payload: jwt.verify(token, requireSecret()) };
  } catch (error) {
    return { error: error.name };
  }
}

// Re-read the user rather than trusting the token body: an account may have
// been deleted or deactivated since the token was issued.
const findSessionUser = (id) =>
  prisma.user.findFirst({ where: { id, deletedAt: null }, select: SESSION_USER_SELECT });

/**
 * Attach req.user when a valid token is present. Does NOT reject when it's
 * missing — use for endpoints that behave differently for signed-in users but
 * still work for anonymous ones.
 */
export async function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();

  // An invalid token on an optional route is simply treated as anonymous.
  const { payload } = verifyToken(token);
  if (!payload) return next();

  try {
    const user = await findSessionUser(payload.sub);
    if (user) req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** Reject anything without a valid token. */
export async function requireAuth(req, res, next) {
  const token = readToken(req);

  if (!token) {
    return res.status(401).json({ message: "You must be signed in to do that." });
  }

  const { payload, error } = verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      message:
        error === "TokenExpiredError"
          ? "Your session expired. Please sign in again."
          : "Invalid session token."
    });
  }

  try {
    const user = await findSessionUser(payload.sub);
    if (!user) {
      return res.status(401).json({ message: "That account no longer exists." });
    }
    req.user = user;
    next();
  } catch (dbError) {
    next(dbError);
  }
}

/**
 * Authorization, as opposed to authentication. Confirms the signed-in user is
 * the event's host or a cohost with the right permission.
 *
 * Being logged in is not the same as being allowed — this is the check that
 * stops one user editing another user's event.
 */
export async function requireEventPermission(req, res, next, permission = "canEdit") {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ message: "id must be a valid UUID" });
  }

  let event;
  try {
    event = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        hostId: true,
        cohosts: { select: { userId: true, canEdit: true, canManageRsvps: true } }
      }
    });
  } catch (error) {
    // Express 4 doesn't catch rejected promises from async middleware; without
    // this a database hiccup here would crash the whole process.
    return next(error);
  }

  if (!event) {
    return res.status(404).json({ message: "Event not found" });
  }

  if (event.hostId === req.user.id) {
    req.event = event;
    return next();
  }

  const cohost = event.cohosts.find((c) => c.userId === req.user.id);
  if (cohost && cohost[permission]) {
    req.event = event;
    return next();
  }

  return res.status(403).json({
    message: "You don't have permission to change this event."
  });
}

export const requireEventEdit = (req, res, next) =>
  requireEventPermission(req, res, next, "canEdit");

export const requireRsvpManagement = (req, res, next) =>
  requireEventPermission(req, res, next, "canManageRsvps");
