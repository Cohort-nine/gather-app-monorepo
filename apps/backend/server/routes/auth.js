import { Router } from "express";
import { changeEmail, changePassword, login, logout, me, signup } from "../controllers/authController.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

// Account-settings changes. Both re-confirm identity with the current
// password — see authController.js for why.
router.patch("/password", requireAuth, changePassword);
router.patch("/email", requireAuth, changeEmail);

export default router;
