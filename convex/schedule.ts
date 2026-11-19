// The season's schedule: phases holding dated tasks, drawn as a Gantt chart on
// the Schedule page and, cut down to the weeks around today, on the dashboard.
//
// Everyone signed in reads it; leads and mentors change it. Days are stored as
// the local midnight the editing browser saw, and every "is this late?" is
// worked out in the browser too, so the server's clock zone never matters.
import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { canRead, requireLead } from "./lib/auth";
import { activeSeason, requireActiveSeason } from "./lib/season";

const SCAN_LIMIT = 1000;
const NAME_MAX = 120;

const vPhase = v.object({
  _id: v.id("schedulePhases"),
  _creationTime: v.number(),
  seasonId: v.id("seasons"),
  name: v.string(),
  order: v.number(),
});

const vTask = v.object({
  _id: v.id("scheduleTasks"),
  _creationTime: v.number(),
  seasonId: v.id("seasons"),
  phaseId: v.id("schedulePhases"),
  name: v.string(),
  start: v.number(),
  end: v.number(),
  order: v.number(),
  doneAt: v.optional(v.number()),
});

const vMilestone = v.object({
  _id: v.id("competitions"),
  name: v.string(),
  date: v.number(),
});

const vDirection = v.union(v.literal("up"), v.literal("down"));

const EMPTY = { phases: [], tasks: [], milestones: [] };

export const get = query({
  args: {},
  returns: v.object({
    phases: v.array(vPhase),
    tasks: v.array(vTask),
    /** The season's events, drawn as lines across the chart. */
    milestones: v.array(vMilestone),
  }),
  handler: async (ctx) => {
    if (!(await canRead(ctx))) return EMPTY;
    const season = await activeSeason(ctx);
    if (!season) return EMPTY;

    const phases = await ctx.db
      .query("schedulePhases")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const tasks = await ctx.db
      .query("scheduleTasks")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const events = await ctx.db
      .query("competitions")
      .withIndex("by_season_and_date", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);

    return {
      phases: phases.sort((a, b) => a.order - b.order),
      tasks: tasks.sort((a, b) => a.order - b.order),
      milestones: events.map((e) => ({
        _id: e._id,
        name: e.name,
        date: e.date,
      })),
    };
  },
});

// ---- Helpers ----

function cleanName(name: string, what: "phase" | "task"): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error(`Give the ${what} a name.`);
  if (trimmed.length > NAME_MAX) {
    throw new Error(`Keep the name under ${NAME_MAX} characters.`);
  }
  return trimmed;
}

function checkDates(start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("Those dates don't look right.");
  }
  if (end < start) throw new Error("A task can't end before it starts.");
}

/** The phase, as long as it's in the season the team is working in. */
async function phaseInSeason(
  ctx: MutationCtx,
  id: Id<"schedulePhases">,
  season: Doc<"seasons">,
): Promise<Doc<"schedulePhases">> {
  const phase = await ctx.db.get(id);
  if (!phase) throw new Error("That phase is gone. Refresh and try again.");
  if (phase.seasonId !== season._id) {
    throw new Error("That phase belongs to another season.");
  }
  return phase;
}

async function taskInSeason(
  ctx: MutationCtx,
  id: Id<"scheduleTasks">,
  season: Doc<"seasons">,
): Promise<Doc<"scheduleTasks">> {
  const task = await ctx.db.get(id);
  if (!task) throw new Error("That task is gone. Refresh and try again.");
  if (task.seasonId !== season._id) {
    throw new Error("That task belongs to another season.");
  }
  return task;
}

async function tasksOf(ctx: MutationCtx, phaseId: Id<"schedulePhases">) {
  return ctx.db
    .query("scheduleTasks")
    .withIndex("by_phase", (q) => q.eq("phaseId", phaseId))
    .take(SCAN_LIMIT);
}

function nextOrder(rows: { order: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.order), -1) + 1;
}

/** Swap `row` with its neighbour in `rows` (sorted or not). */
function neighbour<T extends { _id: string; order: number }>(
  rows: T[],
  row: T,
  direction: "up" | "down",
): T | undefined {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const at = sorted.findIndex((r) => r._id === row._id);
  return sorted[direction === "up" ? at - 1 : at + 1];
}

// ---- Phases ----

export const createPhase = mutation({
  args: { name: v.string() },
  returns: v.id("schedulePhases"),
  handler: async (ctx, { name }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    const phases = await ctx.db
      .query("schedulePhases")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    return ctx.db.insert("schedulePhases", {
      seasonId: season._id,
      name: cleanName(name, "phase"),
      order: nextOrder(phases),
    });
  },
});

export const renamePhase = mutation({
  args: { id: v.id("schedulePhases"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    await phaseInSeason(ctx, id, season);
    await ctx.db.patch(id, { name: cleanName(name, "phase") });
    return null;
  },
});

export const movePhase = mutation({
  args: { id: v.id("schedulePhases"), direction: vDirection },
  returns: v.null(),
  handler: async (ctx, { id, direction }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    const phase = await phaseInSeason(ctx, id, season);
    const phases = await ctx.db
      .query("schedulePhases")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const other = neighbour(phases, phase, direction);
    if (!other) return null;
    await ctx.db.patch(phase._id, { order: other.order });
    await ctx.db.patch(other._id, { order: phase.order });
    return null;
  },
});

/** Remove a phase and every task under it. */
export const removePhase = mutation({
  args: { id: v.id("schedulePhases") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    await phaseInSeason(ctx, id, season);
    for (const task of await tasksOf(ctx, id)) {
      await ctx.db.delete(task._id);
    }
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Tasks ----

export const createTask = mutation({
  args: {
    phaseId: v.id("schedulePhases"),
    name: v.string(),
    start: v.number(),
    end: v.number(),
  },
  returns: v.id("scheduleTasks"),
  handler: async (ctx, { phaseId, name, start, end }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    await phaseInSeason(ctx, phaseId, season);
    checkDates(start, end);
    return ctx.db.insert("scheduleTasks", {
      seasonId: season._id,
      phaseId,
      name: cleanName(name, "task"),
      start,
      end,
      order: nextOrder(await tasksOf(ctx, phaseId)),
    });
  },
});

/** Change any of a task's fields; the ones left out stay as they are. */
export const updateTask = mutation({
  args: {
    id: v.id("scheduleTasks"),
    name: v.optional(v.string()),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    phaseId: v.optional(v.id("schedulePhases")),
    done: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, start, end, phaseId, done }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    const task = await taskInSeason(ctx, id, season);

    const patch: Partial<Doc<"scheduleTasks">> = {};
    if (name !== undefined) patch.name = cleanName(name, "task");
    if (start !== undefined || end !== undefined) {
      const nextStart = start ?? task.start;
      const nextEnd = end ?? task.end;
      checkDates(nextStart, nextEnd);
      patch.start = nextStart;
      patch.end = nextEnd;
    }
    if (phaseId !== undefined && phaseId !== task.phaseId) {
      await phaseInSeason(ctx, phaseId, season);
      patch.phaseId = phaseId;
      // Moved to the bottom of its new phase.
      patch.order = nextOrder(await tasksOf(ctx, phaseId));
    }
    if (done !== undefined) {
      // Marking done again keeps the first date it was done.
      patch.doneAt = done ? (task.doneAt ?? Date.now()) : undefined;
    }
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const moveTask = mutation({
  args: { id: v.id("scheduleTasks"), direction: vDirection },
  returns: v.null(),
  handler: async (ctx, { id, direction }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    const task = await taskInSeason(ctx, id, season);
    const other = neighbour(await tasksOf(ctx, task.phaseId), task, direction);
    if (!other) return null;
    await ctx.db.patch(task._id, { order: other.order });
    await ctx.db.patch(other._id, { order: task.order });
    return null;
  },
});

export const removeTask = mutation({
  args: { id: v.id("scheduleTasks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    await taskInSeason(ctx, id, season);
    await ctx.db.delete(id);
    return null;
  },
});
