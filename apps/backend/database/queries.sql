-- ============================================================================
-- GATHER — the SQL behind each endpoint
--
-- Reference, not a script. Nothing here runs as part of setup; it documents the
-- statements the API actually issues so you can read the data layer without
-- reading the controllers, and run any of them by hand in psql to see what an
-- endpoint sees.
--
-- Two of these — listEvents and the count that pairs with it — are written as
-- raw SQL in server/controllers/eventController.js. The rest are what Prisma
-- generates from the model calls; the controller each one belongs to is noted
-- above it.
--
-- $1, $2 ... are BOUND PARAMETERS, never string interpolation. Every value
-- below that came from a user arrives this way. See the note at the bottom.
--
-- Try any of these:
--   npm run db:psql          then paste, substituting real values for $1
-- ============================================================================


-- ============================================================================
-- READ
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GET /api/events        eventController.listEvents
--
-- The main browse query, and the one that satisfies the JOIN requirement. One
-- statement pulls the event, its host, the host's cached reputation, the
-- category, and live RSVP counts — four JOINs and an aggregate, rather than
-- fetching events and then querying each one's RSVPs in a loop.
--
-- FILTER lets us count 'going' and 'waitlisted' separately in a single pass
-- instead of running two more queries.
-- ----------------------------------------------------------------------------
SELECT
    e.id,
    e.title,
    e.slug,
    e.starts_at,
    e.city,
    e.capacity,
    e.status,
    u.handle                                                AS host_handle,
    u.display_name                                          AS host_display_name,
    c.slug                                                  AS category_slug,
    COALESCE(hr.score, 0)::float8                           AS host_rating,
    COUNT(r.id) FILTER (WHERE r.status = 'going')::int       AS going_count,
    COUNT(r.id) FILTER (WHERE r.status = 'waitlisted')::int  AS waitlist_count
FROM events e
JOIN      users           u  ON u.id       = e.host_id
LEFT JOIN categories      c  ON c.id       = e.category_id
LEFT JOIN host_reputation hr ON hr.user_id = e.host_id
LEFT JOIN rsvps           r  ON r.event_id = e.id
WHERE e.status = 'published'
  AND e.visibility = 'public'
  AND e.starts_at >= now()
GROUP BY e.id, u.id, c.slug, hr.score
ORDER BY e.starts_at ASC
LIMIT 20 OFFSET 0;


-- Search by title or description. ILIKE is case-insensitive; the wildcards are
-- part of the BOUND VALUE ('%potluck%'), not concatenated into the SQL.
SELECT e.id, e.title
FROM events e
WHERE e.status = 'published'
  AND (e.title ILIKE $1 OR e.description ILIKE $1)
ORDER BY e.starts_at ASC;


-- Filter by category slug.
SELECT e.id, e.title, c.name AS category_name
FROM events e
JOIN categories c ON c.id = e.category_id
WHERE e.status = 'published'
  AND c.slug = $1
ORDER BY e.starts_at ASC;


-- ?mine=true — a host's own events, in any state. No status or visibility
-- filter, because drafts are exactly what this view exists to show. Scoped to
-- the signed-in user; there is deliberately no host_id parameter exposed to
-- the client.
SELECT e.id, e.title, e.status, e.visibility, e.starts_at
FROM events e
WHERE e.host_id = $1::uuid
ORDER BY e.starts_at ASC;


-- The paired count, so pagination reports the real total rather than the page
-- size. DISTINCT because the join to rsvps multiplies rows.
SELECT COUNT(DISTINCT e.id)::int AS total
FROM events e
JOIN      users      u ON u.id = e.host_id
LEFT JOIN rsvps      r ON r.event_id = e.id
WHERE e.status = 'published' AND e.visibility = 'public';


-- ----------------------------------------------------------------------------
-- GET /api/events/:id    eventController.getEvent
-- ----------------------------------------------------------------------------
SELECT
    e.*,
    u.handle       AS host_handle,
    u.display_name AS host_display_name,
    c.name         AS category_name
FROM events e
JOIN      users      u ON u.id = e.host_id
LEFT JOIN categories c ON c.id = e.category_id
WHERE e.id = $1;


-- Its attendee list. Anyone whose privacy setting is 'nobody' is counted but
-- not named — the headcount stays honest without exposing them.
SELECT
    u.handle,
    u.display_name,
    r.guest_count,
    COALESCE(ar.band, 'unrated') AS reliability_band
FROM rsvps r
JOIN      users                u   ON u.id       = r.user_id
LEFT JOIN user_privacy_settings ps ON ps.user_id = u.id
LEFT JOIN attendee_reliability  ar ON ar.user_id = u.id
WHERE r.event_id = $1
  AND r.status = 'going'
  AND COALESCE(ps.attendee_visibility, 'connections_and_mutuals') <> 'nobody'
ORDER BY r.created_at ASC;


-- ----------------------------------------------------------------------------
-- GET /api/me/rsvps      rsvpController.listMyRsvps
-- Always the current user. No id in the URL, so there is no way to read
-- someone else's schedule by guessing a UUID.
-- ----------------------------------------------------------------------------
SELECT
    r.status,
    r.guest_count,
    e.title,
    e.starts_at,
    e.city,
    u.display_name AS host_name
FROM rsvps r
JOIN events e ON e.id = r.event_id
JOIN users  u ON u.id = e.host_id
WHERE r.user_id = $1
ORDER BY e.starts_at ASC;


-- ============================================================================
-- CREATE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- POST /api/auth/signup  authController.signup
-- The hash is computed by bcrypt in Node; the plaintext password never reaches
-- the database.
-- ----------------------------------------------------------------------------
INSERT INTO users (handle, email, password_hash, display_name, updated_at)
VALUES ($1, $2, $3, $4, now())
RETURNING id, handle, email, display_name;


-- ----------------------------------------------------------------------------
-- POST /api/events       eventController.createEvent
-- host_id comes from the verified JWT, never from the request body — otherwise
-- anyone could create events in someone else's name.
-- ----------------------------------------------------------------------------
INSERT INTO events (
    host_id, category_id, title, slug, description,
    starts_at, ends_at, timezone, capacity, visibility, status, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
RETURNING *;


-- ----------------------------------------------------------------------------
-- POST /api/events/:id/rsvp    rsvpController.createOrUpdateRsvp
--
-- Two statements in ONE transaction. rsvps holds current state and
-- rsvp_status_events records how it got there; if only one landed, the ledger
-- would disagree with the row and the reliability score built from it would be
-- wrong.
-- ----------------------------------------------------------------------------
BEGIN;

INSERT INTO rsvps (event_id, user_id, status, guest_count, updated_at)
VALUES ($1, $2, $3, $4, now())
RETURNING id;

INSERT INTO rsvp_status_events (
    rsvp_id, event_id, actor_id, from_status, to_status,
    hours_before_event, event_starts_at_snapshot
)
VALUES ($1, $2, $3, NULL, $4, $5, $6);

COMMIT;


-- Next waitlist position for an event. Read inside the same transaction so two
-- simultaneous RSVPs can't both claim position 3 — and if they somehow did,
-- the partial unique index rsvps_waitlist_order_idx rejects the second.
SELECT COALESCE(MAX(waitlist_position), 0) + 1 AS next_position
FROM rsvps
WHERE event_id = $1 AND status = 'waitlisted';


-- ============================================================================
-- UPDATE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PUT /api/events/:id    eventController.updateEvent
-- Only the fields that were sent. host_id is deliberately absent: transferring
-- ownership is not something a plain edit should be able to do, even for the
-- real host.
-- ----------------------------------------------------------------------------
UPDATE events
SET title       = $2,
    description = $3,
    starts_at   = $4,
    ends_at     = $5,
    capacity    = $6,
    visibility  = $7,
    updated_at  = now()
WHERE id = $1
RETURNING *;


-- Publishing a draft. published_at is stamped here rather than defaulted, so
-- "when did this go live" stays answerable.
UPDATE events
SET status       = 'published',
    published_at = now(),
    updated_at   = now()
WHERE id = $1 AND host_id = $2
RETURNING id, title, status;


-- Cancelling an event. The events_cancelled_has_time CHECK requires
-- cancelled_at whenever status is 'cancelled', so both move together.
UPDATE events
SET status              = 'cancelled',
    cancelled_at        = now(),
    cancellation_reason = $2,
    updated_at          = now()
WHERE id = $1;


-- ----------------------------------------------------------------------------
-- DELETE /api/events/:id/rsvp   rsvpController.cancelRsvp
-- Cancelling never deletes the row. The history is the point: how much notice
-- someone gave is what separates "told the host" from "ghosted", and that
-- feeds their reliability score.
-- ----------------------------------------------------------------------------
UPDATE rsvps
SET status            = 'cancelled',
    cancelled_at      = now(),
    status_changed_at = now(),
    waitlist_position = NULL,
    updated_at        = now()
WHERE event_id = $1 AND user_id = $2
RETURNING id;


-- Promoting the next person off the waitlist after a cancellation, subject to
-- the host's reliability floor.
UPDATE rsvps
SET status            = 'going',
    waitlist_position = NULL,
    promoted_at       = now(),
    status_changed_at = now(),
    updated_at        = now()
WHERE id = (
    SELECT r.id
    FROM rsvps r
    LEFT JOIN attendee_reliability ar ON ar.user_id = r.user_id
    WHERE r.event_id = $1
      AND r.status = 'waitlisted'
      AND COALESCE(ar.score, 1.00) >= $2
    ORDER BY r.waitlist_position ASC
    LIMIT 1
)
RETURNING id, user_id;


-- ----------------------------------------------------------------------------
-- POST /api/events/:id/attendance   rsvpController.markAttendance
-- Upsert, so re-marking corrects the record instead of creating a duplicate.
-- ----------------------------------------------------------------------------
INSERT INTO attendance (event_id, user_id, rsvp_id, outcome, method, marked_by_id)
VALUES ($1, $2, $3, $4, 'host_marked', $5)
ON CONFLICT (event_id, user_id)
DO UPDATE SET outcome      = EXCLUDED.outcome,
              marked_by_id = EXCLUDED.marked_by_id,
              marked_at    = now();


-- ----------------------------------------------------------------------------
-- Rebuilding a reliability score from the ledgers.
--
-- Runs after attendance changes. attendee_reliability is a CACHE — truncate it
-- and re-run this for every user and you get identical numbers back, because
-- nothing here reads the old value.
--
--   attended            full credit
--   no_show             zero credit
--   cancelled late      half credit (you told someone, just too late)
--   cancelled w/ notice excluded entirely
--   excused             excluded entirely
-- ----------------------------------------------------------------------------
UPDATE attendee_reliability ar
SET score = sub.score,
    attended_count = sub.attended,
    no_show_count  = sub.no_shows,
    band = CASE
             WHEN sub.graded = 0    THEN 'unrated'
             WHEN sub.score >= 0.9  THEN 'excellent'
             WHEN sub.score >= 0.75 THEN 'good'
             WHEN sub.score >= 0.5  THEN 'mixed'
             ELSE 'unreliable'
           END,
    computed_at = now()
FROM (
    SELECT
        a.user_id,
        COUNT(*) FILTER (WHERE a.outcome = 'attended') AS attended,
        COUNT(*) FILTER (WHERE a.outcome = 'no_show')  AS no_shows,
        COUNT(*) FILTER (WHERE a.outcome IN ('attended', 'no_show')) AS graded,
        CASE
          WHEN COUNT(*) FILTER (WHERE a.outcome IN ('attended', 'no_show')) = 0 THEN 1.00
          ELSE ROUND(
                 COUNT(*) FILTER (WHERE a.outcome = 'attended')::numeric
                 / COUNT(*) FILTER (WHERE a.outcome IN ('attended', 'no_show')), 2)
        END AS score
    FROM attendance a
    WHERE a.user_id = $1
    GROUP BY a.user_id
) sub
WHERE ar.user_id = sub.user_id;


-- ============================================================================
-- DELETE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DELETE /api/events/:id    eventController.deleteEvent
--
-- A real delete, guarded by ownership in the WHERE clause as well as by
-- middleware. Two checks rather than one: if the authorization layer is ever
-- refactored, the statement itself still refuses to touch someone else's row.
--
-- Child rows (rsvps, tags, cohosts, the status ledger) go with it via
-- ON DELETE CASCADE on their foreign keys — see schema.sql.
-- ----------------------------------------------------------------------------
DELETE FROM events
WHERE id = $1 AND host_id = $2;


-- Removing a tag from an event.
DELETE FROM event_tags
WHERE event_id = $1 AND tag = $2;


-- Withdrawing a report before a moderator has acted on it. Resolved reports
-- are not deletable — the record of what was decided has to survive.
DELETE FROM reports
WHERE id = $1 AND reporter_id = $2 AND resolved_at IS NULL;


-- Full reset for local development. Truncating the four roots cascades to
-- everything else through the foreign keys.
TRUNCATE users, categories, badges, event_series RESTART IDENTITY CASCADE;


-- ============================================================================
-- ON PARAMETERIZATION
--
-- Every statement above uses $1, $2 … placeholders. Values are sent separately
-- from the SQL text, so the database parses the statement first and treats the
-- values as data — a value containing "'; DROP TABLE events; --" is stored as
-- that literal string rather than executed.
--
-- In the code:
--
--   -- correct: Prisma's tagged template binds the value
--   prisma.$queryRaw`SELECT * FROM events WHERE id = ${id}`
--
--   -- wrong: this concatenates into the SQL string
--   prisma.$queryRawUnsafe(`SELECT * FROM events WHERE id = ${id}`)
--
-- ORDER BY is the exception — a column name can't be a bound parameter — so
-- sort keys come from a fixed whitelist in eventController.js (SORT_OPTIONS)
-- and anything not on it is rejected with a 400 before a query runs.
-- ============================================================================
