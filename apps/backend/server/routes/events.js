import { Router } from "express";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listCategories,
  listEvents,
  updateEvent,
  uploadEventImage
} from "../controllers/eventController.js";
import {
  cancelRsvp,
  createOrUpdateRsvp,
  listEventRsvps,
  markAttendance
} from "../controllers/rsvpController.js";
import { createOrUpdateRating, listEventRatings } from "../controllers/ratingController.js";
import { mutualAttendees } from "../controllers/connectionsController.js";
import { optionalAuth, requireAuth, requireEventEdit, requireRsvpManagement } from "../lib/auth.js";
import { imageUpload } from "../lib/upload.js";

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

// Cover image is a separate, multipart step — authorization runs (and can
// reject) before any file is read off the wire.
router.post(
  "/events/:id/image",
  requireAuth,
  requireEventEdit,
  imageUpload.single("image"),
  uploadEventImage
);

// Public-ish like the rest of the event reads: optionalAuth so an anonymous
// visitor gets an empty result instead of a 401.
router.get("/events/:id/mutual-attendees", optionalAuth, mutualAttendees);

// ---- RSVPs --------------------------------------------------------------
router.post("/events/:id/rsvp", requireAuth, createOrUpdateRsvp);
router.delete("/events/:id/rsvp", requireAuth, cancelRsvp);

// Host-only views and actions.
router.get("/events/:id/rsvps", requireAuth, requireRsvpManagement, listEventRsvps);
router.post("/events/:id/attendance", requireAuth, requireRsvpManagement, markAttendance);

// ---- Host ratings -------------------------------------------------------
// Reading is public — a rating you can't see is no use to someone deciding
// whether to attend. Writing requires a session, and the controller additionally
// checks that you RSVP'd and weren't marked a no-show.
router.get("/events/:id/ratings", listEventRatings);
router.post("/events/:id/ratings", requireAuth, createOrUpdateRating);

export default router;
