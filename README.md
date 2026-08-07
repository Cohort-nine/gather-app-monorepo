# Gather

Gather is a small-gatherings events app: hosts publish events (block parties,
potlucks, hobby meetups), people RSVP, and a reliability score built from
attendance history feeds back into who gets auto-promoted off a waitlist.

Stack:

- React + React Router + Vite (frontend)
- Node.js + Express (backend API)
- PostgreSQL + Prisma ORM (with hand-written SQL for constraints/views Prisma
  can't express)
- Docker Compose for local Postgres
- Doppler for shared secrets
- Git and GitHub

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
    │       ├── App.jsx                # routes
    │       ├── main.jsx                # BrowserRouter + AuthProvider
    │       ├── styles.css
    │       ├── api/
    │       │   ├── client.js           # fetch wrapper, token storage
    │       │   ├── auth.js
    │       │   └── events.js
    │       ├── context/
    │       │   └── AuthContext.jsx     # session state, login/signup/logout
    │       ├── pages/
    │       │   ├── EventsPage.jsx      # browse + RSVP
    │       │   ├── LoginPage.jsx
    │       │   └── SignupPage.jsx
    │       └── components/
    │           ├── Home.jsx            # marketing homepage
    │           ├── GatherIntro.jsx     # dot-gather intro animation
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
            │   └── validateEvent.js
            ├── controllers/
            │   ├── authController.js
            │   ├── eventController.js
            │   └── rsvpController.js
            ├── routes/
            │   ├── auth.js
            │   ├── events.js
            │   └── index.js
            └── server.js
```

## The data model

`apps/backend/prisma/schema.prisma` is the source of truth. Broad strokes:

- **Events** — one-off gatherings with timing, location, capacity, visibility,
  and an optional recurring series.
- **RSVPs** — one row per (event, user). Status changes (`going` →
  `cancelled`, `waitlisted` → `going`, etc.) are also appended to
  `RsvpStatusEvent`, an append-only ledger. That ledger, plus `Attendance`
  records, is what reliability scores are computed *from* — the score itself
  (`AttendeeReliability`) is a rebuildable cache, never hand-edited.
- **Waitlists** — when an event is full, an RSVP goes to `waitlisted`
  instead of being rejected. Cancelling a confirmed RSVP auto-promotes the
  next eligible person, honoring the host's `waitlistReliabilityFloor`.
- **Social/trust & safety** — connections, blocks, host ratings, reports,
  badges, notifications.

Some things can't be expressed in `schema.prisma` (CHECK constraints, partial
indexes, one VIEW) and live in a hand-written SQL migration instead — see the
`NOTES` block at the bottom of the schema file for the full list.

## Requirements

Before starting, make sure you have these installed:

- Node.js
- npm
- Docker Desktop
- PostgreSQL client tools if you want to use `psql` commands directly

## Environment variables

All secret values should stay in a `.env` file.

1. Go to `apps/backend`
2. Copy `.env.example` to `.env`
3. Update the values if needed

Example:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/backend-db?schema=public"
JWT_SECRET="<32+ random characters>"
PORT=3001
```

The server refuses to start without `JWT_SECRET` set to at least 32
characters — generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The root `.gitignore` already includes `.env` so it will not be committed.

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

For Render, Railway, Vercel, Fly, and Supabase, set the environment variables in
that platform's dashboard, or connect Doppler's
[sync integration](https://docs.doppler.com/docs/integrations) so a change in
Doppler propagates automatically. Production should use a
[service token](https://docs.doppler.com/docs/service-tokens) scoped to the
`prd` config, never a personal login.

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
- `GET    /api/categories`
- `GET    /api/events`                        (search/filter/sort/paginate)
- `GET    /api/events/:id`
- `POST   /api/events`                        (auth required)
- `PUT    /api/events/:id`                    (host/cohost only)
- `DELETE /api/events/:id`                    (host/cohost only)
- `POST   /api/events/:id/rsvp`               (auth required)
- `DELETE /api/events/:id/rsvp`               (auth required)
- `GET    /api/events/:id/rsvps`              (host/cohost only)
- `POST   /api/events/:id/attendance`         (host/cohost only)
- `GET    /api/me/rsvps`                      (auth required)

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

- `/` — homepage (intro animation + hero video)
- `/events` — browse published events, RSVP if signed in
- `/login`, `/signup` — auth

Session state lives in `AuthContext` (`apps/frontend/src/context/AuthContext.jsx`),
backed by a JWT in `localStorage`. `apps/frontend/src/api/` holds the fetch
wrappers — `client.js` attaches the token and normalizes error handling,
`auth.js` and `events.js` are the endpoint-specific calls.

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
- Keep secrets in `.env` files only.
- Use Prisma models to represent your database tables.
- Use REST routes in Express to connect the frontend to PostgreSQL.
- `apps/backend/server/lib/validateEvent.js` mirrors the database's CHECK
  constraints in JavaScript. If you add a new constraint to the schema, add
  the matching check there too — the goal is a readable 400 instead of a raw
  Postgres error reaching the client.
