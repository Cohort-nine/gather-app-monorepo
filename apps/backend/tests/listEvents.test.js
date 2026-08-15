import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// listEvents builds its WHERE clause from Prisma.sql fragments and runs them
// through $queryRaw. To assert on the SQL that actually gets generated, this
// file reimplements Prisma.sql / Prisma.join faithfully enough to flatten the
// nested template literals into { text, values }.
//
// That flattening is the point: it lets the tests prove user input arrives as a
// BOUND PARAMETER and never as part of the SQL string.
// ---------------------------------------------------------------------------

class Sql {
  constructor(strings, values) {
    this.strings = strings;
    this.values = values;
  }
}

function sqlTag(strings, ...values) {
  return new Sql([...strings], values);
}

/** Splice fragments together with a separator, preserving parameter slots. */
function joinFragments(fragments, separator = ",") {
  const strings = [];
  const values = [];
  let current = "";

  fragments.forEach((fragment, index) => {
    if (index > 0) current += separator;
    current += fragment.strings[0];

    fragment.values.forEach((value, i) => {
      strings.push(current);
      values.push(value);
      current = fragment.strings[i + 1];
    });
  });

  strings.push(current);
  return new Sql(strings, values);
}

/** Collapse a template (which may embed Sql fragments) into text + values. */
function flatten(strings, values) {
  let text = "";
  const params = [];

  strings.forEach((chunk, i) => {
    text += chunk;
    if (i >= values.length) return;

    const value = values[i];
    if (value instanceof Sql) {
      const nested = flatten(value.strings, value.values);
      text += nested.text;
      params.push(...nested.values);
    } else {
      text += "$" + (params.length + 1);
      params.push(value);
    }
  });

  return { text, values: params };
}

const captured = { calls: [] };

const prismaMock = {
  $queryRaw: vi.fn(async (strings, ...values) => {
    captured.calls.push(flatten([...strings], values));
    // First call returns rows, second returns the count.
    return captured.calls.length === 1 ? [] : [{ total: 0 }];
  })
};

vi.mock("@prisma/client", () => ({
  Prisma: { sql: sqlTag, join: joinFragments, empty: new Sql([""], []) }
}));
vi.mock("../server/db/prisma.js", () => ({ default: prismaMock }));

const { listEvents } = await import("../server/controllers/eventController.js");

const USER_ID = "33333333-3333-3333-3333-333333333333";

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const rowSql = () => captured.calls[0].text.replace(/\s+/g, " ");
const allParams = () => captured.calls.flatMap((c) => c.values);

beforeEach(() => {
  vi.clearAllMocks();
  captured.calls = [];
});

describe("listEvents — public browse", () => {
  it("restricts to published and public events", async () => {
    await listEvents({ query: {} }, mockRes(), vi.fn());

    expect(rowSql()).toContain("e.status = 'published'");
    expect(rowSql()).toContain("e.visibility = 'public'");
  });

  it("hides past events by default", async () => {
    await listEvents({ query: {} }, mockRes(), vi.fn());
    expect(rowSql()).toContain("e.starts_at >= now()");
  });

  it("binds the search term as a parameter rather than interpolating it", async () => {
    await listEvents({ query: { search: "potluck" } }, mockRes(), vi.fn());

    expect(rowSql()).toContain("ILIKE");
    expect(allParams()).toContain("%potluck%");
    // If it were concatenated into the SQL string, this would fail.
    expect(rowSql()).not.toContain("potluck");
  });

  it("rejects an unknown sort key instead of interpolating it", async () => {
    const res = mockRes();
    await listEvents({ query: { sort: "; DROP TABLE events" } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("listEvents — ?mine=true", () => {
  const req = (query = {}) => ({ query: { mine: "true", ...query }, user: { id: USER_ID } });

  it("requires a session", async () => {
    const res = mockRes();
    await listEvents({ query: { mine: "true" } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("scopes to the signed-in user, bound as a parameter", async () => {
    await listEvents(req(), mockRes(), vi.fn());

    expect(rowSql()).toContain("e.host_id =");
    expect(allParams()).toContain(USER_ID);
    expect(rowSql()).not.toContain(USER_ID);
  });

  // The whole reason this filter exists: drafts are invisible in browse, so the
  // host view must not apply the same restriction.
  it("does NOT filter by status or visibility, so drafts come back", async () => {
    await listEvents(req(), mockRes(), vi.fn());

    expect(rowSql()).not.toContain("e.status = 'published'");
    expect(rowSql()).not.toContain("e.visibility = 'public'");
  });

  it("includes past events, since that's where attendance gets marked", async () => {
    await listEvents(req(), mockRes(), vi.fn());
    expect(rowSql()).not.toContain("e.starts_at >= now()");
  });

  it("still honors search and category filters", async () => {
    await listEvents(req({ search: "dinner", category: "food" }), mockRes(), vi.fn());

    expect(allParams()).toContain("%dinner%");
    expect(allParams()).toContain("food");
  });

  it("ignores mine=false and browses publicly instead", async () => {
    await listEvents({ query: { mine: "false" }, user: { id: USER_ID } }, mockRes(), vi.fn());

    expect(rowSql()).toContain("e.status = 'published'");
    expect(rowSql()).not.toContain("e.host_id =");
  });

  // There is deliberately no ?hostId= — that would let anyone enumerate another
  // host's drafts and invite-only events by guessing a UUID.
  it("offers no way to scope to a different host", async () => {
    const otherUser = "44444444-4444-4444-4444-444444444444";
    await listEvents(
      { query: { mine: "true", hostId: otherUser }, user: { id: USER_ID } },
      mockRes(),
      vi.fn()
    );

    expect(allParams()).toContain(USER_ID);
    expect(allParams()).not.toContain(otherUser);
  });

  it("reports an honest empty message", async () => {
    const res = mockRes();
    await listEvents(req(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "You haven't created any events yet",
        meta: expect.objectContaining({ filters: expect.objectContaining({ mine: true }) })
      })
    );
  });
});
