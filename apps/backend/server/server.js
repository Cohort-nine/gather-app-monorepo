import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import apiRoutes from "./routes/index.js";
import { buildCorsOptions, describeCorsPolicy } from "./lib/cors.js";
import { UPLOAD_DIR } from "./lib/upload.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

// Allowed origins come from CORS_ORIGIN — see server/lib/cors.js. Locally this
// falls back to Vite's dev server so nothing needs configuring to run the app.
app.use(cors(buildCorsOptions()));
app.use(express.json());

// Avatars and event cover images, written by server/lib/upload.js. Known to
// be ephemeral on Render's free tier (the disk doesn't survive a redeploy) —
// an accepted tradeoff for this project, not a bug to fix here.
app.use("/uploads", express.static(UPLOAD_DIR));

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

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(describeCorsPolicy());
  console.log(`Try: http://localhost:${port}/api/events?sort=soonest`);
});
