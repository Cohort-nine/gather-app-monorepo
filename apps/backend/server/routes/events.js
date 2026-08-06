import { Router } from "express";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listCategories,
  listEvents,
  updateEvent
} from "../controllers/eventController.js";
import {
  cancelRsvp,
  createOrUpdateRsvp,
  listEventRsvps,
  markAttendance
} from "../controllers/rsvpController.js";
import { optionalAuth, requireAuth, requireEventEdit, requireRsvpManagement } from "../lib/auth.js";

const router = Router();

router.get("/categories", listCategories);

// ---- Events -------------------------------------------------------------
// Reads are public but use optionalAuth: a signed-in user sees the exact
// address of events they've RSVP'd to, an anonymous visitor never does.
router.get("/events", optionalAuth, listEvents);
router.get("/events/:id", optionalAuth, getEvent);

// Writes require a session. Edit and delete additionally require being the
// host or a cohost — authentication and authorization are separate checks.
router.post("/events", requireAuth, createEvent);
router.put("/events/:id", requireAuth, requireEventEdit, updateEvent);
router.delete("/events/:id", requireAuth, requireEventEdit, deleteEvent);

// ---- RSVPs --------------------------------------------------------------
router.post("/events/:id/rsvp", requireAuth, createOrUpdateRsvp);
router.delete("/events/:id/rsvp", requireAuth, cancelRsvp);

// Host-only views and actions.
router.get("/events/:id/rsvps", requireAuth, requireRsvpManagement, listEventRsvps);
router.post("/events/:id/attendance", requireAuth, requireRsvpManagement, markAttendance);

export default router;
