import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import apiRoutes from "./routes/events.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.use("/api", apiRoutes);

// Unknown route -> 404 JSON, not Express's default HTML page. The frontend
// always parses JSON, so an HTML body would blow up inside the fetch handler.
app.use((req, res) => {
  res.status(404).json({ message: `No route matches ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  console.error(err);

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
  console.log(`Try: http://localhost:${port}/api/events?sort=soonest`);
});
