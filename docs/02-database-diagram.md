# Database Diagram — Gather

21 tables, 38 foreign keys, 16 CHECK constraints, 58 indexes, 1 view.

The diagrams below are [Mermaid](https://mermaid.js.org/), which GitHub renders
natively — open this file on GitHub and you'll see the shapes, not the source.

Column lists are abbreviated to the ones that carry meaning. `events` alone has
37 columns; reproducing all of them here would obscure the relationships, which
is what a diagram is for. Every column, type, constraint, and index is in
[`apps/backend/database/schema.sql`](../apps/backend/database/schema.sql), which
is generated from the Prisma migrations rather than maintained by hand.

`PK` = primary key. `FK` = foreign key. `UK` = unique.

Six tables use a **composite primary key** made of two foreign keys —
`connections`, `user_blocks`, `event_cohosts`, `event_tags`,
`notification_preferences`, and `user_badges`. Those columns are marked `PK`
below and are foreign keys as well; Mermaid renders one key marker per column,
so the FK role is noted here rather than in the diagram.

---

## Core: events, RSVPs, and the attendance ledger

This is the part that matters. Everything else is supporting cast.

```mermaid
erDiagram
    users ||--o{ events : hosts
    users ||--o{ rsvps : makes
    events ||--o{ rsvps : receives
    rsvps ||--o{ rsvp_status_events : "logs changes to"
    events ||--o{ rsvp_status_events : "scoped to"
    rsvps ||--o| attendance : "resolves to"
    users ||--o| attendee_reliability : "scored by"
    categories ||--o{ events : classifies
    event_series ||--o{ events : groups

    users {
        uuid id PK
        text handle UK
        text email UK
        text password_hash
        text display_name
        text avatar_url
        text home_city
        timestamptz joined_at
        timestamptz deleted_at
    }

    categories {
        int id PK
        text slug UK
        text name
        int sort_order
    }

    event_series {
        uuid id PK
        uuid host_id FK
        text title
        text recurrence_rule
    }

    events {
        uuid id PK
        uuid host_id FK
        uuid series_id FK
        int category_id FK
        text title
        text slug
        text description
        text image_url
        timestamptz starts_at
        timestamptz ends_at
        text timezone
        boolean is_online
        text address_line1
        text city
        boolean hide_exact_address_until_rsvp
        int capacity
        boolean allow_waitlist
        numeric waitlist_reliability_floor
        enum visibility
        enum status
        timestamptz created_at
    }

    rsvps {
        uuid id PK
        uuid event_id FK
        uuid user_id FK
        enum status
        int guest_count
        int waitlist_position
        timestamptz first_responded_at
        timestamptz status_changed_at
        timestamptz cancelled_at
    }

    rsvp_status_events {
        uuid id PK
        uuid rsvp_id FK
        uuid event_id FK
        uuid actor_id FK
        enum from_status
        enum to_status
        text reason
        timestamptz created_at
    }

    attendance {
        uuid id PK
        uuid rsvp_id FK
        uuid event_id FK
        uuid user_id FK
        enum outcome
        enum method
        int guests_brought
        uuid marked_by_id FK
        timestamptz marked_at
    }

    attendee_reliability {
        uuid user_id PK
        numeric score
        int rsvp_count
        int attended_count
        int no_show_count
        int cancelled_late_count
        text band
        timestamptz computed_at
    }
```

### Why it's shaped this way

**`rsvps` holds current state; `rsvp_status_events` holds history.** One row per
person per event, unique on `(event_id, user_id)`, so "am I going?" is a single
indexed lookup. Every transition is *also* appended to the ledger with a
timestamp and an actor. Without the ledger there is no way to tell a courteous
two-week cancellation from a no-show, and that distinction is the product.

**`attendance` is separate from `rsvps` on purpose.** Intent and outcome are
different facts. Collapsing them into one status column would mean overwriting
what someone said they'd do with what they actually did, destroying the very
comparison the score depends on.

**`attendee_reliability` is a cache, not a source of truth.** Every column is
derivable from `rsvp_status_events` + `attendance`. Drop the table and it can be
rebuilt exactly. It exists so browse doesn't have to aggregate a ledger on every
request. The same pattern applies to `host_reputation`.

---

## Hosts, ratings, and reputation

Accountability runs both directions — attendees are scored, and so are hosts.

```mermaid
erDiagram
    users ||--o| host_reputation : "scored by"
    users ||--o{ host_ratings : gives
    users ||--o{ host_ratings : receives
    events ||--o{ host_ratings : "rated on"
    events ||--o{ event_cohosts : "co-hosted via"
    users ||--o{ event_cohosts : "cohosts"
    events ||--o{ event_tags : "tagged with"

    host_reputation {
        uuid user_id PK
        numeric score
        int events_hosted
        int events_completed
        int events_cancelled
        int rating_count
        timestamptz computed_at
    }

    host_ratings {
        uuid id PK
        uuid event_id FK
        uuid host_id FK
        uuid rater_id FK
        int rating
        text comment
        timestamptz created_at
    }

    event_cohosts {
        uuid event_id PK
        uuid user_id PK
        text role
        timestamptz added_at
    }

    event_tags {
        uuid event_id PK
        text tag PK
    }
```

`event_cohosts` and `event_tags` use composite primary keys rather than a
surrogate `id`. The pair *is* the identity — a user is a cohost of an event once
or not at all — so a separate key would add a column and permit duplicates.

---

## People: connections, blocks, privacy

```mermaid
erDiagram
    users ||--o{ connections : "low side"
    users ||--o{ connections : "high side"
    users ||--o{ user_blocks : blocks
    users ||--o| user_privacy_settings : configures
    users ||--o{ event_invites : sends
    events ||--o{ event_invites : "invites to"

    connections {
        uuid user_low PK
        uuid user_high PK
        uuid requested_by FK
        enum status
        timestamptz requested_at
        timestamptz accepted_at
    }

    user_blocks {
        uuid blocker_id PK
        uuid blocked_id PK
        text reason
        timestamptz created_at
    }

    user_privacy_settings {
        uuid user_id PK
        enum default_attendee_visibility
        boolean show_reliability_publicly
        boolean discoverable_by_handle
    }

    event_invites {
        uuid id PK
        uuid event_id FK
        uuid inviter_id FK
        uuid invitee_id FK
        enum status
        text token
        timestamptz expires_at
    }
```

**`connections` stores a friendship once, not twice.** The two user ids are
ordered before insert — smaller UUID into `user_low`, larger into `user_high` —
and the composite PK is `(user_low, user_high)`. A CHECK constraint enforces
`user_low < user_high`. This makes a duplicate friendship structurally
impossible rather than something application code has to remember to prevent.
`requested_by` records who initiated, which the ordering would otherwise lose.

`user_blocks` deliberately does *not* order its pair: blocking is one-directional
and asymmetric, so `(A blocks B)` and `(B blocks A)` are genuinely different rows.

---

## Notifications, badges, moderation

```mermaid
erDiagram
    users ||--o{ notifications : receives
    events ||--o{ notifications : "about"
    users ||--o{ notification_preferences : sets
    users ||--o{ user_badges : earns
    badges ||--o{ user_badges : "awarded as"
    users ||--o{ reports : files
    users ||--o{ reports : "reported in"
    events ||--o{ reports : "reported in"

    notifications {
        uuid id PK
        uuid user_id FK
        uuid event_id FK
        enum type
        text title
        text body
        timestamptz read_at
    }

    notification_preferences {
        uuid user_id PK
        enum type PK
        enum channel PK
        boolean enabled
    }

    badges {
        int id PK
        text slug UK
        text name
        text description
    }

    user_badges {
        uuid user_id PK
        int badge_id PK
        timestamptz awarded_at
    }

    reports {
        uuid id PK
        uuid reporter_id FK
        uuid subject_user_id FK
        uuid subject_event_id FK
        text reason
        text details
        text status
        timestamptz created_at
    }
```

`reports` has two nullable subject FKs and a CHECK constraint requiring exactly
one to be set — a report targets a user *or* an event, never both and never
neither.

---

## The one view

```sql
CREATE OR REPLACE VIEW connection_edges AS
    SELECT user_low  AS user_id, user_high AS peer_id, accepted_at
      FROM connections WHERE status = 'accepted'
    UNION ALL
    SELECT user_high AS user_id, user_low  AS peer_id, accepted_at
      FROM connections WHERE status = 'accepted';
```

Storing each friendship once is right for integrity and awkward for querying —
"who are my friends?" would need to check both columns every time. The view
expands each accepted row into both directions so callers can just filter on
`user_id`. Correct storage, convenient reads, no duplicated data.

Prisma cannot express views, CHECK constraints, or partial indexes, so these
live in a hand-edited raw SQL migration alongside the generated ones.

---

## Data types and why

| Choice | Reason |
| --- | --- |
| `uuid` for user-facing ids | Sequential integers leak volume and let anyone enumerate `/events/1`, `/events/2`. `categories` and `badges` keep `serial` — they're a fixed reference list, nothing to leak. |
| `timestamptz`, never `timestamp` | An event at 6pm is 6pm *somewhere*. Without the zone, DST and travel silently corrupt the time. `events.timezone` additionally stores the IANA name for display. |
| `numeric` for scores | `float` cannot represent 0.1 exactly. Scores get compared against thresholds like `waitlist_reliability_floor`, and a comparison that's wrong in the seventh decimal is still wrong. |
| PostgreSQL `enum` for status columns | `status = 'atending'` should fail at the database, not silently store a typo that no query will ever match. |
| `text` over `varchar(n)` | Identical performance in PostgreSQL. An arbitrary length cap is a future migration for no present benefit. |

## NOT NULL and CHECK constraints

Every table has NOT NULL on the columns that make a row meaningful — an event
without `starts_at` or `title` isn't an event. Sixteen CHECK constraints back
this up with rules a type can't express. The full list, verbatim from
`schema.sql`:

```sql
CHECK (handle ~ '^[a-z0-9_]{3,30}$')                          -- users
CHECK (user_low < user_high)                                  -- connections
CHECK (status <> 'accepted' OR accepted_at IS NOT NULL)       -- connections
CHECK (blocker_id <> blocked_id)                              -- user_blocks
CHECK (capacity IS NULL OR capacity > 0)                      -- events
CHECK (ends_at IS NULL OR ends_at > starts_at)                -- events
CHECK (rsvp_closes_at IS NULL OR rsvp_closes_at <= starts_at) -- events
CHECK (NOT is_online OR online_url IS NOT NULL)               -- events
CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)     -- events
CHECK (guest_count >= 0 AND guest_count <= 20)                -- rsvps
CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)     -- rsvps
CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL))  -- rsvps
CHECK (rating BETWEEN 1 AND 5)                                -- host_ratings
CHECK (num_nonnulls(subject_user_id, subject_event_id) = 1)   -- reports
CHECK (score >= 0.00 AND score <= 1.00)                       -- attendee_reliability
CHECK (score >= 0.00 AND score <= 5.00)                       -- host_reputation
```

Several are worth reading twice. `(status = 'waitlisted') = (waitlist_position
IS NOT NULL)` makes the two columns impossible to disagree — you cannot have a
waitlist position without being waitlisted, or be waitlisted without one.
`num_nonnulls(subject_user_id, subject_event_id) = 1` enforces that a report
targets exactly one thing. And `NOT is_online OR online_url IS NOT NULL` means
an online event without a link can't be saved at all.

These live in the database rather than only in Express because the database is
the last line — a bad migration, a psql session, or a second service writing to
the same tables all bypass application validation. Constraints don't.
