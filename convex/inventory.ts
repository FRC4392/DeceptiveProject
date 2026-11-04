import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { canRead, requireUserId, requireMentor } from "./lib/auth";
import { requestedCount } from "./lib/counts";

/**
 * Stock on a shelf: never below none, never a fraction of a thing. This used
 * to take whatever it was given, so a few quick presses of − on a shared
 * count could leave it negative.
 */
function wholeCount(qty: number): number {
  return Math.max(0, Math.round(qty));
}

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
    if (!(await canRead(ctx))) return [];
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
      onHandQty: wholeCount(args.onHandQty),
      unitCost: args.unitCost,
      linkedPartId: args.linkedPartId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("inventoryItems"),
    name: v.optional(v.string()),
    /** A number typed in. */
    onHandQty: v.optional(v.number()),
    /** A press of − or +. See lib/counts.ts for why it isn't a number. */
    onHandQtyDelta: v.optional(v.number()),
    unitCost: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, onHandQty, onHandQtyDelta, unitCost }) => {
    await requireUserId(ctx);
    const item = await ctx.db.get(id);
    if (!item) throw new Error("That item is gone.");
    const patch: Partial<Doc<"inventoryItems">> = {};
    if (name !== undefined) patch.name = name;
    if (onHandQty !== undefined || onHandQtyDelta !== undefined) {
      patch.onHandQty = wholeCount(
        requestedCount(item.onHandQty, {
          value: onHandQty,
          delta: onHandQtyDelta,
        }),
      );
    }
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
