import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import apiRoutes from "./routes/index.js";
import { buildCorsOptions, describeCorsPolicy } from "./lib/cors.js";
import { serveUploadedImage } from "./lib/upload.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

// Render (and most hosts) put a proxy in front of the app. Trusting the first
// hop makes req.ip the visitor's address rather than the proxy's, which is
// what the rate limiter below keys on.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Allowed origins come from CORS_ORIGIN — see server/lib/cors.js. Locally this
// falls back to Vite's dev server so nothing needs configuring to run the app.
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: "100kb" }));

// Password guessing is the one attack a public demo realistically sees.
// Twenty attempts per IP per fifteen minutes is invisible to a real person
// and makes brute-forcing a demo password impractical.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait a few minutes and try again." }
});
app.use(["/api/auth/login", "/api/auth/signup"], authLimiter);

// Avatars and event cover images live in the database (see server/lib/upload.js)
// and are served from the same /uploads/<id>.<ext> paths as before.
app.get("/uploads/:filename", serveUploadedImage);

app.use("/api", apiRoutes);

// Unknown route -> 404 JSON, not Express's default HTML page. The frontend
// always parses JSON, so an HTML body would blow up inside the fetch handler.
app.use((req, res) => {
  res.status(404).json({ message: `No route matches ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  console.error(err);

  // multer errors (oversized file, too many files, etc.) and our own
  // magic-byte / mime-type rejections from server/lib/upload.js are both
  // client mistakes, not server failures — same envelope as any other 400.
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image must be 5MB or smaller."
        : "Image upload failed.";
    return res.status(400).json({ message, errors: [err.message] });
  }
  if (err.isUploadValidation) {
    return res.status(400).json({ message: err.message, errors: [err.message] });
  }

  // Translate the Prisma errors a client can actually cause into useful status
  // codes. Anything else is genuinely our fault and stays a 500.
  if (err.code === "P2002") {
    return res.status(409).json({
      message: "That value is already taken.",
      errors: [`Duplicate value for: ${err.meta?.target ?? "unique field"}`]
    });
  }
  if (err.code === "P2003") {
    return res.status(400).json({ message: "Referenced record does not exist." });
  }
  // A malformed id reached the database (e.g. a non-UUID in a path).
  if (err.code === "P2023") {
    return res.status(400).json({ message: "Malformed id." });
  }
  // A body that isn't valid JSON, or is larger than the limit above.
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body must be valid JSON." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }
  if (err.code === "P2025") {
    return res.status(404).json({ message: "Record not found." });
  }
  // Raised by our CHECK constraints — the database caught something that
  // slipped past validation.
  if (err.code === "P2010" || err.meta?.code === "23514") {
    return res.status(400).json({
      message: "That change would violate a database rule.",
      errors: [err.meta?.message ?? "Constraint violation"]
    });
  }

  res.status(500).json({ message: "Something went wrong on the server." });
});

// Last line of defence. Route handlers pass errors to next(), but a stray
// rejected promise shouldn't take the whole API down with it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(describeCorsPolicy());
  console.log(`Try: http://localhost:${port}/api/events?sort=soonest`);
});
