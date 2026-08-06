-- ============================================================================
-- GATHER — Seed data
--
-- Dev/demo dataset for schema.sql. Fixed UUIDs are used throughout (instead
-- of gen_random_uuid()) purely so later INSERTs in this file can reference
-- earlier rows directly, without subqueries.
--
-- Three events are seeded on purpose, to show the attendance-finalization
-- workflow end to end:
--   - e1 (Aug board game night): completed AND finalized — host reviewed
--     everyone and the checklist is closed.
--   - e2 (Sept board game night): still upcoming — plain RSVP/waitlist data,
--     then a live cancellation at the bottom to demonstrate
--     promote_waitlist_on_cancel().
--   - e3 (picnic): already ended but NOT finalized — two attendees are still
--     unmarked (pending_review = true in event_attendance_checklist), which
--     is exactly the "don't auto-mark absent" case: they show up as
--     unreviewed, not as no-shows.
--
-- attendee_reliability / host_reputation rows below are illustrative
-- starting values, not hand-derived from the ledger — per the schema's own
-- rule, those tables are caches meant to be rebuilt by the nightly
-- recompute job (see schema.sql note 2), not authored by hand.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- USERS
-- ----------------------------------------------------------------------------
INSERT INTO users (id, handle, email, display_name, home_city, joined_at) VALUES
    ('11111111-1111-1111-1111-111111111111', 'alice',  'alice@example.com',  'Alice Nguyen',  'Portland', '2025-11-01 09:00:00+00'),
    ('22222222-2222-2222-2222-222222222222', 'bob',    'bob@example.com',    'Bob Alvarez',   'Portland', '2025-11-03 09:00:00+00'),
    ('33333333-3333-3333-3333-333333333333', 'carol',  'carol@example.com',  'Carol Kim',     'Portland', '2025-11-10 09:00:00+00'),
    ('44444444-4444-4444-4444-444444444444', 'dave',   'dave@example.com',   'Dave Chen',     'Portland', '2025-12-01 09:00:00+00'),
    ('55555555-5555-5555-5555-555555555555', 'erin',   'erin@example.com',   'Erin O''Malley','Portland', '2026-01-15 09:00:00+00'),
    ('66666666-6666-6666-6666-666666666666', 'frank',  'frank@example.com',  'Frank Osei',    'Portland', '2026-02-20 09:00:00+00');

INSERT INTO user_privacy_settings (user_id) VALUES
    ('11111111-1111-1111-1111-111111111111'),
    ('22222222-2222-2222-2222-222222222222'),
    ('33333333-3333-3333-3333-333333333333'),
    ('44444444-4444-4444-4444-444444444444'),
    ('55555555-5555-5555-5555-555555555555'),
    ('66666666-6666-6666-6666-666666666666');

-- ----------------------------------------------------------------------------
-- SOCIAL GRAPH
-- ----------------------------------------------------------------------------
-- bob<->carol accepted, carol<->dave accepted: makes dave a 2nd-degree
-- connection of bob via mutual_attendance_signal().
INSERT INTO connections (user_low, user_high, requested_by, status, requested_at, accepted_at) VALUES
    ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'accepted', '2025-12-01 10:00:00+00', '2025-12-01 12:00:00+00'),
    ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'accepted', '2025-12-05 10:00:00+00', '2025-12-05 18:00:00+00');

-- ----------------------------------------------------------------------------
-- CATEGORIES / SERIES
-- ----------------------------------------------------------------------------
INSERT INTO categories (slug, name, sort_order) VALUES
    ('games',    'Games & Tabletop', 1),
    ('outdoors', 'Outdoors',         2);

INSERT INTO event_series (id, host_id, title, slug, description, cadence, created_at) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
     'Board Game Night', 'board-game-night', 'Alice''s monthly board game meetup.', 'monthly', '2026-06-01 09:00:00+00');

-- ----------------------------------------------------------------------------
-- EVENTS
-- ----------------------------------------------------------------------------

-- e1: already happened. Finalized further down, AFTER its attendance rows
-- are inserted — setting attendance_finalized_at here in the same INSERT
-- that creates the event would be wiped out the moment those attendance
-- rows landed, since attendance_unfinalize_on_change clears it on any
-- attendance change. Real workflow is always: mark attendance, then finalize.
INSERT INTO events (
    id, host_id, series_id, category_id, title, slug, description,
    starts_at, ends_at, timezone, rsvp_closes_at,
    place_name, city, region, country_code,
    capacity, allow_waitlist,
    visibility, status,
    published_at, completed_at,
    created_at
) VALUES (
    'aaaaaaaa-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', (SELECT id FROM categories WHERE slug = 'games'),
    'Board Game Night — August', 'board-game-night-august', 'Catan, Wingspan, and snacks.',
    '2026-07-15 22:00:00+00', '2026-07-16 01:00:00+00', 'America/Los_Angeles', '2026-07-15 20:00:00+00',
    'Alice''s place', 'Portland', 'OR', 'US',
    4, true,
    'unlisted', 'completed',
    '2026-07-01 14:00:00+00', '2026-07-16 01:10:00+00',
    '2026-06-25 09:00:00+00'
);

-- e2: upcoming — normal RSVP/waitlist demo, no attendance yet.
INSERT INTO events (
    id, host_id, series_id, category_id, title, slug, description,
    starts_at, ends_at, timezone, rsvp_closes_at,
    place_name, city, region, country_code,
    capacity, allow_waitlist,
    visibility, status,
    published_at,
    created_at
) VALUES (
    'aaaaaaaa-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', (SELECT id FROM categories WHERE slug = 'games'),
    'Board Game Night — September', 'board-game-night-september', 'Same crew, new games.',
    '2026-09-15 22:00:00+00', '2026-09-16 01:00:00+00', 'America/Los_Angeles', '2026-09-15 20:00:00+00',
    'Alice''s place', 'Portland', 'OR', 'US',
    3, true,
    'unlisted', 'published',
    '2026-08-05 14:00:00+00',
    '2026-08-05 14:00:00+00'
);

-- e3: ended, host (bob) has NOT finalized attendance yet — carol and erin
-- are unreviewed, not marked absent.
INSERT INTO events (
    id, host_id, category_id, title, slug, description,
    starts_at, ends_at, timezone,
    place_name, city, region, country_code,
    allow_waitlist,
    visibility, status,
    published_at, completed_at,
    created_at
) VALUES (
    'aaaaaaaa-0000-0000-0000-000000000103', '22222222-2222-2222-2222-222222222222',
    (SELECT id FROM categories WHERE slug = 'outdoors'),
    'Picnic in the Park', 'picnic-in-the-park', 'Bring a blanket and something to share.',
    '2026-08-01 16:00:00+00', '2026-08-01 19:00:00+00', 'America/Los_Angeles',
    'Laurelhurst Park', 'Portland', 'OR', 'US',
    true,
    'public', 'completed',
    '2026-07-20 12:00:00+00', '2026-08-01 19:05:00+00',
    '2026-07-18 09:00:00+00'
);

INSERT INTO event_cohosts (event_id, user_id, can_edit, can_manage_rsvps) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000102', '33333333-3333-3333-3333-333333333333', true, true);

INSERT INTO event_tags (event_id, tag) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000101', 'boardgames'),
    ('aaaaaaaa-0000-0000-0000-000000000101', 'indoor'),
    ('aaaaaaaa-0000-0000-0000-000000000102', 'boardgames'),
    ('aaaaaaaa-0000-0000-0000-000000000102', 'indoor'),
    ('aaaaaaaa-0000-0000-0000-000000000103', 'outdoor'),
    ('aaaaaaaa-0000-0000-0000-000000000103', 'family-friendly');

-- ----------------------------------------------------------------------------
-- RSVPs  +  ledger
-- ----------------------------------------------------------------------------

-- e1 (August, capacity 4): bob, carol, dave all going.
INSERT INTO rsvps (id, event_id, user_id, status, first_responded_at, status_changed_at) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000101', '22222222-2222-2222-2222-222222222222', 'going', '2026-07-02 14:00:00+00', '2026-07-02 14:00:00+00'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000101', '33333333-3333-3333-3333-333333333333', 'going', '2026-07-03 10:00:00+00', '2026-07-03 10:00:00+00'),
    ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000101', '44444444-4444-4444-4444-444444444444', 'going', '2026-07-04 08:00:00+00', '2026-07-04 08:00:00+00');

INSERT INTO rsvp_status_events (rsvp_id, event_id, user_id, from_status, to_status, changed_at, changed_by, event_starts_at, hours_before_event) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000101', '22222222-2222-2222-2222-222222222222', NULL, 'going', '2026-07-02 14:00:00+00', '22222222-2222-2222-2222-222222222222', '2026-07-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-07-15 22:00:00+00' - TIMESTAMPTZ '2026-07-02 14:00:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000101', '33333333-3333-3333-3333-333333333333', NULL, 'going', '2026-07-03 10:00:00+00', '33333333-3333-3333-3333-333333333333', '2026-07-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-07-15 22:00:00+00' - TIMESTAMPTZ '2026-07-03 10:00:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000101', '44444444-4444-4444-4444-444444444444', NULL, 'going', '2026-07-04 08:00:00+00', '44444444-4444-4444-4444-444444444444', '2026-07-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-07-15 22:00:00+00' - TIMESTAMPTZ '2026-07-04 08:00:00+00')) / 3600.0, 2));

-- e3 (Picnic): alice, carol, erin going.
INSERT INTO rsvps (id, event_id, user_id, status, first_responded_at, status_changed_at) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000103', '11111111-1111-1111-1111-111111111111', 'going', '2026-07-21 09:00:00+00', '2026-07-21 09:00:00+00'),
    ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000103', '33333333-3333-3333-3333-333333333333', 'going', '2026-07-22 11:00:00+00', '2026-07-22 11:00:00+00'),
    ('bbbbbbbb-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000103', '55555555-5555-5555-5555-555555555555', 'going', '2026-07-22 13:00:00+00', '2026-07-22 13:00:00+00');

INSERT INTO rsvp_status_events (rsvp_id, event_id, user_id, from_status, to_status, changed_at, changed_by, event_starts_at, hours_before_event) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000103', '11111111-1111-1111-1111-111111111111', NULL, 'going', '2026-07-21 09:00:00+00', '11111111-1111-1111-1111-111111111111', '2026-08-01 16:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-08-01 16:00:00+00' - TIMESTAMPTZ '2026-07-21 09:00:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000103', '33333333-3333-3333-3333-333333333333', NULL, 'going', '2026-07-22 11:00:00+00', '33333333-3333-3333-3333-333333333333', '2026-08-01 16:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-08-01 16:00:00+00' - TIMESTAMPTZ '2026-07-22 11:00:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000103', '55555555-5555-5555-5555-555555555555', NULL, 'going', '2026-07-22 13:00:00+00', '55555555-5555-5555-5555-555555555555', '2026-08-01 16:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-08-01 16:00:00+00' - TIMESTAMPTZ '2026-07-22 13:00:00+00')) / 3600.0, 2));

-- e2 (September, capacity 3): bob, carol, dave going (fills capacity);
-- erin and frank waitlisted. Bob's RSVP gets cancelled further down to
-- demonstrate promote_waitlist_on_cancel() live.
INSERT INTO rsvps (id, event_id, user_id, status, waitlist_position, first_responded_at, status_changed_at) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000102', '22222222-2222-2222-2222-222222222222', 'going',      NULL, '2026-08-06 15:00:00+00', '2026-08-06 15:00:00+00'),
    ('bbbbbbbb-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000102', '33333333-3333-3333-3333-333333333333', 'going',      NULL, '2026-08-06 15:05:00+00', '2026-08-06 15:05:00+00'),
    ('bbbbbbbb-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000102', '44444444-4444-4444-4444-444444444444', 'going',      NULL, '2026-08-06 15:10:00+00', '2026-08-06 15:10:00+00'),
    ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000102', '55555555-5555-5555-5555-555555555555', 'waitlisted', 1,    '2026-08-06 15:15:00+00', '2026-08-06 15:15:00+00'),
    ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000102', '66666666-6666-6666-6666-666666666666', 'waitlisted', 2,    '2026-08-06 15:20:00+00', '2026-08-06 15:20:00+00');

INSERT INTO rsvp_status_events (rsvp_id, event_id, user_id, from_status, to_status, changed_at, changed_by, event_starts_at, hours_before_event) VALUES
    ('bbbbbbbb-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000102', '22222222-2222-2222-2222-222222222222', NULL, 'going',      '2026-08-06 15:00:00+00', '22222222-2222-2222-2222-222222222222', '2026-09-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-09-15 22:00:00+00' - TIMESTAMPTZ '2026-08-06 15:00:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000102', '33333333-3333-3333-3333-333333333333', NULL, 'going',      '2026-08-06 15:05:00+00', '33333333-3333-3333-3333-333333333333', '2026-09-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-09-15 22:00:00+00' - TIMESTAMPTZ '2026-08-06 15:05:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000102', '44444444-4444-4444-4444-444444444444', NULL, 'going',      '2026-08-06 15:10:00+00', '44444444-4444-4444-4444-444444444444', '2026-09-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-09-15 22:00:00+00' - TIMESTAMPTZ '2026-08-06 15:10:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000102', '55555555-5555-5555-5555-555555555555', NULL, 'waitlisted', '2026-08-06 15:15:00+00', '55555555-5555-5555-5555-555555555555', '2026-09-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-09-15 22:00:00+00' - TIMESTAMPTZ '2026-08-06 15:15:00+00')) / 3600.0, 2)),
    ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000102', '66666666-6666-6666-6666-666666666666', NULL, 'waitlisted', '2026-08-06 15:20:00+00', '66666666-6666-6666-6666-666666666666', '2026-09-15 22:00:00+00', ROUND(EXTRACT(EPOCH FROM (TIMESTAMPTZ '2026-09-15 22:00:00+00' - TIMESTAMPTZ '2026-08-06 15:20:00+00')) / 3600.0, 2));

INSERT INTO event_invites (event_id, inviter_id, invitee_email, token, status, sent_at) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000102', '11111111-1111-1111-1111-111111111111', 'plus-one@example.com', 'inv_tok_frank_plus_one', 'sent', '2026-08-06 15:20:00+00');

-- ----------------------------------------------------------------------------
-- ATTENDANCE
-- ----------------------------------------------------------------------------

-- e1: host reviews everyone, THEN finalizes — the UPDATE below only
-- succeeds because every 'going' RSVP already has an attendance row;
-- events_check_attendance_finalization would reject it otherwise.
INSERT INTO attendance (event_id, user_id, rsvp_id, outcome, method, recorded_by, recorded_at, excuse_note) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000101', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'attended', 'host_marked',   '11111111-1111-1111-1111-111111111111', '2026-07-16 01:15:00+00', NULL),
    ('aaaaaaaa-0000-0000-0000-000000000101', '33333333-3333-3333-3333-333333333333', 'bbbbbbbb-0000-0000-0000-000000000002', 'attended', 'self_checkin',  '33333333-3333-3333-3333-333333333333', '2026-07-15 22:05:00+00', NULL),
    ('aaaaaaaa-0000-0000-0000-000000000101', '44444444-4444-4444-4444-444444444444', 'bbbbbbbb-0000-0000-0000-000000000003', 'excused',  'host_marked',   '11111111-1111-1111-1111-111111111111', '2026-07-16 01:15:00+00', 'Car trouble, gave the host a heads-up before start time.');

UPDATE events
   SET attendance_finalized_at = '2026-07-16 09:00:00+00', attendance_finalized_by = '11111111-1111-1111-1111-111111111111'
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000101';

-- e3: host has only reviewed alice so far. Carol and erin have NO row here —
-- they show up in event_attendance_checklist as pending_review = true, not
-- as a no_show. events_awaiting_attendance_review_idx will surface this
-- event to bob until he finishes the checklist.
INSERT INTO attendance (event_id, user_id, rsvp_id, outcome, method, recorded_by, recorded_at) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000103', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000004', 'attended', 'host_marked', '22222222-2222-2222-2222-222222222222', '2026-08-01 19:20:00+00');

-- ----------------------------------------------------------------------------
-- HOST RATINGS  (only attended guests can rate — enforced by
-- host_ratings_require_attendance, satisfied here since bob/carol are
-- already marked 'attended' for e1 above)
-- ----------------------------------------------------------------------------
INSERT INTO host_ratings (event_id, host_id, rater_id, rating, comment, created_at) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 5, 'Great host, great snacks.', '2026-07-16 12:00:00+00'),
    ('aaaaaaaa-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 4, 'Fun night, a bit crowded.',  '2026-07-16 14:00:00+00');

-- ----------------------------------------------------------------------------
-- TRUST LAYER  (illustrative caches — see note at top of file)
-- ----------------------------------------------------------------------------
INSERT INTO attendee_reliability (user_id, score, commitments, attended, cancelled_with_notice, cancelled_late, no_shows, excused, window_starts_at, last_computed_at) VALUES
    ('11111111-1111-1111-1111-111111111111', 100.0, 1, 1, 0, 0, 0, 0, '2025-08-06 00:00:00+00', '2026-08-06 00:00:00+00'),
    ('22222222-2222-2222-2222-222222222222',  95.0, 2, 1, 1, 0, 0, 0, '2025-08-06 00:00:00+00', '2026-08-06 00:00:00+00'),
    ('33333333-3333-3333-3333-333333333333', 100.0, 2, 1, 0, 0, 0, 0, '2025-08-06 00:00:00+00', '2026-08-06 00:00:00+00'),
    ('44444444-4444-4444-4444-444444444444',  90.0, 1, 0, 0, 0, 0, 1, '2025-08-06 00:00:00+00', '2026-08-06 00:00:00+00'),
    ('55555555-5555-5555-5555-555555555555', 100.0, 1, 0, 0, 0, 0, 0, '2025-08-06 00:00:00+00', '2026-08-06 00:00:00+00'),
    ('66666666-6666-6666-6666-666666666666', 100.0, 0, 0, 0, 0, 0, 0, '2025-08-06 00:00:00+00', '2026-08-06 00:00:00+00');

INSERT INTO host_reputation (user_id, score, events_hosted, events_completed, events_cancelled_by_host, total_attendees, avg_rating, ratings_count, first_hosted_at, last_computed_at) VALUES
    ('11111111-1111-1111-1111-111111111111', 98.0, 2, 1, 0, 3, 4.5, 2, '2026-06-25 09:00:00+00', '2026-08-06 00:00:00+00'),
    ('22222222-2222-2222-2222-222222222222', 100.0, 1, 1, 0, 1, NULL, 0, '2026-07-18 09:00:00+00', '2026-08-06 00:00:00+00');

INSERT INTO badges (slug, label, description, applies_to) VALUES
    ('super-host', 'Super Host', 'Consistently well-reviewed hosting.', 'host'),
    ('early-bird', 'Early Bird', 'RSVPs well ahead of the event.', 'attendee');

INSERT INTO user_badges (user_id, badge_id, awarded_at) VALUES
    ('11111111-1111-1111-1111-111111111111', (SELECT id FROM badges WHERE slug = 'super-host'), '2026-07-17 09:00:00+00');

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS
-- ----------------------------------------------------------------------------

-- The checklist-reminder feature in action: bob (host of e3) was notified
-- to finalize attendance once the event ended, and hasn't acted yet
-- (sent_at set, read_at NULL).
INSERT INTO notifications (user_id, event_id, type, channel, scheduled_for, sent_at) VALUES
    ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000103', 'attendance_review_needed', 'in_app', '2026-08-01 19:05:00+00', '2026-08-01 19:06:00+00');

INSERT INTO notifications (user_id, event_id, type, channel, scheduled_for) VALUES
    ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000102', 'rsvp_reminder_48h', 'push', '2026-09-13 22:00:00+00'),
    ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000102', 'rsvp_reminder_48h', 'push', '2026-09-13 22:00:00+00');

INSERT INTO notification_preferences (user_id, type, channel, enabled) VALUES
    ('11111111-1111-1111-1111-111111111111', 'rsvp_reminder_48h', 'email', true),
    ('11111111-1111-1111-1111-111111111111', 'rsvp_reminder_48h', 'push',  true);

-- ----------------------------------------------------------------------------
-- SAFETY
-- ----------------------------------------------------------------------------
INSERT INTO reports (reporter_id, subject_event_id, reason, details, status, created_at) VALUES
    ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-000000000103', 'listing_accuracy', 'Address pin was off by a few blocks.', 'open', '2026-08-01 20:00:00+00');

-- ----------------------------------------------------------------------------
-- LIVE DEMO: cancel bob's e2 RSVP and let promote_waitlist_on_cancel() do
-- its thing — erin (waitlist position 1) should be auto-promoted to
-- 'going', and frank should shift up to position 1.
-- ----------------------------------------------------------------------------
UPDATE rsvps
   SET status = 'cancelled', cancelled_at = now(), status_changed_at = now()
 WHERE id = 'bbbbbbbb-0000-0000-0000-000000000007';

INSERT INTO rsvp_status_events (rsvp_id, event_id, user_id, from_status, to_status, changed_at, changed_by, event_starts_at, hours_before_event)
SELECT 'bbbbbbbb-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000102', '22222222-2222-2222-2222-222222222222',
       'going', 'cancelled', now(), '22222222-2222-2222-2222-222222222222', starts_at,
       ROUND(EXTRACT(EPOCH FROM (starts_at - now())) / 3600.0, 2)
  FROM events WHERE id = 'aaaaaaaa-0000-0000-0000-000000000102';

INSERT INTO notifications (user_id, event_id, type, channel, scheduled_for, sent_at) VALUES
    ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-000000000102', 'waitlist_promoted', 'push', now(), now());
