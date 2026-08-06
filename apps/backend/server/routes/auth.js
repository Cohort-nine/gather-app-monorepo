import { Router } from "express";
import { login, logout, me, signup } from "../controllers/authController.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

export default router;
