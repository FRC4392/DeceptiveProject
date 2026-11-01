import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMentor } from "./lib/auth";
import { activeSeason, requireActiveSeason } from "./lib/season";

const COMPETITION_LIMIT = 200;

const vCompetition = v.object({
  _id: v.id("competitions"),
  _creationTime: v.number(),
  seasonId: v.optional(v.id("seasons")),
  name: v.string(),
  date: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(vCompetition),
  handler: async (ctx) => {
    const season = await activeSeason(ctx);
    if (!season) return [];
    return ctx.db
      .query("competitions")
      .withIndex("by_season_and_date", (q) => q.eq("seasonId", season._id))
      .take(COMPETITION_LIMIT);
  },
});

/** The next event still ahead of us — the deadline in the sidebar. */
export const next = query({
  args: {},
  returns: v.union(vCompetition, v.null()),
  handler: async (ctx) => {
    const season = await activeSeason(ctx);
    if (!season) return null;
    const upcoming = await ctx.db
      .query("competitions")
      .withIndex("by_season_and_date", (q) =>
        q.eq("seasonId", season._id).gte("date", Date.now()),
      )
      .take(1);
    return upcoming[0] ?? null;
  },
});

export const create = mutation({
  args: { name: v.string(), date: v.number() },
  returns: v.id("competitions"),
  handler: async (ctx, { name, date }) => {
    await requireMentor(ctx);
    const season = await requireActiveSeason(ctx);
    return ctx.db.insert("competitions", { seasonId: season._id, name, date });
  },
});

export const remove = mutation({
  args: { id: v.id("competitions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    const event = await ctx.db.get(id);
    if (!event) return null;
    // Events are scoped now, so a screen left open on last season shouldn't be
    // able to delete this one's. `activeSeason` rather than the throwing
    // version: an unstamped leftover row stays deletable even with no season.
    const season = await activeSeason(ctx);
    if (event.seasonId !== undefined && event.seasonId !== season?._id) {
      throw new Error("That event belongs to another season.");
    }
    await ctx.db.delete(id);
    return null;
  },
});

/**
 * Stamp events added before events were season-scoped with the current season.
 * Internal on purpose: run once from a terminal after deploying, with
 * `npx convex run competitions:backfillSeason`. Safe to re-run.
 */
export const backfillSeason = internalMutation({
  args: {},
  returns: v.object({ stamped: v.number(), skipped: v.number() }),
  handler: async (ctx) => {
    // The whole table, not a page of it: `take` would return the same first
    // rows on a re-run and never reach anything past them. This runs once,
    // from a terminal, over a table that holds a season's events.
    const events = await ctx.db.query("competitions").collect();
    const unstamped = events.filter((e) => e.seasonId === undefined);
    // A migration that throws on a deployment with no season yet is one that
    // fails confusingly on a fresh instance. Report what it found and stop.
    const season = await activeSeason(ctx);
    if (!season) return { stamped: 0, skipped: unstamped.length };
    for (const event of unstamped) {
      await ctx.db.patch(event._id, { seasonId: season._id });
    }
    return { stamped: unstamped.length, skipped: 0 };
  },
});
