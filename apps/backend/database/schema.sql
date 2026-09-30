-- ============================================================================
-- GATHER — PostgreSQL schema
--
-- GENERATED FILE. Do not hand-edit — run `npm run sql:build` instead.
--   Source:  prisma/migrations/20260805000140_init/migration.sql
--            prisma/migrations/20260806003934_add_auth/migration.sql
--            prisma/migrations/20260820010257_add_event_image/migration.sql
--            prisma/migrations/20260930140000_store_images_in_db/migration.sql
--
-- This file exists so the database can be created with plain SQL instead of
-- Prisma. It is generated from the migrations rather than maintained by hand,
-- because a hand-kept copy silently drifted from the Prisma schema once
-- already — same 21 table names, different columns in 10 of them.
--
-- Two rules the whole schema leans on:
--   - Scores are DERIVED, never authored. The ledgers (rsvp_status_events,
--     attendance, host_ratings) are the source of truth; attendee_reliability
--     and host_reputation are caches you can rebuild from scratch at any time.
--   - Every state change that could affect a score is timestamped relative to
--     event start, so "cancelled with notice" vs "ghosted" is answerable from
--     data rather than guessed at.
--
-- Usage:
--   npm run sql:schema        # then: npm run sql:seed
--
-- Requires PostgreSQL 14+.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- citext — case-insensitive handles, emails, and tags, so "Maya" and "maya"
--          collide on the UNIQUE index instead of both being accepted.
--
-- pgcrypto is deliberately NOT required. gen_random_uuid() has been built into
-- core PostgreSQL since 13, and `CREATE EXTENSION pgcrypto` hard-fails on
-- managed providers that don't allowlist it — so asking for it buys nothing
-- and can break a deploy.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "citext";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

CREATE TYPE "connection_status" AS ENUM ('pending', 'accepted', 'blocked');

CREATE TYPE "event_status" AS ENUM ('draft', 'published', 'cancelled', 'completed');

CREATE TYPE "event_visibility" AS ENUM ('public', 'unlisted', 'invite_only');

CREATE TYPE "rsvp_status" AS ENUM ('going', 'waitlisted', 'cancelled', 'declined');

CREATE TYPE "attendance_outcome" AS ENUM ('attended', 'no_show', 'excused');

CREATE TYPE "attendance_method" AS ENUM ('host_marked', 'self_checkin', 'qr_scan', 'auto');

CREATE TYPE "invite_status" AS ENUM ('sent', 'accepted', 'declined', 'expired');

CREATE TYPE "attendee_visibility" AS ENUM ('everyone', 'connections_and_mutuals', 'host_only', 'nobody');

CREATE TYPE "notification_channel" AS ENUM ('push', 'email', 'sms', 'in_app');

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "handle" CITEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "bio" TEXT,
    "home_city" TEXT,
    "home_lat" DOUBLE PRECISION,
    "home_lng" DOUBLE PRECISION,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email_verified_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_hash" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_privacy_settings" (
    "user_id" UUID NOT NULL,
    "attendee_visibility" "attendee_visibility" NOT NULL DEFAULT 'connections_and_mutuals',
    "surface_as_mutual" BOOLEAN NOT NULL DEFAULT true,
    "show_reliability_to_hosts" BOOLEAN NOT NULL DEFAULT true,
    "discoverable_by_handle" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "connections" (
    "user_low" UUID NOT NULL,
    "user_high" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "connection_status" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),

    CONSTRAINT "connections_pkey" PRIMARY KEY ("user_low","user_high")
);

CREATE TABLE "user_blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

CREATE TABLE "categories" (
    "id" SMALLSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "host_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "cadence" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "host_id" UUID NOT NULL,
    "series_id" UUID,
    "category_id" SMALLINT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "rsvp_closes_at" TIMESTAMPTZ(6),
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "online_url" TEXT,
    "place_name" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country_code" CHAR(2),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "hide_exact_address_until_rsvp" BOOLEAN NOT NULL DEFAULT true,
    "capacity" INTEGER,
    "allow_waitlist" BOOLEAN NOT NULL DEFAULT true,
    "allow_guests" BOOLEAN NOT NULL DEFAULT false,
    "max_guests_per_rsvp" SMALLINT NOT NULL DEFAULT 0,
    "waitlist_reliability_floor" DECIMAL(4,2) NOT NULL DEFAULT 0.00,
    "visibility" "event_visibility" NOT NULL DEFAULT 'public',
    "status" "event_status" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancellation_reason" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "image_url" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_cohosts" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "can_edit" BOOLEAN NOT NULL DEFAULT true,
    "can_manage_rsvps" BOOLEAN NOT NULL DEFAULT true,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_cohosts_pkey" PRIMARY KEY ("event_id","user_id")
);

CREATE TABLE "event_tags" (
    "event_id" UUID NOT NULL,
    "tag" CITEXT NOT NULL,

    CONSTRAINT "event_tags_pkey" PRIMARY KEY ("event_id","tag")
);

CREATE TABLE "rsvps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "rsvp_status" NOT NULL DEFAULT 'going',
    "guest_count" SMALLINT NOT NULL DEFAULT 0,
    "waitlist_position" INTEGER,
    "first_responded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),
    "promoted_at" TIMESTAMPTZ(6),
    "note_to_host" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rsvps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rsvp_status_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rsvp_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "actor_id" UUID,
    "from_status" "rsvp_status",
    "to_status" "rsvp_status" NOT NULL,
    "hours_before_event" DECIMAL(10,2),
    "event_starts_at_snapshot" TIMESTAMPTZ(6),
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rsvp_status_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rsvp_id" UUID NOT NULL,
    "outcome" "attendance_outcome" NOT NULL,
    "method" "attendance_method" NOT NULL DEFAULT 'host_marked',
    "guests_brought" SMALLINT NOT NULL DEFAULT 0,
    "checked_in_at" TIMESTAMPTZ(6),
    "marked_by_id" UUID,
    "marked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendee_reliability" (
    "user_id" UUID NOT NULL,
    "score" DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    "rsvp_count" INTEGER NOT NULL DEFAULT 0,
    "attended_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "excused_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_with_notice_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_late_count" INTEGER NOT NULL DEFAULT 0,
    "band" VARCHAR(20),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendee_reliability_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "host_reputation" (
    "user_id" UUID NOT NULL,
    "score" DECIMAL(4,2) NOT NULL DEFAULT 0.00,
    "events_hosted" INTEGER NOT NULL DEFAULT 0,
    "events_completed" INTEGER NOT NULL DEFAULT 0,
    "events_cancelled" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_reputation_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "host_ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "rater_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_ratings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "invitee_id" UUID,
    "invitee_email" CITEXT,
    "status" "invite_status" NOT NULL DEFAULT 'sent',
    "token" TEXT NOT NULL,
    "message" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "event_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_id" UUID,
    "channel" "notification_channel" NOT NULL DEFAULT 'in_app',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","type","channel")
);

CREATE TABLE "badges" (
    "id" SMALLSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon_url" TEXT,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_badges" (
    "user_id" UUID NOT NULL,
    "badge_id" SMALLINT NOT NULL,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("user_id","badge_id")
);

CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reporter_id" UUID NOT NULL,
    "subject_user_id" UUID,
    "subject_event_id" UUID,
    "type" TEXT NOT NULL,
    "details" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE INDEX "connections_user_low_idx" ON "connections"("user_low");

CREATE INDEX "connections_user_high_idx" ON "connections"("user_high");

CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

CREATE UNIQUE INDEX "event_series_slug_key" ON "event_series"("slug");

CREATE INDEX "event_series_host_id_idx" ON "event_series"("host_id");

CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

CREATE INDEX "events_series_id_starts_at_idx" ON "events"("series_id", "starts_at");

CREATE INDEX "events_starts_at_idx" ON "events"("starts_at");

CREATE INDEX "events_host_id_starts_at_idx" ON "events"("host_id", "starts_at" DESC);

CREATE INDEX "events_category_id_starts_at_idx" ON "events"("category_id", "starts_at");

CREATE INDEX "events_lat_lng_idx" ON "events"("lat", "lng");

CREATE INDEX "event_tags_tag_idx" ON "event_tags"("tag");

CREATE INDEX "rsvps_event_id_status_idx" ON "rsvps"("event_id", "status");

CREATE INDEX "rsvps_user_id_created_at_idx" ON "rsvps"("user_id", "created_at" DESC);

CREATE UNIQUE INDEX "rsvps_event_id_user_id_key" ON "rsvps"("event_id", "user_id");

CREATE INDEX "rsvp_status_events_rsvp_id_created_at_idx" ON "rsvp_status_events"("rsvp_id", "created_at");

CREATE INDEX "rsvp_status_events_event_id_created_at_idx" ON "rsvp_status_events"("event_id", "created_at");

CREATE UNIQUE INDEX "attendance_rsvp_id_key" ON "attendance"("rsvp_id");

CREATE INDEX "attendance_user_id_marked_at_idx" ON "attendance"("user_id", "marked_at" DESC);

CREATE INDEX "attendance_event_id_outcome_idx" ON "attendance"("event_id", "outcome");

CREATE UNIQUE INDEX "attendance_event_id_user_id_key" ON "attendance"("event_id", "user_id");

CREATE INDEX "attendee_reliability_score_idx" ON "attendee_reliability"("score" DESC);

CREATE INDEX "host_reputation_score_idx" ON "host_reputation"("score" DESC);

CREATE INDEX "host_ratings_host_id_created_at_idx" ON "host_ratings"("host_id", "created_at" DESC);

CREATE UNIQUE INDEX "host_ratings_event_id_rater_id_key" ON "host_ratings"("event_id", "rater_id");

CREATE UNIQUE INDEX "event_invites_token_key" ON "event_invites"("token");

CREATE INDEX "event_invites_event_id_status_idx" ON "event_invites"("event_id", "status");

CREATE INDEX "event_invites_invitee_id_status_idx" ON "event_invites"("invitee_id", "status");

CREATE UNIQUE INDEX "event_invites_event_id_invitee_id_key" ON "event_invites"("event_id", "invitee_id");

CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

CREATE UNIQUE INDEX "badges_slug_key" ON "badges"("slug");

CREATE INDEX "reports_subject_user_id_created_at_idx" ON "reports"("subject_user_id", "created_at" DESC);

CREATE INDEX "reports_subject_event_id_created_at_idx" ON "reports"("subject_event_id", "created_at" DESC);

CREATE INDEX "reports_resolved_at_idx" ON "reports"("resolved_at");

ALTER TABLE "user_privacy_settings" ADD CONSTRAINT "user_privacy_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connections" ADD CONSTRAINT "connections_user_low_fkey" FOREIGN KEY ("user_low") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connections" ADD CONSTRAINT "connections_user_high_fkey" FOREIGN KEY ("user_high") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connections" ADD CONSTRAINT "connections_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_series" ADD CONSTRAINT "event_series_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "events" ADD CONSTRAINT "events_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "events" ADD CONSTRAINT "events_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "events" ADD CONSTRAINT "events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "event_cohosts" ADD CONSTRAINT "event_cohosts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_cohosts" ADD CONSTRAINT "event_cohosts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rsvp_status_events" ADD CONSTRAINT "rsvp_status_events_rsvp_id_fkey" FOREIGN KEY ("rsvp_id") REFERENCES "rsvps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rsvp_status_events" ADD CONSTRAINT "rsvp_status_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rsvp_status_events" ADD CONSTRAINT "rsvp_status_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_rsvp_id_fkey" FOREIGN KEY ("rsvp_id") REFERENCES "rsvps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendee_reliability" ADD CONSTRAINT "attendee_reliability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_reputation" ADD CONSTRAINT "host_reputation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_ratings" ADD CONSTRAINT "host_ratings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_ratings" ADD CONSTRAINT "host_ratings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_ratings" ADD CONSTRAINT "host_ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reports" ADD CONSTRAINT "reports_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reports" ADD CONSTRAINT "reports_subject_event_id_fkey" FOREIGN KEY ("subject_event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- GATHER — raw SQL companion to schema.prisma
--
-- Prisma cannot express CHECK constraints, partial indexes, or views.
-- Run these AFTER `prisma migrate dev --create-only` by appending this file
-- to the generated migration.sql, then `prisma migrate dev` to apply.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CHECK CONSTRAINTS
--
-- NOTE: `CREATE EXTENSION IF NOT EXISTS citext;` must run BEFORE the CREATE
-- TABLE statements, so it goes at the TOP of migration.sql, not here.
-- pgcrypto is not needed — Postgres 13+ has gen_random_uuid() built in.
-- ----------------------------------------------------------------------------

ALTER TABLE users
    ADD CONSTRAINT users_handle_format
    CHECK (handle ~ '^[a-z0-9_]{3,30}$');

ALTER TABLE connections
    ADD CONSTRAINT connections_canonical_order
    CHECK (user_low < user_high);

ALTER TABLE connections
    ADD CONSTRAINT connections_accepted_has_time
    CHECK (status <> 'accepted' OR accepted_at IS NOT NULL);

ALTER TABLE user_blocks
    ADD CONSTRAINT user_blocks_not_self
    CHECK (blocker_id <> blocked_id);

ALTER TABLE events
    ADD CONSTRAINT events_capacity_positive
    CHECK (capacity IS NULL OR capacity > 0);

ALTER TABLE events
    ADD CONSTRAINT events_end_after_start
    CHECK (ends_at IS NULL OR ends_at > starts_at);

ALTER TABLE events
    ADD CONSTRAINT events_rsvp_before_start
    CHECK (rsvp_closes_at IS NULL OR rsvp_closes_at <= starts_at);

ALTER TABLE events
    ADD CONSTRAINT events_online_has_url
    CHECK (NOT is_online OR online_url IS NOT NULL);

ALTER TABLE events
    ADD CONSTRAINT events_cancelled_has_time
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL);

ALTER TABLE rsvps
    ADD CONSTRAINT rsvps_guest_count_sane
    CHECK (guest_count >= 0 AND guest_count <= 20);

ALTER TABLE rsvps
    ADD CONSTRAINT rsvps_cancelled_has_time
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL);

ALTER TABLE rsvps
    ADD CONSTRAINT rsvps_waitlist_position
    CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL));

ALTER TABLE host_ratings
    ADD CONSTRAINT host_ratings_range
    CHECK (rating BETWEEN 1 AND 5);

-- A report targets exactly one subject: a user OR an event, never both/neither.
ALTER TABLE reports
    ADD CONSTRAINT reports_one_subject
    CHECK (num_nonnulls(subject_user_id, subject_event_id) = 1);

ALTER TABLE attendee_reliability
    ADD CONSTRAINT attendee_reliability_score_range
    CHECK (score >= 0.00 AND score <= 1.00);

ALTER TABLE host_reputation
    ADD CONSTRAINT host_reputation_score_range
    CHECK (score >= 0.00 AND score <= 5.00);

-- ----------------------------------------------------------------------------
-- PARTIAL INDEXES
-- Drop the full indexes Prisma generated, replace with the partial versions.
-- ----------------------------------------------------------------------------

DROP INDEX IF EXISTS "connections_user_low_idx";
CREATE INDEX connections_low_idx ON connections (user_low)
    WHERE status = 'accepted';

DROP INDEX IF EXISTS "connections_user_high_idx";
CREATE INDEX connections_high_idx ON connections (user_high)
    WHERE status = 'accepted';

DROP INDEX IF EXISTS "events_series_id_starts_at_idx";
CREATE INDEX events_series_idx ON events (series_id, starts_at)
    WHERE series_id IS NOT NULL;

DROP INDEX IF EXISTS "events_starts_at_idx";
CREATE INDEX events_browse_idx ON events (starts_at)
    WHERE status = 'published' AND visibility = 'public';

DROP INDEX IF EXISTS "events_category_id_starts_at_idx";
CREATE INDEX events_category_idx ON events (category_id, starts_at)
    WHERE status = 'published';

DROP INDEX IF EXISTS "events_lat_lng_idx";
CREATE INDEX events_geo_idx ON events (lat, lng)
    WHERE status = 'published';

-- Partial UNIQUE — this one is load-bearing. Without it, waitlist ordering
-- has no uniqueness guarantee and two RSVPs can share position 1.
CREATE UNIQUE INDEX rsvps_waitlist_order_idx ON rsvps (event_id, waitlist_position)
    WHERE status = 'waitlisted';

-- ----------------------------------------------------------------------------
-- VIEW
-- One row per direction, for simple JOIN-based graph traversal.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW connection_edges AS
    SELECT user_low  AS user_id, user_high AS peer_id, accepted_at
      FROM connections WHERE status = 'accepted'
    UNION ALL
    SELECT user_high AS user_id, user_low  AS peer_id, accepted_at
      FROM connections WHERE status = 'accepted';


-- ----------------------------------------------------------------------------
-- LATER MIGRATIONS
-- Statements that can't be folded into a CREATE TABLE, replayed in order.
-- ----------------------------------------------------------------------------

-- 20260930140000_store_images_in_db
-- Uploaded images (avatars, event covers) move off the web server's disk and
-- into the database. Render's free tier has an ephemeral filesystem, so files
-- written to disk vanished on every redeploy and every idle spin-down. A row
-- here survives both. Images are capped at 5MB by the upload middleware, and
-- the CHECKs below repeat both rules so the database enforces them too.

CREATE TABLE "images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

ALTER TABLE images
    ADD CONSTRAINT images_mime_type_allowed
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE images
    ADD CONSTRAINT images_byte_size_sane
    CHECK (byte_size > 0 AND byte_size <= 5242880);
