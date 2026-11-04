// The shop's own setup: the machines, and the processes that run on them.
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { canRead, requireMentor } from "./lib/auth";

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

// ---- Machines ----

export const listMachines = query({
  args: {},
  returns: v.array(vMachine),
  handler: async (ctx) => {
    if (!(await canRead(ctx))) return [];
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
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Process types ----

export const listProcessTypes = query({
  args: {},
  returns: v.array(vProcessType),
  handler: async (ctx) => {
    if (!(await canRead(ctx))) return [];
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
