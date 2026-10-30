import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMentor } from "./lib/auth";

const COMPETITION_LIMIT = 200;

const vCompetition = v.object({
  _id: v.id("competitions"),
  _creationTime: v.number(),
  name: v.string(),
  date: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(vCompetition),
  handler: async (ctx) => {
    return ctx.db
      .query("competitions")
      .withIndex("by_date")
      .take(COMPETITION_LIMIT);
  },
});

/** The next event still ahead of us — the deadline in the sidebar. */
export const next = query({
  args: {},
  returns: v.union(vCompetition, v.null()),
  handler: async (ctx) => {
    const upcoming = await ctx.db
      .query("competitions")
      .withIndex("by_date", (q) => q.gte("date", Date.now()))
      .take(1);
    return upcoming[0] ?? null;
  },
});

export const create = mutation({
  args: { name: v.string(), date: v.number() },
  returns: v.id("competitions"),
  handler: async (ctx, { name, date }) => {
    await requireMentor(ctx);
    return ctx.db.insert("competitions", { name, date });
  },
});

export const remove = mutation({
  args: { id: v.id("competitions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    await ctx.db.delete(id);
    return null;
  },
});
