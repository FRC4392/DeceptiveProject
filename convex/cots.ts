// Bought items. They get no part number — they're tracked by name per
// subsystem, and "arrived" counts as ready to assemble.
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { canRead, requireUserId, requireLead } from "./lib/auth";
import { activeSeason, requireActiveSeason } from "./lib/season";

const statusValidator = v.union(
  v.literal("needed"),
  v.literal("ordered"),
  v.literal("arrived"),
);

const vCots = v.object({
  _id: v.id("cotsItems"),
  _creationTime: v.number(),
  seasonId: v.id("seasons"),
  subsystemId: v.id("subsystems"),
  name: v.string(),
  qtyNeeded: v.number(),
  unit: v.optional(v.string()),
  status: statusValidator,
  vendor: v.optional(v.string()),
  vendorPartNumber: v.optional(v.string()),
  eta: v.optional(v.number()),
  orderedAt: v.optional(v.number()),
  arrivedAt: v.optional(v.number()),
  cost: v.optional(v.number()),
  onshapeDocumentId: v.optional(v.string()),
  onshapeElementId: v.optional(v.string()),
  onshapePartId: v.optional(v.string()),
  onshapeVersionId: v.optional(v.string()),
  lastReleasePackageId: v.optional(v.string()),
  lastSyncedAt: v.optional(v.number()),
});

export const list = query({
  args: { subsystemId: v.optional(v.id("subsystems")) },
  returns: v.array(vCots),
  handler: async (ctx, { subsystemId }) => {
    if (!(await canRead(ctx))) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];
    const items =
      subsystemId !== undefined
        ? await ctx.db
            .query("cotsItems")
            .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
            .take(2000)
        : await ctx.db
            .query("cotsItems")
            .withIndex("by_season", (q) => q.eq("seasonId", season._id))
            .take(2000);
    return items.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    subsystemId: v.id("subsystems"),
    name: v.string(),
    qtyNeeded: v.number(),
    unit: v.optional(v.string()),
    vendor: v.optional(v.string()),
    vendorPartNumber: v.optional(v.string()),
    cost: v.optional(v.number()),
    status: v.optional(statusValidator),
  },
  returns: v.id("cotsItems"),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const season = await requireActiveSeason(ctx);
    return ctx.db.insert("cotsItems", {
      seasonId: season._id,
      subsystemId: args.subsystemId,
      name: args.name.trim(),
      qtyNeeded: Math.max(1, Math.round(args.qtyNeeded)),
      unit: args.unit?.trim() || undefined,
      vendor: args.vendor?.trim() || undefined,
      vendorPartNumber: args.vendorPartNumber?.trim() || undefined,
      cost: args.cost,
      status: args.status ?? "needed",
    });
  },
});

/**
 * Move a bought item along, and write down when.
 *
 * The date is stamped here rather than asked for. Someone marking a box of
 * wheels as arrived is telling the app it happened now; making them then pick
 * today out of a date picker is asking them to repeat themselves, and the
 * field sits empty when they don't bother.
 *
 * Moving backwards clears the stamp for the step being undone, because a
 * date saying a thing arrived is a lie about something sitting in a cupboard
 * at the vendor.
 */
export const setStatus = mutation({
  args: {
    id: v.id("cotsItems"),
    status: statusValidator,
    eta: v.optional(v.union(v.number(), v.null())),
    /** Correcting the stamp afterwards — "it actually came on Tuesday". */
    orderedAt: v.optional(v.union(v.number(), v.null())),
    arrivedAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { id, status, eta, orderedAt, arrivedAt }) => {
    await requireUserId(ctx);
    const item = await ctx.db.get(id);
    if (!item) throw new Error("That item is gone.");

    const now = Date.now();
    const patch: Partial<Doc<"cotsItems">> = { status };

    if (status === "needed") {
      // Not on its way at all: nothing has happened to it yet.
      patch.orderedAt = undefined;
      patch.arrivedAt = undefined;
      patch.eta = undefined;
    } else if (status === "ordered") {
      patch.orderedAt = item.orderedAt ?? now;
      patch.arrivedAt = undefined;
    } else {
      // It can arrive without anyone having recorded the order.
      patch.orderedAt = item.orderedAt;
      patch.arrivedAt = item.arrivedAt ?? now;
    }

    // An explicit date always wins, so a correction sticks.
    if (eta !== undefined) patch.eta = eta ?? undefined;
    if (orderedAt !== undefined) patch.orderedAt = orderedAt ?? undefined;
    if (arrivedAt !== undefined) patch.arrivedAt = arrivedAt ?? undefined;

    await ctx.db.patch(id, patch);
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("cotsItems"),
    name: v.optional(v.string()),
    qtyNeeded: v.optional(v.number()),
    unit: v.optional(v.union(v.string(), v.null())),
    vendor: v.optional(v.union(v.string(), v.null())),
    vendorPartNumber: v.optional(v.union(v.string(), v.null())),
    cost: v.optional(v.union(v.number(), v.null())),
    subsystemId: v.optional(v.id("subsystems")),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...rest }) => {
    await requireUserId(ctx);
    const patch: Partial<Doc<"cotsItems">> = {};
    if (rest.name !== undefined) patch.name = rest.name.trim();
    if (rest.qtyNeeded !== undefined)
      patch.qtyNeeded = Math.max(1, Math.round(rest.qtyNeeded));
    if (rest.unit !== undefined) patch.unit = rest.unit ?? undefined;
    if (rest.vendor !== undefined) patch.vendor = rest.vendor ?? undefined;
    if (rest.vendorPartNumber !== undefined)
      patch.vendorPartNumber = rest.vendorPartNumber ?? undefined;
    if (rest.cost !== undefined) patch.cost = rest.cost ?? undefined;
    if (rest.subsystemId !== undefined) patch.subsystemId = rest.subsystemId;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("cotsItems") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireLead(ctx);
    const links = await ctx.db.query("subAssemblyMembers").take(5000);
    for (const link of links) {
      if (link.cotsItemId === id) await ctx.db.delete(link._id);
    }
    await ctx.db.delete(id);
    return null;
  },
});
