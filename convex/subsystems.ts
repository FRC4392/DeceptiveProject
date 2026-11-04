// Subsystems: the robot's parts list is split by these, and a subsystem's code
// is the middle segment of every part number it owns (27-INT-104).
import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { canRead, canReadAsMentor, requireMentor } from "./lib/auth";
import { READY_STAGE } from "./lib/assembly";
import { ensureDefaultSubAssembly } from "./subAssemblies";
import { activeSeason, requireActiveSeason } from "./lib/season";

const vSubsystem = v.object({
  _id: v.id("subsystems"),
  _creationTime: v.number(),
  seasonId: v.id("seasons"),
  code: v.string(),
  name: v.string(),
  leadUserId: v.optional(v.string()),
  order: v.number(),
});

async function seasonSubsystems(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"subsystems">[]> {
  const season = await activeSeason(ctx);
  if (!season) return [];
  const subs = await ctx.db
    .query("subsystems")
    .withIndex("by_season", (q) => q.eq("seasonId", season._id))
    .collect();
  return subs.sort((a, b) => a.order - b.order);
}

export const list = query({
  args: {},
  returns: v.array(vSubsystem),
  handler: async (ctx) => ((await canRead(ctx)) ? seasonSubsystems(ctx) : []),
});

export const get = query({
  args: { id: v.id("subsystems") },
  returns: v.union(vSubsystem, v.null()),
  handler: async (ctx, { id }) =>
    (await canRead(ctx)) ? ctx.db.get(id) : null,
});

export const create = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    leadUserId: v.optional(v.string()),
  },
  returns: v.id("subsystems"),
  handler: async (ctx, { code, name, leadUserId }) => {
    await requireMentor(ctx);
    const season = await requireActiveSeason(ctx);
    const normalized = code.trim().toUpperCase();
    const clash = await ctx.db
      .query("subsystems")
      .withIndex("by_season_and_code", (q) =>
        q.eq("seasonId", season._id).eq("code", normalized),
      )
      .unique();
    if (clash) throw new Error(`${normalized} is already taken this season.`);
    const subs = await ctx.db
      .query("subsystems")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const order = subs.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    const subsystemId = await ctx.db.insert("subsystems", {
      seasonId: season._id,
      code: normalized,
      name: name.trim(),
      leadUserId,
      order,
    });
    const subsystem = await ctx.db.get(subsystemId);
    if (subsystem) await ensureDefaultSubAssembly(ctx, season, subsystem);
    return subsystemId;
  },
});

export const update = mutation({
  args: {
    id: v.id("subsystems"),
    code: v.optional(v.string()),
    name: v.optional(v.string()),
    leadUserId: v.optional(v.union(v.string(), v.null())),
    order: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...rest }) => {
    await requireMentor(ctx);
    const current = await ctx.db.get(id);
    if (!current) throw new Error("That subsystem is gone.");
    const patch: Partial<Doc<"subsystems">> = {};
    if (rest.code !== undefined) {
      const normalized = rest.code.trim().toUpperCase();
      if (normalized !== current.code) {
        const clash = await ctx.db
          .query("subsystems")
          .withIndex("by_season_and_code", (q) =>
            q.eq("seasonId", current.seasonId).eq("code", normalized),
          )
          .unique();
        if (clash)
          throw new Error(`${normalized} is already taken this season.`);
        // Numbers already issued keep the code they were printed with; only
        // new parts use the new one. Renaming a code mid-season is a mentor's
        // call to make deliberately.
      }
      patch.code = normalized;
    }
    if (rest.name !== undefined) patch.name = rest.name.trim();
    if (rest.leadUserId !== undefined)
      patch.leadUserId = rest.leadUserId ?? undefined;
    if (rest.order !== undefined) patch.order = rest.order;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("subsystems") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", id))
      .take(1);
    if (parts.length > 0) {
      throw new Error("This subsystem still has parts — move them first.");
    }
    const cots = await ctx.db
      .query("cotsItems")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", id))
      .collect();
    for (const c of cots) await ctx.db.delete(c._id);
    const assemblies = await ctx.db
      .query("subAssemblies")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", id))
      .collect();
    for (const assembly of assemblies) {
      const members = await ctx.db
        .query("subAssemblyMembers")
        .withIndex("by_parent", (q) => q.eq("subAssemblyId", assembly._id))
        .collect();
      for (const m of members) await ctx.db.delete(m._id);
      await ctx.db.delete(assembly._id);
    }
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Progress ----

const vProgress = v.object({
  subsystemId: v.id("subsystems"),
  code: v.string(),
  name: v.string(),
  ready: v.number(),
  total: v.number(),
  /** Derived: the subsystem's default sub-assembly has been built. */
  installed: v.boolean(),
});

/** The strip of "ready or on the robot" tiles across the top of the board. */
export const progress = query({
  args: {},
  returns: v.array(vProgress),
  handler: async (ctx) => {
    if (!(await canRead(ctx))) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];
    const subs = await seasonSubsystems(ctx);
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(5000);
    const cots = await ctx.db
      .query("cotsItems")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(5000);

    const out = [];
    for (const s of subs) {
      const mine = parts.filter(
        (p) => p.subsystemId === s._id && !p.isArchived,
      );
      const myCots = cots.filter((c) => c.subsystemId === s._id);
      // "On the robot" is derived from the default sub-assembly being built,
      // never stored — one source of truth, nothing to keep in step.
      const root = await ctx.db
        .query("subAssemblies")
        .withIndex("by_subsystem_and_default", (q) =>
          q.eq("subsystemId", s._id).eq("isDefault", true),
        )
        .unique();
      out.push({
        subsystemId: s._id,
        code: s.code,
        name: s.name,
        ready:
          mine.filter((p) => p.stage >= READY_STAGE).length +
          myCots.filter((c) => c.status === "arrived").length,
        total: mine.length + myCots.length,
        installed: root?.completedAt !== undefined,
      });
    }
    return out;
  },
});

/** The number this subsystem will hand out next, for the Settings screen. */
export const nextNumbers = query({
  args: {},
  returns: v.array(
    v.object({ subsystemId: v.id("subsystems"), next: v.number() }),
  ),
  handler: async (ctx) => {
    if (!(await canReadAsMentor(ctx))) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];
    const subsystems = await ctx.db
      .query("subsystems")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    const out = [];
    for (const subsystem of subsystems) {
      const counter = await ctx.db
        .query("partNumberCounters")
        .withIndex("by_season_and_subsystem", (q) =>
          q.eq("seasonId", season._id).eq("subsystemId", subsystem._id),
        )
        .unique();
      out.push({ subsystemId: subsystem._id, next: counter?.next ?? 1 });
    }
    return out;
  },
});

/**
 * Seed or correct the next number a subsystem hands out — picking up where a
 * spreadsheet left off, or skipping a block someone numbered by hand.
 *
 * It only ever moves forward. A number is never reused, and nothing else in
 * the system defends that: the counter is the only record of what has been
 * handed out, so winding it back would quietly hand out a second 27-INT-104.
 */
export const setNextNumber = mutation({
  args: { subsystemId: v.id("subsystems"), next: v.number() },
  returns: v.null(),
  handler: async (ctx, { subsystemId, next }) => {
    await requireMentor(ctx);
    const season = await requireActiveSeason(ctx);
    const subsystem = await ctx.db.get(subsystemId);
    if (!subsystem) throw new Error("That subsystem is gone.");

    const wanted = Math.round(next);
    if (!Number.isFinite(wanted) || wanted < 1) {
      throw new Error("The next number has to be 1 or more.");
    }

    const counter = await ctx.db
      .query("partNumberCounters")
      .withIndex("by_season_and_subsystem", (q) =>
        q.eq("seasonId", season._id).eq("subsystemId", subsystemId),
      )
      .unique();
    const current = counter?.next ?? 1;
    if (wanted < current) {
      throw new Error(
        `This subsystem is already up to ${current}, and a number is never reused. Pick ${current} or higher.`,
      );
    }

    if (counter) {
      await ctx.db.patch(counter._id, { next: wanted });
    } else {
      await ctx.db.insert("partNumberCounters", {
        seasonId: season._id,
        subsystemId,
        next: wanted,
      });
    }
    return null;
  },
});
