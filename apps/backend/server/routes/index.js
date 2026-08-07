import { Router } from "express";
import authRoutes from "./auth.js";
import eventRoutes from "./events.js";
import { listMyRsvps } from "../controllers/rsvpController.js";
import { getHealth } from "../controllers/eventController.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/health", getHealth);

router.use("/auth", authRoutes);
router.use("/", eventRoutes);

// "What am I signed up for" — always the current user, never an id in the URL,
// so there's no way to read someone else's schedule by guessing a UUID.
router.get("/me/rsvps", requireAuth, listMyRsvps);

export default router;
