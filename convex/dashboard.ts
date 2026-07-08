import { query } from "./_generated/server";
import { v } from "convex/values";

const BOARD_LIMIT = 500;
const TASK_LIMIT = 2000;

// Aggregate progress used by the /dashboard view: completion by subsystem,
// overdue count, and the next competition countdown.
export const summary = query({
  args: { projectId: v.optional(v.id("projects")) },
  returns: v.object({
    subsystems: v.array(
      v.object({
        subsystem: v.string(),
        total: v.number(),
        done: v.number(),
      }),
    ),
    totalTasks: v.number(),
    doneTasks: v.number(),
    overdueCount: v.number(),
    nextCompetition: v.union(
      v.object({ name: v.string(), date: v.number() }),
      v.null(),
    ),
  }),
  handler: async (ctx, { projectId }) => {
    const boards =
      projectId === undefined
        ? await ctx.db.query("boards").take(BOARD_LIMIT)
        : await ctx.db
            .query("boards")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .take(BOARD_LIMIT);

    const bySubsystem = new Map<string, { total: number; done: number }>();
    let totalTasks = 0;
    let doneTasks = 0;
    const now = Date.now();
    let overdueCount = 0;

    for (const board of boards) {
      const tasks =
        projectId === undefined
          ? await ctx.db
              .query("tasks")
              .withIndex("by_board", (q) => q.eq("boardId", board._id))
              .take(TASK_LIMIT)
          : await ctx.db
              .query("tasks")
              .withIndex("by_project_and_board", (q) =>
                q.eq("projectId", projectId).eq("boardId", board._id),
              )
              .take(TASK_LIMIT);
      const entry = bySubsystem.get(board.subsystem) ?? { total: 0, done: 0 };
      for (const t of tasks) {
        entry.total += 1;
        totalTasks += 1;
        if (t.status === "done") {
          entry.done += 1;
          doneTasks += 1;
        }
        if (t.dueDate !== undefined && t.dueDate < now && t.status !== "done") {
          overdueCount += 1;
        }
      }
      bySubsystem.set(board.subsystem, entry);
    }

    const subsystems = Array.from(bySubsystem.entries())
      .map(([subsystem, v]) => ({ subsystem, total: v.total, done: v.done }))
      .sort((a, b) => a.subsystem.localeCompare(b.subsystem));

    const upcoming = await ctx.db
      .query("competitions")
      .withIndex("by_date", (q) => q.gte("date", now))
      .take(1);
    const nextCompetition = upcoming[0]
      ? { name: upcoming[0].name, date: upcoming[0].date }
      : null;

    return {
      subsystems,
      totalTasks,
      doneTasks,
      overdueCount,
      nextCompetition,
    };
  },
});
