import { Router } from "express";
import authRoutes from "./auth.js";
import eventRoutes from "./events.js";
import connectionsRoutes from "./connections.js";
import { listMyRsvps } from "../controllers/rsvpController.js";
import { getHealth } from "../controllers/eventController.js";
import { createReport, listMyReports } from "../controllers/reportController.js";
import { listMyFriendsEvents } from "../controllers/connectionsController.js";
import { deleteAvatar, uploadAvatar } from "../controllers/userController.js";
import { requireAuth } from "../lib/auth.js";
import { imageUpload } from "../lib/upload.js";

const router = Router();

router.get("/health", getHealth);

router.use("/auth", authRoutes);
router.use("/", eventRoutes);
router.use("/", connectionsRoutes);

// "What am I signed up for" — always the current user, never an id in the URL,
// so there's no way to read someone else's schedule by guessing a UUID.
router.get("/me/rsvps", requireAuth, listMyRsvps);

// Upcoming events an accepted connection is going to. Same "always the
// current user" reasoning as /me/rsvps.
router.get("/me/friends-events", requireAuth, listMyFriendsEvents);

// Avatar upload/reset — multipart, field name "avatar". See server/lib/upload.js
// for the type/size gate.
router.post("/me/avatar", requireAuth, imageUpload.single("avatar"), uploadAvatar);
router.delete("/me/avatar", requireAuth, deleteAvatar);

// Reports live at the top level rather than under /events, because the subject
// can be either a user or an event.
router.post("/reports", requireAuth, createReport);

// Same reasoning as /me/rsvps: your own reports only, no id in the URL.
router.get("/me/reports", requireAuth, listMyReports);

export default router;
