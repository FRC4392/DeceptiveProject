// Bought items. They get no part number — they're tracked by name per
// subsystem, and "arrived" counts as ready to assemble.
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUserId, requireLead } from "./lib/auth";
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
  cost: v.optional(v.number()),
});

export const list = query({
  args: { subsystemId: v.optional(v.id("subsystems")) },
  returns: v.array(vCots),
  handler: async (ctx, { subsystemId }) => {
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

export const setStatus = mutation({
  args: {
    id: v.id("cotsItems"),
    status: statusValidator,
    eta: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { id, status, eta }) => {
    await requireUserId(ctx);
    const patch: Partial<Doc<"cotsItems">> = { status };
    if (eta !== undefined) patch.eta = eta ?? undefined;
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
