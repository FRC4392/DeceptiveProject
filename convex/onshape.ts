import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMentor, requireUserId } from "./lib/auth";
import { syncTaskForPart } from "./lib/taskSync";
import { inferMethodFromMaterial } from "./lib/inferMethod";
import { methodValidator, partStatusValidator } from "./parts";

const TEAM = "4392";

// ---- Part numbers: 4392-<tag>-DDSSSS (tag comes from the part's project) ----
function formatPartNumber(
  tag: string,
  documentNumber: string,
  seq: number,
): string {
  return `${TEAM}-${tag}-${documentNumber}${String(seq).padStart(4, "0")}`;
}

// Atomic because Convex mutations are transactions; concurrent calls serialize.
// Keyed by (tag, documentNumber) so two projects can reuse a document number.
async function nextPartNumber(
  ctx: MutationCtx,
  tag: string,
  documentNumber: string,
): Promise<string> {
  const counter = await ctx.db
    .query("partNumberCounters")
    .withIndex("by_tag_and_document", (q) =>
      q.eq("tag", tag).eq("documentNumber", documentNumber),
    )
    .unique();
  let seq: number;
  if (counter) {
    seq = counter.lastSequence + 1;
    await ctx.db.patch(counter._id, { lastSequence: seq });
  } else {
    seq = 1;
    await ctx.db.insert("partNumberCounters", {
      tag,
      documentNumber,
      lastSequence: 1,
    });
  }
  return formatPartNumber(tag, documentNumber, seq);
}

export const generatePartNumber = internalMutation({
  args: { tag: v.string(), documentNumber: v.string() },
  returns: v.string(),
  handler: (ctx, { tag, documentNumber }) =>
    nextPartNumber(ctx, tag, documentNumber),
});

// Wipe the per-(tag, document) sequence counters so numbering restarts at 0001.
// Internal-only; run with `npx convex run onshape:resetPartNumberCounters`.
export const resetPartNumberCounters = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const counters = await ctx.db.query("partNumberCounters").take(5000);
    for (const c of counters) await ctx.db.delete(c._id);
    return { deleted: counters.length };
  },
});

// Resolve an Onshape document to its 2-digit number and owning project's
// numbering config. Any field may be null if the document/project isn't set up.
type DocProject = {
  documentNumber: string | null;
  projectId: Id<"projects"> | null;
  tag: string | null;
  mode: "auto" | "manual" | null;
};

async function resolveDocProject(
  ctx: QueryCtx | MutationCtx,
  onshapeDocumentId: string,
): Promise<DocProject> {
  const doc = await ctx.db
    .query("onshapeDocuments")
    .withIndex("by_onshapeDocumentId", (q) =>
      q.eq("onshapeDocumentId", onshapeDocumentId),
    )
    .unique();
  if (!doc) {
    return { documentNumber: null, projectId: null, tag: null, mode: null };
  }
  const project = doc.projectId ? await ctx.db.get(doc.projectId) : null;
  return {
    documentNumber: doc.documentNumber,
    projectId: doc.projectId ?? null,
    tag: project?.tag ?? null,
    mode: project?.numberingMode ?? null,
  };
}

// Read-only projection of what upsert would do to each part's number, for the
// right-panel preview. Mirrors the reconciliation in `upsertPart` WITHOUT
// touching the database: it never advances the per-document counter, instead
// projecting sequence numbers for new parts in list order.
export const previewNumbers = internalQuery({
  args: {
    items: v.array(
      v.object({
        onshapeElementId: v.string(),
        onshapeDocumentId: v.optional(v.string()),
        onshapePartNumber: v.optional(v.string()),
      }),
    ),
  },
  returns: v.array(
    v.object({
      partNumber: v.union(v.string(), v.null()),
      tracked: v.boolean(),
      willWriteBack: v.boolean(),
    }),
  ),
  handler: async (ctx, { items }) => {
    const docCache = new Map<string, DocProject>();
    const nextSeq = new Map<string, number>(); // `${tag}:${doc}` → seq to assign next
    const out: Array<{
      partNumber: string | null;
      tracked: boolean;
      willWriteBack: boolean;
    }> = [];

    for (const item of items) {
      let dp: DocProject = {
        documentNumber: null,
        projectId: null,
        tag: null,
        mode: null,
      };
      if (item.onshapeDocumentId) {
        const cached = docCache.get(item.onshapeDocumentId);
        if (cached) {
          dp = cached;
        } else {
          dp = await resolveDocProject(ctx, item.onshapeDocumentId);
          docCache.set(item.onshapeDocumentId, dp);
        }
      }

      const existing = await ctx.db
        .query("parts")
        .withIndex("by_onshapeElementId", (q) =>
          q.eq("onshapeElementId", item.onshapeElementId),
        )
        .unique();
      const tracked = existing !== null;

      if (item.onshapePartNumber) {
        // Onshape already has a number → adopt it, nothing to write back.
        out.push({ partNumber: item.onshapePartNumber, tracked, willWriteBack: false });
      } else if (existing?.partNumber) {
        // Tracker has one, Onshape doesn't → keep ours and push it back.
        out.push({ partNumber: existing.partNumber, tracked, willWriteBack: true });
      } else if (dp.mode === "auto" && dp.tag !== null && dp.documentNumber !== null) {
        // Auto project, neither side numbered → project the next number.
        const tag = dp.tag;
        const dn = dp.documentNumber;
        const key = `${tag}:${dn}`;
        let seq = nextSeq.get(key);
        if (seq === undefined) {
          const counter = await ctx.db
            .query("partNumberCounters")
            .withIndex("by_tag_and_document", (q) =>
              q.eq("tag", tag).eq("documentNumber", dn),
            )
            .unique();
          seq = (counter?.lastSequence ?? 0) + 1;
        }
        nextSeq.set(key, seq + 1);
        out.push({
          partNumber: formatPartNumber(tag, dn, seq),
          tracked,
          willWriteBack: true,
        });
      } else {
        // Manual project, or document/project not set up → no generated number.
        out.push({ partNumber: null, tracked, willWriteBack: false });
      }
    }
    return out;
  },
});

// When a document is (re)assigned to a project, adopt that project + document
// number on the document's already-synced parts, and — for auto-numbering
// projects — number any part that still lacks one. Returns how many were numbered.
async function backfillDocument(
  ctx: MutationCtx,
  onshapeDocumentId: string,
): Promise<number> {
  const dp = await resolveDocProject(ctx, onshapeDocumentId);
  const parts = await ctx.db.query("parts").take(5000);
  let count = 0;
  for (const p of parts) {
    if (p.onshapeDocumentId !== onshapeDocumentId) continue;
    const patch: Partial<Doc<"parts">> = {};
    if (dp.documentNumber) patch.documentNumber = dp.documentNumber;
    if (dp.projectId) patch.projectId = dp.projectId;
    if (
      !p.partNumber &&
      dp.mode === "auto" &&
      dp.tag !== null &&
      dp.documentNumber !== null
    ) {
      patch.partNumber = await nextPartNumber(ctx, dp.tag, dp.documentNumber);
      count++;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(p._id, patch);
  }
  return count;
}

// ---- Documents (mentor-managed 2-digit numbers) ----
const vOnshapeDoc = v.object({
  _id: v.id("onshapeDocuments"),
  _creationTime: v.number(),
  documentNumber: v.string(),
  onshapeDocumentId: v.string(),
  name: v.string(),
  projectId: v.optional(v.id("projects")),
});

export const listDocuments = query({
  args: {},
  returns: v.array(vOnshapeDoc),
  handler: async (ctx) => {
    const docs = await ctx.db.query("onshapeDocuments").collect();
    return docs.sort((a, b) => a.documentNumber.localeCompare(b.documentNumber));
  },
});

export const assignDocumentNumber = mutation({
  args: {
    onshapeDocumentId: v.string(),
    documentNumber: v.string(),
    name: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
  },
  returns: v.object({ backfilled: v.number() }),
  handler: async (ctx, args) => {
    await requireMentor(ctx);
    const existing = await ctx.db
      .query("onshapeDocuments")
      .withIndex("by_onshapeDocumentId", (q) =>
        q.eq("onshapeDocumentId", args.onshapeDocumentId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        documentNumber: args.documentNumber,
        name: args.name ?? existing.name,
        projectId: args.projectId ?? existing.projectId,
      });
    } else {
      await ctx.db.insert("onshapeDocuments", {
        onshapeDocumentId: args.onshapeDocumentId,
        documentNumber: args.documentNumber,
        name: args.name ?? args.onshapeDocumentId,
        projectId: args.projectId,
      });
    }
    // Adopt the project + number any already-synced parts from this document.
    const backfilled = await backfillDocument(ctx, args.onshapeDocumentId);
    // Keep linked tasks current (titles include the new part numbers).
    if (backfilled > 0) {
      const parts = await ctx.db.query("parts").take(5000);
      for (const p of parts) {
        if (p.onshapeDocumentId === args.onshapeDocumentId) {
          await syncTaskForPart(ctx, p);
        }
      }
    }
    return { backfilled };
  },
});

export const removeDocument = mutation({
  args: { id: v.id("onshapeDocuments") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    await ctx.db.delete(id);
    return null;
  },
});

// ---- Core upsert from Onshape ----
async function upsertPart(
  ctx: MutationCtx,
  input: {
    onshapeElementId: string;
    onshapeDocumentId?: string;
    name?: string;
    material?: string;
    manufacturingMethod?: Doc<"parts">["manufacturingMethod"];
    quantityNeeded?: number;
    status?: Doc<"parts">["status"];
    designerId?: string;
    lastModifiedInOnshape?: number;
    // The part's current "Part number" value in Onshape, if it has one. Drives
    // the bidirectional reconciliation below.
    onshapePartNumber?: string;
  },
): Promise<{
  partId: Id<"parts">;
  partNumber: string | null;
  revisionConflict: boolean;
  // The number the caller (the sync action) should push into Onshape's
  // part-number metadata, or null if Onshape is already authoritative.
  writeBackPartNumber: string | null;
}> {
  const existing = await ctx.db
    .query("parts")
    .withIndex("by_onshapeElementId", (q) =>
      q.eq("onshapeElementId", input.onshapeElementId),
    )
    .unique();

  const dp: DocProject = input.onshapeDocumentId
    ? await resolveDocProject(ctx, input.onshapeDocumentId)
    : { documentNumber: null, projectId: null, tag: null, mode: null };
  const documentNumber = dp.documentNumber ?? undefined;
  const modified = input.lastModifiedInOnshape ?? Date.now();

  if (existing) {
    const patch: Partial<Doc<"parts">> = {
      lastModifiedInOnshape: modified,
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.material !== undefined) patch.material = input.material;
    if (input.manufacturingMethod !== undefined)
      patch.manufacturingMethod = input.manufacturingMethod;
    if (input.quantityNeeded !== undefined)
      patch.quantityNeeded = input.quantityNeeded;
    if (input.designerId !== undefined) patch.designerId = input.designerId;
    if (input.onshapeDocumentId !== undefined)
      patch.onshapeDocumentId = input.onshapeDocumentId;
    if (documentNumber) patch.documentNumber = documentNumber;
    if (dp.projectId) patch.projectId = dp.projectId;
    // Bidirectional part number reconciliation (tag + numberingMode come from
    // the project via resolveDocProject):
    //  - Onshape has one       → adopt it (Onshape is authoritative when set).
    //  - else tracker has one  → push it back.
    //  - else auto project     → generate + push; manual project → leave unset.
    let writeBackPartNumber: string | null = null;
    if (input.onshapePartNumber) {
      if (existing.partNumber !== input.onshapePartNumber)
        patch.partNumber = input.onshapePartNumber;
    } else if (existing.partNumber) {
      writeBackPartNumber = existing.partNumber;
    } else if (
      dp.mode === "auto" &&
      dp.tag !== null &&
      dp.documentNumber !== null
    ) {
      const pn = await nextPartNumber(ctx, dp.tag, dp.documentNumber);
      patch.partNumber = pn;
      writeBackPartNumber = pn;
    }
    // An Onshape edit after the design was locked (status past "designed")
    // is a revision conflict the team needs to reconcile.
    const passedDesign = !["needs_design", "in_design", "designed"].includes(
      existing.status,
    );
    let revisionConflict = existing.revisionConflict;
    if (passedDesign && !existing.revisionConflict) {
      patch.revisionConflict = true;
      revisionConflict = true;
    }
    await ctx.db.patch(existing._id, patch);
    const updated = await ctx.db.get(existing._id);
    if (updated) await syncTaskForPart(ctx, updated);
    return {
      partId: existing._id,
      partNumber: updated?.partNumber ?? null,
      revisionConflict,
      writeBackPartNumber,
    };
  }

  // New part: adopt Onshape's number if it has one; else, for an auto project,
  // generate one (and ask the caller to write it back to Onshape).
  let partNumber: string | undefined;
  let writeBackPartNumber: string | null = null;
  if (input.onshapePartNumber) {
    partNumber = input.onshapePartNumber;
  } else if (
    dp.mode === "auto" &&
    dp.tag !== null &&
    dp.documentNumber !== null
  ) {
    partNumber = await nextPartNumber(ctx, dp.tag, dp.documentNumber);
    writeBackPartNumber = partNumber;
  }
  const id = await ctx.db.insert("parts", {
    name: input.name ?? "Untitled Onshape part",
    // Onshape doesn't report a fab method; infer 3D-printed parts from the
    // material, else default to mill. Inference is create-only, so a method
    // set manually in the app afterward is preserved on re-sync.
    manufacturingMethod:
      input.manufacturingMethod ??
      inferMethodFromMaterial(input.material) ??
      "mill",
    quantityNeeded: input.quantityNeeded ?? 1,
    material: input.material,
    status: input.status ?? "in_design", // synced from CAD → still in design
    isCOTS: false,
    blocked: false,
    revisionConflict: false,
    partNumber,
    documentNumber,
    projectId: dp.projectId ?? undefined,
    onshapeDocumentId: input.onshapeDocumentId,
    onshapeElementId: input.onshapeElementId,
    lastModifiedInOnshape: modified,
    designerId: input.designerId,
  });
  const part = await ctx.db.get(id);
  if (part) await syncTaskForPart(ctx, part);
  return {
    partId: id,
    partNumber: partNumber ?? null,
    revisionConflict: false,
    writeBackPartNumber,
  };
}

export const upsertPartFromOnshape = internalMutation({
  args: {
    onshapeElementId: v.string(),
    onshapeDocumentId: v.optional(v.string()),
    name: v.optional(v.string()),
    material: v.optional(v.string()),
    manufacturingMethod: v.optional(methodValidator),
    quantityNeeded: v.optional(v.number()),
    status: v.optional(partStatusValidator),
    designerId: v.optional(v.string()),
    lastModifiedInOnshape: v.optional(v.number()),
    onshapePartNumber: v.optional(v.string()),
  },
  returns: v.object({
    partId: v.id("parts"),
    partNumber: v.union(v.string(), v.null()),
    revisionConflict: v.boolean(),
    writeBackPartNumber: v.union(v.string(), v.null()),
  }),
  handler: (ctx, args) => upsertPart(ctx, args),
});

export const backfillAll = internalMutation({
  args: {},
  returns: v.object({ assigned: v.number() }),
  handler: async (ctx) => {
    const docs = await ctx.db.query("onshapeDocuments").collect();
    let assigned = 0;
    for (const d of docs) {
      assigned += await backfillDocument(ctx, d.onshapeDocumentId);
    }
    return { assigned };
  },
});

// ---- Revision conflict (UI-facing) ----
export const clearRevisionConflict = mutation({
  args: { partId: v.id("parts") },
  returns: v.null(),
  handler: async (ctx, { partId }) => {
    await requireUserId(ctx);
    await ctx.db.patch(partId, { revisionConflict: false });
    return null;
  },
});
