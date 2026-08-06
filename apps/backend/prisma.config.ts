import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js"
  },
  datasource: {
    // This config is read by the Prisma CLI only (migrate, studio, db seed) —
    // never at runtime. Migrations must use a DIRECT connection, because
    // Supabase's pooled connection (port 6543) cannot run DDL. Locally
    // DIRECT_URL is unset, so it falls back to DATABASE_URL.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? ""
  }
});
