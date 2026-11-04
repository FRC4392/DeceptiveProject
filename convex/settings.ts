// App settings and the Onshape API budget meter.
//
// The team's Classroom plan allows about 2,500 successful calls a year for
// everyone, so the tracker counts every call it makes and drops features
// rather than silently running the team out of allowance. Nothing here calls
// Onshape; it only reads what was already spent.
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { canReadAsLead, canReadAsMentor, requireMentor } from "./lib/auth";
import {
  allowancePeriodStart,
  modeForShare,
  type BudgetMode,
} from "./lib/budget";

export const DEFAULTS = {
  apiLimit: 2500,
  /** Normal above this share of the allowance remaining. */
  leanThreshold: 0.3,
  manualThreshold: 0.1,
  waitingDays: 3,
  renewalDate: null as number | null,
  forcedMode: null as "normal" | "lean" | "manual" | null,
  /** Why the mode was forced, when the app forced it rather than a mentor. */
  forcedModeReason: null as string | null,
  forcedModeAt: null as number | null,
};

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
  forcedModeReason: v.union(v.string(), v.null()),
  forcedModeAt: v.union(v.number(), v.null()),
});

export const get = query({
  args: {},
  returns: vSettings,
  handler: async (ctx) => {
    // Its write twin is mentor-only, and nothing on screen reads it.
    if (!(await canReadAsMentor(ctx))) return { ...DEFAULTS };
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
      forcedModeReason:
        (map.get("forcedModeReason") as string | null | undefined) ?? null,
      forcedModeAt:
        (map.get("forcedModeAt") as number | null | undefined) ?? null,
    };
  },
});

/** A person's change to a setting, from a screen or from the command line. */
async function writeSetting(
  ctx: MutationCtx,
  key: string,
  value: unknown,
): Promise<void> {
  const write = async (k: string, v: unknown) => {
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", k))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value: v });
    else await ctx.db.insert("appSettings", { key: k, value: v });
  };
  await write(key, value);
  // A mode a person sets is theirs, not the app's. Clear the reason the app
  // left when it last forced one, or the budget would go on reporting the
  // app's reason for the person's choice — and drop that choice at renewal
  // as though the app had made it.
  if (key === "forcedMode") {
    await write("forcedModeReason", null);
    await write("forcedModeAt", null);
  }
}

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  returns: v.null(),
  handler: async (ctx, { key, value }) => {
    await requireMentor(ctx);
    await writeSetting(ctx, key, value);
    return null;
  },
});

/**
 * The same as `set`, for the command line. There's no screen for the budget
 * settings yet, and `npx convex run` calls a function as nobody, which `set`
 * refuses — so, like `shop:grantRole`, this is the way in for a mentor at the
 * deployment's own terminal:
 *
 *   npx convex run settings:configure '{"key": "renewalDate", "value": 1785542400000}'
 *
 * Internal, so only someone with access to the deployment can call it.
 */
export const configure = internalMutation({
  args: { key: v.string(), value: v.any() },
  returns: v.null(),
  handler: async (ctx, { key, value }) => {
    await writeSetting(ctx, key, value);
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
    forcedReason: v.union(v.string(), v.null()),
    forcedAt: v.union(v.number(), v.null()),
    renewalDate: v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    // How much allowance is left before the team drops into manual mode is
    // for the leads working the intake queue.
    if (!(await canReadAsLead(ctx))) {
      return {
        used: 0,
        limit: DEFAULTS.apiLimit,
        remaining: DEFAULTS.apiLimit,
        mode: "normal" as const,
        forced: false,
        forcedReason: null,
        forcedAt: null,
        renewalDate: null,
      };
    }
    const state = await budgetState(ctx);
    return {
      used: state.used,
      limit: state.limit,
      remaining: state.remaining,
      mode: state.mode,
      forced: state.forced,
      forcedReason: state.forcedReason,
      forcedAt: state.forcedAt,
      renewalDate: state.renewalDate,
    };
  },
});

/**
 * The mode, for the server side of the line. `onshapeFetch` asks this before
 * every call, so it lives apart from the public `budget` query — that one is
 * a meter for people, this one is a gate.
 */
export const currentMode = internalQuery({
  args: {},
  returns: v.union(v.literal("normal"), v.literal("lean"), v.literal("manual")),
  handler: async (ctx) => (await budgetState(ctx)).mode,
});

/**
 * Drop into manual mode because Onshape said so (a 402 means the allowance is
 * gone). Recorded with a reason, because a mode nobody can explain is a mode
 * someone will quietly switch back.
 *
 * Never overrides a mode a mentor forced by hand: if they chose it, they get
 * to keep it.
 */
export const forceManualMode = internalMutation({
  args: { reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { reason }) => {
    const rows = await ctx.db.query("appSettings").collect();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    // A Manual a mentor chose carries no reason: theirs, so leave it. One the
    // app forced is stamped again rather than skipped — last year's is still
    // stored after a renewal, and skipping it would leave a fresh 402 dated
    // last year, which the budget then reads as lapsed and stops braking.
    const mentorChoseManual =
      byKey.get("forcedMode")?.value === "manual" &&
      (byKey.get("forcedModeReason")?.value ?? null) === null;
    if (mentorChoseManual) return null;
    const write = async (key: string, value: unknown) => {
      const existing = byKey.get(key);
      if (existing) await ctx.db.patch(existing._id, { value });
      else await ctx.db.insert("appSettings", { key, value });
    };
    await write("forcedMode", "manual");
    await write("forcedModeReason", reason);
    await write("forcedModeAt", Date.now());
    console.error(`Onshape budget: forced into manual mode — ${reason}`);
    return null;
  },
});

type BudgetState = {
  used: number;
  limit: number;
  remaining: number;
  mode: BudgetMode;
  forced: boolean;
  forcedReason: string | null;
  forcedAt: number | null;
  renewalDate: number | null;
};

async function budgetState(ctx: QueryCtx): Promise<BudgetState> {
  const rows = await ctx.db.query("appSettings").collect();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const limit = (map.get("apiLimit") as number) ?? DEFAULTS.apiLimit;
  const leanThreshold =
    (map.get("leanThreshold") as number) ?? DEFAULTS.leanThreshold;
  const manualThreshold =
    (map.get("manualThreshold") as number) ?? DEFAULTS.manualThreshold;
  const storedMode =
    (map.get("forcedMode") as BudgetMode | null | undefined) ?? null;
  const forcedReason =
    (map.get("forcedModeReason") as string | null | undefined) ?? null;
  const forcedAt =
    (map.get("forcedModeAt") as number | null | undefined) ?? null;
  const renewalDate = (map.get("renewalDate") as number | null) ?? null;
  const periodStart = allowancePeriodStart(renewalDate, Date.now());

  // Only this year's calls. The bound goes in the index range, never in a
  // filter after the fact: the index runs oldest first, so taking a batch and
  // then filtering would keep only last year's calls and read zero forever.
  // Every Convex index ends in `_creationTime`, which is what makes this a
  // range read. Bounded to a year, the read is bounded by real usage too, so
  // it no longer stops counting at 10,000.
  const counted = await ctx.db
    .query("apiCalls")
    .withIndex("by_counted", (q) =>
      periodStart === null
        ? q.eq("counted", true)
        : q.eq("counted", true).gte("_creationTime", periodStart),
    )
    .collect();
  const used = counted.length;
  const remaining = Math.max(0, limit - used);
  const share = limit > 0 ? remaining / limit : 0;

  // A mode the app forced — it only ever forces Manual, after Onshape said
  // the allowance was spent, and always says why — is about *that* year. Once
  // the allowance renews it no longer applies. A mode a mentor chose carries
  // no reason (setting one clears the app's), and stays until they change it.
  const appForcedLastYear =
    storedMode !== null &&
    forcedReason !== null &&
    periodStart !== null &&
    (forcedAt ?? 0) < periodStart;
  const forcedMode = appForcedLastYear ? null : storedMode;

  return {
    used,
    limit,
    remaining,
    mode: forcedMode ?? modeForShare(share, leanThreshold, manualThreshold),
    forced: forcedMode !== null,
    forcedReason: forcedMode === null ? null : forcedReason,
    forcedAt: forcedMode === null ? null : forcedAt,
    renewalDate,
  };
}
