// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function identity(subject: string, role: "mentor" | "student" = "student") {
  return { subject, issuer: ISSUER, email: `${subject}@example.com`, role };
}

async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  return mentor;
}

describe("events belong to a season", () => {
  test("an event added in one season is invisible from another", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    await mentor.mutation(api.competitions.create, {
      name: "District Championship",
      date: Date.now() + WEEK,
    });

    expect(await mentor.query(api.competitions.list, {})).toHaveLength(1);
    expect((await mentor.query(api.competitions.next, {}))?.name).toBe(
      "District Championship",
    );

    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });
    await mentor.mutation(api.seasons.setActive, { id: id28 });

    expect(await mentor.query(api.competitions.list, {})).toEqual([]);
    expect(await mentor.query(api.competitions.next, {})).toBeNull();
  });

  test("the dashboard countdown only sees the current season's events", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    await mentor.mutation(api.competitions.create, {
      name: "Week 1",
      date: Date.now() + WEEK,
    });

    let summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.nextCompetition?.name).toBe("Week 1");

    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });
    await mentor.mutation(api.seasons.setActive, { id: id28 });

    summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.nextCompetition).toBeNull();
  });

  test("an event from another season can't be removed from this one", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    const eventId = await mentor.mutation(api.competitions.create, {
      name: "Week 1",
      date: Date.now() + WEEK,
    });

    const id28 = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });
    await mentor.mutation(api.seasons.setActive, { id: id28 });

    await expect(
      mentor.mutation(api.competitions.remove, { id: eventId }),
    ).rejects.toThrow(/another season/);
  });
});

describe("the one-off backfill", () => {
  test("stamps events from before events were season-scoped", async () => {
    const t = convexTest(schema, modules);
    const mentor = await setup(t);
    // A row as it looked before `seasonId` existed — legal precisely because
    // the field is optional.
    await t.run((ctx) =>
      ctx.db.insert("competitions", {
        name: "Districts",
        date: Date.now() + WEEK,
      }),
    );

    expect(await mentor.query(api.competitions.list, {})).toEqual([]);

    expect(await t.mutation(internal.competitions.backfillSeason, {})).toEqual({
      stamped: 1,
      skipped: 0,
    });

    const events = await mentor.query(api.competitions.list, {});
    expect(events.map((e) => e.name)).toEqual(["Districts"]);
  });

  test("is safe to run twice", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    await t.run((ctx) =>
      ctx.db.insert("competitions", { name: "Districts", date: Date.now() }),
    );

    await t.mutation(internal.competitions.backfillSeason, {});
    expect(await t.mutation(internal.competitions.backfillSeason, {})).toEqual({
      stamped: 0,
      skipped: 0,
    });
  });

  test("says what it found rather than throwing when there's no season", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("competitions", { name: "Districts", date: Date.now() }),
    );

    expect(await t.mutation(internal.competitions.backfillSeason, {})).toEqual({
      stamped: 0,
      skipped: 1,
    });
  });
});
