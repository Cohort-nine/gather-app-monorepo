import { Router } from "express";
import {
  createEvent,
  deleteEvent,
  getEvent,
  getHealth,
  listCategories,
  listEvents,
  updateEvent
} from "../controllers/eventController.js";

const router = Router();

router.get("/health", getHealth);
router.get("/categories", listCategories);

// Main resource — full CRUD.
router.get("/events", listEvents);
router.get("/events/:id", getEvent);
router.post("/events", createEvent);
router.put("/events/:id", updateEvent);
router.delete("/events/:id", deleteEvent);

export default router;
