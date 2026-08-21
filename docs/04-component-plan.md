# Component Plan — Gather

## Tree

```text
main.jsx
└── BrowserRouter
    └── ErrorBoundary                 ← catches any render throw below it
        └── AuthProvider              ← session state for the whole app
            └── App                   ← route table
                ├── NavBar            ← every route except "/"
                │   ├── GatherLogo
                │   └── ThemeToggle
                │
                ├── Home                        "/"
                │   ├── GatherIntro             dot-gather intro animation
                │   ├── GatherLogo
                │   └── FriendsEventsSection    signed-in only
                │       └── EventCard
                │           └── MutualAttendees
                │
                ├── EventsPage                  "/events"
                │   └── EventCard  (×N)
                │       └── MutualAttendees
                │
                ├── EventFormPage               "/events/new", "/events/:id/edit"
                ├── EventDetailPage             "/events/:id"
                ├── MyEventsPage                "/my-events"
                │   ├── ConfettiBurst
                │   └── GatherLogo              empty-state mark
                ├── MyRsvpsPage                 "/my-rsvps"
                │   └── GatherLogo
                ├── ProfilePage                 "/profile"
                ├── ConnectionsPage             "/connections"
                ├── LoginPage                   "/login"
                ├── SignupPage                  "/signup"
                └── NotFound                    "*"
```

## Reusable components

The rubric asks for at least four. There are ten, each used in more than one
place or extracted because duplication had already appeared.

| Component | Used by | Why it exists |
| --- | --- | --- |
| `NavBar` | Every route except `/` | Persistent navigation. `NavLink` marks the active section with colour, weight, *and* an underline, so it never depends on colour alone. |
| `EventCard` | `EventsPage`, `FriendsEventsSection` | One card definition for every event list. Was duplicated markup in two places before it was extracted. |
| `MutualAttendees` | `EventCard` | Avatar stack of connections already going. |
| `GatherLogo` | `NavBar`, `Home`, `MyEventsPage`, `MyRsvpsPage` | Inline SVG mark. Inline rather than an `<img>` so it inherits `currentColor` and follows the theme. |
| `ThemeToggle` | `NavBar` | Dark/light switch. |
| `ErrorBoundary` | `main.jsx`, wrapping everything | A render throw unmounts the whole React tree. Without this the user gets a black screen with no explanation — which is exactly what happened before it existed. |
| `ConfettiBurst` | `MyEventsPage` | Fires once per completed event, tracked in `localStorage` so it celebrates a milestone rather than replaying on every visit. |
| `GatherIntro` | `Home` | Intro animation. |
| `FriendsEventsSection` | `Home` | "From your friends" feed, signed-in only, with a real empty state. |
| `Home` | `App` | Marketing homepage. |

## Shared state and logic

| Module | Responsibility |
| --- | --- |
| `context/AuthContext.jsx` | Session state. Holds the current user, exposes `login` / `signup` / `logout` / `updateUser`, and restores the session on load via `GET /api/auth/me`. |
| `lib/useEventRsvp.js` | Custom hook holding RSVP state and the submit handler, so any list can render an RSVP button without reimplementing optimistic updates. |
| `lib/reliability.js` | Maps a reliability band to its display label. One definition, so the nav badge and the event page can't disagree. |
| `api/client.js` | `fetch` wrapper. Attaches the token, normalises errors, rejects non-JSON responses, retries through a cold start, and exposes `resolveMediaUrl()`. |
| `api/auth.js`, `api/events.js`, `api/connections.js` | Endpoint-specific calls, so no component builds a URL by hand. |

## Required React features — where each one lives

| Requirement | Where |
| --- | --- |
| Four+ reusable components | Ten, in `src/components/` |
| At least one form | `EventFormPage`, plus `SignupPage`, `LoginPage`, `ProfilePage`, and the browse filters |
| State with `useState` | Every page; e.g. `EventsPage` holds events, categories, filters, loading, and error |
| API requests with `fetch` | `api/client.js`, used by every call |
| At least one `useEffect` | `EventsPage` (two — categories once, events on every filter change), `AuthContext`, `MyEventsPage`, `MyRsvpsPage`, `EventDetailPage` |
| Loading feedback | Skeleton cards on `EventsPage`; text status elsewhere |
| Error feedback | `.status--error` message per page, plus the global `ErrorBoundary` |
| Empty-state message | `EventsPage`, `MyEventsPage`, `MyRsvpsPage`, `ConnectionsPage`, `FriendsEventsSection` |
| Responsive interface | CSS Grid card layout, `@media (max-width: 720px)` nav collapse, 44px minimum touch targets |
| Clear navigation | `NavBar` on every route, breadcrumb back-link on event detail |
| Confirm before destructive actions | `window.confirm` before deleting an event and before cancelling an RSVP |

## Design decisions worth defending

**`ErrorBoundary` is a class component.** It's the only class in the codebase.
`componentDidCatch` has no hook equivalent, so a class is the only way to catch a
render error in React.

**The homepage has its own nav.** `App` renders `NavBar` for every path except
`/`, because the intro animation flies the logo into a reserved slot and a second
bar stacked on top would fight the choreography.

**`/events/new` is declared before `/events/:id`.** Otherwise `"new"` matches as
an id and the form becomes a 404.

**Loading state is a skeleton, not a spinner, on browse.** The layout is known
before the data arrives, so showing its shape avoids the content jump a spinner
causes when results land.

**Cancelled RSVPs stay visible under "past" rather than disappearing.** The
record that you backed out — and when — is what the reliability score is built
from. Hiding it would misrepresent your own history to you.
