import { Router } from "express";
import {
  acceptConnection,
  declineConnection,
  listConnections,
  removeConnection,
  searchUsers,
  sendConnectionRequest
} from "../controllers/connectionsController.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

// Search requires a session so blocked/blocking users can be filtered out and
// so an anonymous caller can't enumerate handles.
router.get("/users/search", requireAuth, searchUsers);

router.post("/connections", requireAuth, sendConnectionRequest);
router.get("/connections", requireAuth, listConnections);
router.patch("/connections/:otherUserId/accept", requireAuth, acceptConnection);
router.patch("/connections/:otherUserId/decline", requireAuth, declineConnection);
router.delete("/connections/:otherUserId", requireAuth, removeConnection);

export default router;
