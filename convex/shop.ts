// The shop's own setup: machines, the processes that run on them, and who a
// mentor has signed off to use what. Training is what gates claiming a part in
// "Ready to make", so it is mentor-only to grant.
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireMentor, requireUserId } from "./lib/auth";

const vMachine = v.object({
  _id: v.id("machines"),
  _creationTime: v.number(),
  name: v.string(),
  requiresMentorPresent: v.boolean(),
  order: v.number(),
});

const vProcessType = v.object({
  _id: v.id("processTypes"),
  _creationTime: v.number(),
  name: v.string(),
  machineId: v.optional(v.id("machines")),
  needsDrawing: v.boolean(),
  needsFinishing: v.boolean(),
  isBought: v.optional(v.boolean()),
  order: v.number(),
});

const vTraining = v.object({
  _id: v.id("training"),
  _creationTime: v.number(),
  userId: v.string(),
  machineId: v.id("machines"),
  signedOffByUserId: v.string(),
  date: v.number(),
});

// ---- Machines ----

export const listMachines = query({
  args: {},
  returns: v.array(vMachine),
  handler: async (ctx) => {
    const machines = await ctx.db.query("machines").collect();
    return machines.sort((a, b) => a.order - b.order);
  },
});

export const createMachine = mutation({
  args: { name: v.string(), requiresMentorPresent: v.optional(v.boolean()) },
  returns: v.id("machines"),
  handler: async (ctx, { name, requiresMentorPresent }) => {
    await requireMentor(ctx);
    const machines = await ctx.db.query("machines").collect();
    const order = machines.reduce((max, m) => Math.max(max, m.order), -1) + 1;
    return ctx.db.insert("machines", {
      name: name.trim(),
      requiresMentorPresent: requiresMentorPresent ?? false,
      order,
    });
  },
});

export const updateMachine = mutation({
  args: {
    id: v.id("machines"),
    name: v.optional(v.string()),
    requiresMentorPresent: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, requiresMentorPresent }) => {
    await requireMentor(ctx);
    const patch: Partial<Doc<"machines">> = {};
    if (name !== undefined) patch.name = name.trim();
    if (requiresMentorPresent !== undefined)
      patch.requiresMentorPresent = requiresMentorPresent;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const removeMachine = mutation({
  args: { id: v.id("machines") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    const processes = await ctx.db.query("processTypes").collect();
    if (processes.some((p) => p.machineId === id)) {
      throw new Error("A process still runs on this machine — move it first.");
    }
    const training = await ctx.db
      .query("training")
      .withIndex("by_machine", (q) => q.eq("machineId", id))
      .collect();
    for (const t of training) await ctx.db.delete(t._id);
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Process types ----

export const listProcessTypes = query({
  args: {},
  returns: v.array(vProcessType),
  handler: async (ctx) => {
    const processes = await ctx.db.query("processTypes").collect();
    return processes.sort((a, b) => a.order - b.order);
  },
});

export const createProcessType = mutation({
  args: {
    name: v.string(),
    machineId: v.optional(v.id("machines")),
    needsDrawing: v.boolean(),
    needsFinishing: v.boolean(),
    isBought: v.optional(v.boolean()),
  },
  returns: v.id("processTypes"),
  handler: async (ctx, args) => {
    await requireMentor(ctx);
    const processes = await ctx.db.query("processTypes").collect();
    const order = processes.reduce((max, p) => Math.max(max, p.order), -1) + 1;
    return ctx.db.insert("processTypes", {
      ...args,
      name: args.name.trim(),
      order,
    });
  },
});

export const updateProcessType = mutation({
  args: {
    id: v.id("processTypes"),
    name: v.optional(v.string()),
    machineId: v.optional(v.union(v.id("machines"), v.null())),
    needsDrawing: v.optional(v.boolean()),
    needsFinishing: v.optional(v.boolean()),
    isBought: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...rest }) => {
    await requireMentor(ctx);
    const patch: Partial<Doc<"processTypes">> = {};
    if (rest.name !== undefined) patch.name = rest.name.trim();
    if (rest.machineId !== undefined)
      patch.machineId = rest.machineId ?? undefined;
    if (rest.needsDrawing !== undefined) patch.needsDrawing = rest.needsDrawing;
    if (rest.needsFinishing !== undefined)
      patch.needsFinishing = rest.needsFinishing;
    if (rest.isBought !== undefined) patch.isBought = rest.isBought;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const removeProcessType = mutation({
  args: { id: v.id("processTypes") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    const parts = await ctx.db.query("parts").take(5000);
    if (parts.some((p) => p.processTypeId === id)) {
      throw new Error("Parts still use this process — change them first.");
    }
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Training sign-offs ----

export const listTraining = query({
  args: { userId: v.optional(v.string()) },
  returns: v.array(vTraining),
  handler: async (ctx, { userId }) => {
    if (userId !== undefined) {
      return ctx.db
        .query("training")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    }
    return ctx.db.query("training").take(5000);
  },
});

/** The machines the signed-in person may run, for the shop screen's header. */
export const myTraining = query({
  args: {},
  returns: v.array(v.id("machines")),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("training")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.machineId);
  },
});

export const signOffTraining = mutation({
  args: { userId: v.string(), machineId: v.id("machines") },
  returns: v.id("training"),
  handler: async (ctx, { userId, machineId }) => {
    const mentor = await requireMentor(ctx);
    const existing = await ctx.db
      .query("training")
      .withIndex("by_user_and_machine", (q) =>
        q.eq("userId", userId).eq("machineId", machineId),
      )
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert("training", {
      userId,
      machineId,
      signedOffByUserId: mentor.authId,
      date: Date.now(),
    });
  },
});

export const revokeTraining = mutation({
  args: { userId: v.string(), machineId: v.id("machines") },
  returns: v.null(),
  handler: async (ctx, { userId, machineId }) => {
    await requireMentor(ctx);
    const existing = await ctx.db
      .query("training")
      .withIndex("by_user_and_machine", (q) =>
        q.eq("userId", userId).eq("machineId", machineId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

// ---- Roles ----

/**
 * Give someone a tracker role from the command line:
 *
 *   npx convex run shop:grantRole '{"email":"you@example.com","role":"mentor"}'
 *
 * This is how the first mentor gets made, because Settings → People is itself
 * mentor-only. It writes `appRole`, which sign-in never overwrites, so it
 * sticks even if the Clerk session token carries no `role` claim.
 */
export const grantRole = internalMutation({
  args: {
    email: v.optional(v.string()),
    authId: v.optional(v.string()),
    role: v.union(
      v.literal("student"),
      v.literal("lead"),
      v.literal("mentor"),
      v.literal("admin"),
    ),
  },
  returns: v.object({ authId: v.string(), name: v.string() }),
  handler: async (ctx, { email, authId, role }) => {
    const users = await ctx.db.query("users").take(500);
    const match = authId
      ? users.find((u) => u.authId === authId)
      : users.find(
          (u) => u.email.toLowerCase() === (email ?? "").toLowerCase(),
        );
    if (!match) {
      throw new Error(
        `No such user. Sign in once first, then pick from: ${
          users.map((u) => u.email || u.authId).join(", ") || "(nobody yet)"
        }`,
      );
    }
    await ctx.db.patch(match._id, { appRole: role });
    return { authId: match.authId, name: match.name };
  },
});

export const setUserRole = mutation({
  args: {
    userId: v.string(),
    role: v.union(
      v.literal("student"),
      v.literal("lead"),
      v.literal("mentor"),
      v.literal("admin"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { userId, role }) => {
    await requireMentor(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", userId))
      .unique();
    if (!user) throw new Error("That person hasn't signed in yet.");
    await ctx.db.patch(user._id, { appRole: role });
    return null;
  },
});
