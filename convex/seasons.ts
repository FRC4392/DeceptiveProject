import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMentor } from "./lib/auth";
import { ensureDefaultSubAssembly } from "./subAssemblies";

const vSeason = v.object({
  _id: v.id("seasons"),
  _creationTime: v.number(),
  year: v.string(),
  name: v.string(),
  active: v.boolean(),
});

export const list = query({
  args: {},
  returns: v.array(vSeason),
  handler: async (ctx) => {
    const seasons = await ctx.db.query("seasons").collect();
    return seasons.sort((a, b) => b.year.localeCompare(a.year));
  },
});

/** The season every screen works in. Null until a mentor runs setup. */
export const active = query({
  args: {},
  returns: v.union(vSeason, v.null()),
  handler: async (ctx) => {
    const seasons = await ctx.db.query("seasons").collect();
    return seasons.find((s) => s.active) ?? null;
  },
});

export const create = mutation({
  args: {
    year: v.string(),
    name: v.string(),
    makeActive: v.optional(v.boolean()),
  },
  returns: v.id("seasons"),
  handler: async (ctx, { year, name, makeActive }) => {
    await requireMentor(ctx);
    const existing = await ctx.db.query("seasons").collect();
    const active = makeActive ?? existing.length === 0;
    if (active) {
      for (const s of existing) {
        if (s.active) await ctx.db.patch(s._id, { active: false });
      }
    }
    return ctx.db.insert("seasons", {
      year: year.trim(),
      name: name.trim(),
      active,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("seasons"),
    year: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, year, name }) => {
    await requireMentor(ctx);
    const patch: Partial<Doc<"seasons">> = {};
    if (year !== undefined) patch.year = year.trim();
    if (name !== undefined) patch.name = name.trim();
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const setActive = mutation({
  args: { id: v.id("seasons") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    for (const s of await ctx.db.query("seasons").collect()) {
      if (s.active !== (s._id === id)) {
        await ctx.db.patch(s._id, { active: s._id === id });
      }
    }
    return null;
  },
});

// A new team shouldn't meet an empty app with no way in. This lays down one
// season, the usual five subsystems, the machines most teams have, and the
// process types that decide which stages a part skips. Everything is editable
// in Settings afterwards.
const DEFAULT_SUBSYSTEMS = [
  { code: "DRV", name: "Drivetrain" },
  { code: "INT", name: "Intake" },
  { code: "ELV", name: "Elevator" },
  { code: "SHT", name: "Shooter" },
  { code: "CLB", name: "Climber" },
];

const DEFAULT_MACHINES = [
  { name: "CNC router", requiresMentorPresent: true },
  { name: "Mill", requiresMentorPresent: true },
  { name: "Lathe", requiresMentorPresent: true },
  { name: "Bandsaw", requiresMentorPresent: false },
  { name: "Drill press", requiresMentorPresent: false },
  { name: "3D printer", requiresMentorPresent: false },
];

// [process name, machine name or null, needsDrawing, needsFinishing]
const DEFAULT_PROCESSES: [string, string | null, boolean, boolean, boolean][] =
  [
    ["CNC router", "CNC router", true, true, false],
    ["Mill", "Mill", true, true, false],
    ["Lathe", "Lathe", true, true, false],
    ["Bandsaw + drill", "Bandsaw", true, true, false],
    ["3D print", "3D printer", false, false, false],
    ["Bought (COTS)", null, false, false, true],
  ];

export const seedDefaults = mutation({
  args: { year: v.string(), name: v.string() },
  returns: v.object({ seasonId: v.id("seasons") }),
  handler: async (ctx, { year, name }) => {
    await requireMentor(ctx);

    const seasons = await ctx.db.query("seasons").collect();
    for (const s of seasons) {
      if (s.active) await ctx.db.patch(s._id, { active: false });
    }
    const seasonId = await ctx.db.insert("seasons", {
      year: year.trim(),
      name: name.trim(),
      active: true,
    });

    let order = 0;
    const season = await ctx.db.get(seasonId);
    for (const sub of DEFAULT_SUBSYSTEMS) {
      const subsystemId = await ctx.db.insert("subsystems", {
        seasonId,
        ...sub,
        order: order++,
      });
      const subsystem = await ctx.db.get(subsystemId);
      // Every subsystem is born with its {YY}-{SUB}-000 assembly.
      if (season && subsystem) {
        await ensureDefaultSubAssembly(ctx, season, subsystem);
      }
    }

    // Machines and processes are team-wide, not per-season — only lay them
    // down if this is the first season.
    const existingMachines = await ctx.db.query("machines").collect();
    if (existingMachines.length === 0) {
      const machineIds = new Map<string, Id<"machines">>();
      let mOrder = 0;
      for (const m of DEFAULT_MACHINES) {
        machineIds.set(
          m.name,
          await ctx.db.insert("machines", { ...m, order: mOrder++ }),
        );
      }
      let pOrder = 0;
      for (const [
        pName,
        machineName,
        needsDrawing,
        needsFinishing,
        isBought,
      ] of DEFAULT_PROCESSES) {
        await ctx.db.insert("processTypes", {
          name: pName,
          machineId: machineName ? machineIds.get(machineName) : undefined,
          needsDrawing,
          needsFinishing,
          isBought,
          order: pOrder++,
        });
      }
    }

    return { seasonId };
  },
});
