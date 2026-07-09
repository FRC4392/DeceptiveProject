import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getUserId, requireUserId, requireMentor } from "./lib/auth";

export const statusValidator = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("done"),
);

export const priorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

const sourceValidator = v.union(
  v.literal("manual"),
  v.literal("part"),
  v.literal("issue"),
);

const vTask = v.object({
  _id: v.id("tasks"),
  _creationTime: v.number(),
  title: v.string(),
  description: v.optional(v.string()),
  boardId: v.id("boards"),
  assigneeIds: v.array(v.string()),
  dueDate: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  status: statusValidator,
  priority: priorityValidator,
  labels: v.array(v.string()),
  parentTaskId: v.optional(v.id("tasks")),
  dependsOn: v.array(v.id("tasks")),
  source: sourceValidator,
  sourceId: v.optional(v.string()),
  projectId: v.optional(v.id("projects")),
});

// Upper bound for the in-memory scans below (listMine / listOverdue). A
// robotics season produces well under this many tasks; revisit with a
// dedicated index/table if it ever grows past it.
const SCAN_LIMIT = 2000;

async function listRecentTasks(
  ctx: QueryCtx,
  projectId?: Id<"projects">,
): Promise<Doc<"tasks">[]> {
  if (projectId === undefined) {
    return ctx.db.query("tasks").order("desc").take(SCAN_LIMIT);
  }
  return ctx.db
    .query("tasks")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .take(SCAN_LIMIT);
}

export const listByBoard = query({
  args: { boardId: v.id("boards") },
  returns: v.array(vTask),
  handler: async (ctx, { boardId }) => {
    return ctx.db
      .query("tasks")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .take(SCAN_LIMIT);
  },
});

export const listMine = query({
  args: { projectId: v.optional(v.id("projects")) },
  returns: v.array(vTask),
  handler: async (ctx, { projectId }) => {
    const me = await getUserId(ctx);
    if (!me) return [];
    const tasks = await listRecentTasks(ctx, projectId);
    return tasks.filter((t) => t.assigneeIds.includes(me));
  },
});

export const listOverdue = query({
  args: { projectId: v.optional(v.id("projects")) },
  returns: v.array(vTask),
  handler: async (ctx, { projectId }) => {
    const now = Date.now();
    const tasks = await listRecentTasks(ctx, projectId);
    return tasks.filter(
      (t) => t.dueDate !== undefined && t.dueDate < now && t.status !== "done",
    );
  },
});

// All tasks (bounded), for cross-board views like the calendar and timeline.
export const listAll = query({
  args: { projectId: v.optional(v.id("projects")) },
  returns: v.array(vTask),
  handler: async (ctx, { projectId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return listRecentTasks(ctx, projectId);
  },
});

export const get = query({
  args: { id: v.id("tasks") },
  returns: v.union(vTask, v.null()),
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

export const getMany = query({
  args: { ids: v.array(v.id("tasks")) },
  returns: v.array(vTask),
  handler: async (ctx, { ids }) => {
    const tasks = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return tasks.filter((t): t is Doc<"tasks"> => t !== null);
  },
});

export const listSubtasks = query({
  args: { parentTaskId: v.id("tasks") },
  returns: v.array(vTask),
  handler: async (ctx, { parentTaskId }) => {
    return ctx.db
      .query("tasks")
      .withIndex("by_parent", (q) => q.eq("parentTaskId", parentTaskId))
      .take(SCAN_LIMIT);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    boardId: v.id("boards"),
    assigneeIds: v.optional(v.array(v.string())),
    dueDate: v.optional(v.number()),
    status: v.optional(statusValidator),
    priority: v.optional(priorityValidator),
    labels: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id("tasks")),
    dependsOn: v.optional(v.array(v.id("tasks"))),
    projectId: v.optional(v.id("projects")),
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const status = args.status ?? "todo";
    // A manual task belongs to its board's project unless one is given.
    const board = await ctx.db.get(args.boardId);
    const projectId = args.projectId ?? board?.projectId;
    return ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      boardId: args.boardId,
      assigneeIds: args.assigneeIds ?? [],
      dueDate: args.dueDate,
      completedAt: status === "done" ? Date.now() : undefined,
      status,
      priority: args.priority ?? "medium",
      labels: args.labels ?? [],
      parentTaskId: args.parentTaskId,
      dependsOn: args.dependsOn ?? [],
      source: "manual",
      projectId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    boardId: v.optional(v.id("boards")),
    assigneeIds: v.optional(v.array(v.string())),
    dueDate: v.optional(v.union(v.number(), v.null())),
    status: v.optional(statusValidator),
    priority: v.optional(priorityValidator),
    labels: v.optional(v.array(v.string())),
    dependsOn: v.optional(v.array(v.id("tasks"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error("Task not found");

    // Only touch fields that were actually provided. `null` clears an
    // optional field; `undefined` (omitted) leaves it untouched.
    const patch: Partial<Doc<"tasks">> = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined)
      patch.description = args.description ?? undefined;
    if (args.boardId !== undefined) patch.boardId = args.boardId;
    if (args.assigneeIds !== undefined) patch.assigneeIds = args.assigneeIds;
    if (args.dueDate !== undefined) patch.dueDate = args.dueDate ?? undefined;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.labels !== undefined) patch.labels = args.labels;
    if (args.dependsOn !== undefined) patch.dependsOn = args.dependsOn;

    if (args.status !== undefined) {
      patch.status = args.status;
      if (args.status === "done" && task.status !== "done") {
        patch.completedAt = Date.now();
      } else if (args.status !== "done" && task.status === "done") {
        patch.completedAt = undefined; // clear
      }
    }

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);

    const comments = await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);

    const attachments = await ctx.db
      .query("taskAttachments")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    for (const a of attachments) {
      await ctx.storage.delete(a.storageId);
      await ctx.db.delete(a._id);
    }

    // Orphan any subtasks rather than deleting them.
    const children = await ctx.db
      .query("tasks")
      .withIndex("by_parent", (q) => q.eq("parentTaskId", id))
      .collect();
    for (const child of children) {
      await ctx.db.patch(child._id, { parentTaskId: undefined });
    }

    await ctx.db.delete(id);
    return null;
  },
});

// --- Comments ---

const vComment = v.object({
  _id: v.id("taskComments"),
  _creationTime: v.number(),
  taskId: v.id("tasks"),
  authorId: v.string(),
  body: v.string(),
});

export const addComment = mutation({
  args: { taskId: v.id("tasks"), body: v.string() },
  returns: v.id("taskComments"),
  handler: async (ctx, { taskId, body }) => {
    const authorId = await requireUserId(ctx);
    return ctx.db.insert("taskComments", { taskId, authorId, body });
  },
});

export const listComments = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(vComment),
  handler: async (ctx, { taskId }) => {
    return ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("asc")
      .collect();
  },
});

// --- Attachments ---

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const addAttachment = mutation({
  args: {
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    filename: v.string(),
  },
  returns: v.id("taskAttachments"),
  handler: async (ctx, { taskId, storageId, filename }) => {
    await requireUserId(ctx);
    return ctx.db.insert("taskAttachments", { taskId, storageId, filename });
  },
});

export const listAttachments = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(
    v.object({
      _id: v.id("taskAttachments"),
      _creationTime: v.number(),
      filename: v.string(),
      url: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { taskId }) => {
    const attachments = await ctx.db
      .query("taskAttachments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    return Promise.all(
      attachments.map(async (a) => ({
        _id: a._id,
        _creationTime: a._creationTime,
        filename: a.filename,
        url: await ctx.storage.getUrl(a.storageId),
      })),
    );
  },
});

export const removeAttachment = mutation({
  args: { id: v.id("taskAttachments") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireUserId(ctx);
    const attachment = await ctx.db.get(id);
    if (!attachment) return null;
    await ctx.storage.delete(attachment.storageId);
    await ctx.db.delete(id);
    return null;
  },
});

// Re-exported for reuse by other modules (e.g. dashboard grouping).
export type Task = Doc<"tasks">;
export type TaskId = Id<"tasks">;
