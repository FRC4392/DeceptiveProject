// The season's to-do list.
//
// One list, no boards: a to-do is a title, some tags, who picked it up, and
// done or not done. Deliberately the same shape as a part — claim it, work on
// it, mark it done — so the two sides of the app read the same way.
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  canRead,
  getActor,
  requireLead,
  requireMentor,
  requireUserId,
} from "./lib/auth";
import { activeSeason, requireActiveSeason } from "./lib/season";
import { isLeadOrAbove } from "./lib/stages";

const SCAN_LIMIT = 2000;

const priorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

const vTodo = v.object({
  _id: v.id("todos"),
  _creationTime: v.number(),
  seasonId: v.id("seasons"),
  title: v.string(),
  description: v.optional(v.string()),
  tagIds: v.array(v.id("todoTags")),
  priority: priorityValidator,
  claimedByUserId: v.optional(v.string()),
  doneAt: v.optional(v.number()),
  doneByUserId: v.optional(v.string()),
});

const vTag = v.object({
  _id: v.id("todoTags"),
  _creationTime: v.number(),
  name: v.string(),
  order: v.number(),
});

// ---- Tags ----

export const listTags = query({
  args: {},
  returns: v.array(vTag),
  handler: async (ctx) => {
    if (!(await canRead(ctx))) return [];
    const tags = await ctx.db.query("todoTags").collect();
    return tags.sort((a, b) => a.order - b.order);
  },
});

export const createTag = mutation({
  args: { name: v.string() },
  returns: v.id("todoTags"),
  handler: async (ctx, { name }) => {
    await requireMentor(ctx);
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("Give the tag a name.");
    const tags = await ctx.db.query("todoTags").collect();
    if (tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`There's already a "${trimmed}" tag.`);
    }
    const order = tags.reduce((max, t) => Math.max(max, t.order), -1) + 1;
    return ctx.db.insert("todoTags", { name: trimmed, order });
  },
});

export const renameTag = mutation({
  args: { id: v.id("todoTags"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    await requireMentor(ctx);
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("Give the tag a name.");
    await ctx.db.patch(id, { name: trimmed });
    return null;
  },
});

export const removeTag = mutation({
  args: { id: v.id("todoTags") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    // Take it off everything carrying it rather than leaving a dangling id.
    for (const todo of await ctx.db.query("todos").take(SCAN_LIMIT)) {
      if (todo.tagIds.includes(id)) {
        await ctx.db.patch(todo._id, {
          tagIds: todo.tagIds.filter((t) => t !== id),
        });
      }
    }
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Reading ----

export const list = query({
  args: { includeDone: v.optional(v.boolean()) },
  returns: v.array(vTodo),
  handler: async (ctx, { includeDone }) => {
    if (!(await canRead(ctx))) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];
    const todos = await ctx.db
      .query("todos")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const visible =
      includeDone === false ? todos.filter((t) => !t.doneAt) : todos;
    // Newest first within each half; done ones sink.
    return visible.sort((a, b) => {
      if (!!a.doneAt !== !!b.doneAt) return a.doneAt ? 1 : -1;
      return b._creationTime - a._creationTime;
    });
  },
});

export const get = query({
  args: { id: v.id("todos") },
  returns: v.union(vTodo, v.null()),
  handler: async (ctx, { id }) =>
    (await canRead(ctx)) ? ctx.db.get(id) : null,
});

export const listMine = query({
  args: {},
  returns: v.array(vTodo),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    // This season's, like the list it comes from.
    const season = await activeSeason(ctx);
    if (!season) return [];
    const todos = (
      await ctx.db
        .query("todos")
        .withIndex("by_claimedBy", (q) => q.eq("claimedByUserId", userId))
        .take(SCAN_LIMIT)
    ).filter((t) => t.seasonId === season._id);
    return todos.sort((a, b) => {
      if (!!a.doneAt !== !!b.doneAt) return a.doneAt ? 1 : -1;
      return b._creationTime - a._creationTime;
    });
  },
});

export const notes = query({
  args: { todoId: v.id("todos") },
  returns: v.array(
    v.object({
      _id: v.id("todoNotes"),
      _creationTime: v.number(),
      todoId: v.id("todos"),
      userId: v.string(),
      body: v.string(),
    }),
  ),
  handler: async (ctx, { todoId }) => {
    if (!(await canRead(ctx))) return [];
    const rows = await ctx.db
      .query("todoNotes")
      .withIndex("by_todo", (q) => q.eq("todoId", todoId))
      .collect();
    return rows.sort((a, b) => b._creationTime - a._creationTime);
  },
});

// ---- Writing ----

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("todoTags"))),
    priority: v.optional(priorityValidator),
  },
  returns: v.id("todos"),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const season = await requireActiveSeason(ctx);
    const title = args.title.trim();
    if (title.length === 0) throw new Error("Give it a title.");
    return ctx.db.insert("todos", {
      seasonId: season._id,
      title,
      description: args.description?.trim() || undefined,
      tagIds: args.tagIds ?? [],
      priority: args.priority ?? "medium",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("todos"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    tagIds: v.optional(v.array(v.id("todoTags"))),
    priority: v.optional(priorityValidator),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...rest }) => {
    await requireUserId(ctx);
    const patch: Partial<Doc<"todos">> = {};
    if (rest.title !== undefined) {
      const title = rest.title.trim();
      if (title.length === 0) throw new Error("Give it a title.");
      patch.title = title;
    }
    if (rest.description !== undefined) {
      patch.description = rest.description?.trim() || undefined;
    }
    if (rest.tagIds !== undefined) patch.tagIds = rest.tagIds;
    if (rest.priority !== undefined) patch.priority = rest.priority;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireLead(ctx);
    const notes = await ctx.db
      .query("todoNotes")
      .withIndex("by_todo", (q) => q.eq("todoId", id))
      .collect();
    for (const note of notes) await ctx.db.delete(note._id);
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Picking one up, and finishing it ----

export const claim = mutation({
  args: { id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const todo = await ctx.db.get(id);
    if (!todo) throw new Error("That to-do is gone.");
    if (todo.claimedByUserId && todo.claimedByUserId !== userId) {
      throw new Error("Someone else already picked this one up.");
    }
    await ctx.db.patch(id, { claimedByUserId: userId });
    return null;
  },
});

/**
 * Put someone else on a to-do. Mentors only, same as parts.
 */
export const assign = mutation({
  args: { id: v.id("todos"), userId: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { id, userId }) => {
    await requireMentor(ctx);
    const todo = await ctx.db.get(id);
    if (!todo) throw new Error("That to-do is gone.");
    if (userId !== null) {
      const user = await ctx.db
        .query("users")
        .withIndex("authId", (q) => q.eq("authId", userId))
        .unique();
      if (!user) throw new Error("That person hasn't signed in yet.");
    }
    await ctx.db.patch(id, { claimedByUserId: userId ?? undefined });
    return null;
  },
});

export const unclaim = mutation({
  args: { id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const actor = await getActor(ctx);
    const todo = await ctx.db.get(id);
    if (!todo) throw new Error("That to-do is gone.");
    if (todo.claimedByUserId !== actor.userId && !isLeadOrAbove(actor.role)) {
      throw new Error("Only the person who picked it up can put it back.");
    }
    await ctx.db.patch(id, { claimedByUserId: undefined });
    return null;
  },
});

/** Done or not — anyone can flip it, the way anyone can finish a part. */
export const setDone = mutation({
  args: { id: v.id("todos"), done: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, done }) => {
    const userId = await requireUserId(ctx);
    await ctx.db.patch(id, {
      doneAt: done ? Date.now() : undefined,
      doneByUserId: done ? userId : undefined,
    });
    return null;
  },
});

export const addNote = mutation({
  args: { todoId: v.id("todos"), body: v.string() },
  returns: v.id("todoNotes"),
  handler: async (ctx, { todoId, body }) => {
    const userId = await requireUserId(ctx);
    const trimmed = body.trim();
    if (trimmed.length === 0) throw new Error("Write something first.");
    return ctx.db.insert("todoNotes", { todoId, userId, body: trimmed });
  },
});
