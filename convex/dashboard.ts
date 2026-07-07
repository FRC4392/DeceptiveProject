import { query } from "./_generated/server";
import { v } from "convex/values";

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
    const allBoards = await ctx.db.query("boards").collect();
    // In a project view, only that project's boards count.
    const boards =
      projectId === undefined
        ? allBoards
        : allBoards.filter((b) => b.projectId === projectId);

    const bySubsystem = new Map<string, { total: number; done: number }>();
    let totalTasks = 0;
    let doneTasks = 0;
    const now = Date.now();
    let overdueCount = 0;

    for (const board of boards) {
      const boardTasks = await ctx.db
        .query("tasks")
        .withIndex("by_board", (q) => q.eq("boardId", board._id))
        .collect();
      // Scope to the selected project (undefined = all projects).
      const tasks =
        projectId === undefined
          ? boardTasks
          : boardTasks.filter((t) => t.projectId === projectId);
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

    const competitions = await ctx.db.query("competitions").collect();
    const upcoming = competitions
      .filter((c) => c.date >= now)
      .sort((a, b) => a.date - b.date);
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
