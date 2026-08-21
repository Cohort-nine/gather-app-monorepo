# API Plan — Gather

Every route is prefixed `/api`. Responses always take the shape
`{ message, data?, errors? }` whether they succeed or fail, so a client can read
`response.message` the same way in both branches.

Auth is a stateless JWT sent as `Authorization: Bearer <token>`.

| Middleware | Effect |
| --- | --- |
| *(none)* | Public. |
| `optionalAuth` | Reads the token if present, but never rejects. Lets one endpoint serve signed-out and signed-in visitors with different detail. |
| `requireAuth` | 401 without a valid token. |
| `requireEventEdit` | Host or cohost of `:id` only, else 403. |
| `requireRsvpManagement` | Host or cohost, for reading the guest list and marking attendance. |

---

## Main resource — events

The five routes the rubric asks for, plus the ones the feature set needed.

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/events` | `optionalAuth` | List published public events. Supports `?search=`, `?category=`, `?city=`, `?sort=`, `?page=`, `?limit=`, and `?mine=true`. |
| GET | `/api/events/:id` | `optionalAuth` | One event in full, including the guest list. Exact address is stripped unless you're the host, a cohost, or hold an active RSVP. |
| POST | `/api/events` | `requireAuth` | Create an event. |
| PUT | `/api/events/:id` | `requireEventEdit` | Update an event. |
| DELETE | `/api/events/:id` | `requireEventEdit` | Delete an event. |
| POST | `/api/events/:id/image` | `requireEventEdit` | Upload a cover photo (multipart, field `image`). Authorisation runs before any bytes are read off the wire. |
| GET | `/api/events/:id/mutual-attendees` | `optionalAuth` | Which of your connections are going. Empty array when signed out — not a 401. |
| GET | `/api/categories` | — | Category list for the browse filter. |

### `?mine=true`

The one query parameter that changes the rules rather than the filter. It
returns events *you* host in any state, including drafts, which the public
listing excludes. It takes no user id — the id comes from your token. Accepting
a `hostId` parameter would have made every user's draft events readable by
anyone who could guess a UUID.

Unauthenticated requests get 401 rather than an empty list, because an empty
list would read as "you host nothing" instead of "you aren't signed in".

---

## RSVPs

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/events/:id/rsvp` | `requireAuth` | RSVP, or update an existing one. Assigns a waitlist position when the event is full. |
| DELETE | `/api/events/:id/rsvp` | `requireAuth` | Cancel. Promotes the next person off the waitlist. |
| GET | `/api/events/:id/rsvps` | `requireRsvpManagement` | Full guest list — host and cohosts only. |
| POST | `/api/events/:id/attendance` | `requireRsvpManagement` | Record who actually turned up. |
| GET | `/api/me/rsvps` | `requireAuth` | Everything you've RSVP'd to, ordered by event start. |

`POST` handles both create and update deliberately. "RSVP to this event" is one
user intention; making the client first discover whether a row already exists,
then choose POST or PUT, pushes bookkeeping into the UI for no benefit. The
unique constraint on `(event_id, user_id)` makes the upsert safe.

---

## Ratings and reputation

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/events/:id/ratings` | — | Ratings left for an event's host. |
| POST | `/api/events/:id/ratings` | `requireAuth` | Rate the host, 1–5. Attendees of completed events only. |

---

## Auth and account

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | — | Create an account. Returns a JWT. |
| POST | `/api/auth/login` | — | Sign in. Returns a JWT. |
| POST | `/api/auth/logout` | — | Client-side token discard; present so the client has one call site. |
| GET | `/api/auth/me` | `requireAuth` | Current user, for session restore on page load. |
| PATCH | `/api/auth/password` | `requireAuth` | Change password. Requires `currentPassword`. |
| PATCH | `/api/auth/email` | `requireAuth` | Change login email. Requires `currentPassword`. |
| POST | `/api/me/avatar` | `requireAuth` | Upload an avatar (multipart, field `avatar`). |
| DELETE | `/api/me/avatar` | `requireAuth` | Remove the avatar. |

Both PATCH routes re-verify the current password before changing anything. A
valid token proves the session was authenticated at some point; it does not
prove the person at the keyboard is the account owner right now. For changes
that could lock the real owner out, that distinction matters.

Passwords are bcrypt at cost 12 and `password_hash` is never selected into any
response.

---

## Connections

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/users/search?q=` | `requireAuth` | Find people by handle. Excludes yourself and anyone blocked either way. |
| POST | `/api/connections` | `requireAuth` | Send a request. Body `{ userId }`. |
| GET | `/api/connections?status=` | `requireAuth` | Your connections, filterable by status. |
| PATCH | `/api/connections/:otherUserId/accept` | `requireAuth` | Accept an incoming request. Incoming and pending only. |
| PATCH | `/api/connections/:otherUserId/decline` | `requireAuth` | Decline. |
| DELETE | `/api/connections/:otherUserId` | `requireAuth` | Cancel a request you sent, or unfriend. |
| GET | `/api/me/friends-events` | `requireAuth` | Upcoming events at least one connection is going to. |

Routes address the *other person* (`/connections/:otherUserId`), not a
connection row id. A client already knows who it means; making it look up a synthetic id
first would add a round trip and leak the ordered-pair storage into the API.

---

## Moderation and ops

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/reports` | `requireAuth` | Report a user or an event. |
| GET | `/api/me/reports` | `requireAuth` | Reports you've filed. |
| GET | `/api/health` | — | Liveness check for Render. |

---

## Status codes

| Code | Used for |
| --- | --- |
| 200 | Successful read, update, or delete. |
| 201 | Resource created — signup, event creation, RSVP, report. |
| 400 | Missing or invalid input. Body carries a field-level `errors` object. |
| 401 | Missing, malformed, or expired token. |
| 403 | Authenticated, but not allowed — editing someone else's event. |
| 404 | No such record, or one you aren't permitted to know exists. |
| 409 | Conflict with current state — handle taken, already RSVP'd, RSVP closed. |
| 500 | Unexpected server or database error. |

Current distribution across the controllers: 4×201, 46×400, 9×401, 5×403,
20×404, 21×409, 1×500.

The 403/404 split is a judgement call. Asking for an event that doesn't exist
and asking for someone's private draft both return 404 — a 403 would confirm the
record exists, which is itself a leak.

---

## Example responses

Success:

```json
{
  "message": "Event created successfully",
  "data": { "id": "4ad0e5f3-0821-4326-a274-bf18286024e7", "title": "Potluck" }
}
```

Validation failure (400):

```json
{
  "message": "Title and start time are required",
  "errors": { "title": "Title is required", "startsAt": "Start time is required" }
}
```

---

## Query parameters on `GET /api/events`

| Parameter | Effect |
| --- | --- |
| `search` | Case-insensitive match on title or description. |
| `category` | Category slug. |
| `city` | Case-insensitive city match. |
| `sort` | `soonest`, `newest`, `popular`, or `title`. |
| `page`, `limit` | Pagination. Response includes a `meta` block with `total` and `totalPages`. |
| `mine` | `true` returns your own events in any state. Requires auth. |

Every value a user supplies is bound as a parameter. `sort` is the exception
that proves the rule: `ORDER BY` cannot be parameterised in SQL, so it is
resolved through a `SORT_OPTIONS` whitelist and an unrecognised value falls back
to the default rather than reaching the query. String-interpolating it would be
a SQL injection.
