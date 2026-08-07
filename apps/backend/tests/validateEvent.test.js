import { describe, expect, it } from "vitest";
import { isUuid, slugify, validateEventPayload } from "../server/lib/validateEvent.js";

describe("isUuid", () => {
  it("accepts a well-formed UUID", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
  });

  it("rejects non-UUID strings and non-strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});

describe("slugify", () => {
  it("lowercases, strips punctuation, and hyphenates", () => {
    expect(slugify("Maya's Rooftop Potluck!")).toBe("mayas-rooftop-potluck");
  });

  it("truncates to 80 characters", () => {
    expect(slugify("a".repeat(100)).length).toBe(80);
  });
});

describe("validateEventPayload", () => {
  const hostId = "11111111-1111-1111-1111-111111111111";

  it("requires title, hostId, and startsAt on create", () => {
    const { errors } = validateEventPayload({});
    expect(errors).toEqual(
      expect.arrayContaining(["title is required", "hostId is required", "startsAt is required"])
    );
  });

  it("accepts a minimal valid payload", () => {
    const { errors, data } = validateEventPayload({
      title: "Block Party",
      hostId,
      startsAt: "2027-01-01T18:00:00Z"
    });

    expect(errors).toEqual([]);
    expect(data.title).toBe("Block Party");
    expect(data.hostId).toBe(hostId);
  });

  it("rejects endsAt at or before startsAt", () => {
    const { errors } = validateEventPayload({
      title: "Block Party",
      hostId,
      startsAt: "2027-01-01T18:00:00Z",
      endsAt: "2027-01-01T17:00:00Z"
    });

    expect(errors).toContain("endsAt must be after startsAt");
  });

  it("rejects rsvpClosesAt after startsAt", () => {
    const { errors } = validateEventPayload({
      title: "Block Party",
      hostId,
      startsAt: "2027-01-01T18:00:00Z",
      rsvpClosesAt: "2027-01-01T19:00:00Z"
    });

    expect(errors).toContain("rsvpClosesAt cannot be after startsAt");
  });

  it("requires onlineUrl when isOnline is true", () => {
    const { errors } = validateEventPayload({
      title: "Virtual Meetup",
      hostId,
      startsAt: "2027-01-01T18:00:00Z",
      isOnline: true
    });

    expect(errors).toContain("onlineUrl is required when isOnline is true");
  });

  it("only checks fields that are present on a partial update", () => {
    const { errors, data } = validateEventPayload({ capacity: 10 }, { partial: true });
    expect(errors).toEqual([]);
    expect(data).toEqual({ capacity: 10 });
  });

  it("rejects a non-positive capacity", () => {
    const { errors } = validateEventPayload({ capacity: 0 }, { partial: true });
    expect(errors).toContain("capacity must be a positive whole number");
  });

  it("rejects an out-of-range waitlistReliabilityFloor", () => {
    const { errors } = validateEventPayload({ waitlistReliabilityFloor: 1.5 }, { partial: true });
    expect(errors).toContain("waitlistReliabilityFloor must be between 0 and 1");
  });
});
