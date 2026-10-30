// The Onshape link, on the tracker's side of the line.
//
// Two jobs: remember which Onshape document holds which subsystem's CAD, and
// turn a sync into a release intake for a lead to look at. Everything a
// student does — getting a number, pasting it into Onshape — costs nothing and
// happens without this file.
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMentor } from "./lib/auth";
import { requireActiveSeason } from "./lib/season";
import {
  classifyAssemblyLine,
  classifyRelease,
  type KnownPart,
} from "./lib/intake";
import { normalizePartNumber } from "./lib/stages";

const vOnshapeDoc = v.object({
  _id: v.id("onshapeDocuments"),
  _creationTime: v.number(),
  onshapeDocumentId: v.string(),
  name: v.string(),
  subsystemId: v.optional(v.id("subsystems")),
});

export const listDocuments = query({
  args: {},
  returns: v.array(vOnshapeDoc),
  handler: async (ctx) => {
    const docs = await ctx.db.query("onshapeDocuments").collect();
    return docs.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Map an Onshape document to the subsystem whose parts live in it. */
export const mapDocument = mutation({
  args: {
    onshapeDocumentId: v.string(),
    name: v.optional(v.string()),
    subsystemId: v.optional(v.union(v.id("subsystems"), v.null())),
  },
  returns: v.id("onshapeDocuments"),
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
        name: args.name ?? existing.name,
        subsystemId:
          args.subsystemId === undefined
            ? existing.subsystemId
            : (args.subsystemId ?? undefined),
      });
      return existing._id;
    }
    return ctx.db.insert("onshapeDocuments", {
      onshapeDocumentId: args.onshapeDocumentId,
      name: args.name ?? args.onshapeDocumentId,
      subsystemId: args.subsystemId ?? undefined,
    });
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

/** Record an Onshape call for the budget meter. 4xx/5xx don't count. */
export const recordApiCall = internalMutation({
  args: {
    method: v.string(),
    endpoint: v.string(),
    status: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("apiCalls", {
      ...args,
      counted: args.status >= 200 && args.status < 400,
    });
    return null;
  },
});

async function subsystemForDocument(
  ctx: MutationCtx,
  onshapeDocumentId: string,
): Promise<Id<"subsystems"> | undefined> {
  const doc = await ctx.db
    .query("onshapeDocuments")
    .withIndex("by_onshapeDocumentId", (q) =>
      q.eq("onshapeDocumentId", onshapeDocumentId),
    )
    .unique();
  return doc?.subsystemId;
}

/**
 * Everything a sync found in one Onshape element, parked as an intake for a
 * design lead to review on "New from Onshape". Nothing lands on the board
 * until someone decides — a released part that nobody has numbered is a
 * question, not a fact.
 */
export const receiveSync = internalMutation({
  args: {
    onshapeDocumentId: v.string(),
    onshapeElementId: v.string(),
    documentName: v.optional(v.string()),
    elementName: v.optional(v.string()),
    versionId: v.optional(v.string()),
    /** Set when the synced element is an Assembly rather than a Part Studio. */
    assembly: v.optional(
      v.object({
        name: v.string(),
        partNumber: v.optional(v.string()),
        children: v.array(
          v.object({
            elementId: v.string(),
            documentId: v.string(),
            name: v.string(),
            quantity: v.number(),
          }),
        ),
      }),
    ),
    parts: v.array(
      v.object({
        name: v.string(),
        partNumber: v.optional(v.string()),
        revision: v.optional(v.string()),
        quantity: v.optional(v.number()),
        onshapePartId: v.optional(v.string()),
        material: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ intakeId: v.id("releaseIntakes"), lines: v.number() }),
  handler: async (ctx, args) => {
    const season = await requireActiveSeason(ctx);
    const subsystemId = await subsystemForDocument(ctx, args.onshapeDocumentId);

    const existing = subsystemId
      ? await ctx.db
          .query("parts")
          .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
          .take(5000)
      : await ctx.db
          .query("parts")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .take(5000);
    const live = existing.filter((p) => !p.isArchived);
    const known: KnownPart[] = live.map((p) => ({
      partNumber: p.partNumber,
      stage: p.stage,
      qtyMade: p.qtyMade,
      revision: p.revision,
    }));
    const byNumber = new Map(
      live.map((p) => [normalizePartNumber(p.partNumber), p]),
    );

    const classified = classifyRelease(
      args.parts.map((p) => ({
        partNumber: p.partNumber,
        revision: p.revision,
        name: p.name,
        quantity: p.quantity,
      })),
      known,
    );

    const label = [args.documentName, args.elementName ?? args.assembly?.name]
      .filter(Boolean)
      .join(" · ");
    const intakeId = await ctx.db.insert("releaseIntakes", {
      source: "onshape",
      label: label || "Onshape sync",
      receivedAt: Date.now(),
      status: "read",
      payload: {
        onshapeDocumentId: args.onshapeDocumentId,
        onshapeElementId: args.onshapeElementId,
        versionId: args.versionId,
      },
    });

    for (const [index, line] of classified.entries()) {
      const match = line.partNumber
        ? byNumber.get(normalizePartNumber(line.partNumber))
        : undefined;
      // By index, not by name: two parts can share a name, and matching on it
      // would cross-wire their Onshape ids. `classifyRelease` preserves order,
      // and anything it appends past the input runs off the end harmlessly.
      const source = args.parts[index];
      await ctx.db.insert("releaseIntakeLines", {
        intakeId,
        partNumber: line.partNumber,
        revision: line.revision,
        name: line.name,
        quantity: line.quantity,
        kind: line.kind,
        partId: match?._id,
        subsystemId: match?.subsystemId ?? subsystemId,
        note: line.explanation,
      });
      // Keep the CAD links on parts we already know current, so deep links and
      // thumbnails don't go stale while the lead works through the queue.
      if (match) {
        await ctx.db.patch(match._id, {
          onshapeDocumentId: args.onshapeDocumentId,
          onshapeElementId: args.onshapeElementId,
          onshapePartId: source?.onshapePartId ?? match.onshapePartId,
          onshapeVersionId: args.versionId ?? match.onshapeVersionId,
          material: source?.material ?? match.material,
          lastSyncedAt: Date.now(),
        });
      }
    }

    let lines = classified.length;
    if (args.assembly) {
      lines += await recordAssemblyLine(ctx, {
        intakeId,
        subsystemId,
        onshapeDocumentId: args.onshapeDocumentId,
        onshapeElementId: args.onshapeElementId,
        versionId: args.versionId,
        assembly: args.assembly,
      });
    }

    return { intakeId, lines };
  },
});

/**
 * Record what the sync found about the assembly element itself, and about the
 * sub-assemblies placed directly inside it.
 *
 * Identity is settled element id first, then part number. A match has its CAD
 * ids refreshed — that is what keeps the derived deep link working for free.
 * Anything unrecognised becomes a line for a lead: nothing restructures a
 * hand-built tree on its own.
 */
async function recordAssemblyLine(
  ctx: MutationCtx,
  args: {
    intakeId: Id<"releaseIntakes">;
    subsystemId?: Id<"subsystems">;
    onshapeDocumentId: string;
    onshapeElementId: string;
    versionId?: string;
    assembly: {
      name: string;
      partNumber?: string;
      children: Array<{
        elementId: string;
        documentId: string;
        name: string;
        quantity: number;
      }>;
    };
  },
): Promise<number> {
  const now = Date.now();

  const match = await findSubAssembly(
    ctx,
    args.onshapeElementId,
    args.assembly.partNumber,
  );
  const line = classifyAssemblyLine(
    {
      partNumber: args.assembly.partNumber ?? match?.partNumber,
      name: args.assembly.name,
    },
    match
      ? {
          partNumber: match.partNumber,
          revision: match.revision,
          built: match.completedAt !== undefined,
        }
      : undefined,
  );

  await ctx.db.insert("releaseIntakeLines", {
    intakeId: args.intakeId,
    target: "subAssembly",
    partNumber: line.partNumber,
    name: line.name,
    kind: line.kind,
    subAssemblyId: match?._id,
    subsystemId: match?.subsystemId ?? args.subsystemId,
    note: line.explanation,
  });

  if (match) {
    await ctx.db.patch(match._id, {
      onshapeDocumentId: args.onshapeDocumentId,
      onshapeElementId: args.onshapeElementId,
      onshapeVersionId: args.versionId ?? match.onshapeVersionId,
      lastSyncedAt: now,
    });
  }

  let count = 1;
  for (const child of args.assembly.children) {
    const childMatch = await findSubAssembly(ctx, child.elementId, undefined);
    await ctx.db.insert("releaseIntakeLines", {
      intakeId: args.intakeId,
      target: "subAssembly",
      partNumber: childMatch?.partNumber,
      name: child.name,
      quantity: child.quantity,
      kind: childMatch ? "matched" : "unknown",
      subAssemblyId: childMatch?._id,
      subsystemId: childMatch?.subsystemId ?? args.subsystemId,
      note: childMatch
        ? `Inside ${args.assembly.name} in the CAD.`
        : `Inside ${args.assembly.name} in the CAD, but not on the board yet.`,
    });
    count++;
  }
  return count;
}

async function findSubAssembly(
  ctx: MutationCtx,
  onshapeElementId: string | undefined,
  partNumber: string | undefined,
): Promise<Doc<"subAssemblies"> | null> {
  const byElement = onshapeElementId
    ? await ctx.db
        .query("subAssemblies")
        .withIndex("by_onshapeElementId", (q) =>
          q.eq("onshapeElementId", onshapeElementId),
        )
        .unique()
    : null;
  if (byElement) return byElement;
  if (!partNumber) return null;
  return ctx.db
    .query("subAssemblies")
    .withIndex("by_partNumberKey", (q) =>
      q.eq("partNumberKey", normalizePartNumber(partNumber)),
    )
    .unique();
}

// ---- Releases, arriving on their own ----

const vReleaseItem = v.object({
  partNumber: v.optional(v.string()),
  revision: v.optional(v.string()),
  name: v.string(),
  documentId: v.optional(v.string()),
  elementId: v.optional(v.string()),
  versionId: v.optional(v.string()),
  partId: v.optional(v.string()),
  isAssembly: v.boolean(),
});

/**
 * A whole release package, taken in as one intake.
 *
 * The difference from `receiveSync` is where the data came from and how much
 * it cost: a release names every item it contains along with its number and
 * revision, so one API call replaces the per-part metadata walk the panel does.
 * What it produces is deliberately identical — the same `releaseIntakeLines`,
 * reviewed on the same screen. A release still changes nothing on the board on
 * its own.
 *
 * Returns null when this package has already been taken in. Onshape retries a
 * notification it isn't sure landed, and a package can transition more than
 * once, so arriving twice is normal rather than exceptional.
 */
export const receiveRelease = internalMutation({
  args: {
    releasePackageId: v.string(),
    label: v.string(),
    state: v.string(),
    messageId: v.optional(v.string()),
    /** The raw package, kept so the first real one can be read by a human. */
    raw: v.optional(v.any()),
    items: v.array(vReleaseItem),
  },
  returns: v.union(
    v.object({ intakeId: v.id("releaseIntakes"), lines: v.number() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const already = await ctx.db
      .query("releaseIntakes")
      .withIndex("by_package", (q) =>
        q.eq("onshapeReleasePackageId", args.releasePackageId),
      )
      .first();
    // A queued row is a release we were told about but couldn't afford to
    // read. Reconcile is finishing that job, so fill it in rather than
    // treating it as a duplicate and dropping the release on the floor.
    if (already && already.status !== "queued") return null;

    const season = await requireActiveSeason(ctx);
    const now = Date.now();
    const parts = args.items.filter((i) => !i.isAssembly);
    const assemblies = args.items.filter((i) => i.isAssembly);

    // A release can span subsystems, so the comparison set is the season
    // rather than one document's subsystem the way a panel sync does it.
    const live = (
      await ctx.db
        .query("parts")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .take(5000)
    ).filter((p) => !p.isArchived);
    const known: KnownPart[] = live.map((p) => ({
      partNumber: p.partNumber,
      stage: p.stage,
      qtyMade: p.qtyMade,
      revision: p.revision,
    }));
    const byNumber = new Map(
      live.map((p) => [normalizePartNumber(p.partNumber), p]),
    );

    const classified = classifyRelease(
      parts.map((p) => ({
        partNumber: p.partNumber,
        revision: p.revision,
        name: p.name,
      })),
      known,
    );

    const fields = {
      source: "onshape" as const,
      onshapeReleasePackageId: args.releasePackageId,
      label: args.label,
      status: "read" as const,
      payload: {
        releasePackageId: args.releasePackageId,
        state: args.state,
        messageId: args.messageId,
        raw: args.raw,
      },
    };
    let intakeId;
    if (already) {
      await ctx.db.patch(already._id, fields);
      intakeId = already._id;
    } else {
      intakeId = await ctx.db.insert("releaseIntakes", {
        ...fields,
        receivedAt: now,
      });
    }

    // One lookup per document, not per item: a release of forty parts out of
    // one document shouldn't be forty reads of the same row.
    const subsystemCache = new Map<string, Id<"subsystems"> | undefined>();
    const subsystemFor = async (documentId: string | undefined) => {
      if (!documentId) return undefined;
      if (subsystemCache.has(documentId)) return subsystemCache.get(documentId);
      const found = await subsystemForDocument(ctx, documentId);
      subsystemCache.set(documentId, found);
      return found;
    };

    for (const [index, line] of classified.entries()) {
      // By index, not by name: `classifyRelease` preserves order and two parts
      // can share a name, which matching on it would cross-wire.
      const source = parts[index];
      const match = line.partNumber
        ? byNumber.get(normalizePartNumber(line.partNumber))
        : undefined;
      await ctx.db.insert("releaseIntakeLines", {
        intakeId,
        partNumber: line.partNumber,
        revision: line.revision,
        name: line.name,
        kind: line.kind,
        partId: match?._id,
        subsystemId:
          match?.subsystemId ?? (await subsystemFor(source?.documentId)),
        note: line.explanation,
      });
      // Keep the CAD links current on parts we recognise, so the derived deep
      // link still opens the right thing while the lead works the queue.
      if (match && source) {
        await ctx.db.patch(match._id, {
          onshapeDocumentId: source.documentId ?? match.onshapeDocumentId,
          onshapeElementId: source.elementId ?? match.onshapeElementId,
          onshapePartId: source.partId ?? match.onshapePartId,
          onshapeVersionId: source.versionId ?? match.onshapeVersionId,
          lastSyncedAt: now,
        });
      }
    }

    for (const item of assemblies) {
      const match = await findSubAssembly(ctx, item.elementId, item.partNumber);
      const line = classifyAssemblyLine(
        {
          partNumber: item.partNumber ?? match?.partNumber,
          revision: item.revision,
          name: item.name,
        },
        match
          ? {
              partNumber: match.partNumber,
              revision: match.revision,
              built: match.completedAt !== undefined,
            }
          : undefined,
      );
      await ctx.db.insert("releaseIntakeLines", {
        intakeId,
        target: "subAssembly",
        partNumber: line.partNumber,
        revision: line.revision,
        name: line.name,
        kind: line.kind,
        subAssemblyId: match?._id,
        subsystemId:
          match?.subsystemId ?? (await subsystemFor(item.documentId)),
        note: line.explanation,
      });
      if (match) {
        await ctx.db.patch(match._id, {
          onshapeDocumentId: item.documentId ?? match.onshapeDocumentId,
          onshapeElementId: item.elementId ?? match.onshapeElementId,
          onshapeVersionId: item.versionId ?? match.onshapeVersionId,
          lastSyncedAt: now,
        });
      }
    }

    return { intakeId, lines: classified.length + assemblies.length };
  },
});

/**
 * Park a release we were told about but can't afford to read.
 *
 * The notification was free and arrives once; losing it because the budget is
 * spent would mean losing the release entirely. So the id is kept, and
 * Reconcile reads it when there's allowance again.
 */
export const queueRelease = internalMutation({
  args: { releasePackageId: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const already = await ctx.db
      .query("releaseIntakes")
      .withIndex("by_package", (q) =>
        q.eq("onshapeReleasePackageId", args.releasePackageId),
      )
      .first();
    if (already) return null;
    await ctx.db.insert("releaseIntakes", {
      source: "onshape",
      onshapeReleasePackageId: args.releasePackageId,
      label: `Release ${args.releasePackageId}`,
      receivedAt: Date.now(),
      status: "queued",
      payload: {
        releasePackageId: args.releasePackageId,
        queuedBecause: args.reason,
      },
    });
    return null;
  },
});
