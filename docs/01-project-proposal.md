# Project Proposal — Gather

## What is the application?

Gather is a web app for organising small, in-person get-togethers: potlucks,
block parties, board-game nights, hobby meetups. A host publishes a gathering
with a time, a place, and a headcount limit. People browse what's nearby, RSVP,
and see who they already know who is going.

It is deliberately not a ticketing platform and not a mass-event site. Everything
is sized for gatherings where the host is cooking, setting out chairs, or buying
supplies — where the difference between eight people and twelve people is a real
problem for a real person.

## What problem does it solve?

**Hosts cannot get a headcount they can trust, and they have no way to tell
who is likely to show.**

The failure is specific. Free RSVP tools treat "yes" as costless: there is no
record of whether you turned up last time, so a host planning for twelve
routinely cooks for twelve and seats seven. The host absorbs the cost — money,
food, time, and the deflation of a half-empty room — and there is no signal
anywhere in the system that anything went wrong. Do that twice and people stop
hosting.

Gather makes showing up legible.

1. **RSVPs are a ledger, not a checkbox.** Every status change is appended to
   `rsvp_status_events` with a timestamp and who made it. Cancelling three weeks
   out and cancelling an hour out are different acts and are recorded as such.
2. **Attendance is recorded separately from intent.** After an event the host
   marks who actually came (`attendance`). Saying yes and turning up are two
   different facts, so they are two different tables.
3. **Reliability is derived from that history.** `attendee_reliability` holds a
   score and a band (excellent / good / mixed / unreliable) computed from the
   ledger. It is a rebuildable cache, never a source of truth — delete it and it
   can be recomputed exactly.
4. **The signal is used, not just displayed.** Waitlist promotion can respect a
   reliability floor (`events.waitlist_reliability_floor`), so a host running a
   dinner with ten seats can prefer people with a track record.

The same idea runs the other way: `host_reputation` and `host_ratings` let
attendees see whether a host actually runs the events they announce, so the
accountability is not one-sided.

## Who is the target user?

**Primary — the recurring small host.** Runs something on a rhythm: monthly
potluck, weekly run club, a craft night. Between 6 and 40 people. Needs an
accurate headcount because they are personally buying the food. Currently
juggling a group chat and a spreadsheet.

**Secondary — the person new to an area.** Wants low-stakes ways to meet people
without walking into a room of strangers. The connections feature is aimed
squarely at them: seeing that one person you know is already going is the
difference between attending and not.

**Tertiary — the neighbourhood organiser.** Block parties, mutual-aid meetups,
community garden work days. Cares about the address-privacy control, which
hides the exact street address until someone has actually RSVP'd.

## What is the main resource being managed?

**Events.** Everything else exists to support them: RSVPs attach to events,
attendance attaches to RSVPs, reliability is derived from attendance, and
connections determine what you can see about who else is going.

## What CRUD actions will users perform?

| Action | Who | What happens |
| --- | --- | --- |
| **Create** | Any signed-in user | Publish a gathering — title, time, place, capacity, visibility, category, optional cover photo. Saved as `draft` or `published`. |
| **Read** | Anyone | Browse published public events with search, category filter, and sort. Open one for full detail, including who's going. Exact address stays hidden until you RSVP if the host enabled that. |
| **Update** | Host or cohost only | Edit any field, cancel the event, or mark it completed. Enforced by the `requireEventEdit` middleware, not by hiding the button. |
| **Delete** | Host or cohost only | Remove the event. The UI confirms first; the API re-checks authorisation regardless. |

Secondary CRUD, on the same pattern: RSVPs (create / read / cancel), host
ratings, connections (request / accept / decline / remove), reports, and profile
data including avatar, password, and login email.

## What are the related database tables?

Twenty-one tables. The ones that carry the core story:

- **`users`** — accounts and profile. Referenced by nearly everything.
- **`events`** — the main resource. FK to `users` (host), `categories`,
  `event_series`.
- **`rsvps`** — one row per person per event. FK to both. Unique on
  `(event_id, user_id)`.
- **`rsvp_status_events`** — append-only ledger of every status change.
- **`attendance`** — who actually turned up, recorded by the host.
- **`attendee_reliability`** — derived score per user. Rebuildable from the two
  tables above.
- **`host_reputation`** / **`host_ratings`** — the same accountability applied
  to hosts.
- **`connections`** — mutual relationships, stored once as an ordered pair
  (`user_low`, `user_high`) so a friendship can't be recorded twice.
- **`categories`**, **`event_tags`**, **`event_cohosts`**, **`event_invites`**,
  **`notifications`**, **`reports`**, **`badges`**, and supporting tables.

Full column-level detail is in [`02-database-diagram.md`](./02-database-diagram.md)
and the generated [`apps/backend/database/schema.sql`](../apps/backend/database/schema.sql).

## Why this design and not a simpler one

A single `rsvps` table with a `status` column would have been less work. It would
also have made the core feature impossible: with only the current status, there
is no way to distinguish someone who cancelled with two weeks' notice from
someone who cancelled during the event. That distinction is the entire product.
The ledger is the feature.
