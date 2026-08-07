-- ============================================================================
-- GATHER — seed data (raw SQL path)
--
-- Produces the SAME database as `npm run db:seed` (prisma/seed.js). If you
-- change one, change the other — or the two setup paths drift apart, which is
-- exactly the bug this file was rewritten to fix.
--
-- Design rule this file follows, matching the schema:
--   Scores are DERIVED. Nothing here hardcodes a reliability or reputation
--   number. We write the LEDGERS (rsvp_status_events, attendance, host_ratings)
--   and then compute attendee_reliability and host_reputation from them at the
--   very end — the same way the real app will. Delete those two tables, re-run
--   the final section, and you get identical numbers back.
--
-- The data is deliberately messy in useful ways: someone who always shows up,
-- someone who cancels late, someone who ghosts, a full event with a waitlist,
-- a cancelled event, a draft. That's what makes the scoring visible.
--
-- Every timestamp is relative to now(), so the seed never goes stale — the
-- "upcoming" events are always upcoming, no matter when you run it.
--
-- Rows are inserted by natural key (handle, slug) and looked up with
-- subqueries rather than hardcoded UUIDs, so this file can be re-run without
-- editing a single id.
--
-- Run with:  npm run sql:seed        (after: npm run sql:schema)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- WIPE
-- Truncating the four roots cascades to everything else via the foreign keys.
-- ----------------------------------------------------------------------------
TRUNCATE users, categories, badges, event_series RESTART IDENTITY CASCADE;

-- ============================================================================
-- REFERENCE DATA
-- ============================================================================

INSERT INTO categories (slug, name, sort_order) VALUES
    ('food',     'Food & Drink',    1),
    ('outdoors', 'Outdoors',        2),
    ('games',    'Games',           3),
    ('making',   'Making & Crafts', 4),
    ('music',    'Music',           5),
    ('learning', 'Learning',        6);

INSERT INTO badges (slug, name, description) VALUES
    ('founding-member', 'Founding Member', 'Joined in the first month.'),
    ('always-shows-up', 'Always Shows Up', 'Ten RSVPs, zero no-shows.'),
    ('good-host',       'Good Host',       'Hosted five events rated 4.5 or higher.'),
    ('connector',       'Connector',       'Brought ten people to their first event.'),
    ('regular',         'Regular',         'Attended the same series five times.');

-- ============================================================================
-- PEOPLE
--
-- Handles must match ^[a-z0-9_]{3,30}$ — the users_handle_format CHECK
-- enforces it, so a bad handle fails loudly here rather than silently later.
--
-- All twelve accounts share one password so you can log in as anyone during a
-- demo:  gather-demo-2026
-- The hash below is bcrypt cost 12, the same cost the signup endpoint uses.
-- This is seed data for a local/dev database only — real accounts get their
-- hash from POST /api/auth/signup.
--
-- Join dates are staggered 12 days apart so "founding member" means something.
-- ============================================================================

INSERT INTO users (
    handle, email, password_hash, last_login_at, display_name, bio,
    home_city, home_lat, home_lng, joined_at, email_verified_at, updated_at
)
SELECT
    p.handle,
    p.handle || '@example.com',
    '$2a$12$2lqGVr7A8auIjqOgT9Wezek/V9eiWZhaevQnVfbuL23KNQhNIW0yi',
    now() - interval '2 days',
    p.display_name,
    p.bio,
    p.city,
    p.lat,
    p.lng,
    now() - make_interval(days => 300 - p.i * 12),
    now() - make_interval(days => 299 - p.i * 12),
    now()
FROM (VALUES
    (0,  'maya_ortiz',    'Maya Ortiz',     'Columbus',  39.9612, -82.9988, 'Runs a monthly potluck. Will feed you.'),
    (1,  'devon_park',    'Devon Park',     'Columbus',  39.98,   -83.004,  'Board games, mostly co-op.'),
    (2,  'sam_reyes',     'Sam Reyes',      'Columbus',  39.953,  -83.01,   'Trail runner. Slow but consistent.'),
    (3,  'kira_nakamura', 'Kira Nakamura',  'Columbus',  40.01,   -83.02,   'Ceramics and bad puns.'),
    (4,  'theo_bright',   'Theo Bright',    'Columbus',  39.97,   -82.99,   NULL),
    (5,  'priya_shah',    'Priya Shah',     'Columbus',  39.99,   -83.03,   'Learning bass. Apologies in advance.'),
    (6,  'lena_fox',      'Lena Fox',       'Columbus',  39.965,  -83.015,  NULL),
    (7,  'amir_haddad',   'Amir Haddad',    'Columbus',  39.975,  -82.985,  NULL),
    (8,  'nina_castro',   'Nina Castro',    'Cleveland', 41.4993, -81.6944, 'Visiting often enough to count.'),
    (9,  'jonah_webb',    'Jonah Webb',     'Columbus',  39.958,  -83.005,  NULL),
    (10, 'ruth_okafor',   'Ruth Okafor',    'Columbus',  40.005,  -83.012,  'Here for the snacks and the people.'),
    (11, 'cal_dunn',      'Cal Dunn',       'Columbus',  39.962,  -82.995,  NULL)
) AS p(i, handle, display_name, city, lat, lng, bio);

-- A couple of people are more private than the default, so the privacy code
-- has something real to branch on.
INSERT INTO user_privacy_settings (
    user_id, attendee_visibility, surface_as_mutual,
    show_reliability_to_hosts, discoverable_by_handle, updated_at
)
SELECT
    u.id,
    CASE u.handle
        WHEN 'nina_castro' THEN 'host_only'::attendee_visibility
        WHEN 'cal_dunn'    THEN 'nobody'::attendee_visibility
        ELSE 'connections_and_mutuals'::attendee_visibility
    END,
    u.handle <> 'cal_dunn',
    u.handle <> 'jonah_webb',
    true,
    now()
FROM users u;

-- ============================================================================
-- SOCIAL GRAPH
--
-- connections stores ONE row per pair, canonically ordered (user_low <
-- user_high) — the connections_canonical_order CHECK makes a reversed
-- duplicate impossible. LEAST/GREATEST on the two uuids does the ordering.
-- ============================================================================

INSERT INTO connections (user_low, user_high, requested_by, status, requested_at, accepted_at)
SELECT
    LEAST(a.id, b.id),
    GREATEST(a.id, b.id),
    a.id,
    'accepted',
    now() - interval '120 days',
    -- connections_accepted_has_time CHECK: accepted rows must carry a time.
    now() - interval '119 days'
FROM (VALUES
    ('maya_ortiz',    'devon_park'),
    ('maya_ortiz',    'sam_reyes'),
    ('maya_ortiz',    'kira_nakamura'),
    ('maya_ortiz',    'ruth_okafor'),
    ('devon_park',    'theo_bright'),
    ('devon_park',    'priya_shah'),
    ('sam_reyes',     'lena_fox'),
    ('sam_reyes',     'amir_haddad'),
    ('kira_nakamura', 'priya_shah'),
    ('kira_nakamura', 'jonah_webb'),
    ('theo_bright',   'nina_castro'),
    ('priya_shah',    'ruth_okafor'),
    ('lena_fox',      'cal_dunn'),
    ('amir_haddad',   'jonah_webb'),
    ('ruth_okafor',   'nina_castro')
) AS f(requester, other)
JOIN users a ON a.handle = f.requester
JOIN users b ON b.handle = f.other;

INSERT INTO connections (user_low, user_high, requested_by, status, requested_at)
SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), a.id, 'pending', now() - interval '4 days'
FROM (VALUES
    ('theo_bright', 'sam_reyes'),
    ('cal_dunn',    'maya_ortiz')
) AS f(requester, other)
JOIN users a ON a.handle = f.requester
JOIN users b ON b.handle = f.other;

-- One safety edge. Blocks are directed and survive independently of friendship
-- state, which is why they live in their own table.
INSERT INTO user_blocks (blocker_id, blocked_id, reason, created_at)
SELECT a.id, b.id, 'Repeated unwanted messages after an event.', now() - interval '30 days'
FROM users a, users b
WHERE a.handle = 'lena_fox' AND b.handle = 'jonah_webb';

-- ============================================================================
-- EVENTS
-- ============================================================================

INSERT INTO event_series (host_id, title, slug, description, cadence, created_at)
SELECT u.id, s.title, s.slug, s.description, s.cadence, now() - make_interval(days => s.age)
FROM (VALUES
    ('maya_ortiz', 'Third Thursday Potluck', 'third-thursday-potluck',
     'Bring a dish, bring a friend. Same living room every month.', 'monthly',  250),
    ('devon_park', 'Co-op Game Night',       'co-op-game-night',
     'Nobody loses alone.',                                          'biweekly', 180)
) AS s(host, title, slug, description, cadence, age)
JOIN users u ON u.handle = s.host;

-- Twelve events covering every state the UI has to handle: four completed
-- (these are what the ledgers get built from), six upcoming, one cancelled,
-- one still a draft.
INSERT INTO events (
    host_id, series_id, category_id, title, slug, description,
    starts_at, ends_at, timezone, rsvp_closes_at,
    is_online, online_url, place_name, address_line1, city, region, country_code,
    lat, lng, hide_exact_address_until_rsvp,
    capacity, allow_waitlist, allow_guests, max_guests_per_rsvp,
    waitlist_reliability_floor, visibility, status,
    published_at, cancelled_at, cancellation_reason, completed_at,
    created_at, updated_at
)
SELECT
    h.id,
    s.id,
    c.id,
    d.title,
    d.slug,
    d.description,
    now() + make_interval(days => d.days_out),
    now() + make_interval(days => d.days_out) + make_interval(hours => d.hours),
    'America/New_York',
    -- events_rsvp_before_start CHECK: must be <= starts_at.
    now() + make_interval(days => d.days_out) - interval '12 hours',
    d.is_online,
    d.online_url,
    d.place_name,
    d.address_line1,
    'Columbus',
    'OH',
    'US',
    d.lat,
    d.lng,
    d.hide_address,
    d.capacity,
    true,
    d.allow_guests,
    d.max_guests,
    d.waitlist_floor,
    d.visibility::event_visibility,
    d.status::event_status,
    CASE WHEN d.status = 'draft' THEN NULL ELSE now() - interval '70 days' END,
    -- events_cancelled_has_time CHECK: cancelled rows must carry a time.
    CASE WHEN d.status = 'cancelled' THEN now() - interval '2 days' END,
    d.cancellation_reason,
    CASE WHEN d.status = 'completed'
         THEN now() + make_interval(days => d.days_out) + make_interval(hours => d.hours) END,
    now() - interval '70 days',
    now()
FROM (VALUES
    -- ---- PAST, COMPLETED. The ledgers below are built from these. ----------
    ('third-thursday-potluck-march', 'maya_ortiz', 'third-thursday-potluck', 'food',
     'Third Thursday Potluck — March', 'Soup theme. Someone please bring bread.',
     -60, 3, false, NULL, 'Maya''s place', '418 Hamlet St', 39.9612, -82.9988,
     true, 12, false, 0, 0.00, 'public', 'completed', NULL),

    ('saturday-trail-run-highbanks', 'sam_reyes', NULL, 'outdoors',
     'Saturday Trail Run — Highbanks', 'Five miles, conversational pace. Nobody gets dropped.',
     -45, 2, false, NULL, 'Highbanks Metro Park', '9466 Columbus Pike', 40.1467, -83.018,
     false, 10, false, 0, 0.00, 'public', 'completed', NULL),

    ('co-op-game-night-spirit-island', 'devon_park', 'co-op-game-night', 'games',
     'Co-op Game Night — Spirit Island', 'Teaching game first, then a full run.',
     -30, 4, false, NULL, 'Devon''s apartment', '77 E 5th Ave, Apt 3', 39.98, -83.004,
     true, 6, false, 0, 0.00, 'public', 'completed', NULL),

    ('intro-to-wheel-throwing', 'kira_nakamura', NULL, 'making',
     'Intro to Wheel Throwing', 'Six wheels, six people. Clay provided.',
     -15, 3, false, NULL, 'Glassaxis Studio', '610 W Town St', 39.956, -83.018,
     true, 6, false, 0, 0.00, 'public', 'completed', NULL),

    -- ---- UPCOMING, PUBLISHED ----------------------------------------------
    ('third-thursday-potluck-summer', 'maya_ortiz', 'third-thursday-potluck', 'food',
     'Third Thursday Potluck — Summer', 'Grill''s working again. Bring something that likes fire.',
     9, 3, false, NULL, 'Maya''s place', '418 Hamlet St', 39.9612, -82.9988,
     true, 12, true, 2, 0.00, 'public', 'published', NULL),

    ('very-casual-open-mic', 'priya_shah', NULL, 'music',
     'Very Casual Open Mic', 'First-timers strongly encouraged. Three-song limit.',
     5, 3, false, NULL, 'Wild Goose Creative', '2491 Summit St', 40.014, -83.0,
     false, 30, false, 0, 0.00, 'public', 'published', NULL),

    -- Deliberately over-subscribed so the waitlist has real rows, and only
    -- reasonably reliable people get auto-promoted off it.
    ('six-seat-dinner-west-african', 'ruth_okafor', NULL, 'food',
     'Six-Seat Dinner: West African Home Cooking', 'Jollof, egusi, plantain. Four seats, no more.',
     12, 3, false, NULL, 'Ruth''s kitchen', '1204 Neil Ave', 40.005, -83.012,
     true, 4, false, 0, 0.70, 'public', 'published', NULL),

    ('co-op-game-night-gloomhaven', 'devon_park', 'co-op-game-night', 'games',
     'Co-op Game Night — Gloomhaven', 'Campaign start. Commit to the whole arc if you can.',
     16, 4, false, NULL, 'Devon''s apartment', '77 E 5th Ave, Apt 3', 39.98, -83.004,
     true, 5, false, 0, 0.00, 'public', 'published', NULL),

    -- events_online_has_url CHECK: an online event must carry a URL.
    ('sql-for-people-who-avoid-sql', 'amir_haddad', NULL, 'learning',
     'SQL for People Who Avoid SQL', 'Two hours, one database, zero judgment.',
     21, 2, true, 'https://meet.example.com/sql-workshop', NULL, NULL, NULL, NULL,
     false, 40, false, 0, 0.00, 'public', 'published', NULL),

    ('theos-birthday-thing', 'theo_bright', NULL, 'food',
     'Theo''s Birthday Thing', 'Low key. Link only.',
     7, 5, false, NULL, 'Backyard', '88 Hudson St', 39.97, -82.99,
     true, 20, false, 0, 0.00, 'unlisted', 'published', NULL),

    -- ---- EDGE CASES the UI needs to handle ---------------------------------
    ('sunrise-hike-hocking-hills', 'sam_reyes', NULL, 'outdoors',
     'Sunrise Hike — Hocking Hills', 'Early start, long drive, worth it.',
     3, 6, false, NULL, 'Old Man''s Cave lot', NULL, 39.43, -82.54,
     true, 8, false, 0, 0.00, 'public', 'cancelled', 'Trail closed after storm damage.'),

    ('park-picnic-planning', 'lena_fox', NULL, 'outdoors',
     'Park Picnic (planning)', 'Still picking a date.',
     40, 4, false, NULL, 'Schiller Park', NULL, 39.945, -82.997,
     true, 25, false, 0, 0.00, 'public', 'draft', NULL)
) AS d(slug, host, series_slug, category_slug, title, description,
       days_out, hours, is_online, online_url, place_name, address_line1, lat, lng,
       hide_address, capacity, allow_guests, max_guests, waitlist_floor,
       visibility, status, cancellation_reason)
JOIN users h ON h.handle = d.host
LEFT JOIN event_series s ON s.slug = d.series_slug
LEFT JOIN categories c ON c.slug = d.category_slug;

INSERT INTO event_tags (event_id, tag)
SELECT e.id, t.tag
FROM (VALUES
    ('third-thursday-potluck-march',    'potluck'),
    ('third-thursday-potluck-march',    'vegetarian-friendly'),
    ('saturday-trail-run-highbanks',    'running'),
    ('saturday-trail-run-highbanks',    'beginner-welcome'),
    ('co-op-game-night-spirit-island',  'board-games'),
    ('co-op-game-night-spirit-island',  'co-op'),
    ('intro-to-wheel-throwing',         'ceramics'),
    ('intro-to-wheel-throwing',         'hands-on'),
    ('third-thursday-potluck-summer',   'potluck'),
    ('third-thursday-potluck-summer',   'outdoor'),
    ('very-casual-open-mic',            'music'),
    ('very-casual-open-mic',            'beginner-welcome'),
    ('six-seat-dinner-west-african',    'dinner'),
    ('six-seat-dinner-west-african',    'small-group'),
    ('co-op-game-night-gloomhaven',     'board-games'),
    ('co-op-game-night-gloomhaven',     'campaign'),
    ('sql-for-people-who-avoid-sql',    'learning'),
    ('sql-for-people-who-avoid-sql',    'online'),
    ('theos-birthday-thing',            'birthday'),
    ('sunrise-hike-hocking-hills',      'hiking')
) AS t(event_slug, tag)
JOIN events e ON e.slug = t.event_slug;

-- Shared hosting duties.
INSERT INTO event_cohosts (event_id, user_id, can_edit, can_manage_rsvps)
SELECT e.id, u.id, ch.can_edit, true
FROM (VALUES
    ('third-thursday-potluck-summer', 'ruth_okafor',   true),
    ('very-casual-open-mic',          'kira_nakamura', false),
    ('sql-for-people-who-avoid-sql',  'jonah_webb',    true)
) AS ch(event_slug, handle, can_edit)
JOIN events e ON e.slug = ch.event_slug
JOIN users u ON u.handle = ch.handle;

-- ============================================================================
-- RSVPs
--
-- One row per person per event. Status changes mutate this row; the history
-- goes in rsvp_status_events below.
--
-- responded_days_before is relative to the event's start, not to now(), so a
-- past event's RSVPs still land before it happened.
-- ============================================================================

INSERT INTO rsvps (
    event_id, user_id, status, guest_count, waitlist_position,
    first_responded_at, status_changed_at, cancelled_at, note_to_host,
    created_at, updated_at
)
SELECT
    e.id,
    u.id,
    r.status::rsvp_status,
    r.guest_count,
    -- rsvps_waitlist_position CHECK: set if and only if status = 'waitlisted'.
    CASE WHEN r.status = 'waitlisted' THEN r.waitlist_position END,
    e.starts_at - make_interval(days => r.responded_days_before),
    COALESCE(
        e.starts_at - make_interval(hours => r.cancelled_hours_before),
        e.starts_at - make_interval(days => r.responded_days_before)
    ),
    -- rsvps_cancelled_has_time CHECK: cancelled rows must carry a time.
    e.starts_at - make_interval(hours => r.cancelled_hours_before),
    r.note,
    e.starts_at - make_interval(days => r.responded_days_before),
    now()
FROM (VALUES
    -- ---- PAST EVENT 1: potluck. Mostly good, one ghost, two cancels. -------
    ('third-thursday-potluck-march', 'devon_park',    'going',      0, NULL, 14, NULL, NULL),
    ('third-thursday-potluck-march', 'sam_reyes',     'going',      0, NULL, 14, NULL, NULL),
    ('third-thursday-potluck-march', 'kira_nakamura', 'going',      0, NULL, 14, NULL, NULL),
    ('third-thursday-potluck-march', 'ruth_okafor',   'going',      0, NULL, 14, NULL, NULL),
    ('third-thursday-potluck-march', 'priya_shah',    'going',      0, NULL, 14, NULL, NULL),
    ('third-thursday-potluck-march', 'theo_bright',   'going',      0, NULL, 14, NULL, NULL),
    -- Jonah cancelled 6 hours out — inside the notice window.
    ('third-thursday-potluck-march', 'jonah_webb',    'cancelled',  0, NULL, 12,    6, NULL),
    -- Amir cancelled 5 days out — plenty of notice, shouldn't be penalized.
    ('third-thursday-potluck-march', 'amir_haddad',   'cancelled',  0, NULL, 15,  120, NULL),

    -- ---- PAST EVENT 2: trail run -------------------------------------------
    ('saturday-trail-run-highbanks', 'lena_fox',      'going',      0, NULL, 10, NULL, NULL),
    ('saturday-trail-run-highbanks', 'amir_haddad',   'going',      0, NULL, 10, NULL, NULL),
    ('saturday-trail-run-highbanks', 'maya_ortiz',    'going',      0, NULL, 10, NULL, NULL),
    ('saturday-trail-run-highbanks', 'cal_dunn',      'going',      0, NULL, 10, NULL, NULL),
    ('saturday-trail-run-highbanks', 'jonah_webb',    'going',      0, NULL, 10, NULL, NULL),

    -- ---- PAST EVENT 3: game night. One excused absence. ---------------------
    ('co-op-game-night-spirit-island', 'theo_bright', 'going',      0, NULL,  9, NULL, NULL),
    ('co-op-game-night-spirit-island', 'priya_shah',  'going',      0, NULL,  9, NULL, NULL),
    ('co-op-game-night-spirit-island', 'maya_ortiz',  'going',      0, NULL,  9, NULL, NULL),
    ('co-op-game-night-spirit-island', 'nina_castro', 'going',      0, NULL,  9, NULL, NULL),

    -- ---- PAST EVENT 4: ceramics ---------------------------------------------
    ('intro-to-wheel-throwing',      'priya_shah',    'going',      0, NULL,  8, NULL, NULL),
    ('intro-to-wheel-throwing',      'ruth_okafor',   'going',      0, NULL,  8, NULL, NULL),
    ('intro-to-wheel-throwing',      'lena_fox',      'going',      0, NULL,  8, NULL, NULL),
    ('intro-to-wheel-throwing',      'devon_park',    'going',      0, NULL,  8, NULL, NULL),
    ('intro-to-wheel-throwing',      'jonah_webb',    'going',      0, NULL,  8, NULL, NULL),

    -- ---- UPCOMING: potluck, with guests -------------------------------------
    ('third-thursday-potluck-summer', 'devon_park',   'going',      2, NULL,  3, NULL,
     'Bringing my roommate and her partner.'),
    ('third-thursday-potluck-summer', 'kira_nakamura','going',      0, NULL,  3, NULL, NULL),
    ('third-thursday-potluck-summer', 'sam_reyes',    'going',      0, NULL,  3, NULL, NULL),
    ('third-thursday-potluck-summer', 'priya_shah',   'going',      0, NULL,  3, NULL, NULL),

    -- ---- UPCOMING: open mic --------------------------------------------------
    ('very-casual-open-mic',         'kira_nakamura', 'going',      0, NULL,  2, NULL, NULL),
    ('very-casual-open-mic',         'theo_bright',   'going',      0, NULL,  2, NULL, NULL),
    ('very-casual-open-mic',         'ruth_okafor',   'going',      0, NULL,  2, NULL, NULL),
    ('very-casual-open-mic',         'amir_haddad',   'going',      0, NULL,  2, NULL, NULL),
    ('very-casual-open-mic',         'maya_ortiz',    'going',      0, NULL,  2, NULL, NULL),
    -- Declined is an explicit no, which is different from never answering.
    ('very-casual-open-mic',         'cal_dunn',      'declined',   0, NULL,  2, NULL, NULL),

    -- ---- UPCOMING: six-seat dinner. Capacity 4, so a real waitlist. ---------
    ('six-seat-dinner-west-african', 'maya_ortiz',    'going',      0, NULL,  6, NULL, NULL),
    ('six-seat-dinner-west-african', 'priya_shah',    'going',      0, NULL,  6, NULL, NULL),
    ('six-seat-dinner-west-african', 'kira_nakamura', 'going',      0, NULL,  6, NULL, NULL),
    ('six-seat-dinner-west-african', 'lena_fox',      'going',      0, NULL,  6, NULL, NULL),
    -- Positions are unique per event — enforced by rsvps_waitlist_order_idx,
    -- a partial UNIQUE index that only applies to waitlisted rows.
    ('six-seat-dinner-west-african', 'devon_park',    'waitlisted', 0,    1,  5, NULL, NULL),
    ('six-seat-dinner-west-african', 'sam_reyes',     'waitlisted', 0,    2,  5, NULL, NULL),
    ('six-seat-dinner-west-african', 'jonah_webb',    'waitlisted', 0,    3,  5, NULL, NULL),

    -- ---- UPCOMING: the rest ---------------------------------------------------
    ('co-op-game-night-gloomhaven',  'theo_bright',   'going',      0, NULL,  8, NULL, NULL),
    ('co-op-game-night-gloomhaven',  'priya_shah',    'going',      0, NULL,  8, NULL, NULL),
    ('co-op-game-night-gloomhaven',  'maya_ortiz',    'going',      0, NULL,  8, NULL, NULL),

    ('sql-for-people-who-avoid-sql', 'jonah_webb',    'going',      0, NULL, 11, NULL, NULL),
    ('sql-for-people-who-avoid-sql', 'ruth_okafor',   'going',      0, NULL, 11, NULL, NULL),
    ('sql-for-people-who-avoid-sql', 'lena_fox',      'going',      0, NULL, 11, NULL, NULL),
    ('sql-for-people-who-avoid-sql', 'nina_castro',   'going',      0, NULL, 11, NULL, NULL),
    ('sql-for-people-who-avoid-sql', 'cal_dunn',      'going',      0, NULL, 11, NULL, NULL),

    ('theos-birthday-thing',         'devon_park',    'going',      0, NULL,  4, NULL, NULL),
    ('theos-birthday-thing',         'nina_castro',   'going',      0, NULL,  4, NULL, NULL),
    ('theos-birthday-thing',         'sam_reyes',     'going',      0, NULL,  4, NULL, NULL),

    -- The cancelled hike still has RSVPs — the event died, not the intent.
    -- Nobody is penalized for a host cancellation.
    ('sunrise-hike-hocking-hills',   'lena_fox',      'going',      0, NULL,  9, NULL, NULL),
    ('sunrise-hike-hocking-hills',   'amir_haddad',   'going',      0, NULL,  9, NULL, NULL),
    ('sunrise-hike-hocking-hills',   'maya_ortiz',    'going',      0, NULL,  9, NULL, NULL)
) AS r(event_slug, handle, status, guest_count, waitlist_position,
       responded_days_before, cancelled_hours_before, note)
JOIN events e ON e.slug = r.event_slug
JOIN users u ON u.handle = r.handle;

-- ============================================================================
-- THE LEDGER  (rsvp_status_events)
--
-- APPEND-ONLY, and the table attendee_reliability is computed from. Rather
-- than hand-writing a row per RSVP, both inserts below DERIVE the ledger from
-- the rsvps table — which is the same thing the API does on every status
-- change, and means the two can't disagree.
--
-- hours_before_event is SNAPSHOTTED here rather than computed at read time, so
-- a later edit to the event's start time cannot retroactively change someone's
-- score.
-- ============================================================================

-- Row 1 of 2: the original response. Every RSVP gets one.
INSERT INTO rsvp_status_events (
    rsvp_id, event_id, actor_id, from_status, to_status,
    hours_before_event, event_starts_at_snapshot, created_at
)
SELECT
    r.id,
    r.event_id,
    r.user_id,
    NULL,
    -- A cancelled RSVP was a 'going' RSVP first — that's what row 1 records.
    CASE WHEN r.status = 'cancelled' THEN 'going'::rsvp_status ELSE r.status END,
    round((EXTRACT(EPOCH FROM (e.starts_at - r.first_responded_at)) / 3600.0)::numeric, 2),
    e.starts_at,
    r.first_responded_at
FROM rsvps r
JOIN events e ON e.id = r.event_id;

-- Row 2 of 2: the cancellation, for the RSVPs that have one. This is the row
-- that makes "gave notice" vs "ghosted" answerable from data.
INSERT INTO rsvp_status_events (
    rsvp_id, event_id, actor_id, from_status, to_status,
    hours_before_event, event_starts_at_snapshot, reason, created_at
)
SELECT
    r.id,
    r.event_id,
    r.user_id,
    'going',
    'cancelled',
    round((EXTRACT(EPOCH FROM (e.starts_at - r.cancelled_at)) / 3600.0)::numeric, 2),
    e.starts_at,
    CASE
        WHEN EXTRACT(EPOCH FROM (e.starts_at - r.cancelled_at)) / 3600.0 >= 48
            THEN 'Something came up — sorry, giving as much notice as I can.'
        ELSE 'Can''t make it.'
    END,
    r.cancelled_at
FROM rsvps r
JOIN events e ON e.id = r.event_id
WHERE r.status = 'cancelled';

-- ============================================================================
-- ATTENDANCE  (the other ledger)
--
-- What actually happened. One row per (event, user), only for events that have
-- already occurred.
-- ============================================================================

INSERT INTO attendance (
    event_id, user_id, rsvp_id, outcome, method, guests_brought,
    checked_in_at, marked_by_id, marked_at, notes
)
SELECT
    e.id,
    u.id,
    r.id,
    a.outcome::attendance_outcome,
    a.method::attendance_method,
    0,
    -- Only people who actually showed up have a check-in time.
    CASE WHEN a.outcome = 'attended' THEN e.starts_at END,
    e.host_id,
    e.starts_at + interval '5 hours',
    a.notes
FROM (VALUES
    -- ---- PAST EVENT 1: potluck ---------------------------------------------
    ('third-thursday-potluck-march',   'devon_park',    'attended', 'host_marked', NULL),
    ('third-thursday-potluck-march',   'sam_reyes',     'attended', 'host_marked', NULL),
    ('third-thursday-potluck-march',   'kira_nakamura', 'attended', 'host_marked', NULL),
    ('third-thursday-potluck-march',   'ruth_okafor',   'attended', 'host_marked', NULL),
    ('third-thursday-potluck-march',   'priya_shah',    'attended', 'host_marked', NULL),
    ('third-thursday-potluck-march',   'theo_bright',   'no_show',  'host_marked', NULL),

    -- ---- PAST EVENT 2: trail run --------------------------------------------
    ('saturday-trail-run-highbanks',   'lena_fox',      'attended', 'self_checkin', NULL),
    ('saturday-trail-run-highbanks',   'amir_haddad',   'attended', 'self_checkin', NULL),
    ('saturday-trail-run-highbanks',   'maya_ortiz',    'attended', 'self_checkin', NULL),
    ('saturday-trail-run-highbanks',   'cal_dunn',      'attended', 'self_checkin', NULL),
    ('saturday-trail-run-highbanks',   'jonah_webb',    'no_show',  'self_checkin', NULL),

    -- ---- PAST EVENT 3: game night. Excused = told the host, host accepted
    --      it. Deliberately NOT a no-show, and excluded from scoring.
    ('co-op-game-night-spirit-island', 'theo_bright',   'attended', 'host_marked', NULL),
    ('co-op-game-night-spirit-island', 'priya_shah',    'attended', 'host_marked', NULL),
    ('co-op-game-night-spirit-island', 'maya_ortiz',    'attended', 'host_marked', NULL),
    ('co-op-game-night-spirit-island', 'nina_castro',   'excused',  'host_marked',
     'Sick — let me know that morning.'),

    -- ---- PAST EVENT 4: ceramics ----------------------------------------------
    ('intro-to-wheel-throwing',        'priya_shah',    'attended', 'qr_scan', NULL),
    ('intro-to-wheel-throwing',        'ruth_okafor',   'attended', 'qr_scan', NULL),
    ('intro-to-wheel-throwing',        'lena_fox',      'attended', 'qr_scan', NULL),
    ('intro-to-wheel-throwing',        'devon_park',    'attended', 'qr_scan', NULL),
    ('intro-to-wheel-throwing',        'jonah_webb',    'no_show',  'qr_scan', NULL)
) AS a(event_slug, handle, outcome, method, notes)
JOIN events e ON e.slug = a.event_slug
JOIN users u ON u.handle = a.handle
JOIN rsvps r ON r.event_id = e.id AND r.user_id = u.id;

-- ============================================================================
-- HOST RATINGS  (the ledger behind host_reputation)
-- ============================================================================

INSERT INTO host_ratings (event_id, host_id, rater_id, rating, comment, created_at)
SELECT e.id, e.host_id, u.id, hr.rating, hr.comment, e.starts_at + interval '1 day'
FROM (VALUES
    ('third-thursday-potluck-march',   'devon_park',    5, 'Maya makes it easy to show up alone.'),
    ('third-thursday-potluck-march',   'sam_reyes',     5, NULL),
    ('third-thursday-potluck-march',   'kira_nakamura', 4, 'Ran a little long, but great.'),
    ('saturday-trail-run-highbanks',   'lena_fox',      5, 'Genuinely nobody got dropped.'),
    ('saturday-trail-run-highbanks',   'amir_haddad',   4, NULL),
    ('saturday-trail-run-highbanks',   'maya_ortiz',    5, NULL),
    ('co-op-game-night-spirit-island', 'theo_bright',   5, 'Best rules explanation I''ve had.'),
    ('co-op-game-night-spirit-island', 'priya_shah',    4, NULL),
    ('intro-to-wheel-throwing',        'priya_shah',    5, NULL),
    ('intro-to-wheel-throwing',        'ruth_okafor',   5, 'Kira is patient with beginners.'),
    ('intro-to-wheel-throwing',        'lena_fox',      3, 'Fun, but the studio was freezing.')
) AS hr(event_slug, handle, rating, comment)
JOIN events e ON e.slug = hr.event_slug
JOIN users u ON u.handle = hr.handle;

-- ============================================================================
-- INVITES, NOTIFICATIONS, BADGES, REPORTS
-- ============================================================================

INSERT INTO event_invites (
    event_id, inviter_id, invitee_id, invitee_email, status, token, message,
    sent_at, responded_at, expires_at
)
SELECT e.id, inviter.id, invitee.id, i.invitee_email, i.status::invite_status, i.token, i.message,
       now() - make_interval(days => i.sent_days_ago),
       CASE WHEN i.responded_days_ago IS NOT NULL
            THEN now() - make_interval(days => i.responded_days_ago) END,
       CASE WHEN i.expires_days_out IS NOT NULL
            THEN now() + make_interval(days => i.expires_days_out) END
FROM (VALUES
    ('theos-birthday-thing',         'theo_bright', 'kira_nakamura', NULL, 'sent',
     'inv_theo_kira_birthday', 'Would love to have you there.', 5, NULL, 7),
    ('six-seat-dinner-west-african', 'ruth_okafor', 'maya_ortiz',    NULL, 'accepted',
     'inv_ruth_maya_dinner',   NULL,                             8,    6, NULL),
    -- Invited by email — this person doesn't have an account yet, which is why
    -- invitee_id is nullable.
    ('very-casual-open-mic',         'priya_shah',  NULL, 'newcomer@example.com', 'sent',
     'inv_priya_email_openmic',
     'You said you wanted to try playing in public. Here''s your chance.', 3, NULL, 5)
) AS i(event_slug, inviter_handle, invitee_handle, invitee_email, status, token, message,
       sent_days_ago, responded_days_ago, expires_days_out)
JOIN events e ON e.slug = i.event_slug
JOIN users inviter ON inviter.handle = i.inviter_handle
LEFT JOIN users invitee ON invitee.handle = i.invitee_handle;

INSERT INTO notifications (user_id, event_id, channel, type, title, body, sent_at, read_at)
SELECT u.id, e.id, n.channel::notification_channel, n.type, n.title, n.body,
       now() - make_interval(days => n.sent_days_ago),
       CASE WHEN n.read_days_ago IS NOT NULL
            THEN now() - make_interval(days => n.read_days_ago) END
FROM (VALUES
    ('devon_park',    'third-thursday-potluck-summer', 'in_app', 'rsvp_confirmed',
     'You''re going to Third Thursday Potluck — Summer',
     'Maya will share the exact address 12 hours before.', 3, 3),
    ('sam_reyes',     'six-seat-dinner-west-african',  'push',   'waitlist_position',
     'You''re #2 on the waitlist', 'We''ll let you know if a seat opens up.', 5, NULL),
    ('lena_fox',      'sunrise-hike-hocking-hills',    'email',  'event_cancelled',
     'Sunrise Hike has been cancelled', 'Trail closed after storm damage.', 2, NULL),
    ('kira_nakamura', 'theos-birthday-thing',          'in_app', 'invite_received',
     'Theo invited you to their birthday', NULL, 5, NULL)
) AS n(handle, event_slug, channel, type, title, body, sent_days_ago, read_days_ago)
JOIN users u ON u.handle = n.handle
JOIN events e ON e.slug = n.event_slug;

-- Absence of a row means "use the app default" — this table is an override
-- list, not a backfilled matrix of every user x type x channel combination.
INSERT INTO notification_preferences (user_id, type, channel, enabled, updated_at)
SELECT u.id, p.type, p.channel::notification_channel, p.enabled, now()
FROM (VALUES
    ('cal_dunn',   'event_reminder',    'push',  false),
    ('cal_dunn',   'event_reminder',    'email', true),
    ('jonah_webb', 'waitlist_position', 'push',  false),
    ('maya_ortiz', 'rsvp_confirmed',    'email', false)
) AS p(handle, type, channel, enabled)
JOIN users u ON u.handle = p.handle;

INSERT INTO user_badges (user_id, badge_id, awarded_at)
SELECT u.id, b.id, now() - make_interval(days => ub.days_ago)
FROM (VALUES
    ('maya_ortiz',  'founding-member', 270),
    ('maya_ortiz',  'good-host',        40),
    ('devon_park',  'founding-member', 260),
    ('priya_shah',  'always-shows-up',  20),
    ('sam_reyes',   'good-host',        35),
    ('ruth_okafor', 'regular',          25)
) AS ub(handle, badge_slug, days_ago)
JOIN users u ON u.handle = ub.handle
JOIN badges b ON b.slug = ub.badge_slug;

-- reports_one_subject CHECK: exactly one subject — a user OR an event, never
-- both, never neither.
INSERT INTO reports (reporter_id, subject_user_id, type, details, created_at)
SELECT r.id, s.id, 'harassment', 'Kept messaging after I asked him to stop.', now() - interval '30 days'
FROM users r, users s
WHERE r.handle = 'lena_fox' AND s.handle = 'jonah_webb';

INSERT INTO reports (reporter_id, subject_event_id, type, details, resolved_at, resolution_note, created_at)
SELECT u.id, e.id, 'spam', 'Description looked like a copy-paste promo.',
       now() - interval '1 day',
       'Reviewed — legitimate community event. No action taken.',
       now() - interval '4 days'
FROM users u, events e
WHERE u.handle = 'cal_dunn' AND e.slug = 'very-casual-open-mic';

-- ============================================================================
-- DERIVED SCORES
--
-- This is the important part. Nothing above wrote a score. Both tables below
-- are computed from the ledgers — exactly what a nightly job (or a post-event
-- hook) would do in production. Truncate them, re-run this section, and you
-- get the same numbers back.
--
-- Weighting for attendee reliability:
--   attended             -> full credit
--   no_show              -> zero credit
--   cancelled late       -> half credit (you told someone, just too late)
--   cancelled w/ notice  -> excluded entirely, neither helps nor hurts
--   excused              -> excluded entirely
--
-- Someone with no graded history scores 1.00 rather than 0.00 — a new account
-- is not "unreliable", it's simply unknown. Their band is 'unrated' rather
-- than 'excellent', because telling a host that an untested person is proven
-- would be a lie the number alone can't correct.
-- ============================================================================

INSERT INTO attendee_reliability (
    user_id, score, rsvp_count, attended_count, no_show_count, excused_count,
    cancelled_with_notice_count, cancelled_late_count, band, computed_at
)
WITH
-- Cancelling with at least 48 hours' notice doesn't count against you.
attended AS (
    SELECT u.id AS user_id,
           count(a.id) FILTER (WHERE a.outcome = 'attended') AS attended_count,
           count(a.id) FILTER (WHERE a.outcome = 'no_show')  AS no_show_count,
           count(a.id) FILTER (WHERE a.outcome = 'excused')  AS excused_count
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id
    GROUP BY u.id
),
-- Cancellations live in the RSVP ledger, not in attendance.
cancels AS (
    SELECT u.id AS user_id,
           count(se.id) FILTER (WHERE se.hours_before_event >= 48) AS with_notice,
           count(se.id) FILTER (WHERE se.hours_before_event <  48) AS late
    FROM users u
    LEFT JOIN rsvp_status_events se
           ON se.actor_id = u.id AND se.to_status = 'cancelled'
    GROUP BY u.id
),
counts AS (
    SELECT u.id AS user_id, count(r.id) AS rsvp_count
    FROM users u
    LEFT JOIN rsvps r ON r.user_id = u.id
    GROUP BY u.id
),
scored AS (
    SELECT
        a.user_id,
        c.rsvp_count,
        a.attended_count,
        a.no_show_count,
        a.excused_count,
        x.with_notice,
        x.late,
        (a.attended_count + a.no_show_count + x.late) AS graded,
        CASE
            WHEN (a.attended_count + a.no_show_count + x.late) = 0 THEN 1.0
            ELSE LEAST(1.0, GREATEST(0.0,
                (a.attended_count + 0.5 * x.late)::numeric
                / (a.attended_count + a.no_show_count + x.late)
            ))
        END AS score
    FROM attended a
    JOIN cancels x ON x.user_id = a.user_id
    JOIN counts  c ON c.user_id = a.user_id
)
SELECT
    user_id,
    round(score, 2),
    rsvp_count,
    attended_count,
    no_show_count,
    excused_count,
    with_notice,
    late,
    CASE
        WHEN graded = 0     THEN 'unrated'
        WHEN score >= 0.9   THEN 'excellent'
        WHEN score >= 0.75  THEN 'good'
        WHEN score >= 0.5   THEN 'mixed'
        ELSE 'unreliable'
    END,
    now()
FROM scored;

-- Only people who have actually hosted get a row.
INSERT INTO host_reputation (
    user_id, score, events_hosted, events_completed, events_cancelled,
    rating_count, computed_at
)
WITH hosted AS (
    SELECT host_id,
           count(*)                                    AS events_hosted,
           count(*) FILTER (WHERE status = 'completed') AS events_completed,
           count(*) FILTER (WHERE status = 'cancelled') AS events_cancelled
    FROM events
    GROUP BY host_id
),
rated AS (
    SELECT host_id, avg(rating)::numeric AS avg_rating, count(*) AS rating_count
    FROM host_ratings
    GROUP BY host_id
)
SELECT
    h.host_id,
    COALESCE(round(r.avg_rating, 2), 0.00),
    h.events_hosted,
    h.events_completed,
    h.events_cancelled,
    COALESCE(r.rating_count, 0),
    now()
FROM hosted h
LEFT JOIN rated r ON r.host_id = h.host_id;

COMMIT;

-- ============================================================================
-- READOUT — eyeball that the scoring behaved.
--
-- Expect: priya_shah and maya_ortiz excellent (always show up), jonah_webb
-- unreliable (two no-shows and a late cancel), amir_haddad unaffected by his
-- cancellation because he gave five days' notice, and the four people with no
-- completed events sitting at 1.00 / 'unrated'.
-- ============================================================================

SELECT
    u.handle,
    ar.score,
    ar.band,
    ar.attended_count  AS attended,
    ar.no_show_count   AS no_shows,
    ar.cancelled_late_count        AS late_cancels,
    ar.cancelled_with_notice_count AS ok_cancels
FROM attendee_reliability ar
JOIN users u ON u.id = ar.user_id
ORDER BY ar.score DESC, u.handle;

SELECT
    u.handle,
    hr.score AS avg_rating,
    hr.events_hosted,
    hr.events_completed,
    hr.events_cancelled,
    hr.rating_count
FROM host_reputation hr
JOIN users u ON u.id = hr.user_id
ORDER BY hr.score DESC, u.handle;

-- Plain SELECT rather than psql's \echo, so this file also runs unmodified in
-- the Supabase SQL editor or any other client.
SELECT 'Seeded. All accounts share the password: gather-demo-2026' AS note
UNION ALL
SELECT 'Log in with any handle, e.g. maya_ortiz (host) or jonah_webb (unreliable).';
