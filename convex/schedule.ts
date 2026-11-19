// The season's schedule: phases holding dated tasks, drawn as a Gantt chart on
// the Schedule page and, cut down to the weeks around today, on the dashboard.
//
// Everyone signed in reads it; leads and mentors change it. Days are calendar
// dates stored as Date.UTC of the date, so the server can count days exactly;
// "is this late?" needs today, and that's the browser's to say.
//
// Tasks can wait for other tasks. Every write that moves a task, or changes
// what it waits for, also moves what waits on it (convex/lib/scheduleDeps.ts).
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { canRead, requireLead } from "./lib/auth";
import { activeSeason, requireActiveSeason } from "./lib/season";
import { cascade, DAY_MS, wouldCycle, type DepTask } from "./lib/scheduleDeps";

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
  dependsOn: v.optional(v.array(v.id("scheduleTasks"))),
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
  // Whole UTC days only: anything else is a moment, sent by a screen that
  // predates days being stored this way.
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start % DAY_MS !== 0 ||
    end % DAY_MS !== 0
  ) {
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

async function seasonTasks(ctx: MutationCtx, season: Doc<"seasons">) {
  return ctx.db
    .query("scheduleTasks")
    .withIndex("by_season", (q) => q.eq("seasonId", season._id))
    .take(SCAN_LIMIT);
}

function toDep(t: Doc<"scheduleTasks">): DepTask {
  return {
    id: t._id,
    start: t.start,
    end: t.end,
    dependsOn: t.dependsOn ?? [],
    done: t.doneAt !== undefined,
  };
}

/**
 * Move everything that waits on `id`, now that it has its new dates (and,
 * with `snapSelf`, line `id` itself up behind what it waits for).
 */
async function pushDependents(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  id: Id<"scheduleTasks">,
  snapSelf: boolean,
): Promise<void> {
  const tasks = (await seasonTasks(ctx, season)).map(toDep);
  const changes = cascade(tasks, [id], snapSelf ? [id] : []);
  for (const [taskId, span] of changes) {
    await ctx.db.patch(taskId as Id<"scheduleTasks">, span);
  }
}

/** Take removed tasks off everything that waited for them. */
async function forget(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  removed: Set<string>,
): Promise<void> {
  for (const task of await seasonTasks(ctx, season)) {
    if (removed.has(task._id)) continue;
    const deps = task.dependsOn ?? [];
    if (deps.some((d) => removed.has(d))) {
      const kept = deps.filter((d) => !removed.has(d));
      await ctx.db.patch(task._id, {
        dependsOn: kept.length > 0 ? kept : undefined,
      });
    }
  }
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
    const removed = new Set<string>();
    for (const task of await tasksOf(ctx, id)) {
      await ctx.db.delete(task._id);
      removed.add(task._id);
    }
    await ctx.db.delete(id);
    // What waited for them in other phases now waits for nothing there, and
    // stays where it is.
    await forget(ctx, season, removed);
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

/**
 * Change any of a task's fields; the ones left out stay as they are.
 *
 * New dates move everything waiting on the task. The task's own new dates
 * stand even if it now starts before what it waits for has finished: that's
 * shown as a clash, not refused. Giving it something new to wait for lines
 * it up the day after that finishes.
 */
export const updateTask = mutation({
  args: {
    id: v.id("scheduleTasks"),
    name: v.optional(v.string()),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    phaseId: v.optional(v.id("schedulePhases")),
    done: v.optional(v.boolean()),
    /** The whole list of what it waits for, replacing the old one. */
    dependsOn: v.optional(v.array(v.id("scheduleTasks"))),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, start, end, phaseId, done, dependsOn }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    const task = await taskInSeason(ctx, id, season);

    const patch: Partial<Doc<"scheduleTasks">> = {};
    if (name !== undefined) patch.name = cleanName(name, "task");
    let datesMoved = false;
    if (start !== undefined || end !== undefined) {
      const nextStart = start ?? task.start;
      const nextEnd = end ?? task.end;
      checkDates(nextStart, nextEnd);
      patch.start = nextStart;
      patch.end = nextEnd;
      datesMoved = nextStart !== task.start || nextEnd !== task.end;
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

    let gained = false;
    if (dependsOn !== undefined) {
      const next = [...new Set(dependsOn)];
      const all = await seasonTasks(ctx, season);
      const byId = new Map(all.map((t) => [t._id as string, t]));
      for (const p of next) {
        const prereq = byId.get(p);
        if (p === id) throw new Error("A task can't wait for itself.");
        if (!prereq) {
          // Gone, or not this season's: both mean a stale screen.
          throw new Error("One of those tasks is gone. Refresh and try again.");
        }
      }
      // Check for loops against the graph as it will be, with all the new
      // links in at once.
      const graph = all
        .map(toDep)
        .map((t) => (t.id === id ? { ...t, dependsOn: next } : t));
      for (const p of next) {
        if (wouldCycle(graph, id, p)) {
          throw new Error(
            `"${byId.get(p)!.name}" already waits for "${task.name}", so "${task.name}" can't wait for it.`,
          );
        }
      }
      const before = new Set(task.dependsOn ?? []);
      gained = next.some((p) => !before.has(p));
      patch.dependsOn = next.length > 0 ? next : undefined;
    }

    await ctx.db.patch(id, patch);
    if (datesMoved || gained) {
      // Only snap the task itself for a new link: its own new dates are what
      // somebody just chose.
      await pushDependents(ctx, season, id, gained && !datesMoved);
    }
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
    await forget(ctx, season, new Set([id]));
    return null;
  },
});

/**
 * Turn task dates saved as local midnights — how the schedule stored days
 * before tasks could wait for each other — into calendar days. A local
 * midnight is within twelve hours of that date's UTC midnight in any zone,
 * so rounding to the nearest one keeps the date. Run once with
 * `npx convex run schedule:roundToDays`; safe to re-run.
 */
export const roundToDays = internalMutation({
  args: {},
  returns: v.object({ rounded: v.number() }),
  handler: async (ctx) => {
    const round = (ts: number) => Math.round(ts / DAY_MS) * DAY_MS;
    let rounded = 0;
    for (const task of await ctx.db.query("scheduleTasks").collect()) {
      if (task.start % DAY_MS === 0 && task.end % DAY_MS === 0) continue;
      await ctx.db.patch(task._id, {
        start: round(task.start),
        end: round(task.end),
      });
      rounded++;
    }
    return { rounded };
  },
});
