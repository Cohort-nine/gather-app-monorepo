// ============================================================================
// GATHER — seed data
//
// Design rule this file follows, matching the schema:
//   Scores are DERIVED. Nothing here hardcodes a reliability or reputation
//   number. We write the LEDGERS (rsvp_status_events, attendance, host_ratings)
//   and then compute attendee_reliability and host_reputation from them at the
//   end — the same way the real app will. Delete those two tables, rerun the
//   compute step, and you get identical numbers back.
//
// The data is deliberately messy in useful ways: someone who always shows up,
// someone who cancels late, someone who ghosts, a full event with a waitlist,
// a cancelled event, a draft. That's what makes the scoring visible.
//
// Run with:  npm run db:seed
// ============================================================================

import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../server/db/prisma.js";

// Every seeded account shares one password so you can log in as anyone during
// a demo. This is seed data for a local/dev database only — real accounts get
// their hash from the signup endpoint.
const DEMO_PASSWORD = "gather-demo-2026";

// ---------------------------------------------------------------------------
// Time helpers — everything is relative to "now" so the seed never goes stale.
// ---------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

const daysFromNow = (d) => new Date(now + d * DAY);
const hoursBefore = (date, h) => new Date(date.getTime() - h * HOUR);

/** connections stores one row per pair, canonically ordered (low < high). */
const orderPair = (a, b) => (a < b ? [a, b] : [b, a]);

// ---------------------------------------------------------------------------
// Wipe. Order matters — children before parents.
// ---------------------------------------------------------------------------
async function reset() {
  await prisma.report.deleteMany();
  await prisma.userBadge.deleteMany();
  await prisma.badge.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.eventInvite.deleteMany();
  await prisma.hostRating.deleteMany();
  await prisma.hostReputation.deleteMany();
  await prisma.attendeeReliability.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.rsvpStatusEvent.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.eventTag.deleteMany();
  await prisma.eventCohost.deleteMany();
  await prisma.event.deleteMany();
  await prisma.eventSeries.deleteMany();
  await prisma.category.deleteMany();
  await prisma.userBlock.deleteMany();
  await prisma.connection.deleteMany();
  await prisma.userPrivacySettings.deleteMany();
  await prisma.user.deleteMany();
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
async function seedCategories() {
  await prisma.category.createMany({
    data: [
      { slug: "food", name: "Food & Drink", sortOrder: 1 },
      { slug: "outdoors", name: "Outdoors", sortOrder: 2 },
      { slug: "games", name: "Games", sortOrder: 3 },
      { slug: "making", name: "Making & Crafts", sortOrder: 4 },
      { slug: "music", name: "Music", sortOrder: 5 },
      { slug: "learning", name: "Learning", sortOrder: 6 }
    ]
  });

  const rows = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  return Object.fromEntries(rows.map((c) => [c.slug, c.id]));
}

async function seedBadges() {
  await prisma.badge.createMany({
    data: [
      { slug: "founding-member", name: "Founding Member", description: "Joined in the first month." },
      { slug: "always-shows-up", name: "Always Shows Up", description: "Ten RSVPs, zero no-shows." },
      { slug: "good-host", name: "Good Host", description: "Hosted five events rated 4.5 or higher." },
      { slug: "connector", name: "Connector", description: "Brought ten people to their first event." },
      { slug: "regular", name: "Regular", description: "Attended the same series five times." }
    ]
  });

  const rows = await prisma.badge.findMany();
  return Object.fromEntries(rows.map((b) => [b.slug, b.id]));
}

// ---------------------------------------------------------------------------
// People
//
// Handles must match ^[a-z0-9_]{3,30}$ — the CHECK constraint enforces it.
// ---------------------------------------------------------------------------
const PEOPLE = [
  { handle: "maya_ortiz", displayName: "Maya Ortiz", city: "Columbus", lat: 39.9612, lng: -82.9988,
    bio: "Runs a monthly potluck. Will feed you." },
  { handle: "devon_park", displayName: "Devon Park", city: "Columbus", lat: 39.98, lng: -83.004,
    bio: "Board games, mostly co-op." },
  { handle: "sam_reyes", displayName: "Sam Reyes", city: "Columbus", lat: 39.953, lng: -83.01,
    bio: "Trail runner. Slow but consistent." },
  { handle: "kira_nakamura", displayName: "Kira Nakamura", city: "Columbus", lat: 40.01, lng: -83.02,
    bio: "Ceramics and bad puns." },
  { handle: "theo_bright", displayName: "Theo Bright", city: "Columbus", lat: 39.97, lng: -82.99 },
  { handle: "priya_shah", displayName: "Priya Shah", city: "Columbus", lat: 39.99, lng: -83.03,
    bio: "Learning bass. Apologies in advance." },
  { handle: "lena_fox", displayName: "Lena Fox", city: "Columbus", lat: 39.965, lng: -83.015 },
  { handle: "amir_haddad", displayName: "Amir Haddad", city: "Columbus", lat: 39.975, lng: -82.985 },
  { handle: "nina_castro", displayName: "Nina Castro", city: "Cleveland", lat: 41.4993, lng: -81.6944,
    bio: "Visiting often enough to count." },
  { handle: "jonah_webb", displayName: "Jonah Webb", city: "Columbus", lat: 39.958, lng: -83.005 },
  { handle: "ruth_okafor", displayName: "Ruth Okafor", city: "Columbus", lat: 40.005, lng: -83.012,
    bio: "Here for the snacks and the people." },
  { handle: "cal_dunn", displayName: "Cal Dunn", city: "Columbus", lat: 39.962, lng: -82.995 }
];

async function seedUsers() {
  const users = {};
  // Hash once, reuse for all twelve — bcrypt at 12 rounds is slow by design.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const [i, p] of PEOPLE.entries()) {
    const user = await prisma.user.create({
      data: {
        handle: p.handle,
        email: `${p.handle}@example.com`,
        passwordHash,
        lastLoginAt: daysFromNow(-2),
        displayName: p.displayName,
        // Keyed on the handle, so a person keeps the same face across reseeds
        // and across the card, the attendee list, and the nav. Two people are
        // deliberately left without one, so the initials fallback stays a
        // visible path rather than dead code.
        avatarUrl:
          p.handle === "cal_dunn" || p.handle === "nina_castro"
            ? null
            : `https://i.pravatar.cc/160?u=${p.handle}`,
        bio: p.bio ?? null,
        homeCity: p.city,
        homeLat: p.lat,
        homeLng: p.lng,
        // Stagger join dates so "founding member" means something.
        joinedAt: daysFromNow(-300 + i * 12),
        emailVerifiedAt: daysFromNow(-299 + i * 12),
        privacySettings: {
          create: {
            // A couple of people are more private than the default.
            attendeeVisibility:
              p.handle === "nina_castro"
                ? "host_only"
                : p.handle === "cal_dunn"
                  ? "nobody"
                  : "connections_and_mutuals",
            surfaceAsMutual: p.handle !== "cal_dunn",
            showReliabilityToHosts: p.handle !== "jonah_webb",
            discoverableByHandle: true
          }
        }
      }
    });

    users[p.handle] = user;
  }

  return users;
}

// ---------------------------------------------------------------------------
// Social graph — powers "friends and friends-of-friends have been here"
// ---------------------------------------------------------------------------
const FRIENDSHIPS = [
  ["maya_ortiz", "devon_park"],
  ["maya_ortiz", "sam_reyes"],
  ["maya_ortiz", "kira_nakamura"],
  ["maya_ortiz", "ruth_okafor"],
  ["devon_park", "theo_bright"],
  ["devon_park", "priya_shah"],
  ["sam_reyes", "lena_fox"],
  ["sam_reyes", "amir_haddad"],
  ["kira_nakamura", "priya_shah"],
  ["kira_nakamura", "jonah_webb"],
  ["theo_bright", "nina_castro"],
  ["priya_shah", "ruth_okafor"],
  ["lena_fox", "cal_dunn"],
  ["amir_haddad", "jonah_webb"],
  ["ruth_okafor", "nina_castro"]
];

const PENDING_REQUESTS = [
  ["theo_bright", "sam_reyes"],
  ["cal_dunn", "maya_ortiz"]
];

async function seedConnections(users) {
  for (const [a, b] of FRIENDSHIPS) {
    const [low, high] = orderPair(users[a].id, users[b].id);
    await prisma.connection.create({
      data: {
        userLow: low,
        userHigh: high,
        requestedBy: users[a].id,
        status: "accepted",
        requestedAt: daysFromNow(-120),
        // CHECK: accepted rows must carry an acceptedAt.
        acceptedAt: daysFromNow(-119)
      }
    });
  }

  for (const [a, b] of PENDING_REQUESTS) {
    const [low, high] = orderPair(users[a].id, users[b].id);
    await prisma.connection.create({
      data: {
        userLow: low,
        userHigh: high,
        requestedBy: users[a].id,
        status: "pending",
        requestedAt: daysFromNow(-4)
      }
    });
  }

  // One safety edge. Blocks are directed and survive independently of
  // friendship state, which is why they live in their own table.
  await prisma.userBlock.create({
    data: {
      blockerId: users.lena_fox.id,
      blockedId: users.jonah_webb.id,
      reason: "Repeated unwanted messages after an event.",
      createdAt: daysFromNow(-30)
    }
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
async function seedEvents(users, categories) {
  const potluck = await prisma.eventSeries.create({
    data: {
      hostId: users.maya_ortiz.id,
      title: "Third Thursday Potluck",
      slug: "third-thursday-potluck",
      description: "Bring a dish, bring a friend. Same living room every month.",
      cadence: "monthly",
      createdAt: daysFromNow(-250)
    }
  });

  const gameNight = await prisma.eventSeries.create({
    data: {
      hostId: users.devon_park.id,
      title: "Co-op Game Night",
      slug: "co-op-game-night",
      description: "Nobody loses alone.",
      cadence: "biweekly",
      createdAt: daysFromNow(-180)
    }
  });

  const base = {
    timezone: "America/New_York",
    city: "Columbus",
    region: "OH",
    countryCode: "US"
  };

  const defs = [
    // ---- PAST, COMPLETED. These are what the ledgers get built from. ------
    {
      key: "potluckMarch",
      hostId: users.maya_ortiz.id,
      seriesId: potluck.id,
      categoryId: categories.food,
      title: "Third Thursday Potluck — March",
      slug: "third-thursday-potluck-march",
      description: "Soup theme. Someone please bring bread.",
      startsAt: daysFromNow(-60),
      hours: 3,
      placeName: "Maya's place",
      addressLine1: "418 Hamlet St",
      lat: 39.9612,
      lng: -82.9988,
      capacity: 12,
      status: "completed",
      tags: ["potluck", "vegetarian-friendly"]
    },
    {
      key: "trailRun",
      hostId: users.sam_reyes.id,
      categoryId: categories.outdoors,
      title: "Saturday Trail Run — Highbanks",
      slug: "saturday-trail-run-highbanks",
      description: "Five miles, conversational pace. Nobody gets dropped.",
      startsAt: daysFromNow(-45),
      hours: 2,
      placeName: "Highbanks Metro Park",
      addressLine1: "9466 Columbus Pike",
      lat: 40.1467,
      lng: -83.018,
      capacity: 10,
      hideExactAddressUntilRsvp: false,
      status: "completed",
      tags: ["running", "beginner-welcome"]
    },
    {
      key: "gameNightApril",
      hostId: users.devon_park.id,
      seriesId: gameNight.id,
      categoryId: categories.games,
      title: "Co-op Game Night — Spirit Island",
      slug: "co-op-game-night-spirit-island",
      description: "Teaching game first, then a full run.",
      startsAt: daysFromNow(-30),
      hours: 4,
      placeName: "Devon's apartment",
      addressLine1: "77 E 5th Ave, Apt 3",
      lat: 39.98,
      lng: -83.004,
      capacity: 6,
      status: "completed",
      tags: ["board-games", "co-op"]
    },
    {
      key: "ceramicsIntro",
      hostId: users.kira_nakamura.id,
      categoryId: categories.making,
      title: "Intro to Wheel Throwing",
      slug: "intro-to-wheel-throwing",
      description: "Six wheels, six people. Clay provided.",
      startsAt: daysFromNow(-15),
      hours: 3,
      placeName: "Glassaxis Studio",
      addressLine1: "610 W Town St",
      lat: 39.956,
      lng: -83.018,
      capacity: 6,
      status: "completed",
      tags: ["ceramics", "hands-on"]
    },

    // ---- UPCOMING, PUBLISHED ---------------------------------------------
    {
      key: "potluckNext",
      hostId: users.maya_ortiz.id,
      seriesId: potluck.id,
      categoryId: categories.food,
      title: "Third Thursday Potluck — Summer",
      slug: "third-thursday-potluck-summer",
      description: "Grill's working again. Bring something that likes fire.",
      startsAt: daysFromNow(9),
      hours: 3,
      placeName: "Maya's place",
      addressLine1: "418 Hamlet St",
      lat: 39.9612,
      lng: -82.9988,
      capacity: 12,
      allowGuests: true,
      maxGuestsPerRsvp: 2,
      tags: ["potluck", "outdoor"]
    },
    {
      key: "openMic",
      hostId: users.priya_shah.id,
      categoryId: categories.music,
      title: "Very Casual Open Mic",
      slug: "very-casual-open-mic",
      description: "First-timers strongly encouraged. Three-song limit.",
      startsAt: daysFromNow(5),
      hours: 3,
      placeName: "Wild Goose Creative",
      addressLine1: "2491 Summit St",
      lat: 40.014,
      lng: -83.0,
      capacity: 30,
      hideExactAddressUntilRsvp: false,
      tags: ["music", "beginner-welcome"]
    },
    {
      // Deliberately over-subscribed so the waitlist has real rows.
      key: "smallDinner",
      hostId: users.ruth_okafor.id,
      categoryId: categories.food,
      title: "Six-Seat Dinner: West African Home Cooking",
      slug: "six-seat-dinner-west-african",
      description: "Jollof, egusi, plantain. Four seats, no more.",
      startsAt: daysFromNow(12),
      hours: 3,
      placeName: "Ruth's kitchen",
      addressLine1: "1204 Neil Ave",
      lat: 40.005,
      lng: -83.012,
      capacity: 4,
      // Only reasonably reliable people get auto-promoted off this waitlist.
      waitlistReliabilityFloor: 0.7,
      tags: ["dinner", "small-group"]
    },
    {
      key: "gameNightNext",
      hostId: users.devon_park.id,
      seriesId: gameNight.id,
      categoryId: categories.games,
      title: "Co-op Game Night — Gloomhaven",
      slug: "co-op-game-night-gloomhaven",
      description: "Campaign start. Commit to the whole arc if you can.",
      startsAt: daysFromNow(16),
      hours: 4,
      placeName: "Devon's apartment",
      addressLine1: "77 E 5th Ave, Apt 3",
      lat: 39.98,
      lng: -83.004,
      capacity: 5,
      tags: ["board-games", "campaign"]
    },
    {
      key: "sqlWorkshop",
      hostId: users.amir_haddad.id,
      categoryId: categories.learning,
      title: "SQL for People Who Avoid SQL",
      slug: "sql-for-people-who-avoid-sql",
      description: "Two hours, one database, zero judgment.",
      startsAt: daysFromNow(21),
      hours: 2,
      isOnline: true,
      onlineUrl: "https://meet.example.com/sql-workshop",
      capacity: 40,
      hideExactAddressUntilRsvp: false,
      tags: ["learning", "online"]
    },
    {
      key: "unlistedBirthday",
      hostId: users.theo_bright.id,
      categoryId: categories.food,
      title: "Theo's Birthday Thing",
      slug: "theos-birthday-thing",
      description: "Low key. Link only.",
      startsAt: daysFromNow(7),
      hours: 5,
      placeName: "Backyard",
      addressLine1: "88 Hudson St",
      lat: 39.97,
      lng: -82.99,
      capacity: 20,
      visibility: "unlisted",
      tags: ["birthday"]
    },

    // ---- EDGE CASES the UI needs to handle --------------------------------
    {
      key: "cancelledHike",
      hostId: users.sam_reyes.id,
      categoryId: categories.outdoors,
      title: "Sunrise Hike — Hocking Hills",
      slug: "sunrise-hike-hocking-hills",
      description: "Early start, long drive, worth it.",
      startsAt: daysFromNow(3),
      hours: 6,
      placeName: "Old Man's Cave lot",
      lat: 39.43,
      lng: -82.54,
      capacity: 8,
      status: "cancelled",
      cancellationReason: "Trail closed after storm damage.",
      tags: ["hiking"]
    },
    {
      key: "draftPicnic",
      hostId: users.lena_fox.id,
      categoryId: categories.outdoors,
      title: "Park Picnic (planning)",
      slug: "park-picnic-planning",
      description: "Still picking a date.",
      startsAt: daysFromNow(40),
      hours: 4,
      placeName: "Schiller Park",
      lat: 39.945,
      lng: -82.997,
      capacity: 25,
      status: "draft",
      // No cover yet — a half-finished draft is exactly the case the
      // placeholder mark exists for, so leaving one event without an image
      // keeps that path visible instead of theoretical.
      image: false,
      tags: []
    }
  ];

  const events = {};

  for (const d of defs) {
    const startsAt = d.startsAt;
    const status = d.status ?? "published";
    const endsAt = new Date(startsAt.getTime() + d.hours * HOUR);

    const event = await prisma.event.create({
      data: {
        ...base,
        hostId: d.hostId,
        seriesId: d.seriesId ?? null,
        categoryId: d.categoryId,
        title: d.title,
        slug: d.slug,
        description: d.description,
        // Cover photo, derived from the slug rather than listed per event, so
        // every event gets a stable distinct image and adding one needs no
        // extra work. Seeded by slug means the same event always gets the same
        // photo — a random URL would reshuffle the whole grid on every reload.
        //
        // An absolute URL on purpose. Uploaded covers land in
        // apps/backend/uploads/, which is an ephemeral filesystem on Render's
        // free tier — they vanish on the next redeploy. resolveMediaUrl()
        // passes absolute http(s) through untouched, so these survive.
        //
        // `image: false` on a definition opts out, which keeps the
        // placeholder-mark path visible somewhere in the seed.
        imageUrl: d.image === false ? null : `https://picsum.photos/seed/gather-${d.slug}/800/450`,
        startsAt,
        endsAt,
        // CHECK: rsvp_closes_at must be <= starts_at.
        rsvpClosesAt: hoursBefore(startsAt, 12),
        isOnline: d.isOnline ?? false,
        onlineUrl: d.onlineUrl ?? null,
        placeName: d.placeName ?? null,
        addressLine1: d.addressLine1 ?? null,
        lat: d.lat ?? null,
        lng: d.lng ?? null,
        hideExactAddressUntilRsvp: d.hideExactAddressUntilRsvp ?? true,
        capacity: d.capacity ?? null,
        allowWaitlist: true,
        allowGuests: d.allowGuests ?? false,
        maxGuestsPerRsvp: d.maxGuestsPerRsvp ?? 0,
        waitlistReliabilityFloor: d.waitlistReliabilityFloor ?? 0,
        visibility: d.visibility ?? "public",
        status,
        publishedAt: status === "draft" ? null : daysFromNow(-70),
        // CHECK: cancelled rows must carry a cancelledAt.
        cancelledAt: status === "cancelled" ? daysFromNow(-2) : null,
        cancellationReason: d.cancellationReason ?? null,
        completedAt: status === "completed" ? endsAt : null,
        tags: d.tags?.length ? { create: d.tags.map((tag) => ({ tag })) } : undefined
      }
    });

    events[d.key] = event;
  }

  // Shared hosting duties.
  await prisma.eventCohost.createMany({
    data: [
      { eventId: events.potluckNext.id, userId: users.ruth_okafor.id },
      { eventId: events.openMic.id, userId: users.kira_nakamura.id, canEdit: false },
      { eventId: events.sqlWorkshop.id, userId: users.jonah_webb.id }
    ]
  });

  return events;
}

// ---------------------------------------------------------------------------
// RSVPs + the append-only ledger
//
// Every RSVP writes at least one rsvp_status_events row. Cancellations write a
// second one carrying hoursBeforeEvent — that number is what separates "gave
// notice" from "ghosted", and it is snapshotted at write time so a later edit
// to the event's start time cannot retroactively change someone's score.
// ---------------------------------------------------------------------------
async function createRsvp(event, user, opts = {}) {
  const {
    status = "going",
    guestCount = 0,
    waitlistPosition = null,
    respondedDaysBeforeStart = 20,
    cancelledHoursBefore = null,
    note = null
  } = opts;

  const respondedAt = new Date(event.startsAt.getTime() - respondedDaysBeforeStart * DAY);
  const cancelledAt =
    cancelledHoursBefore === null ? null : hoursBefore(event.startsAt, cancelledHoursBefore);

  const rsvp = await prisma.rsvp.create({
    data: {
      eventId: event.id,
      userId: user.id,
      status,
      guestCount,
      // CHECK: waitlist_position is set if and only if status = 'waitlisted'.
      waitlistPosition: status === "waitlisted" ? waitlistPosition : null,
      firstRespondedAt: respondedAt,
      statusChangedAt: cancelledAt ?? respondedAt,
      cancelledAt,
      noteToHost: note,
      createdAt: respondedAt
    }
  });

  // Ledger row 1: the original response.
  await prisma.rsvpStatusEvent.create({
    data: {
      rsvpId: rsvp.id,
      eventId: event.id,
      actorId: user.id,
      fromStatus: null,
      toStatus: status === "cancelled" ? "going" : status,
      hoursBeforeEvent: (event.startsAt.getTime() - respondedAt.getTime()) / HOUR,
      eventStartsAtSnapshot: event.startsAt,
      createdAt: respondedAt
    }
  });

  // Ledger row 2: the cancellation, if there was one.
  if (status === "cancelled") {
    await prisma.rsvpStatusEvent.create({
      data: {
        rsvpId: rsvp.id,
        eventId: event.id,
        actorId: user.id,
        fromStatus: "going",
        toStatus: "cancelled",
        hoursBeforeEvent: cancelledHoursBefore,
        eventStartsAtSnapshot: event.startsAt,
        reason:
          cancelledHoursBefore >= 48
            ? "Something came up — sorry, giving as much notice as I can."
            : "Can't make it.",
        createdAt: cancelledAt
      }
    });
  }

  return rsvp;
}

async function markAttendance(event, rsvp, userId, outcome, opts = {}) {
  await prisma.attendance.create({
    data: {
      eventId: event.id,
      userId,
      rsvpId: rsvp.id,
      outcome,
      method: opts.method ?? "host_marked",
      guestsBrought: opts.guestsBrought ?? 0,
      checkedInAt: outcome === "attended" ? event.startsAt : null,
      markedById: opts.markedById ?? event.hostId,
      markedAt: new Date(event.startsAt.getTime() + 5 * HOUR),
      notes: opts.notes ?? null
    }
  });
}

async function seedRsvpsAndAttendance(users, events) {
  // ---- PAST EVENT 1: potluck. Mostly good, one ghost, two cancels. -------
  const p1 = [
    ["devon_park", "attended"],
    ["sam_reyes", "attended"],
    ["kira_nakamura", "attended"],
    ["ruth_okafor", "attended"],
    ["priya_shah", "attended"],
    ["theo_bright", "no_show"]
  ];

  for (const [handle, outcome] of p1) {
    const rsvp = await createRsvp(events.potluckMarch, users[handle], {
      respondedDaysBeforeStart: 14
    });
    await markAttendance(events.potluckMarch, rsvp, users[handle].id, outcome);
  }

  // Jonah cancelled 6 hours out — inside the notice window.
  await createRsvp(events.potluckMarch, users.jonah_webb, {
    status: "cancelled",
    respondedDaysBeforeStart: 12,
    cancelledHoursBefore: 6
  });

  // Amir cancelled 5 days out — plenty of notice, shouldn't be penalized.
  await createRsvp(events.potluckMarch, users.amir_haddad, {
    status: "cancelled",
    respondedDaysBeforeStart: 15,
    cancelledHoursBefore: 120
  });

  // ---- PAST EVENT 2: trail run ------------------------------------------
  const p2 = [
    ["lena_fox", "attended"],
    ["amir_haddad", "attended"],
    ["maya_ortiz", "attended"],
    ["cal_dunn", "attended"],
    ["jonah_webb", "no_show"]
  ];

  for (const [handle, outcome] of p2) {
    const rsvp = await createRsvp(events.trailRun, users[handle], {
      respondedDaysBeforeStart: 10
    });
    await markAttendance(events.trailRun, rsvp, users[handle].id, outcome, {
      method: "self_checkin"
    });
  }

  // ---- PAST EVENT 3: game night. One excused absence. --------------------
  const p3 = [
    ["theo_bright", "attended"],
    ["priya_shah", "attended"],
    ["maya_ortiz", "attended"],
    // Excused = told the host, host accepted it. Not a no-show.
    ["nina_castro", "excused"]
  ];

  for (const [handle, outcome] of p3) {
    const rsvp = await createRsvp(events.gameNightApril, users[handle], {
      respondedDaysBeforeStart: 9
    });
    await markAttendance(events.gameNightApril, rsvp, users[handle].id, outcome, {
      notes: outcome === "excused" ? "Sick — let me know that morning." : null
    });
  }

  // ---- PAST EVENT 4: ceramics --------------------------------------------
  const p4 = [
    ["priya_shah", "attended"],
    ["ruth_okafor", "attended"],
    ["lena_fox", "attended"],
    ["devon_park", "attended"],
    ["jonah_webb", "no_show"]
  ];

  for (const [handle, outcome] of p4) {
    const rsvp = await createRsvp(events.ceramicsIntro, users[handle], {
      respondedDaysBeforeStart: 8
    });
    await markAttendance(events.ceramicsIntro, rsvp, users[handle].id, outcome, {
      method: "qr_scan"
    });
  }

  // ---- UPCOMING: potluck, with guests ------------------------------------
  for (const handle of ["devon_park", "kira_nakamura", "sam_reyes", "priya_shah"]) {
    await createRsvp(events.potluckNext, users[handle], {
      respondedDaysBeforeStart: 3,
      guestCount: handle === "devon_park" ? 2 : 0,
      note: handle === "devon_park" ? "Bringing my roommate and her partner." : null
    });
  }

  // ---- UPCOMING: open mic -------------------------------------------------
  for (const handle of ["kira_nakamura", "theo_bright", "ruth_okafor", "amir_haddad", "maya_ortiz"]) {
    await createRsvp(events.openMic, users[handle], { respondedDaysBeforeStart: 2 });
  }

  // One declined — explicitly said no, which is different from never answering.
  await createRsvp(events.openMic, users.cal_dunn, {
    status: "declined",
    respondedDaysBeforeStart: 2
  });

  // ---- UPCOMING: six-seat dinner. Capacity 4, so a real waitlist. --------
  for (const handle of ["maya_ortiz", "priya_shah", "kira_nakamura", "lena_fox"]) {
    await createRsvp(events.smallDinner, users[handle], { respondedDaysBeforeStart: 6 });
  }

  // Positions are unique per event — enforced by a partial unique index.
  const waitlist = ["devon_park", "sam_reyes", "jonah_webb"];
  for (const [i, handle] of waitlist.entries()) {
    await createRsvp(events.smallDinner, users[handle], {
      status: "waitlisted",
      waitlistPosition: i + 1,
      respondedDaysBeforeStart: 5
    });
  }

  // ---- UPCOMING: the rest -------------------------------------------------
  for (const handle of ["theo_bright", "priya_shah", "maya_ortiz"]) {
    await createRsvp(events.gameNightNext, users[handle], { respondedDaysBeforeStart: 8 });
  }

  for (const handle of ["jonah_webb", "ruth_okafor", "lena_fox", "nina_castro", "cal_dunn"]) {
    await createRsvp(events.sqlWorkshop, users[handle], { respondedDaysBeforeStart: 11 });
  }

  for (const handle of ["devon_park", "nina_castro", "sam_reyes"]) {
    await createRsvp(events.unlistedBirthday, users[handle], { respondedDaysBeforeStart: 4 });
  }

  // The cancelled hike still has RSVPs — the event died, not the intent.
  // Nobody is penalized for a host cancellation.
  for (const handle of ["lena_fox", "amir_haddad", "maya_ortiz"]) {
    await createRsvp(events.cancelledHike, users[handle], { respondedDaysBeforeStart: 9 });
  }
}

// ---------------------------------------------------------------------------
// Host ratings — the ledger behind host_reputation
// ---------------------------------------------------------------------------
async function seedHostRatings(users, events) {
  const ratings = [
    [events.potluckMarch, "devon_park", 5, "Maya makes it easy to show up alone."],
    [events.potluckMarch, "sam_reyes", 5, null],
    [events.potluckMarch, "kira_nakamura", 4, "Ran a little long, but great."],
    [events.trailRun, "lena_fox", 5, "Genuinely nobody got dropped."],
    [events.trailRun, "amir_haddad", 4, null],
    [events.trailRun, "maya_ortiz", 5, null],
    [events.gameNightApril, "theo_bright", 5, "Best rules explanation I've had."],
    [events.gameNightApril, "priya_shah", 4, null],
    [events.ceramicsIntro, "priya_shah", 5, null],
    [events.ceramicsIntro, "ruth_okafor", 5, "Kira is patient with beginners."],
    [events.ceramicsIntro, "lena_fox", 3, "Fun, but the studio was freezing."]
  ];

  for (const [event, handle, rating, comment] of ratings) {
    await prisma.hostRating.create({
      data: {
        eventId: event.id,
        hostId: event.hostId,
        raterId: users[handle].id,
        rating,
        comment,
        createdAt: new Date(event.startsAt.getTime() + DAY)
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Invites, notifications, badges, reports
// ---------------------------------------------------------------------------
async function seedEngagement(users, events, badges) {
  await prisma.eventInvite.create({
    data: {
      eventId: events.unlistedBirthday.id,
      inviterId: users.theo_bright.id,
      inviteeId: users.kira_nakamura.id,
      status: "sent",
      token: "inv_theo_kira_birthday",
      message: "Would love to have you there.",
      sentAt: daysFromNow(-5),
      expiresAt: daysFromNow(7)
    }
  });

  await prisma.eventInvite.create({
    data: {
      eventId: events.smallDinner.id,
      inviterId: users.ruth_okafor.id,
      inviteeId: users.maya_ortiz.id,
      status: "accepted",
      token: "inv_ruth_maya_dinner",
      sentAt: daysFromNow(-8),
      respondedAt: daysFromNow(-6)
    }
  });

  // Invite by email — the person doesn't have an account yet.
  await prisma.eventInvite.create({
    data: {
      eventId: events.openMic.id,
      inviterId: users.priya_shah.id,
      inviteeEmail: "newcomer@example.com",
      status: "sent",
      token: "inv_priya_email_openmic",
      message: "You said you wanted to try playing in public. Here's your chance.",
      sentAt: daysFromNow(-3),
      expiresAt: daysFromNow(5)
    }
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: users.devon_park.id,
        eventId: events.potluckNext.id,
        channel: "in_app",
        type: "rsvp_confirmed",
        title: "You're going to Third Thursday Potluck — Summer",
        body: "Maya will share the exact address 12 hours before.",
        sentAt: daysFromNow(-3),
        readAt: daysFromNow(-3)
      },
      {
        userId: users.sam_reyes.id,
        eventId: events.smallDinner.id,
        channel: "push",
        type: "waitlist_position",
        title: "You're #2 on the waitlist",
        body: "We'll let you know if a seat opens up.",
        sentAt: daysFromNow(-5)
      },
      {
        userId: users.lena_fox.id,
        eventId: events.cancelledHike.id,
        channel: "email",
        type: "event_cancelled",
        title: "Sunrise Hike has been cancelled",
        body: "Trail closed after storm damage.",
        sentAt: daysFromNow(-2)
      },
      {
        userId: users.kira_nakamura.id,
        eventId: events.unlistedBirthday.id,
        channel: "in_app",
        type: "invite_received",
        title: "Theo invited you to their birthday",
        sentAt: daysFromNow(-5)
      }
    ]
  });

  await prisma.notificationPreference.createMany({
    data: [
      { userId: users.cal_dunn.id, type: "event_reminder", channel: "push", enabled: false },
      { userId: users.cal_dunn.id, type: "event_reminder", channel: "email", enabled: true },
      { userId: users.jonah_webb.id, type: "waitlist_position", channel: "push", enabled: false },
      { userId: users.maya_ortiz.id, type: "rsvp_confirmed", channel: "email", enabled: false }
    ]
  });

  await prisma.userBadge.createMany({
    data: [
      { userId: users.maya_ortiz.id, badgeId: badges["founding-member"], awardedAt: daysFromNow(-270) },
      { userId: users.maya_ortiz.id, badgeId: badges["good-host"], awardedAt: daysFromNow(-40) },
      { userId: users.devon_park.id, badgeId: badges["founding-member"], awardedAt: daysFromNow(-260) },
      { userId: users.priya_shah.id, badgeId: badges["always-shows-up"], awardedAt: daysFromNow(-20) },
      { userId: users.sam_reyes.id, badgeId: badges["good-host"], awardedAt: daysFromNow(-35) },
      { userId: users.ruth_okafor.id, badgeId: badges["regular"], awardedAt: daysFromNow(-25) }
    ]
  });

  // CHECK: exactly one subject — a user OR an event, never both.
  await prisma.report.create({
    data: {
      reporterId: users.lena_fox.id,
      subjectUserId: users.jonah_webb.id,
      type: "harassment",
      details: "Kept messaging after I asked him to stop.",
      createdAt: daysFromNow(-30)
    }
  });

  await prisma.report.create({
    data: {
      reporterId: users.cal_dunn.id,
      subjectEventId: events.openMic.id,
      type: "spam",
      details: "Description looked like a copy-paste promo.",
      resolvedAt: daysFromNow(-1),
      resolutionNote: "Reviewed — legitimate community event. No action taken.",
      createdAt: daysFromNow(-4)
    }
  });
}

// ---------------------------------------------------------------------------
// DERIVED SCORES
//
// This is the important part. Nothing above wrote a score. We read the ledgers
// and compute both caches — exactly what a nightly job (or a post-event hook)
// would do in production.
// ---------------------------------------------------------------------------

/** Cancelling with less than this much notice counts against you. */
const NOTICE_WINDOW_HOURS = 48;

/**
 * A band is a human-readable summary shown to hosts when the user has hidden
 * their numeric score.
 *
 * `graded === 0` is its own case on purpose. Someone with no completed history
 * scores 1.00 by default, but calling that "excellent" would tell a host this
 * person is proven when nothing has been tested yet. "unrated" is honest, and
 * it lets the UI say "new to Gather" instead of implying a track record.
 */
function reliabilityBand(score, graded) {
  if (graded === 0) return "unrated";
  if (score >= 0.9) return "excellent";
  if (score >= 0.75) return "good";
  if (score >= 0.5) return "mixed";
  return "unreliable";
}

async function computeAttendeeReliability() {
  const users = await prisma.user.findMany({ select: { id: true } });

  for (const { id: userId } of users) {
    const attendance = await prisma.attendance.findMany({
      where: { userId },
      select: { outcome: true }
    });

    // Cancellations live in the RSVP ledger, not in attendance.
    const cancellations = await prisma.rsvpStatusEvent.findMany({
      where: { actorId: userId, toStatus: "cancelled" },
      select: { hoursBeforeEvent: true }
    });

    const rsvpCount = await prisma.rsvp.count({ where: { userId } });

    const attendedCount = attendance.filter((a) => a.outcome === "attended").length;
    const noShowCount = attendance.filter((a) => a.outcome === "no_show").length;
    const excusedCount = attendance.filter((a) => a.outcome === "excused").length;

    let cancelledWithNoticeCount = 0;
    let cancelledLateCount = 0;

    for (const c of cancellations) {
      const hours = Number(c.hoursBeforeEvent ?? 0);
      if (hours >= NOTICE_WINDOW_HOURS) cancelledWithNoticeCount += 1;
      else cancelledLateCount += 1;
    }

    // Weighting:
    //   attended             -> full credit
    //   no_show              -> zero credit
    //   cancelled late       -> half credit (you told someone, just too late)
    //   cancelled w/ notice  -> excluded entirely, neither helps nor hurts
    //   excused              -> excluded entirely
    // Someone with no graded history starts at 1.00 rather than 0.00 — a new
    // account is not "unreliable", it's simply unknown.
    const graded = attendedCount + noShowCount + cancelledLateCount;
    const credit = attendedCount + 0.5 * cancelledLateCount;
    const score = graded === 0 ? 1 : credit / graded;
    const clamped = Math.max(0, Math.min(1, score));

    await prisma.attendeeReliability.create({
      data: {
        userId,
        score: clamped.toFixed(2),
        rsvpCount,
        attendedCount,
        noShowCount,
        excusedCount,
        cancelledWithNoticeCount,
        cancelledLateCount,
        band: reliabilityBand(clamped, graded)
      }
    });
  }
}

async function computeHostReputation() {
  // Only people who have actually hosted get a row.
  const hosts = await prisma.event.findMany({
    distinct: ["hostId"],
    select: { hostId: true }
  });

  for (const { hostId } of hosts) {
    const hosted = await prisma.event.findMany({
      where: { hostId },
      select: { status: true }
    });

    const ratings = await prisma.hostRating.findMany({
      where: { hostId },
      select: { rating: true }
    });

    const ratingCount = ratings.length;
    const average =
      ratingCount === 0 ? 0 : ratings.reduce((sum, r) => sum + r.rating, 0) / ratingCount;

    await prisma.hostReputation.create({
      data: {
        userId: hostId,
        score: average.toFixed(2),
        eventsHosted: hosted.length,
        eventsCompleted: hosted.filter((e) => e.status === "completed").length,
        eventsCancelled: hosted.filter((e) => e.status === "cancelled").length,
        ratingCount
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  console.log("Resetting…");
  await reset();

  console.log("Seeding reference data…");
  const categories = await seedCategories();
  const badges = await seedBadges();

  console.log("Seeding people and the social graph…");
  const users = await seedUsers();
  await seedConnections(users);

  console.log("Seeding events…");
  const events = await seedEvents(users, categories);

  console.log("Seeding RSVPs and attendance ledgers…");
  await seedRsvpsAndAttendance(users, events);
  await seedHostRatings(users, events);

  console.log("Seeding invites, notifications, badges, reports…");
  await seedEngagement(users, events, badges);

  console.log("Computing derived scores from the ledgers…");
  await computeAttendeeReliability();
  await computeHostReputation();

  // A quick readout so you can eyeball that the scoring behaved.
  const summary = await prisma.attendeeReliability.findMany({
    include: { user: { select: { handle: true } } },
    orderBy: { score: "desc" }
  });

  console.log("\nAttendee reliability (derived, not authored):");
  for (const r of summary) {
    console.log(
      `  ${r.user.handle.padEnd(16)}${String(r.score).padStart(5)}  ${String(r.band).padEnd(11)}` +
        `attended=${r.attendedCount} noShow=${r.noShowCount} lateCancel=${r.cancelledLateCount}`
    );
  }

  console.log(`\nAll seeded accounts share the password: ${DEMO_PASSWORD}`);
  console.log("Log in with any handle, e.g. maya_ortiz (host) or jonah_webb (unreliable).");

  console.log("\nRow counts:", {
    users: await prisma.user.count(),
    events: await prisma.event.count(),
    rsvps: await prisma.rsvp.count(),
    ledgerRows: await prisma.rsvpStatusEvent.count(),
    attendance: await prisma.attendance.count()
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
