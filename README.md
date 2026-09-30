# Gather

### 🔴 [**Live demo → __FRONTEND_HOST__**](https://__FRONTEND_HOST__/)

A social events app: host a gathering, RSVP to one, and build a track record of
actually showing up.

### Try it

Every demo account uses the password **`gather-demo-2026`**. Sign in with the
handle.

| Handle | What you'll see |
| --- | --- |
| `maya_ortiz` | **Start here.** A host: three events, a seat at a sold-out dinner with a waitlist behind it, a bonfire from two days ago that's waiting for her to mark who came, and an incoming connection request. |
| `devon_park` | A reliable regular who brings guests along — see how guests count toward an event's capacity. |
| `jonah_webb` | The cautionary tale: two no-shows and a late cancel, so his reliability badge reads *unreliable*. |
| `lena_fox` | Has a draft event (only she can see it) and a block in place. |

The API is on Render's free tier and sleeps after 15 minutes idle. The first
request after a nap takes 30–60 seconds; the app shows a "waking up" notice and
retries on its own. The demo data can be reset at any time, so feel free to
click everything.

## Problem statement

**Hosts of small gatherings cannot get a headcount they can trust, and have no
way to tell who is likely to show up.**

Free RSVP tools treat "yes" as costless. Nothing records whether you turned up
last time, so a host planning for twelve cooks for twelve and seats seven. The
host absorbs the cost — money, food, time, a half-empty room — and no signal
anywhere in the system registers that anything went wrong. Happen twice and
people stop hosting.

Gather makes showing up legible. RSVP changes are appended to a ledger with
timestamps, so cancelling two weeks out and cancelling an hour out are recorded
as the different acts they are. Hosts mark who actually attended, separately
from who said they would. A reliability score is derived from that history, and
hosts can set a reliability floor for waitlist promotion. The same
accountability runs the other way: hosts carry a reputation score and a rating,
so attendees can see whether a host actually runs the events they announce.

## Target user

- **The recurring small host.** Runs something on a rhythm — monthly potluck,
  weekly run club, craft night — for 6 to 40 people. Buys the food personally,
  so an accurate headcount is a budget decision. Currently juggling a group chat
  and a spreadsheet.
- **The person new to an area.** Wants low-stakes ways to meet people without
  walking into a room of strangers. Seeing that one person they know is already
  going is often the difference between attending and not.
- **The neighbourhood organiser.** Block parties, mutual-aid meetups, community
  garden work days. Relies on the address-privacy control, which hides the exact
  street address until someone has actually RSVP'd.

## Features

**Events** — create, browse, edit, and delete gatherings. Search by title or
description, filter by category or city, sort by soonest / newest / popular /
title. Drafts stay private to the host until published.

**RSVPs** — one click to attend, automatic waitlisting when an event is full,
automatic promotion when someone cancels. Bring a guest count. See everything
you've signed up for in one place.

**Attendance and reliability** — hosts record who actually turned up. Each
user's reliability score and band is derived from that ledger, shown as a badge,
and usable as a floor for waitlist promotion.

**Host reputation and ratings** — attendees rate hosts 1–5 after a completed
event; hosts carry a visible reputation score.

**Connections** — search people by handle, send and accept requests, and see
which of your connections are already going to an event before you commit. The
homepage surfaces upcoming events your friends are attending.

**Address privacy** — hosts can hide the exact street address until a visitor
holds an active RSVP. Enforced server-side; the fields are stripped from the API
response, not merely hidden in the UI.

**Photo uploads** — one cover photo per event, plus profile avatars. Validated
by magic bytes as well as MIME type, capped at 5MB.

**Accounts** — signup, login, change password, change login email. Both changes
re-verify the current password first.

**Moderation** — report a user or an event.

**Interface** — responsive card grid, dark and light themes, loading skeletons,
empty states, error messages, and confirmation before anything destructive.

## Technology

- **Frontend** — React, Vite, React Router, plain CSS with design tokens
- **Backend** — Node.js, Express, JWT auth with bcrypt
- **Database** — PostgreSQL (Supabase in production), Prisma ORM over the `pg`
  driver via `@prisma/adapter-pg`, with hand-written SQL for the CHECK
  constraints, partial indexes, and view Prisma can't express
- **Testing** — Vitest
- **Infrastructure** — Vercel (frontend), Render (backend), Supabase (database),
  GitHub Actions (CI + auto-deploy), Doppler (shared secrets), Docker Compose
  (local Postgres)

## Planning documents

Written before the build, kept current with it:

- [Project proposal](docs/01-project-proposal.md)
- [Database diagram (ERD)](docs/02-database-diagram.md)
- [API plan](docs/03-api-plan.md)
- [Component plan](docs/04-component-plan.md)

## Installation

```bash
git clone https://github.com/Cohort-nine/gather-app-monorepo.git
cd gather-app-monorepo

# backend
cd apps/backend
npm install
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npm run db:up               # optional: local Postgres in Docker
npm run prisma:deploy       # apply migrations
npm run db:seed             # load sample data
npm run dev                 # http://localhost:3001

# frontend, in a second terminal
cd apps/frontend
npm install
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:3001/api
npm run dev                 # http://localhost:5173
```

Each step is expanded below: [creating the database](#how-to-create-the-postgresql-database),
[environment variables](#environment-variables), [backend setup](#backend-setup),
[frontend setup](#frontend-setup), [running `schema.sql`](#how-to-run-schemasql),
and [running `seed.sql`](#how-to-run-seedsql).

## Project structure

```text
.
├── README.md
├── .gitignore
├── docker-compose.yml
└── apps/
    ├── frontend/
    │   ├── package.json
    │   ├── index.html
    │   ├── vite.config.js
    │   └── src/
    │       ├── App.jsx                 # routes
    │       ├── main.jsx                # BrowserRouter + AuthProvider
    │       ├── styles.css              # theme tokens (--accent, --glow, etc.) + shared UI
    │       ├── api/
    │       │   ├── client.js           # fetch wrapper, token storage, resolveMediaUrl()
    │       │   ├── auth.js             # signup/login/logout/me, avatar + password/email
    │       │   ├── events.js
    │       │   └── connections.js      # search, requests, accept/decline/remove
    │       ├── context/
    │       │   └── AuthContext.jsx     # session state, login/signup/logout, updateUser()
    │       ├── lib/
    │       │   └── useEventRsvp.js     # shared RSVP state/handler for any event list
    │       ├── pages/
    │       │   ├── EventsPage.jsx      # browse grid + filters
    │       │   ├── EventDetailPage.jsx
    │       │   ├── EventFormPage.jsx   # create/edit, incl. cover photo upload
    │       │   ├── MyEventsPage.jsx    # events you're hosting
    │       │   ├── MyRsvpsPage.jsx     # events you're attending
    │       │   ├── ProfilePage.jsx     # avatar upload, change password/email
    │       │   ├── ConnectionsPage.jsx # search people, requests, your connections
    │       │   ├── LoginPage.jsx
    │       │   └── SignupPage.jsx
    │       └── components/
    │           ├── Home.jsx                 # marketing homepage + hero video
    │           ├── FriendsEventsSection.jsx # "From your friends" — Home, signed-in only
    │           ├── EventCard.jsx            # the card every event list renders
    │           ├── MutualAttendees.jsx      # "people you know are going" on a card
    │           ├── GatherIntro.jsx          # dot-gather intro animation
    │           └── GatherLogo.jsx
    └── backend/
        ├── package.json
        ├── .env.example
        ├── prisma.config.ts
        ├── prisma/
        │   ├── schema.prisma
        │   ├── migrations/
        │   └── seed.js
        ├── database/
        │   ├── schema.sql               # raw SQL mirror of the schema, for teaching
        │   └── seed.sql
        └── server/
            ├── db/
            │   └── prisma.js
            ├── lib/
            │   ├── auth.js               # JWT + bcrypt helpers, auth middleware
            │   ├── validateEvent.js
            │   └── upload.js             # multer config, magic-byte type check, file save/delete
            ├── controllers/
            │   ├── authController.js     # + password/email change
            │   ├── userController.js     # avatar upload/delete
            │   ├── eventController.js    # + event cover image upload
            │   ├── connectionsController.js
            │   └── rsvpController.js
            ├── routes/
            │   ├── auth.js
            │   ├── events.js
            │   ├── connections.js
            │   └── index.js
            └── server.js
```

## Notable features

- Intro animation + marketing homepage with a high-quality canvas animation.
- Events with full RSVP and waitlist handling (auto-promotion honoring
  host `waitlistReliabilityFloor`).
- Attendance tracking and a rebuildable AttendeeReliability score used to
  influence waitlist ordering.
- JWT-based authentication (stateless tokens), stored in localStorage on the
  client and sent as `Authorization: Bearer <token>`.
- CORS policy configurable via CORS_ORIGIN with single-level wildcard support
  (e.g. `https://*.vercel.app`) so Vercel preview URLs work.
- Doppler integration for centralized secret management, with fallback to
  local `.env` files for single-developer workflows.
- **Black-and-white brand** — no hue anywhere in the UI; depth/emphasis comes
  from `--glow` (a light bleed on dark, a soft shadow ring on light) instead
  of an accent color. See the `--accent`/`--glow` tokens at the top of
  `apps/frontend/src/styles.css`.
- **Event cards as a grid**, each with a cover photo (or a quiet placeholder
  mark when none is set), the host's avatar, and — if you're signed in and
  connected to people — a small avatar stack of connections who are already
  going (`MutualAttendees.jsx`).
- **Photo uploads** — hosts can attach a single cover photo to an event
  (`EventFormPage`), and any signed-in user can set a profile avatar
  (`ProfilePage`). Both are validated server-side by MIME *and* magic bytes
  (`server/lib/upload.js`) — not just the filename or the client-supplied
  Content-Type — and capped at 5MB. This is technical validation only
  (file type/size), **not** content moderation; nothing here detects
  inappropriate imagery, which would need a third-party API.
- **Connections** — search for people by handle, send/accept/decline
  requests (`ConnectionsPage`), and see whichever of your accepted
  connections are attending a given event.
- **"From your friends"** on the homepage — upcoming events where at least
  one of your connections has RSVP'd going, shown only when signed in
  (`FriendsEventsSection.jsx`).
- **Account settings** — click your handle/avatar in the nav to reach your
  profile: replace your avatar, change your password, or change your login
  email (all require your current password to confirm identity first).
- Uploaded images are stored **in PostgreSQL** (the `images` table) and served
  from `/uploads/<id>.<ext>` with a one-year immutable cache header. Render's
  free tier wipes the local disk on every redeploy and idle spin-down, so
  files written there used to vanish; a 5MB-capped row survives both and
  needs no extra storage service.
- **Rate limiting** — login and signup allow 20 attempts per IP per 15
  minutes, so the shared demo password can't be brute-forced.

## The Gather database design

The real schema for this project lives in
[`apps/backend/database/schema.sql`](apps/backend/database/schema.sql) (PostgreSQL
14+, using `pgcrypto` for UUIDs and `citext` for case-insensitive email/handles).
It's organized into a few areas:

- **Identity** — `users`, plus `user_privacy_settings` split into its own table so
  privacy controls (who can see you listed as an attendee, whether your
  reliability score is visible, etc.) can grow independently of the hot `users` row.
- **Social graph** — `connections` (a symmetric friend edge, stored once per pair
  via a canonical ordering constraint so it can never be double-inserted in
  reverse) and `user_blocks`, which power "friends and friends-of-friends have
  been here" on event listings.
- **Events** — `events` (with full location fields, online/in-person, visibility
  `public`/`unlisted`/`invite_only`, capacity, waitlist and guest rules, and a
  `hide_exact_address_until_rsvp` flag for house-hosted gatherings), plus
  `event_series` for recurring events, `event_cohosts`, and `event_tags`.
- **RSVPs and attendance** — `rsvps` is the current-state row per person per
  event; `rsvp_status_events` is an **append-only ledger** of every status
  change, storing `hours_before_event` at write time (not derived later) so
  editing an event's start time can't retroactively rewrite anyone's history.
  `attendance` is a host-driven review gate — no row is ever inserted
  automatically, so an unmarked 'going' RSVP means "not yet reviewed," never an
  implicit no-show. Triggers keep this honest: editing attendance after an event
  is finalized automatically un-finalizes it, and a host can't finalize while any
  RSVP is still unreviewed.
- **Trust layer** — `attendee_reliability` and `host_reputation` are **derived
  caches**, rebuildable from the ledgers above, never authored directly. Scores
  are framed as recoverable (rolling 12-month windows, not lifetime tallies) —
  plus `host_ratings`, `badges`, and `user_badges`.
- **Notifications** — a scheduled queue (`notifications`) with per-channel
  `notification_preferences` (push/email/SMS/in-app).
- **Safety** — `reports`, which must survive the reporter's account being
  deleted (so it uses `ON DELETE SET NULL`, not `CASCADE`, on the reporter).
- **Read models** — views like `event_attendance_checklist` and
  `event_expected_headcount`, which weights RSVPs by each attendee's reliability
  score instead of just counting raw "going" responses, so a new user with no
  history isn't penalized (they default to a neutral 0.75).

## Requirements

Before starting, make sure you have these installed:

- Node.js
- npm
- Docker Desktop
- PostgreSQL client tools if you want to use `psql` commands directly

## Environment variables

All secret values should stay in a `.env` file or in your host's environment
variables (Doppler is recommended for teams). See `apps/backend/.env.example` and
`apps/frontend/.env.example` for examples.

Important production variables (examples):

- Frontend (Vercel):
  - VITE_API_BASE_URL=https://gather-api-07it.onrender.com/api
    - Include the `/api` suffix and do NOT include a trailing slash.
    - This variable is inlined by Vite at build time, so you must set it in
      Vercel and redeploy the frontend build.

- Backend (Render):
  - NODE_ENV=production
  - DATABASE_URL=postgresql://<user>:<pass>@<host>:<port>/<db>?schema=public
  - JWT_SECRET=<secure random string, >=32 chars>
  - DIRECT_URL=<same database, used by `prisma migrate deploy` during the build>
  - CORS_ORIGIN=https://__FRONTEND_HOST__,https://gather-app-*.vercel.app
    - The wildcard allows this project's Vercel preview deployments.

Production service URLs (current deployments)

- Frontend (Vercel): https://__FRONTEND_HOST__
- Backend (Render): https://gather-api-07it.onrender.com
- Database: Supabase (Postgres 17), connected through the session pooler

Notes on localhost fallback

- Localhost fallbacks are intentional and normal for development. Files like
  `apps/frontend/src/api/client.js` use a fallback of `http://localhost:3001/api`
  so `npm run dev` works without extra setup.
- In production you should NOT rely on those fallbacks. If `VITE_API_BASE_URL`
  is unset in a production build the bundled app will point at a localhost
  address and requests from users' browsers will fail. Set the production
  env var in Vercel and redeploy.

## Secrets management (Doppler)

`.env` works fine on one machine. It stops working the moment four people need
the same Supabase password — someone ends up pasting a connection string into
Slack, and now it lives in a chat log forever.

[Doppler](https://www.doppler.com) stores the secrets once, in the cloud, and
injects them as environment variables at run time. Nobody copies anything.

**Doppler is optional.** Every `npm run` script still reads `.env` if you
haven't set Doppler up, so a teammate is never blocked. The `:doppler` variants
below are the same commands with secrets injected instead.

### First-time setup (one person, once)

1. Create a free account at [doppler.com](https://dashboard.doppler.com/register)
2. Create a project named `gather-app` — it comes with `dev`, `stg`, and `prd` configs
3. Install the CLI and log in:

```bash
# macOS
brew install gnupg && brew install dopplerhq/cli/doppler

# Windows (PowerShell or CMD)
winget install doppler.doppler

# Windows (Git Bash) — install to your home bin
mkdir -p $HOME/bin
curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh -s -- --install-path $HOME/bin

doppler login
```

> **Git Bash users:** `doppler login` needs a real TTY. If it hangs, run
> `winpty doppler login` instead. This is a known CLI issue on MINGW64.

4. Push the secrets you already have in `.env` up to Doppler:

```bash
cd apps/backend
doppler setup            # picks project `gather-app`, config `dev` from doppler.yaml
npm run doppler:import   # uploads .env  -> Doppler
```

5. Invite your teammates from the Doppler dashboard (Team → Invite)

### Per-teammate setup (everyone else)

```bash
# install the CLI (see above), then:
doppler login
cd apps/backend
doppler setup            # doppler.yaml preselects the right project + config
npm run dev:doppler
```

No `.env` file needed. Nobody sends anybody a password.

### Daily use

```bash
npm run dev:doppler                # backend with secrets injected
npm run prisma:migrate:doppler     # migrations
npm run db:seed:doppler            # seed
npm run doppler:secrets            # list what's currently set
```

Any other script works with the same wrapper:

```bash
doppler run -- npm run <script-name>
```

### How it interacts with `.env`

`dotenv` does not overwrite variables that already exist in the environment, so
when you run through Doppler, **Doppler's values win** and a stale local `.env`
can't silently override them. Once your team is fully on Doppler you can delete
`.env` entirely.

### What's committed vs. what isn't

| File | Committed? | Contains |
| --- | --- | --- |
| `apps/backend/doppler.yaml` | yes | project + config *names* only |
| `apps/backend/.env.example` | yes | placeholder keys, no values |
| `apps/backend/.env` | **no** | real secrets, gitignored |

`doppler.yaml` holds no secret material. Committing it is what makes
`doppler setup` a single keystroke for the next person.

### Deploying

Both halves deploy automatically on every push to `main`:

- **Backend → Render.** Render watches `main`. Build command
  `cd apps/backend && npm ci && npx prisma migrate deploy`, start command
  `cd apps/backend && npm start`. New migrations apply on deploy.
- **Frontend → Vercel.** The `deploy-frontend` job in
  `.github/workflows/ci.yml` builds and deploys once tests pass. It needs one
  repository secret, `VERCEL_TOKEN`, created at vercel.com/account/tokens.

**Seeding production.** `prisma/seed.js` deletes everything before it
inserts, so with `NODE_ENV=production` it refuses to run unless `ALLOW_SEED=true`
is set for that one run. To reset the live demo data: add `ALLOW_SEED=true`
on Render, append `&& npm run db:seed` to the build command, deploy once, then
undo both.

## How to create the PostgreSQL database

This project uses Docker Compose for PostgreSQL.

From `apps/backend`, run:

```bash
npm run db:up
```

This starts the PostgreSQL container defined in the root `docker-compose.yml` file.

Prisma 7 reads its CLI database configuration from `apps/backend/prisma.config.ts`.

To stop the database:

```bash
npm run db:down
```

To view database logs:

```bash
npm run db:logs
```

## Backend setup

Open a terminal in `apps/backend` and run:

```bash
npm install
cp .env.example .env      # then fill in JWT_SECRET
npm run db:up
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run db:seed
```

Then start the backend:

```bash
npm run dev
```

The backend will run at:

```text
http://localhost:3001
```

Available REST API endpoints:

- `GET    /api/health`
- `POST   /api/auth/signup`
- `POST   /api/auth/login`
- `POST   /api/auth/logout`
- `GET    /api/auth/me`                      (auth required)
- `PATCH  /api/auth/password`                (auth required — body needs `currentPassword`)
- `PATCH  /api/auth/email`                   (auth required — body needs `currentPassword`)
- `GET    /api/categories`
- `GET    /api/events`                        (search/filter/sort/paginate)
- `GET    /api/events/:id`
- `POST   /api/events`                        (auth required)
- `PUT    /api/events/:id`                    (host/cohost only)
- `DELETE /api/events/:id`                    (host/cohost only)
- `POST   /api/events/:id/image`              (host/cohost only — multipart, field `image`)
- `POST   /api/events/:id/rsvp`               (auth required)
- `DELETE /api/events/:id/rsvp`               (auth required)
- `GET    /api/events/:id/rsvps`              (host/cohost only)
- `POST   /api/events/:id/attendance`         (host/cohost only)
- `GET    /api/events/:id/mutual-attendees`   (optional auth — empty result if signed out)
- `GET    /api/me/rsvps`                      (auth required)
- `GET    /api/me/friends-events`             (auth required — "from your friends" feed)
- `POST   /api/me/avatar`                     (auth required — multipart, field `avatar`)
- `DELETE /api/me/avatar`                     (auth required)
- `GET    /api/users/search?q=`               (auth required — excludes self + blocked)
- `POST   /api/connections`                   (auth required — body `{ userId }`)
- `GET    /api/connections?status=`           (auth required)
- `PATCH  /api/connections/:userId/accept`    (auth required — incoming pending only)
- `PATCH  /api/connections/:userId/decline`   (auth required)
- `DELETE /api/connections/:userId`           (auth required — cancel a pending request or unfriend)

Sessions are stateless JWTs. The frontend sends them as
`Authorization: Bearer <token>`.

## Frontend setup

Open a second terminal in `apps/frontend` and run:

```bash
npm install
npm run dev
```

The frontend will run at:

```text
http://localhost:5173
```

Routes:

- `/` — homepage (intro animation + hero video); signed in, also shows
  "From your friends" below the fold
- `/events` — browse published events as a card grid, RSVP if signed in
- `/events/new`, `/events/:id/edit` — host/edit an event, incl. cover photo
- `/events/:id` — event detail, incl. cover photo and who's going
- `/my-events` — events you're hosting
- `/my-rsvps` — events you're attending
- `/profile` — avatar upload, change password/change login email
- `/connections` — search people, manage requests, your connections
- `/login`, `/signup` — auth

Session state lives in `AuthContext` (`apps/frontend/src/context/AuthContext.jsx`),
backed by a JWT in `localStorage`. `apps/frontend/src/api/` holds the fetch
wrappers — `client.js` attaches the token, normalizes error handling, and
exposes `resolveMediaUrl()` (uploaded-image paths come back from the API
relative to the *backend's* origin, not the frontend's — every `<img>`
rendering an `avatarUrl`/`imageUrl` needs to resolve through it, or the
image 404s in production). `auth.js`, `events.js`, and `connections.js` are
the endpoint-specific calls.

## How to run `schema.sql`

The raw SQL files are included in `apps/backend/database` for teaching and testing.

Use this option on a fresh database if you want to set up the tables manually with SQL instead of using Prisma migrations.

From `apps/backend`, after your `.env` is configured and PostgreSQL is running, run:

```bash
npm run sql:schema
```

This executes:

```text
database/schema.sql
```

## How to run `seed.sql`

Run this after `schema.sql` if you are following the raw SQL setup path.

From `apps/backend`, run:

```bash
npm run sql:seed
```

This executes:

```text
database/seed.sql
```

## Prisma workflow

This template uses the current Prisma 7 setup:

- `prisma.config.ts` configures Prisma CLI commands
- `schema.prisma` defines the models
- `@prisma/adapter-pg` connects Prisma Client to PostgreSQL at runtime
- `prisma-client-js` keeps the generated client plain JavaScript-friendly for this class template
- A few constructs Prisma can't express (CHECK constraints, partial indexes,
  the `connection_edges` view) live in a hand-edited raw SQL migration instead
  — see the `NOTES` block at the bottom of `schema.prisma`

Useful Prisma commands from `apps/backend`:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:studio
npm run db:seed
npm run db:reset
```

### When you want to change the database schema

Do not create the migration file by hand first.

#### Instead:

- Edit `apps/backend/prisma/schema.prisma`

Run:

- `npm run prisma:migrate -- --name describe-your-change`

Prisma will:

- compare the current schema to the last migration
- generate the new migration SQL file for you
- apply it to your local database

Example:

- If you add a new column or model:
- `npm run prisma:migrate -- --name add-user-table`

## Tests

Backend business logic (event validation, password/token handling, RSVP and
waitlist behavior) has unit tests under `apps/backend/tests`, run with
[Vitest](https://vitest.dev). They mock the Prisma client, so they don't need
a running database.

```bash
cd apps/backend
npm test
```

There is no frontend test suite yet.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: it installs
and runs the backend test suite, and builds the frontend to catch compile
errors.

## Helpful backend scripts

From `apps/backend`:

```bash
npm run dev
npm run start
npm test
npm run db:up
npm run db:down
npm run db:logs
npm run db:psql
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:deploy
npm run prisma:studio
npm run db:seed
npm run db:reset
npm run sql:schema
npm run sql:seed
```

`db:psql` requires PostgreSQL client tools to be installed on your machine.

## Git and GitHub workflow

Suggested student workflow:

1. Create a new branch for your work.
2. Commit your changes regularly.
3. Push your branch to GitHub and open a PR.

## Suggested startup order

1. In `apps/backend`, run `npm install`.
2. In `apps/frontend`, run `npm install`.
3. In `apps/backend`, copy `.env.example` to `.env` and set `JWT_SECRET`.
4. In `apps/backend`, run `npm run db:up`.
5. In `apps/backend`, run `npm run prisma:generate`.
6. In `apps/backend`, run `npm run prisma:migrate -- --name init`.
7. In `apps/backend`, run `npm run db:seed`.
8. In `apps/backend`, run `npm run dev`.
9. In `apps/frontend`, run `npm run dev`.

## Notes for students

- Keep your backend code inside `apps/backend`.
- Keep your frontend code inside `apps/frontend`.
- Keep secrets in `.env` files only (or use Doppler for team secrets).
- Use Prisma models to represent your database tables.
- Use REST routes in Express to connect the frontend to PostgreSQL.
- `apps/backend/server/lib/validateEvent.js` mirrors the database's CHECK
  constraints in JavaScript. If you add a new constraint to the schema, add
  the matching check there too — the goal is a readable 400 instead of a raw
  Postgres error reaching the client.
