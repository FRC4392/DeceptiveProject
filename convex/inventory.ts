import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUserId, requireMentor } from "./lib/auth";

const vInventoryItem = v.object({
  _id: v.id("inventoryItems"),
  _creationTime: v.number(),
  name: v.string(),
  onHandQty: v.number(),
  unitCost: v.optional(v.number()),
  linkedPartId: v.optional(v.id("parts")),
});

export const list = query({
  args: {},
  returns: v.array(vInventoryItem),
  handler: async (ctx) => {
    const items = await ctx.db.query("inventoryItems").take(2000);
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    onHandQty: v.number(),
    unitCost: v.optional(v.number()),
    linkedPartId: v.optional(v.id("parts")),
  },
  returns: v.id("inventoryItems"),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    return ctx.db.insert("inventoryItems", {
      name: args.name,
      onHandQty: args.onHandQty,
      unitCost: args.unitCost,
      linkedPartId: args.linkedPartId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("inventoryItems"),
    name: v.optional(v.string()),
    onHandQty: v.optional(v.number()),
    unitCost: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, onHandQty, unitCost }) => {
    await requireUserId(ctx);
    const patch: Partial<Doc<"inventoryItems">> = {};
    if (name !== undefined) patch.name = name;
    if (onHandQty !== undefined) patch.onHandQty = onHandQty;
    if (unitCost !== undefined) patch.unitCost = unitCost ?? undefined;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("inventoryItems") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    await ctx.db.delete(id);
    return null;
  },
});
