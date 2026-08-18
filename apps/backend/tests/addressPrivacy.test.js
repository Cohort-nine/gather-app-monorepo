import { describe, expect, it, vi } from "vitest";

// applyAddressPrivacy is a pure function, but importing it pulls in the whole
// controller — which reaches for a generated Prisma client. Stub both so the
// module loads without a database.
vi.mock("@prisma/client", () => ({
  Prisma: { sql: () => ({}), join: () => ({}), empty: {} }
}));
vi.mock("../server/db/prisma.js", () => ({ default: {} }));

const { applyAddressPrivacy } = await import("../server/controllers/eventController.js");

// ---------------------------------------------------------------------------
// hideExactAddressUntilRsvp is a trust & safety feature: it lets someone host
// in their living room without publishing their home address.
//
// The browse endpoint honored it by never selecting those columns. The detail
// endpoint spread the whole row, so the address was one request away for anyone
// holding the event id. These tests pin the fix.
// ---------------------------------------------------------------------------

const HOST_ID = "11111111-1111-1111-1111-111111111111";
const COHOST_ID = "22222222-2222-2222-2222-222222222222";
const ATTENDEE_ID = "33333333-3333-3333-3333-333333333333";
const STRANGER_ID = "44444444-4444-4444-4444-444444444444";

const event = (overrides = {}) => ({
  id: "99999999-9999-9999-9999-999999999999",
  hostId: HOST_ID,
  title: "Third Thursday Potluck",
  placeName: "Maya's place",
  addressLine1: "418 Hamlet St",
  addressLine2: "Apt 2",
  city: "Columbus",
  region: "OH",
  postalCode: "43201",
  lat: 39.9612,
  lng: -82.9988,
  hideExactAddressUntilRsvp: true,
  cohosts: [{ userId: COHOST_ID, canEdit: true }],
  ...overrides
});

const rsvps = [
  { userId: ATTENDEE_ID, status: "going" },
  { userId: "55555555-5555-5555-5555-555555555555", status: "waitlisted" }
];

/** The fields that must disappear for someone who hasn't earned them. */
const SECRET_FIELDS = ["addressLine1", "addressLine2", "postalCode", "lat", "lng"];

describe("applyAddressPrivacy — who gets the street address", () => {
  it("hides it from an anonymous visitor", () => {
    const result = applyAddressPrivacy(event(), null, rsvps);

    for (const field of SECRET_FIELDS) {
      expect(result[field]).toBeNull();
    }
    expect(result.addressHidden).toBe(true);
  });

  it("hides it from a signed-in user who hasn't RSVP'd", () => {
    const result = applyAddressPrivacy(event(), STRANGER_ID, rsvps);

    expect(result.addressLine1).toBeNull();
    expect(result.addressHidden).toBe(true);
  });

  it("shows it to the host", () => {
    const result = applyAddressPrivacy(event(), HOST_ID, rsvps);

    expect(result.addressLine1).toBe("418 Hamlet St");
    expect(result.addressHidden).toBe(false);
  });

  it("shows it to a cohost", () => {
    const result = applyAddressPrivacy(event(), COHOST_ID, rsvps);

    expect(result.addressLine1).toBe("418 Hamlet St");
    expect(result.addressHidden).toBe(false);
  });

  it("shows it to someone who is going", () => {
    const result = applyAddressPrivacy(event(), ATTENDEE_ID, rsvps);

    expect(result.addressLine1).toBe("418 Hamlet St");
    expect(result.postalCode).toBe("43201");
    expect(result.addressHidden).toBe(false);
  });

  // Waitlisted people may get promoted with little notice, so they need to know
  // where they'd be going.
  it("shows it to someone on the waitlist", () => {
    const result = applyAddressPrivacy(
      event(),
      "55555555-5555-5555-5555-555555555555",
      rsvps
    );

    expect(result.addressLine1).toBe("418 Hamlet St");
  });

  it("hides it again once someone cancels", () => {
    const cancelled = [{ userId: ATTENDEE_ID, status: "cancelled" }];
    const result = applyAddressPrivacy(event(), ATTENDEE_ID, cancelled);

    expect(result.addressLine1).toBeNull();
    expect(result.addressHidden).toBe(true);
  });

  it("shows everything when the host didn't ask to hide it", () => {
    const open = event({ hideExactAddressUntilRsvp: false });
    const result = applyAddressPrivacy(open, null, []);

    expect(result.addressLine1).toBe("418 Hamlet St");
    expect(result.lat).toBe(39.9612);
    expect(result.addressHidden).toBe(false);
  });

  // Coordinates are the same disclosure as a street address — you can paste
  // either into a map. Hiding one without the other would be theater.
  it("hides coordinates too, not just the text address", () => {
    const result = applyAddressPrivacy(event(), null, rsvps);

    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });

  // The city is how people find events near them, and the place name is how a
  // listing reads. Neither pinpoints a house.
  it("still returns city, region, and place name", () => {
    const result = applyAddressPrivacy(event(), null, rsvps);

    expect(result.city).toBe("Columbus");
    expect(result.region).toBe("OH");
    expect(result.placeName).toBe("Maya's place");
  });

  it("says explicitly that the address is hidden", () => {
    // Without this flag the UI can't tell "no address on file" from "you have
    // to RSVP first", and would render a confusing blank.
    expect(applyAddressPrivacy(event(), null, []).addressHidden).toBe(true);
  });

  it("doesn't mutate the row it was given", () => {
    const original = event();
    applyAddressPrivacy(original, null, rsvps);

    expect(original.addressLine1).toBe("418 Hamlet St");
  });

  it("handles an event with no cohosts", () => {
    const solo = event({ cohosts: undefined });

    expect(() => applyAddressPrivacy(solo, STRANGER_ID, [])).not.toThrow();
    expect(applyAddressPrivacy(solo, HOST_ID, []).addressHidden).toBe(false);
  });
});
