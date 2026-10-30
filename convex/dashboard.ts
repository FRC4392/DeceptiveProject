// The dashboard's headline numbers: how the to-do list is going, and how long
// until the robot has to be done.
import { query } from "./_generated/server";
import { v } from "convex/values";
import { activeSeason } from "./lib/season";

const SCAN_LIMIT = 2000;

export const summary = query({
  args: {},
  returns: v.object({
    doneTodos: v.number(),
    totalTodos: v.number(),
    claimedByMe: v.number(),
    nextCompetition: v.union(
      v.object({ name: v.string(), date: v.number() }),
      v.null(),
    ),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const season = await activeSeason(ctx);

    const todos = season
      ? await ctx.db
          .query("todos")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .take(SCAN_LIMIT)
      : [];

    const upcoming = await ctx.db
      .query("competitions")
      .withIndex("by_date", (q) => q.gte("date", Date.now()))
      .take(1);

    return {
      doneTodos: todos.filter((t) => t.doneAt !== undefined).length,
      totalTodos: todos.length,
      claimedByMe: identity
        ? todos.filter(
            (t) => t.claimedByUserId === identity.subject && !t.doneAt,
          ).length
        : 0,
      nextCompetition: upcoming[0]
        ? { name: upcoming[0].name, date: upcoming[0].date }
        : null,
    };
  },
});
