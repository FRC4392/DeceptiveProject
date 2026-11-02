import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMentor } from "./lib/auth";
import { ensureDefaultSubAssembly } from "./subAssemblies";
import { DEFAULT_PAD, defaultSubAssemblyNumber } from "./lib/numbering";
import { normalizePartNumber } from "./lib/stages";

const vSeason = v.object({
  _id: v.id("seasons"),
  _creationTime: v.number(),
  year: v.string(),
  name: v.string(),
  active: v.boolean(),
});

/**
 * A season's year is half of every part number, so two seasons may not share
 * one: {YY}-{SUB}-{NNN} would collide, and the partNumberKey lookups in
 * lib/numbering.ts use `.unique()`, which throws when two rows match. Pass
 * `except` when renaming, so a season keeps the right to its own year.
 */
async function assertYearFree(
  ctx: MutationCtx,
  year: string,
  except?: Id<"seasons">,
): Promise<void> {
  const seasons = await ctx.db.query("seasons").collect();
  if (seasons.some((s) => s.year === year && s._id !== except)) {
    throw new Error(`Season ${year} already exists.`);
  }
}

/**
 * A subsystem and the {YY}-{SUB}-000 assembly it is born with. Both the
 * first-run seeder and "add a season" come through here, so there is one way
 * a subsystem comes into being.
 */
async function addSubsystem(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  code: string,
  name: string,
  order: number,
): Promise<void> {
  const subsystemId = await ctx.db.insert("subsystems", {
    seasonId: season._id,
    code,
    name,
    order,
  });
  // ensureDefaultSubAssembly wants the row, not the id.
  const subsystem = await ctx.db.get(subsystemId);
  if (subsystem) await ensureDefaultSubAssembly(ctx, season, subsystem);
}

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

/**
 * Add a year. It starts with one subsystem, Drivetrain, and its
 * {YY}-DRV-000 assembly — the rest go on the Subsystems tab. Adding a season
 * doesn't switch to it unless asked: starting next year in November shouldn't
 * move the team off the robot they're still building.
 */
export const create = mutation({
  args: {
    year: v.string(),
    name: v.string(),
    makeActive: v.optional(v.boolean()),
  },
  returns: v.id("seasons"),
  handler: async (ctx, { year, name, makeActive }) => {
    await requireMentor(ctx);
    const trimmedYear = year.trim();
    await assertYearFree(ctx, trimmedYear);
    const existing = await ctx.db.query("seasons").collect();
    const active = makeActive ?? existing.length === 0;
    if (active) {
      for (const s of existing) {
        if (s.active) await ctx.db.patch(s._id, { active: false });
      }
    }
    const seasonId = await ctx.db.insert("seasons", {
      year: trimmedYear,
      name: name.trim(),
      active,
    });
    // The number comes from the season it's handed, never the active one, so
    // adding 28 while 27 is current still gives 28-DRV-000.
    const season = await ctx.db.get(seasonId);
    if (season) await addSubsystem(ctx, season, "DRV", "Drivetrain", 0);
    return seasonId;
  },
});

export const update = mutation({
  args: {
    id: v.id("seasons"),
    year: v.optional(v.string()),
    name: v.optional(v.string()),
    /** Digits the sequence is padded to. Only before anything is issued. */
    numberPad: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, year, name, numberPad }) => {
    await requireMentor(ctx);
    const patch: Partial<Doc<"seasons">> = {};
    if (numberPad !== undefined) {
      patch.numberPad = await settableNumberPad(ctx, id, numberPad);
    }
    if (year !== undefined) {
      const trimmed = year.trim();
      await assertYearFree(ctx, trimmed, id);
      patch.year = trimmed;
    }
    if (name !== undefined) patch.name = name.trim();
    await ctx.db.patch(id, patch);
    return null;
  },
});

/**
 * Widening the padding mid-season would split the search key: a part keyed
 * 27INT104 and one keyed 27INT0104 are the same number to a person and two
 * different strings to `normalizePartNumber`, which strips separators but
 * not leading zeros — so typing "104" would stop finding the second.
 *
 * Rather than warn about that, it simply isn't allowed once the season has
 * handed anything out. The {YY}-{SUB}-000 defaults every season is born with
 * cost the counter nothing, so they don't count as issued — they are
 * re-stamped here instead, being the only numbers that exist at this point.
 */
async function settableNumberPad(
  ctx: MutationCtx,
  seasonId: Id<"seasons">,
  pad: number,
): Promise<number> {
  const next = Math.round(pad);
  if (!Number.isFinite(next) || next < 1 || next > 6) {
    throw new Error("Padding has to be between 1 and 6 digits.");
  }
  const season = await ctx.db.get(seasonId);
  if (!season) throw new Error("That season is gone.");
  if ((season.numberPad ?? DEFAULT_PAD) === next) return next;

  const parts = await ctx.db
    .query("parts")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .take(1);
  const counters = await ctx.db
    .query("partNumberCounters")
    .filter((q) => q.eq(q.field("seasonId"), seasonId))
    .take(1);
  const assemblies = await ctx.db
    .query("subAssemblies")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .collect();
  if (parts.length > 0 || counters.length > 0) {
    throw new Error(
      "This season has already issued numbers, so the padding is fixed. Set it on a new season instead.",
    );
  }
  if (assemblies.some((a) => a.isDefault !== true)) {
    throw new Error(
      "This season has sub-assemblies already, so the padding is fixed.",
    );
  }

  // Re-stamp the born-with defaults so the season is all one shape.
  for (const assembly of assemblies) {
    const subsystem = await ctx.db.get(assembly.subsystemId);
    if (!subsystem) continue;
    const partNumber = defaultSubAssemblyNumber(
      season.year,
      subsystem.code,
      next,
    );
    await ctx.db.patch(assembly._id, {
      partNumber,
      partNumberKey: normalizePartNumber(partNumber),
    });
  }
  return next;
}

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
//
// No bought process is seeded. Something the team buys isn't a part and takes
// no tracker number — it goes on the Ordering board, which is where the
// intake sends it. A seeded "Bought (COTS)" was worse than nothing: picking
// it made a part at stage 5, Ready to assemble, which counts as in the bin
// before anyone has ordered the thing. `processTypes.isBought` still exists,
// so a mentor who wants one can add it in Settings.
const DEFAULT_PROCESSES: [string, string | null, boolean, boolean][] = [
  ["CNC router", "CNC router", true, true],
  ["Mill", "Mill", true, true],
  ["Lathe", "Lathe", true, true],
  ["Bandsaw + drill", "Bandsaw", true, true],
  ["3D print", "3D printer", false, false],
];

export const seedDefaults = mutation({
  args: { year: v.string(), name: v.string() },
  returns: v.object({ seasonId: v.id("seasons") }),
  handler: async (ctx, { year, name }) => {
    await requireMentor(ctx);
    const trimmedYear = year.trim();
    await assertYearFree(ctx, trimmedYear);

    const seasons = await ctx.db.query("seasons").collect();
    for (const s of seasons) {
      if (s.active) await ctx.db.patch(s._id, { active: false });
    }
    const seasonId = await ctx.db.insert("seasons", {
      year: trimmedYear,
      name: name.trim(),
      active: true,
    });

    let order = 0;
    const season = await ctx.db.get(seasonId);
    if (season) {
      for (const sub of DEFAULT_SUBSYSTEMS) {
        await addSubsystem(ctx, season, sub.code, sub.name, order++);
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
      ] of DEFAULT_PROCESSES) {
        await ctx.db.insert("processTypes", {
          name: pName,
          machineId: machineName ? machineIds.get(machineName) : undefined,
          needsDrawing,
          needsFinishing,
          order: pOrder++,
        });
      }
    }

    return { seasonId };
  },
});
