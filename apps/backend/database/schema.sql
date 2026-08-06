-- ============================================================================
-- GATHER — Proposed database schema (PostgreSQL 14+)
--
-- Two rules the whole schema leans on:
--   - Scores are DERIVED, never authored. The ledgers (rsvp_status_events,
--     attendance) are the source of truth; reliability/reputation tables are
--     caches you can rebuild from scratch at any time.
--   - Every state change that could affect a score is timestamped relative to
--     event start, so "with notice" vs "ghosted" is answerable from data.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email/handle

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE connection_status   AS ENUM ('pending', 'accepted', 'blocked');
CREATE TYPE event_status        AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE event_visibility    AS ENUM ('public', 'unlisted', 'invite_only');
CREATE TYPE rsvp_status         AS ENUM ('going', 'waitlisted', 'cancelled', 'declined');
CREATE TYPE attendance_outcome  AS ENUM ('attended', 'no_show', 'excused');
CREATE TYPE attendance_method   AS ENUM ('host_marked', 'self_checkin', 'qr_scan', 'auto');
CREATE TYPE invite_status       AS ENUM ('sent', 'accepted', 'declined', 'expired');
CREATE TYPE attendee_visibility AS ENUM ('everyone', 'connections_and_mutuals', 'host_only', 'nobody');
CREATE TYPE notification_channel AS ENUM ('push', 'email', 'sms', 'in_app');

-- ============================================================================
-- IDENTITY
-- ============================================================================

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    handle          citext NOT NULL UNIQUE,
    email           citext NOT NULL UNIQUE,
    display_name    text   NOT NULL,
    avatar_url      text,
    bio             text,
    home_city       text,
    home_lat        double precision,
    home_lng        double precision,
    joined_at       timestamptz NOT NULL DEFAULT now(),
    email_verified_at timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT users_handle_format CHECK (handle ~ '^[a-z0-9_]{3,30}$')
);

-- who else will be there (with privacy controls)
-- split out so the settings row can grow without bloating the hot users table.
CREATE TABLE user_privacy_settings (
    user_id                  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- Can others see this user listed as a past/current attendee?
    attendee_visibility      attendee_visibility NOT NULL DEFAULT 'connections_and_mutuals',
    -- Can this user be surfaced as a "mutual connection" on a listing?
    surface_as_mutual        boolean NOT NULL DEFAULT true,
    -- Is the numeric reliability score visible to hosts, or only the band?
    show_reliability_to_hosts boolean NOT NULL DEFAULT true,
    discoverable_by_handle   boolean NOT NULL DEFAULT true,
    updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- SOCIAL GRAPH  (powers "friends and friends-of-friends have been here")
-- ============================================================================

-- Symmetric edge stored once, canonically ordered (user_low < user_high),
-- so a friendship can never be double-inserted in reverse.
CREATE TABLE connections (
    user_low     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       connection_status NOT NULL DEFAULT 'pending',
    requested_at timestamptz NOT NULL DEFAULT now(),
    accepted_at  timestamptz,
    PRIMARY KEY (user_low, user_high),
    CONSTRAINT connections_canonical_order CHECK (user_low < user_high),
    CONSTRAINT connections_accepted_has_time
        CHECK (status <> 'accepted' OR accepted_at IS NOT NULL)
);

CREATE INDEX connections_low_idx  ON connections (user_low)  WHERE status = 'accepted';
CREATE INDEX connections_high_idx ON connections (user_high) WHERE status = 'accepted';

-- Directed, always-honored safety edge. Kept separate from `connections`
-- because a block must survive independently of friendship state.
CREATE TABLE user_blocks (
    blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason     text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

-- Convenience view: one row per direction, for simple JOIN-based traversal.
CREATE VIEW connection_edges AS
    SELECT user_low  AS user_id, user_high AS peer_id, accepted_at
      FROM connections WHERE status = 'accepted'
    UNION ALL
    SELECT user_high AS user_id, user_low  AS peer_id, accepted_at
      FROM connections WHERE status = 'accepted';

-- ============================================================================
-- EVENTS
-- ============================================================================

CREATE TABLE categories (
    id          smallserial PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    sort_order  smallint NOT NULL DEFAULT 0
);

-- Optional series identity for recurring events (e.g. a host's monthly potluck)
CREATE TABLE event_series (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title       text NOT NULL,
    slug        text NOT NULL UNIQUE,
    description text,
    cadence     text, -- freeform ("monthly", "weekly", cron, etc.)
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- "All series this host runs" (host's series-management page).
CREATE INDEX event_series_host_idx ON event_series (host_id);


CREATE TABLE events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    series_id       uuid REFERENCES event_series(id) ON DELETE SET NULL,
    category_id     smallint REFERENCES categories(id),
    title           text NOT NULL,
    slug            text NOT NULL UNIQUE,
    description     text,

    -- Timing. Store UTC + IANA zone so recurring/local display stays correct.
    starts_at       timestamptz NOT NULL,
    ends_at         timestamptz,
    timezone        text NOT NULL DEFAULT 'UTC',
    rsvp_closes_at  timestamptz,

    -- Place. Denormalized on the event because Gather events are one-off
    -- gatherings (a park, someone's living room), not recurring venues.
    is_online       boolean NOT NULL DEFAULT false,
    online_url      text,
    place_name      text,
    address_line1   text,
    address_line2   text,
    city            text,
    region          text,
    postal_code     text,
    country_code    char(2),
    lat             double precision,
    lng             double precision,
    -- Exact address hidden until RSVP confirmed (a real trust/safety pattern
    -- for house-hosted gatherings).
    hide_exact_address_until_rsvp boolean NOT NULL DEFAULT true,

    capacity        integer,
    allow_waitlist  boolean NOT NULL DEFAULT true,
    allow_guests    boolean NOT NULL DEFAULT false,
    max_guests_per_rsvp smallint NOT NULL DEFAULT 0,

    -- Minimum attendee reliability (0.0 - 1.0) required to be auto-promoted
    -- from the waitlist when a spot opens. Default 0.00 = anyone.
    waitlist_reliability_floor numeric(4,2) NOT NULL DEFAULT 0.00,

    visibility      event_visibility NOT NULL DEFAULT 'public',
    status          event_status NOT NULL DEFAULT 'draft',

    published_at    timestamptz,
    cancelled_at    timestamptz,
    cancellation_reason text,
    completed_at    timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT events_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
    CONSTRAINT events_end_after_start   CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT events_rsvp_before_start CHECK (rsvp_closes_at IS NULL OR rsvp_closes_at <= starts_at),
    CONSTRAINT events_online_has_url    CHECK (NOT is_online OR online_url IS NOT NULL),
    CONSTRAINT events_cancelled_has_time
        CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
    CONSTRAINT events_completed_has_time
        CHECK (status <> 'completed' OR completed_at IS NOT NULL),
    -- Only published/completed require the stamp — a draft can be cancelled
    -- directly without ever having been published.
    CONSTRAINT events_published_has_time
        CHECK (status NOT IN ('published', 'completed') OR published_at IS NOT NULL)
);

-- Series-level dev note: series pages read as "give me every occurrence of
-- this series, in order" (e.g. `WHERE series_id = $1 ORDER BY starts_at`),
-- so the index carries starts_at rather than being series_id alone — that
-- makes the ORDER BY an index-only scan instead of a sort. Partial on
-- series_id IS NOT NULL because most events aren't part of a series.
CREATE INDEX events_series_idx ON events (series_id, starts_at)
    WHERE series_id IS NOT NULL;

-- The main browse query: upcoming published events, newest start first.
CREATE INDEX events_browse_idx ON events (starts_at)
    WHERE status = 'published' AND visibility = 'public';
CREATE INDEX events_host_idx     ON events (host_id, starts_at DESC);
CREATE INDEX events_category_idx ON events (category_id, starts_at)
    WHERE status = 'published';
CREATE INDEX events_geo_idx      ON events (lat, lng) WHERE status = 'published';

-- Host runs multiple groups and may share hosting duties.
CREATE TABLE event_cohosts (
    event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit  boolean NOT NULL DEFAULT true,
    can_manage_rsvps boolean NOT NULL DEFAULT true,
    added_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);

CREATE TABLE event_tags (
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tag      citext NOT NULL,
    PRIMARY KEY (event_id, tag)
);
CREATE INDEX event_tags_tag_idx ON event_tags (tag);

-- ============================================================================
-- RSVPs  +  the ledger that makes reliability computable
-- ============================================================================

CREATE TABLE rsvps (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    status            rsvp_status NOT NULL DEFAULT 'going',
    guest_count       smallint NOT NULL DEFAULT 0,

    -- Position is only meaningful while status = 'waitlisted'.
    waitlist_position integer,

    first_responded_at timestamptz NOT NULL DEFAULT now(),
    status_changed_at  timestamptz NOT NULL DEFAULT now(),
    cancelled_at       timestamptz,
    promoted_at        timestamptz,   -- moved waitlisted -> going
    note_to_host       text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    -- One RSVP row per person per event. Status changes mutate this row;
    -- the history lives in rsvp_status_events.
    CONSTRAINT rsvps_one_per_user UNIQUE (event_id, user_id),
    CONSTRAINT rsvps_guest_count_sane CHECK (guest_count >= 0 AND guest_count <= 20),
    CONSTRAINT rsvps_cancelled_has_time
        CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
    CONSTRAINT rsvps_waitlist_position
        CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL))
);

CREATE INDEX rsvps_event_status_idx ON rsvps (event_id, status);
CREATE INDEX rsvps_user_idx         ON rsvps (user_id, created_at DESC);
-- Keeps waitlist ordering unambiguous and cheap to pop from.
CREATE UNIQUE INDEX rsvps_waitlist_order_idx ON rsvps (event_id, waitlist_position)
    WHERE status = 'waitlisted';

-- APPEND-ONLY. This is the table the reliability score is computed from.
-- hours_before_event is stored (not derived at read time) so a later edit to
-- the event's start time can't retroactively change someone's score.
CREATE TABLE rsvp_status_events (
    id                 bigserial PRIMARY KEY,
    rsvp_id            uuid NOT NULL REFERENCES rsvps(id) ON DELETE CASCADE,
    event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_status        rsvp_status,
    to_status          rsvp_status NOT NULL,
    changed_at         timestamptz NOT NULL DEFAULT now(),
    changed_by         uuid REFERENCES users(id),  -- null = system (auto-promote)
    event_starts_at    timestamptz NOT NULL,
    hours_before_event numeric(10,2) NOT NULL,
    CONSTRAINT rsvp_status_events_actual_change CHECK (from_status IS DISTINCT FROM to_status)
);

CREATE INDEX rsvp_status_events_user_idx ON rsvp_status_events (user_id, changed_at DESC);
CREATE INDEX rsvp_status_events_rsvp_idx ON rsvp_status_events (rsvp_id, changed_at);

-- Auto-promote the next eligible waitlisted RSVP when a 'going' RSVP is
-- cancelled. Runs in the same transaction and writes an rsvp_status_events
-- row with changed_by = NULL to indicate a system action.
CREATE OR REPLACE FUNCTION promote_waitlist_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
        e RECORD;
        committed_seats integer;
        candidate RECORD;
        candidate_pos integer;
        hours_before numeric;
BEGIN
        -- Lock the event row to enforce capacity checks safely
        SELECT id, starts_at, capacity, allow_waitlist, waitlist_reliability_floor
            INTO e
            FROM events WHERE id = NEW.event_id FOR UPDATE;

        IF NOT FOUND OR NOT e.allow_waitlist THEN
                RETURN NEW;
        END IF;

        -- Loop rather than promoting one row: cancelling a 'going' RSVP with
        -- guest_count > 0 frees multiple seats at once, and one waitlist
        -- promotion per cancellation would leave the rest of that capacity
        -- unfilled until something else happened to cancel.
        LOOP
                IF e.capacity IS NOT NULL THEN
                        SELECT COALESCE(SUM(1 + guest_count) FILTER (WHERE status = 'going'), 0)
                            INTO committed_seats
                            FROM rsvps WHERE event_id = e.id;

                        IF committed_seats >= e.capacity THEN
                                EXIT; -- no free spot
                        END IF;
                END IF;

                -- Find the lowest waitlist_position that meets the reliability floor.
                SELECT r.id AS rsvp_id, r.user_id, r.waitlist_position, r.guest_count
                    INTO candidate
                    FROM rsvps r
                    LEFT JOIN attendee_reliability ar ON ar.user_id = r.user_id
                    WHERE r.event_id = e.id
                        AND r.status = 'waitlisted'
                        AND COALESCE(ar.score/100.0, 0.75) >= e.waitlist_reliability_floor
                    ORDER BY r.waitlist_position ASC
                    LIMIT 1
                    FOR UPDATE OF r SKIP LOCKED;

                IF NOT FOUND THEN
                        EXIT;
                END IF;

                -- Don't promote a party bigger than the remaining space; stop
                -- rather than skip ahead of them in line to a smaller party.
                IF e.capacity IS NOT NULL AND committed_seats + 1 + candidate.guest_count > e.capacity THEN
                        EXIT;
                END IF;

                candidate_pos := candidate.waitlist_position;

                -- Promote the candidate
                UPDATE rsvps
                     SET status = 'going', promoted_at = now(), status_changed_at = now(), waitlist_position = NULL, updated_at = now()
                 WHERE id = candidate.rsvp_id;

                -- Record the status event (system actor = NULL)
                hours_before := EXTRACT(EPOCH FROM (e.starts_at - now())) / 3600.0;
                INSERT INTO rsvp_status_events (rsvp_id, event_id, user_id, from_status, to_status, changed_at, changed_by, event_starts_at, hours_before_event)
                VALUES (candidate.rsvp_id, e.id, candidate.user_id, 'waitlisted', 'going', now(), NULL, e.starts_at, ROUND(hours_before::numeric,2));

                -- Shift up remaining waitlist positions to close the gap
                UPDATE rsvps
                     SET waitlist_position = waitlist_position - 1
                 WHERE event_id = e.id AND status = 'waitlisted' AND waitlist_position > candidate_pos;
        END LOOP;

        RETURN NEW;
END;
$$;

CREATE TRIGGER promote_waitlist_after_cancel
AFTER UPDATE ON rsvps
FOR EACH ROW
WHEN (OLD.status = 'going' AND NEW.status = 'cancelled')
EXECUTE FUNCTION promote_waitlist_on_cancel();

-- Ground truth for "did they actually show up". Nullable rsvp_id allows
-- walk-ins (people who never RSVP and show up).
CREATE TABLE attendance (
    event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rsvp_id     uuid REFERENCES rsvps(id) ON DELETE SET NULL,
    outcome     attendance_outcome NOT NULL,
    method      attendance_method NOT NULL DEFAULT 'host_marked',
    recorded_by uuid REFERENCES users(id),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Host can waive a no-show ("her car broke down") without gaming the ledger.
    excuse_note text,
    PRIMARY KEY (event_id, user_id),
    CONSTRAINT attendance_excuse_requires_excused
        CHECK (outcome = 'excused' OR excuse_note IS NULL)
);

CREATE INDEX attendance_user_idx ON attendance (user_id, recorded_at DESC);

CREATE TABLE event_invites (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    inviter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id   uuid REFERENCES users(id) ON DELETE CASCADE,
    invitee_email citext,
    token        text NOT NULL UNIQUE,
    status       invite_status NOT NULL DEFAULT 'sent',
    sent_at      timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    expires_at   timestamptz,
    CONSTRAINT event_invites_target CHECK (invitee_id IS NOT NULL OR invitee_email IS NOT NULL)
);

CREATE UNIQUE INDEX event_invites_unique_user ON event_invites (event_id, invitee_id)
    WHERE invitee_id IS NOT NULL;

-- ============================================================================
-- ATTENDANCE FINALIZATION  (host review gate — see note 8)
--
-- No attendance row is ever inserted automatically. A 'going' RSVP with no
-- matching `attendance` row means "not yet reviewed" — never an implicit
-- no-show. These two columns let the host (or a cohost with
-- can_manage_rsvps) explicitly close out the checklist, and give the
-- reliability job something concrete to gate on.
-- ============================================================================

ALTER TABLE events
    ADD COLUMN attendance_finalized_at timestamptz,
    ADD COLUMN attendance_finalized_by uuid REFERENCES users(id);

-- Worker query: "which ended events still need a host to walk the
-- checklist" — feeds the attendance_review_needed notification.
CREATE INDEX events_awaiting_attendance_review_idx ON events (ends_at)
    WHERE attendance_finalized_at IS NULL AND status <> 'cancelled';

-- The host's post-event checklist. One row per person who committed to
-- attend; pending_review = true means the host hasn't marked them yet.
-- Deliberately excludes waitlisted/cancelled RSVPs — only 'going' commitments
-- are the host's to account for.
CREATE VIEW event_attendance_checklist AS
SELECT
    r.event_id,
    r.id          AS rsvp_id,
    r.user_id,
    r.guest_count,
    a.outcome,
    a.method,
    a.excuse_note,
    (a.outcome IS NULL) AS pending_review
FROM rsvps r
JOIN events e ON e.id = r.event_id
LEFT JOIN attendance a ON a.event_id = r.event_id AND a.user_id = r.user_id
WHERE r.status = 'going';

-- A host re-saving the same checklist screen shouldn't bump updated_at,
-- re-trigger reliability recompute, or touch anything — only a genuine
-- change to outcome/method/excuse_note counts as an edit.
CREATE OR REPLACE FUNCTION attendance_skip_noop_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.outcome IS NOT DISTINCT FROM OLD.outcome
        AND NEW.method IS NOT DISTINCT FROM OLD.method
        AND NEW.excuse_note IS NOT DISTINCT FROM OLD.excuse_note THEN
        RETURN NULL; -- no real change: abort the write entirely
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_before_update
BEFORE UPDATE ON attendance
FOR EACH ROW
EXECUTE FUNCTION attendance_skip_noop_update();

-- Editing attendance after the host already finalized the event un-finalizes
-- it, so "finalized" always reflects a real, complete review rather than a
-- stale click from before a walk-in was added or a mistake was corrected.
CREATE OR REPLACE FUNCTION unfinalize_event_on_attendance_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE events
       SET attendance_finalized_at = NULL, attendance_finalized_by = NULL
     WHERE id = COALESCE(NEW.event_id, OLD.event_id)
       AND attendance_finalized_at IS NOT NULL;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER attendance_unfinalize_on_change
AFTER INSERT OR UPDATE OR DELETE ON attendance
FOR EACH ROW
EXECUTE FUNCTION unfinalize_event_on_attendance_change();

-- Guard on the other end: a host can't mark the checklist finalized while
-- any 'going' RSVP is still unreviewed. Without this, "finalize" could be
-- clicked immediately and silently leave everyone else unaccounted for.
CREATE OR REPLACE FUNCTION check_attendance_finalization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    pending integer;
BEGIN
    SELECT COUNT(*) INTO pending
      FROM event_attendance_checklist
     WHERE event_id = NEW.id AND pending_review;

    IF pending > 0 THEN
        RAISE EXCEPTION 'Cannot finalize attendance for event %: % RSVP(s) still unreviewed', NEW.id, pending;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER events_check_attendance_finalization
BEFORE UPDATE ON events
FOR EACH ROW
WHEN (NEW.attendance_finalized_at IS NOT NULL AND NEW.attendance_finalized_at IS DISTINCT FROM OLD.attendance_finalized_at)
EXECUTE FUNCTION check_attendance_finalization();

-- ============================================================================
-- TRUST LAYER  (derived caches — rebuildable from the ledgers above)
-- ============================================================================

-- Framed as a nudge: it recovers over time, so the counts are
-- windowed (rolling 12 months) rather than lifetime.
CREATE TABLE attendee_reliability (
    user_id                  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    score                    numeric(4,1) NOT NULL DEFAULT 100.0,  -- 0.0 - 100.0
    commitments              integer NOT NULL DEFAULT 0,  -- times they said "going"
    attended                 integer NOT NULL DEFAULT 0,
    cancelled_with_notice    integer NOT NULL DEFAULT 0,  -- >= notice threshold
    cancelled_late           integer NOT NULL DEFAULT 0,  -- < notice threshold
    no_shows                 integer NOT NULL DEFAULT 0,
    excused                  integer NOT NULL DEFAULT 0,
    window_starts_at         timestamptz NOT NULL,
    -- Below a minimum sample size the UI should show "New" instead of a number.
    is_provisional           boolean NOT NULL GENERATED ALWAYS AS (commitments < 3) STORED,
    last_computed_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendee_reliability_score_range CHECK (score >= 0 AND score <= 100)
);

-- Deliberately separate from attendee reliability: being a
-- good host and being a reliable guest are different reputations.
CREATE TABLE host_reputation (
    user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    score                numeric(4,1) NOT NULL DEFAULT 100.0,
    events_hosted        integer NOT NULL DEFAULT 0,
    events_completed     integer NOT NULL DEFAULT 0,
    events_cancelled_by_host integer NOT NULL DEFAULT 0,
    total_attendees      integer NOT NULL DEFAULT 0,
    avg_rating           numeric(3,2),
    ratings_count        integer NOT NULL DEFAULT 0,
    first_hosted_at      timestamptz,
    is_provisional       boolean NOT NULL GENERATED ALWAYS AS (events_completed < 2) STORED,
    last_computed_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT host_reputation_score_range CHECK (score >= 0 AND score <= 100)
);

-- Post-event rating of the host by an attendee who actually showed up.
CREATE TABLE host_ratings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    host_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rater_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      smallint NOT NULL,
    comment     text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT host_ratings_one_per_event UNIQUE (event_id, rater_id),
    CONSTRAINT host_ratings_range CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT host_ratings_not_self CHECK (host_id <> rater_id)
);

CREATE INDEX host_ratings_host_idx ON host_ratings (host_id, created_at DESC);

-- The comment above says "by an attendee who actually showed up" but
-- nothing enforced it. Ties ratings to the same attendance ledger the
-- finalization gate protects, so a no-show (or someone never marked at
-- all) can't rate the host.
CREATE OR REPLACE FUNCTION check_rater_attended()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM attendance
         WHERE event_id = NEW.event_id
           AND user_id = NEW.rater_id
           AND outcome = 'attended'
    ) THEN
        RAISE EXCEPTION 'User % cannot rate host for event %: not recorded as attended', NEW.rater_id, NEW.event_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER host_ratings_require_attendance
BEFORE INSERT ON host_ratings
FOR EACH ROW
EXECUTE FUNCTION check_rater_attended();

-- Badges are awarded, not computed on the fly, so the criteria can change
-- without silently revoking what someone already earned.
CREATE TABLE badges (
    id          smallserial PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    label       text NOT NULL,
    description text,
    applies_to  text NOT NULL CHECK (applies_to IN ('host', 'attendee'))
);

CREATE TABLE user_badges (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id   smallint NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    PRIMARY KEY (user_id, badge_id)
);

-- ============================================================================
-- NOTIFICATIONS  (reminders before events)
-- ============================================================================

CREATE TABLE notifications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id      uuid REFERENCES events(id) ON DELETE CASCADE,
    type          text NOT NULL,   -- 'rsvp_reminder_48h', 'waitlist_promoted', ...
    channel       notification_channel NOT NULL,
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    scheduled_for timestamptz NOT NULL,
    sent_at       timestamptz,
    read_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- The worker's queue query.
CREATE INDEX notifications_due_idx ON notifications (scheduled_for)
    WHERE sent_at IS NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE notification_preferences (
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type               text NOT NULL,
    channel            notification_channel NOT NULL,
    enabled            boolean NOT NULL DEFAULT true,
    PRIMARY KEY (user_id, type, channel)
);

-- ============================================================================
-- SAFETY
-- ============================================================================

CREATE TABLE reports (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nullable: ON DELETE SET NULL needs somewhere to put NULL. A report
    -- must survive its reporter's account being deleted, so it can't cascade.
    reporter_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    subject_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    subject_event_id uuid REFERENCES events(id) ON DELETE CASCADE,
    reason         text NOT NULL,
    details        text,
    status         text NOT NULL DEFAULT 'open',
    created_at     timestamptz NOT NULL DEFAULT now(),
    resolved_at    timestamptz,
    CONSTRAINT reports_has_subject
        CHECK (subject_user_id IS NOT NULL OR subject_event_id IS NOT NULL)
);

-- ============================================================================
-- READ MODELS
-- ============================================================================

-- The headline number: not the raw RSVP count, but the expected turnout.
-- Weight each committed seat by that attendee's reliability score; brand-new
-- users fall back to a neutral 0.75 so they aren't penalized for having no
-- history.
CREATE VIEW event_expected_headcount AS
SELECT
    e.id AS event_id,
    e.capacity,
    COUNT(*) FILTER (WHERE r.status = 'going')                       AS rsvp_count,
    COALESCE(SUM(1 + r.guest_count) FILTER (WHERE r.status = 'going'), 0) AS committed_seats,
    ROUND(COALESCE(SUM(
        (1 + r.guest_count) *
        CASE
            WHEN ar.user_id IS NULL OR ar.is_provisional THEN 0.75
            ELSE ar.score / 100.0
        END
    ) FILTER (WHERE r.status = 'going'), 0), 1)                      AS expected_headcount,
    COUNT(*) FILTER (WHERE r.status = 'waitlisted')                  AS waitlist_count
FROM events e
LEFT JOIN rsvps r ON r.event_id = e.id
LEFT JOIN attendee_reliability ar ON ar.user_id = r.user_id
GROUP BY e.id, e.capacity;

-- Guest trust signal: how many of MY connections (1st degree) and
-- friends-of-friends (2nd degree) have attended this host's past events.
-- Parameterized as a function because it depends on the viewer.
CREATE FUNCTION mutual_attendance_signal(viewer_id uuid, target_host_id uuid)
RETURNS TABLE (degree smallint, people integer, sample_user_ids uuid[])
LANGUAGE sql STABLE AS $$
    WITH first_degree AS (
        SELECT peer_id FROM connection_edges WHERE user_id = viewer_id
    ),
    second_degree AS (
        SELECT DISTINCT ce.peer_id
        FROM connection_edges ce
        JOIN first_degree fd ON ce.user_id = fd.peer_id
        WHERE ce.peer_id <> viewer_id
          AND ce.peer_id NOT IN (SELECT peer_id FROM first_degree)
    ),
    host_attendees AS (
        SELECT DISTINCT a.user_id
        FROM attendance a
        JOIN events e ON e.id = a.event_id
        JOIN user_privacy_settings ps ON ps.user_id = a.user_id
        WHERE e.host_id = target_host_id
          AND a.outcome = 'attended'
          AND ps.surface_as_mutual = true
          AND NOT EXISTS (
              SELECT 1 FROM user_blocks b
              WHERE (b.blocker_id = a.user_id AND b.blocked_id = viewer_id)
                 OR (b.blocker_id = viewer_id AND b.blocked_id = a.user_id)
          )
    )
    SELECT 1::smallint, COUNT(*)::integer,
           (ARRAY_AGG(ha.user_id ORDER BY ha.user_id))[1:3]
      FROM host_attendees ha WHERE ha.user_id IN (SELECT peer_id FROM first_degree)
    UNION ALL
    SELECT 2::smallint, COUNT(*)::integer,
           (ARRAY_AGG(ha.user_id ORDER BY ha.user_id))[1:3]
      FROM host_attendees ha WHERE ha.user_id IN (SELECT peer_id FROM second_degree);
$$;

-- ============================================================================
-- NOTES / OPEN QUESTIONS
-- ============================================================================
-- 1. Notice threshold. "Cancelled with notice" is currently a business-logic
--    constant compared against rsvp_status_events.hours_before_event (24h is a
--    reasonable start). If it needs to vary per event, add
--    events.cancellation_notice_hours and read it at scoring time.
--
-- 2. Score recomputation. Recompute attendee_reliability and host_reputation
--    on a nightly job plus on-write after attendance is recorded. Both tables
--    are caches — truncate and rebuild from rsvp_status_events + attendance.
--
-- 3. Waitlist promotion — implemented.
--    Implemented via the `promote_waitlist_on_cancel()` function and
--    `promote_waitlist_after_cancel` trigger. When a 'going' RSVP is
--    cancelled the trigger locks the event row, checks capacity and
--    `events.waitlist_reliability_floor`, promotes the lowest
--    eligible `waitlisted` RSVP (sets status -> 'going'), inserts an
--    `rsvp_status_events` row with `changed_by = NULL`, and shifts
--    remaining waitlist positions — all within one transaction.
--
-- 4. Recurring events — implemented.
--    The `event_series` table and `events.series_id` support series-level
--    identity for recurring events (e.g. monthly gatherings). Use
--    `event_series.id` to group occurrences and to add series-level
--    metadata or reputation later. Indexing for series-level queries is
--    covered in note 7.
--
-- 5. Capacity enforcement. Deliberately NOT a CHECK constraint, since it spans
--    rows. Enforce with SELECT ... FOR UPDATE on the event row inside the RSVP
--    transaction, or a trigger — never in application code alone.
--
-- 6. Geo search. lat/lng + btree is fine to start. If "events near me" becomes
--    a primary browse path, move to PostGIS geography(Point) with a GiST index.
--
-- 7. Series-level query indexing — implemented.
--    `events_series_idx (series_id, starts_at) WHERE series_id IS NOT NULL`
--    serves the series-page read ("every occurrence of this series, in
--    order") as an index-only scan instead of a sort; it's partial because
--    most events aren't part of a series. `event_series_host_idx (host_id)`
--    serves "series run by this host" for a host's series-management page.
--    If a series detail page later needs per-series attendance/reliability
--    rollups, that's a new derived read model (see note 2's pattern), not a
--    column on event_series.
--
-- 8. Attendance finalization — implemented.
--    Nothing auto-marks a no-show; a 'going' RSVP with no `attendance` row
--    is just unreviewed. `events.attendance_finalized_at` /
--    `_finalized_by` mark the point where a host has walked the full
--    checklist (`event_attendance_checklist`) and signed off.
--    `events_check_attendance_finalization` blocks setting that timestamp
--    while any RSVP is still unreviewed; `attendance_unfinalize_on_change`
--    clears it automatically if attendance is edited afterward, so a host
--    always has to re-confirm after a real change. `attendance_skip_noop_update`
--    keeps a re-save of the same checklist screen from being treated as an
--    edit. A worker should poll `events_awaiting_attendance_review_idx`
--    (ended, unfinalized, not cancelled) to notify the host it's time to
--    review — note 2's nightly score recompute should only touch events
--    where `attendance_finalized_at IS NOT NULL`.
-- ============================================================================
