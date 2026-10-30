// App settings and the Onshape API budget meter.
//
// The team's Classroom plan allows about 2,500 successful calls a year for
// everyone, so the tracker counts every call it makes and drops features
// rather than silently running the team out of allowance. Nothing here calls
// Onshape; it only reads what was already spent.
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMentor } from "./lib/auth";

export const DEFAULTS = {
  apiLimit: 2500,
  /** Normal above this share of the allowance remaining. */
  leanThreshold: 0.3,
  manualThreshold: 0.1,
  waitingDays: 3,
  renewalDate: null as number | null,
  forcedMode: null as "normal" | "lean" | "manual" | null,
};

export type BudgetMode = "normal" | "lean" | "manual";

const vSettings = v.object({
  apiLimit: v.number(),
  leanThreshold: v.number(),
  manualThreshold: v.number(),
  waitingDays: v.number(),
  renewalDate: v.union(v.number(), v.null()),
  forcedMode: v.union(
    v.literal("normal"),
    v.literal("lean"),
    v.literal("manual"),
    v.null(),
  ),
});

export const get = query({
  args: {},
  returns: vSettings,
  handler: async (ctx) => {
    const rows = await ctx.db.query("appSettings").collect();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      apiLimit: (map.get("apiLimit") as number) ?? DEFAULTS.apiLimit,
      leanThreshold:
        (map.get("leanThreshold") as number) ?? DEFAULTS.leanThreshold,
      manualThreshold:
        (map.get("manualThreshold") as number) ?? DEFAULTS.manualThreshold,
      waitingDays: (map.get("waitingDays") as number) ?? DEFAULTS.waitingDays,
      renewalDate: (map.get("renewalDate") as number | null) ?? null,
      forcedMode:
        (map.get("forcedMode") as BudgetMode | null | undefined) ?? null,
    };
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  returns: v.null(),
  handler: async (ctx, { key, value }) => {
    await requireMentor(ctx);
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("appSettings", { key, value });
    }
    return null;
  },
});

/**
 * Calls used, the limit, and which mode that puts the app in. A forced mode
 * set by a mentor always wins — that's the switch to pull when Onshape is
 * misbehaving.
 */
export const budget = query({
  args: {},
  returns: v.object({
    used: v.number(),
    limit: v.number(),
    remaining: v.number(),
    mode: v.union(v.literal("normal"), v.literal("lean"), v.literal("manual")),
    forced: v.boolean(),
    renewalDate: v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("appSettings").collect();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const limit = (map.get("apiLimit") as number) ?? DEFAULTS.apiLimit;
    const leanThreshold =
      (map.get("leanThreshold") as number) ?? DEFAULTS.leanThreshold;
    const manualThreshold =
      (map.get("manualThreshold") as number) ?? DEFAULTS.manualThreshold;
    const forcedMode =
      (map.get("forcedMode") as BudgetMode | null | undefined) ?? null;

    const counted = await ctx.db
      .query("apiCalls")
      .withIndex("by_counted", (q) => q.eq("counted", true))
      .take(10000);
    const used = counted.length;
    const remaining = Math.max(0, limit - used);
    const share = limit > 0 ? remaining / limit : 0;

    const mode: BudgetMode =
      forcedMode ??
      (share < manualThreshold
        ? "manual"
        : share < leanThreshold
          ? "lean"
          : "normal");

    return {
      used,
      limit,
      remaining,
      mode,
      forced: forcedMode !== null,
      renewalDate: (map.get("renewalDate") as number | null) ?? null,
    };
  },
});
