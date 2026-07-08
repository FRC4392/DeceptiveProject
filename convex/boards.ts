import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireMentor } from "./lib/auth";

const BOARD_LIMIT = 500;

const vBoard = v.object({
  _id: v.id("boards"),
  _creationTime: v.number(),
  name: v.string(),
  subsystem: v.string(),
  order: v.number(),
  projectId: v.optional(v.id("projects")),
});

export const list = query({
  args: { projectId: v.optional(v.id("projects")) },
  returns: v.array(vBoard),
  handler: async (ctx, { projectId }) => {
    // Boards are a small, mentor-managed set (one per subsystem-ish), but keep
    // the read bounded and push project scoping into the index when present.
    const boards =
      projectId === undefined
        ? await ctx.db.query("boards").take(BOARD_LIMIT)
        : await ctx.db
            .query("boards")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .take(BOARD_LIMIT);
    return boards.sort((a, b) => a.order - b.order);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    subsystem: v.string(),
    order: v.optional(v.number()),
    projectId: v.optional(v.id("projects")),
  },
  returns: v.id("boards"),
  handler: async (ctx, args) => {
    await requireMentor(ctx);
    let order = args.order;
    if (order === undefined) {
      const boards = await ctx.db.query("boards").take(BOARD_LIMIT);
      order = boards.reduce((max, b) => Math.max(max, b.order), -1) + 1;
    }
    return ctx.db.insert("boards", {
      name: args.name,
      subsystem: args.subsystem,
      order,
      projectId: args.projectId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("boards"),
    name: v.optional(v.string()),
    subsystem: v.optional(v.string()),
    order: v.optional(v.number()),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, subsystem, order, projectId }) => {
    await requireMentor(ctx);
    const patch: Partial<Doc<"boards">> = {};
    if (name !== undefined) patch.name = name;
    if (subsystem !== undefined) patch.subsystem = subsystem;
    if (order !== undefined) patch.order = order;
    if (projectId !== undefined) patch.projectId = projectId ?? undefined;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("boards") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_board", (q) => q.eq("boardId", id))
      .take(1);
    if (existing.length > 0) {
      throw new Error("Move or delete this board's tasks before deleting it.");
    }
    await ctx.db.delete(id);
    return null;
  },
});
