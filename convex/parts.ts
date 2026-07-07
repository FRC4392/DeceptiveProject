import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUserId, requireMentor } from "./lib/auth";
import { syncTaskForPart, deleteTaskForPart } from "./lib/taskSync";

export const partStatusValidator = v.union(
  v.literal("needs_design"),
  v.literal("in_design"),
  v.literal("designed"),
  v.literal("queued"),
  v.literal("in_progress"),
  v.literal("manufactured"),
  v.literal("qc"),
  v.literal("installed"),
  v.literal("scrapped"),
);

export const methodValidator = v.union(
  v.literal("mill"),
  v.literal("lathe"),
  v.literal("3d_print"),
  v.literal("waterjet"),
  v.literal("laser_cut"),
  v.literal("cots"),
);

const vPart = v.object({
  _id: v.id("parts"),
  _creationTime: v.number(),
  partNumber: v.optional(v.string()),
  name: v.string(),
  material: v.optional(v.string()),
  quantityNeeded: v.number(),
  manufacturingMethod: methodValidator,
  status: partStatusValidator,
  assigneeId: v.optional(v.string()),
  thumbnailStorageId: v.optional(v.id("_storage")),
  isCOTS: v.boolean(),
  vendor: v.optional(v.string()),
  vendorPartNumber: v.optional(v.string()),
  cost: v.optional(v.number()),
  orderStatus: v.optional(v.string()),
  leadTime: v.optional(v.string()),
  linkedTaskId: v.optional(v.id("tasks")),
  blocked: v.boolean(),
  blockedReason: v.optional(v.string()),
  onshapeDocumentId: v.optional(v.string()),
  onshapeElementId: v.optional(v.string()),
  documentNumber: v.optional(v.string()),
  lastModifiedInOnshape: v.optional(v.number()),
  designerId: v.optional(v.string()),
  revisionConflict: v.boolean(),
  projectId: v.optional(v.id("projects")),
});

const SCAN_LIMIT = 2000;

export const list = query({
  args: {
    status: v.optional(partStatusValidator),
    manufacturingMethod: v.optional(methodValidator),
    isCOTS: v.optional(v.boolean()),
    projectId: v.optional(v.id("projects")),
  },
  returns: v.array(vPart),
  handler: async (ctx, args) => {
    let parts: Doc<"parts">[];
    if (args.projectId !== undefined) {
      parts = await ctx.db
        .query("parts")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(SCAN_LIMIT);
    } else if (args.status !== undefined) {
      parts = await ctx.db
        .query("parts")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .take(SCAN_LIMIT);
    } else if (args.isCOTS !== undefined) {
      parts = await ctx.db
        .query("parts")
        .withIndex("by_isCOTS", (q) => q.eq("isCOTS", args.isCOTS!))
        .take(SCAN_LIMIT);
    } else {
      parts = await ctx.db.query("parts").order("desc").take(SCAN_LIMIT);
    }
    return parts.filter(
      (p) =>
        (args.status === undefined || p.status === args.status) &&
        (args.manufacturingMethod === undefined ||
          p.manufacturingMethod === args.manufacturingMethod) &&
        (args.isCOTS === undefined || p.isCOTS === args.isCOTS),
    );
  },
});

export const get = query({
  args: { id: v.id("parts") },
  returns: v.union(vPart, v.null()),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const create = mutation({
  args: {
    name: v.string(),
    manufacturingMethod: methodValidator,
    quantityNeeded: v.optional(v.number()),
    material: v.optional(v.string()),
    status: v.optional(partStatusValidator),
    assigneeId: v.optional(v.string()),
    isCOTS: v.optional(v.boolean()),
    vendor: v.optional(v.string()),
    vendorPartNumber: v.optional(v.string()),
    cost: v.optional(v.number()),
    orderStatus: v.optional(v.string()),
    leadTime: v.optional(v.string()),
    partNumber: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
  },
  returns: v.id("parts"),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const isCOTS = args.isCOTS ?? args.manufacturingMethod === "cots";
    const id = await ctx.db.insert("parts", {
      name: args.name,
      manufacturingMethod: args.manufacturingMethod,
      quantityNeeded: args.quantityNeeded ?? 1,
      material: args.material,
      status: args.status ?? "needs_design",
      assigneeId: args.assigneeId,
      isCOTS,
      vendor: args.vendor,
      vendorPartNumber: args.vendorPartNumber,
      cost: args.cost,
      orderStatus: args.orderStatus,
      leadTime: args.leadTime,
      partNumber: args.partNumber,
      projectId: args.projectId,
      blocked: false,
      revisionConflict: false,
    });
    const part = await ctx.db.get(id);
    if (part) await syncTaskForPart(ctx, part);
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("parts"),
    name: v.optional(v.string()),
    manufacturingMethod: v.optional(methodValidator),
    quantityNeeded: v.optional(v.number()),
    material: v.optional(v.union(v.string(), v.null())),
    status: v.optional(partStatusValidator),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    isCOTS: v.optional(v.boolean()),
    vendor: v.optional(v.union(v.string(), v.null())),
    vendorPartNumber: v.optional(v.union(v.string(), v.null())),
    cost: v.optional(v.union(v.number(), v.null())),
    orderStatus: v.optional(v.union(v.string(), v.null())),
    leadTime: v.optional(v.union(v.string(), v.null())),
    partNumber: v.optional(v.union(v.string(), v.null())),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const { id, ...rest } = args;
    const patch: Partial<Doc<"parts">> = {};
    if (rest.projectId !== undefined)
      patch.projectId = rest.projectId ?? undefined;
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.manufacturingMethod !== undefined)
      patch.manufacturingMethod = rest.manufacturingMethod;
    if (rest.quantityNeeded !== undefined)
      patch.quantityNeeded = rest.quantityNeeded;
    if (rest.material !== undefined) patch.material = rest.material ?? undefined;
    if (rest.status !== undefined) patch.status = rest.status;
    if (rest.assigneeId !== undefined)
      patch.assigneeId = rest.assigneeId ?? undefined;
    if (rest.isCOTS !== undefined) patch.isCOTS = rest.isCOTS;
    if (rest.vendor !== undefined) patch.vendor = rest.vendor ?? undefined;
    if (rest.vendorPartNumber !== undefined)
      patch.vendorPartNumber = rest.vendorPartNumber ?? undefined;
    if (rest.cost !== undefined) patch.cost = rest.cost ?? undefined;
    if (rest.orderStatus !== undefined)
      patch.orderStatus = rest.orderStatus ?? undefined;
    if (rest.leadTime !== undefined) patch.leadTime = rest.leadTime ?? undefined;
    if (rest.partNumber !== undefined)
      patch.partNumber = rest.partNumber ?? undefined;

    await ctx.db.patch(id, patch);
    const part = await ctx.db.get(id);
    if (part) await syncTaskForPart(ctx, part);
    return null;
  },
});

export const updateStatus = mutation({
  args: { id: v.id("parts"), status: partStatusValidator },
  returns: v.null(),
  handler: async (ctx, { id, status }) => {
    await requireUserId(ctx);
    await ctx.db.patch(id, { status });
    const part = await ctx.db.get(id);
    if (part) await syncTaskForPart(ctx, part);
    return null;
  },
});

export const flagBlocked = mutation({
  args: {
    id: v.id("parts"),
    blocked: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, blocked, reason }) => {
    await requireUserId(ctx);
    await ctx.db.patch(id, {
      blocked,
      blockedReason: blocked ? reason : undefined,
    });
    const part = await ctx.db.get(id);
    if (part) await syncTaskForPart(ctx, part);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("parts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    const part = await ctx.db.get(id);
    if (!part) return null;

    await deleteTaskForPart(ctx, id);

    for (const table of ["partComments", "qcChecks"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_part", (q) => q.eq("partId", id))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
    if (part.thumbnailStorageId) {
      await ctx.storage.delete(part.thumbnailStorageId);
    }
    await ctx.db.delete(id);
    return null;
  },
});

// Delete every part and its dependents (linked tasks, comments, QC checks,
// thumbnails) — same cleanup as `remove`, applied in bulk. Internal-only; run
// with `npx convex run parts:deleteAllParts`. Leaves the Onshape document
// mapping, OAuth connection, and part-number counters intact. Handles up to a
// few thousand parts per call (fine for a test reset).
export const deleteAllParts = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const parts = await ctx.db.query("parts").take(5000);
    for (const part of parts) {
      await deleteTaskForPart(ctx, part._id);
      for (const table of ["partComments", "qcChecks"] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_part", (q) => q.eq("partId", part._id))
          .collect();
        for (const r of rows) await ctx.db.delete(r._id);
      }
      if (part.thumbnailStorageId) {
        await ctx.storage.delete(part.thumbnailStorageId);
      }
      await ctx.db.delete(part._id);
    }
    return { deleted: parts.length };
  },
});

// --- Thumbnail ---

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const setThumbnail = mutation({
  args: { id: v.id("parts"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { id, storageId }) => {
    await requireUserId(ctx);
    const part = await ctx.db.get(id);
    if (part?.thumbnailStorageId) {
      await ctx.storage.delete(part.thumbnailStorageId);
    }
    await ctx.db.patch(id, { thumbnailStorageId: storageId });
    return null;
  },
});

// Set a part's thumbnail from a Convex-side action (the Onshape sync), which
// has no logged-in user to guard on. Same body as `setThumbnail` minus the
// auth check. Replaces any prior thumbnail blob.
export const setThumbnailInternal = internalMutation({
  args: { id: v.id("parts"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { id, storageId }) => {
    const part = await ctx.db.get(id);
    if (part?.thumbnailStorageId) {
      await ctx.storage.delete(part.thumbnailStorageId);
    }
    await ctx.db.patch(id, { thumbnailStorageId: storageId });
    return null;
  },
});

export const thumbnailUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { storageId }) => ctx.storage.getUrl(storageId),
});

// --- Comments ---

const vPartComment = v.object({
  _id: v.id("partComments"),
  _creationTime: v.number(),
  partId: v.id("parts"),
  authorId: v.string(),
  body: v.string(),
});

export const addComment = mutation({
  args: { partId: v.id("parts"), body: v.string() },
  returns: v.id("partComments"),
  handler: async (ctx, { partId, body }) => {
    const authorId = await requireUserId(ctx);
    return ctx.db.insert("partComments", { partId, authorId, body });
  },
});

export const listComments = query({
  args: { partId: v.id("parts") },
  returns: v.array(vPartComment),
  handler: async (ctx, { partId }) =>
    ctx.db
      .query("partComments")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .order("asc")
      .collect(),
});

// --- QC checklist ---

const vQCCheck = v.object({
  _id: v.id("qcChecks"),
  _creationTime: v.number(),
  partId: v.id("parts"),
  label: v.string(),
  checked: v.boolean(),
});

export const listQCChecks = query({
  args: { partId: v.id("parts") },
  returns: v.array(vQCCheck),
  handler: async (ctx, { partId }) =>
    ctx.db
      .query("qcChecks")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .collect(),
});

export const addQCCheck = mutation({
  args: { partId: v.id("parts"), label: v.string() },
  returns: v.id("qcChecks"),
  handler: async (ctx, { partId, label }) => {
    await requireUserId(ctx);
    return ctx.db.insert("qcChecks", { partId, label, checked: false });
  },
});

export const toggleQCCheck = mutation({
  args: { id: v.id("qcChecks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireUserId(ctx);
    const check = await ctx.db.get(id);
    if (check) await ctx.db.patch(id, { checked: !check.checked });
    return null;
  },
});

export const removeQCCheck = mutation({
  args: { id: v.id("qcChecks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireUserId(ctx);
    await ctx.db.delete(id);
    return null;
  },
});

// --- Cost rollup (informational; skips missing values) ---

export const costRollup = query({
  args: { projectId: v.optional(v.id("projects")) },
  returns: v.object({
    total: v.number(),
    partsTotal: v.number(),
    inventoryTotal: v.number(),
    cotsTotal: v.number(),
    partsMissingCost: v.number(),
    byMethod: v.array(
      v.object({ method: methodValidator, total: v.number(), count: v.number() }),
    ),
  }),
  handler: async (ctx, args) => {
    const parts = (
      args.projectId !== undefined
        ? await ctx.db
            .query("parts")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .take(SCAN_LIMIT)
        : await ctx.db.query("parts").take(SCAN_LIMIT)
    );
    // Inventory isn't project-scoped; only include it in the whole-team rollup.
    const inventory =
      args.projectId !== undefined
        ? []
        : await ctx.db.query("inventoryItems").take(SCAN_LIMIT);

    const byMethod = new Map<string, { total: number; count: number }>();
    let partsTotal = 0;
    let cotsTotal = 0;
    let partsMissingCost = 0;
    for (const p of parts) {
      const entry = byMethod.get(p.manufacturingMethod) ?? {
        total: 0,
        count: 0,
      };
      entry.count += 1;
      if (p.cost !== undefined) {
        partsTotal += p.cost;
        entry.total += p.cost;
        if (p.isCOTS) cotsTotal += p.cost;
      } else {
        partsMissingCost += 1;
      }
      byMethod.set(p.manufacturingMethod, entry);
    }

    let inventoryTotal = 0;
    for (const item of inventory) {
      if (item.unitCost !== undefined) {
        inventoryTotal += item.unitCost * item.onHandQty;
      }
    }

    return {
      total: partsTotal + inventoryTotal,
      partsTotal,
      inventoryTotal,
      cotsTotal,
      partsMissingCost,
      byMethod: Array.from(byMethod.entries()).map(([method, v]) => ({
        method: method as Doc<"parts">["manufacturingMethod"],
        total: v.total,
        count: v.count,
      })),
    };
  },
});

// --- BOM export (flat rows; client builds the CSV) ---

export const exportBOM = query({
  args: { projectId: v.optional(v.id("projects")) },
  returns: v.array(
    v.object({
      partNumber: v.string(),
      name: v.string(),
      material: v.string(),
      quantityNeeded: v.number(),
      manufacturingMethod: v.string(),
      status: v.string(),
      isCOTS: v.boolean(),
      vendor: v.string(),
      vendorPartNumber: v.string(),
      cost: v.union(v.number(), v.null()),
      leadTime: v.string(),
      orderStatus: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const parts =
      args.projectId !== undefined
        ? await ctx.db
            .query("parts")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .take(SCAN_LIMIT)
        : await ctx.db.query("parts").order("desc").take(SCAN_LIMIT);
    return parts.map((p) => ({
      partNumber: p.partNumber ?? "",
      name: p.name,
      material: p.material ?? "",
      quantityNeeded: p.quantityNeeded,
      manufacturingMethod: p.manufacturingMethod,
      status: p.status,
      isCOTS: p.isCOTS,
      vendor: p.vendor ?? "",
      vendorPartNumber: p.vendorPartNumber ?? "",
      cost: p.cost ?? null,
      leadTime: p.leadTime ?? "",
      orderStatus: p.orderStatus ?? "",
    }));
  },
});
