// "New from Onshape": the queue of releases waiting for a design lead, and the
// manual tools that do the same job without spending a single API call.
//
// Nothing in this file talks to Onshape. A release arrives here either from a
// webhook/sync that has already been paid for, or because a lead typed the
// numbers in or uploaded a BOM export.
import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { canReadAsLead, requireLead } from "./lib/auth";
import { assertSubsystemInSeason, requireActiveSeason } from "./lib/season";
import { assertNumberFree, takePartNumber } from "./lib/numbering";
import { loadKnown } from "./lib/intakeKnown";
import {
  classifyRelease,
  parseBomCsv,
  parseManualNumbers,
  type IntakeLineInput,
} from "./lib/intake";
import { normalizePartNumber, nextStage, type Stage } from "./lib/stages";

const kindValidator = v.union(
  v.literal("matched"),
  v.literal("changed"),
  v.literal("unknown"),
  v.literal("removed"),
);

const decisionValidator = v.union(
  v.literal("rework"),
  v.literal("remake_all"),
  v.literal("keep"),
  v.literal("linked"),
  v.literal("created"),
  v.literal("archived"),
  v.literal("ignored"),
);

const vIntake = v.object({
  _id: v.id("releaseIntakes"),
  _creationTime: v.number(),
  source: v.union(v.literal("onshape"), v.literal("manual"), v.literal("csv")),
  onshapeReleasePackageId: v.optional(v.string()),
  label: v.string(),
  receivedAt: v.number(),
  status: v.union(
    v.literal("queued"),
    v.literal("read"),
    v.literal("processed"),
    v.literal("dismissed"),
  ),
  payload: v.optional(v.any()),
  processedByUserId: v.optional(v.string()),
});

const vLine = v.object({
  _id: v.id("releaseIntakeLines"),
  _creationTime: v.number(),
  intakeId: v.id("releaseIntakes"),
  partNumber: v.optional(v.string()),
  revision: v.optional(v.string()),
  name: v.string(),
  quantity: v.optional(v.number()),
  kind: kindValidator,
  decision: v.optional(decisionValidator),
  partId: v.optional(v.id("parts")),
  // Absent means the line is about a part, which is the common case. A sync
  // or a release can also tell us about the assembly itself, or about
  // something the Ordering board already has.
  target: v.optional(
    v.union(v.literal("part"), v.literal("subAssembly"), v.literal("cotsItem")),
  ),
  subAssemblyId: v.optional(v.id("subAssemblies")),
  cotsItemId: v.optional(v.id("cotsItems")),
  subsystemId: v.optional(v.id("subsystems")),
  vendor: v.optional(v.string()),
  standardContent: v.optional(v.boolean()),
  onshapeDocumentId: v.optional(v.string()),
  onshapeElementId: v.optional(v.string()),
  onshapePartId: v.optional(v.string()),
  onshapeVersionId: v.optional(v.string()),
  note: v.optional(v.string()),
});

/** How many releases are waiting on a lead — the sidebar's badge. */
export const pendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (!(await canReadAsLead(ctx))) return 0;
    const queued = await ctx.db
      .query("releaseIntakes")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(100);
    const read = await ctx.db
      .query("releaseIntakes")
      .withIndex("by_status", (q) => q.eq("status", "read"))
      .take(100);
    return queued.length + read.length;
  },
});

export const list = query({
  args: { includeProcessed: v.optional(v.boolean()) },
  returns: v.array(v.object({ intake: vIntake, lines: v.array(vLine) })),
  handler: async (ctx, { includeProcessed }) => {
    if (!(await canReadAsLead(ctx))) return [];
    const all = await ctx.db.query("releaseIntakes").order("desc").take(100);
    const visible = includeProcessed
      ? all
      : all.filter((i) => i.status === "queued" || i.status === "read");
    const out = [];
    for (const intake of visible) {
      const lines = await ctx.db
        .query("releaseIntakeLines")
        .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
        .collect();
      out.push({ intake, lines });
    }
    return out;
  },
});

/**
 * Build an intake from a list of released numbers, whoever typed them. The
 * matching in lib/intake.ts decides which of the four buckets each line lands
 * in; nothing is applied to the board until a lead says so.
 */
async function insertIntake(
  ctx: MutationCtx,
  args: {
    source: "onshape" | "manual" | "csv";
    label: string;
    lines: IntakeLineInput[];
    subsystemId?: Id<"subsystems">;
    detectRemoved: boolean;
    onshapeReleasePackageId?: string;
    payload?: unknown;
  },
): Promise<{ intakeId: Id<"releaseIntakes">; lines: number }> {
  const season = await requireActiveSeason(ctx);

  // Compare against what we already hold — the whole season, or just one
  // subsystem when the lead said which assembly this release came from.
  const { known, byNumber, bought, boughtByNumber } = await loadKnown(ctx, {
    seasonId: season._id,
    subsystemId: args.subsystemId,
  });

  const classified = classifyRelease(args.lines, known, {
    detectRemoved: args.detectRemoved,
    bought,
  });

  const intakeId = await ctx.db.insert("releaseIntakes", {
    source: args.source,
    onshapeReleasePackageId: args.onshapeReleasePackageId,
    label: args.label,
    receivedAt: Date.now(),
    status: "read",
    payload: args.payload,
  });

  for (const line of classified) {
    const match = line.partNumber
      ? byNumber.get(normalizePartNumber(line.partNumber))
      : undefined;
    // Which collection matched is the classifier's answer, read back rather
    // than worked out again here.
    const boughtMatch =
      line.target === "cotsItem" && line.partNumber
        ? boughtByNumber.get(normalizePartNumber(line.partNumber))
        : undefined;
    await ctx.db.insert("releaseIntakeLines", {
      intakeId,
      partNumber: line.partNumber,
      revision: line.revision,
      name: line.name,
      quantity: line.quantity,
      kind: line.kind,
      target: boughtMatch ? "cotsItem" : undefined,
      partId: match?._id,
      cotsItemId: boughtMatch?._id,
      vendor: line.vendor,
      subsystemId:
        match?.subsystemId ?? boughtMatch?.subsystemId ?? args.subsystemId,
      note: line.explanation,
    });
  }

  return { intakeId, lines: classified.length };
}

async function requirePart(
  ctx: MutationCtx,
  partId: Id<"parts"> | undefined,
): Promise<Doc<"parts">> {
  if (!partId) throw new Error("That line isn't linked to a part yet.");
  const part = await ctx.db.get(partId);
  if (!part) throw new Error("That part is gone.");
  return part;
}

/** Close the intake once every line has been decided. */
async function maybeFinish(
  ctx: MutationCtx,
  intakeId: Id<"releaseIntakes">,
  userId: string,
): Promise<void> {
  const lines = await ctx.db
    .query("releaseIntakeLines")
    .withIndex("by_intake", (q) => q.eq("intakeId", intakeId))
    .collect();
  if (lines.every((l) => l.decision !== undefined)) {
    await ctx.db.patch(intakeId, {
      status: "processed",
      processedByUserId: userId,
    });
  }
}

export const addManual = mutation({
  args: {
    label: v.string(),
    text: v.string(),
    subsystemId: v.optional(v.id("subsystems")),
    detectRemoved: v.optional(v.boolean()),
  },
  returns: v.object({ intakeId: v.id("releaseIntakes"), lines: v.number() }),
  handler: async (ctx, args) => {
    await requireLead(ctx);
    const lines = parseManualNumbers(args.text);
    if (lines.length === 0) throw new Error("No part numbers in that.");
    return insertIntake(ctx, {
      source: "manual",
      label: args.label.trim() || "Typed in by hand",
      lines,
      subsystemId: args.subsystemId,
      detectRemoved: args.detectRemoved ?? false,
    });
  },
});

export const importCsv = mutation({
  args: {
    label: v.string(),
    csv: v.string(),
    subsystemId: v.optional(v.id("subsystems")),
    detectRemoved: v.optional(v.boolean()),
  },
  returns: v.object({ intakeId: v.id("releaseIntakes"), lines: v.number() }),
  handler: async (ctx, args) => {
    await requireLead(ctx);
    const lines = parseBomCsv(args.csv);
    if (lines.length === 0) {
      throw new Error(
        "Nothing to import. The BOM needs a Part number column, or a Name and a Vendor for the things the team buys.",
      );
    }
    return insertIntake(ctx, {
      source: "csv",
      label: args.label.trim() || "BOM import",
      lines,
      subsystemId: args.subsystemId,
      detectRemoved: args.detectRemoved ?? false,
    });
  },
});

export const applyLine = mutation({
  args: {
    lineId: v.id("releaseIntakeLines"),
    decision: decisionValidator,
    // Creating a part from an unknown number, or linking to an existing one.
    partId: v.optional(v.id("parts")),
    subsystemId: v.optional(v.id("subsystems")),
    processTypeId: v.optional(v.id("processTypes")),
    qtyNeeded: v.optional(v.number()),
    qtySpares: v.optional(v.number()),
    name: v.optional(v.string()),
  },
  returns: v.union(v.id("parts"), v.null()),
  handler: async (ctx, args) => {
    const lead = await requireLead(ctx);
    const line = await ctx.db.get(args.lineId);
    if (!line) throw new Error("That line is gone.");
    // Every decision below is a decision about a part — a stage to move, a
    // quantity already made, a process that decides where it starts. None of
    // those mean anything for an assembly, so rather than do something
    // plausible to the wrong record, say so.
    if (
      line.target !== undefined &&
      line.target !== "part" &&
      args.decision !== "ignored"
    ) {
      throw new Error(
        line.target === "subAssembly"
          ? "That line is a sub-assembly, not a part. Set it up on the subsystem page and ignore it here."
          : "That line is a bought item, not a part. It's on the Ordering board; ignore it here.",
      );
    }
    const season = await requireActiveSeason(ctx);
    const now = Date.now();
    // Which release this decision came from, stamped wherever lastSyncedAt
    // is so the field keeps one meaning across both mutations.
    const intake = await ctx.db.get(line.intakeId);
    const fromRelease = intake?.onshapeReleasePackageId;

    const patchLine = async (
      decision: typeof args.decision,
      partId?: Id<"parts">,
    ) => {
      await ctx.db.patch(line._id, { decision, partId: partId ?? line.partId });
      // Deciding the last line finishes the intake, the same way Apply does.
      // Without this a lead could answer every line and still be left with
      // "Done with this" to press, which is the whole complaint.
      await maybeFinish(ctx, line.intakeId, lead.authId);
    };

    switch (args.decision) {
      case "ignored":
        await patchLine("ignored");
        return null;

      case "created": {
        if (!args.subsystemId || !args.processTypeId) {
          throw new Error("Pick a subsystem and how it gets made.");
        }
        const subsystem = await ctx.db.get(args.subsystemId);
        if (!subsystem) throw new Error("That subsystem is gone.");
        assertSubsystemInSeason(subsystem, season);
        const process = await ctx.db.get(args.processTypeId);
        if (!process) throw new Error("That process is gone.");

        // Adopt the released number when it's one we issued the format for,
        // otherwise hand out the next one for this subsystem.
        const issued =
          line.partNumber &&
          normalizePartNumber(line.partNumber).startsWith(
            normalizePartNumber(`${season.year}${subsystem.code}`),
          )
            ? line.partNumber
            : await takePartNumber(ctx, season, subsystem);

        const stage: Stage = process.isBought
          ? 5
          : process.needsDrawing
            ? 2
            : 3;
        const partId = await ctx.db.insert("parts", {
          seasonId: season._id,
          subsystemId: args.subsystemId,
          partNumber: issued,
          partNumberKey: normalizePartNumber(issued),
          name: (args.name ?? line.name).trim(),
          processTypeId: args.processTypeId,
          qtyNeeded: Math.max(1, args.qtyNeeded ?? line.quantity ?? 1),
          qtySpares: Math.max(0, args.qtySpares ?? 0),
          qtyMade: 0,
          stage,
          stageSince: now,
          isArchived: false,
          revision: line.revision,
          // The line's CAD ids, so a part added from a release has a working
          // deep link straight away instead of waiting for a later sync to
          // find it by number.
          onshapeDocumentId: line.onshapeDocumentId,
          onshapeElementId: line.onshapeElementId,
          onshapePartId: line.onshapePartId,
          onshapeVersionId: line.onshapeVersionId,
          lastSyncedAt: now,
          lastReleasePackageId: fromRelease,
          flags: [],
        });
        await ctx.db.insert("stageEvents", {
          partId,
          fromStage: 0,
          toStage: stage,
          userId: lead.authId,
          note: `added from a release as ${issued}`,
        });
        await patchLine("created", partId);
        return partId;
      }

      case "linked": {
        if (!args.partId) throw new Error("Pick the part to link it to.");
        const part = await ctx.db.get(args.partId);
        if (!part) throw new Error("That part is gone.");
        await ctx.db.patch(part._id, {
          revision: line.revision ?? part.revision,
          lastSyncedAt: now,
          lastReleasePackageId: fromRelease,
        });
        await patchLine("linked", part._id);
        return part._id;
      }

      case "rework": {
        const part = await requirePart(ctx, line.partId);
        await ctx.db.patch(part._id, {
          revision: line.revision ?? part.revision,
          lastSyncedAt: now,
          lastReleasePackageId: fromRelease,
          flags: [
            ...part.flags.filter((f) => f.kind !== "changed_after_made"),
            {
              kind: "changed_after_made" as const,
              note: `Rework the ${part.qtyMade} already made to ${line.revision ?? "the new version"}.`,
              qty: part.qtyMade,
              at: now,
              byUserId: lead.authId,
            },
          ],
        });
        await ctx.db.insert("stageEvents", {
          partId: part._id,
          fromStage: part.stage,
          toStage: part.stage,
          userId: lead.authId,
          note: "CAD changed after it was made — reworking the ones we have",
        });
        await patchLine("rework", part._id);
        return part._id;
      }

      case "remake_all": {
        const part = await requirePart(ctx, line.partId);
        await ctx.db.patch(part._id, {
          qtyMade: 0,
          stage: 3,
          stageSince: now,
          claimedByUserId: undefined,
          revision: line.revision ?? part.revision,
          lastSyncedAt: now,
          lastReleasePackageId: fromRelease,
          flags: [
            ...part.flags.filter((f) => f.kind !== "changed_after_made"),
            {
              kind: "remake" as const,
              note: "CAD changed after these were made — the old ones are scrap or practice bot.",
              at: now,
              byUserId: lead.authId,
            },
          ],
        });
        await ctx.db.insert("stageEvents", {
          partId: part._id,
          fromStage: part.stage,
          toStage: 3,
          userId: lead.authId,
          note: "remaking all of them against the new version",
        });
        await patchLine("remake_all", part._id);
        return part._id;
      }

      case "keep": {
        const part = await requirePart(ctx, line.partId);
        await ctx.db.patch(part._id, {
          revision: line.revision ?? part.revision,
          lastSyncedAt: now,
          lastReleasePackageId: fromRelease,
          flags: part.flags.filter((f) => f.kind !== "changed_after_made"),
        });
        await ctx.db.insert("stageEvents", {
          partId: part._id,
          fromStage: part.stage,
          toStage: part.stage,
          userId: lead.authId,
          note: "designer confirmed the ones already made are fine",
        });
        await patchLine("keep", part._id);
        return part._id;
      }

      case "archived": {
        const part = await requirePart(ctx, line.partId);
        await ctx.db.patch(part._id, { isArchived: true });
        await patchLine("archived", part._id);
        return part._id;
      }
    }
  },
});

/** Apply every "matched" line at once — the common, boring case. */
/**
 * Put an assembly a release mentioned onto the board.
 *
 * The part decisions mean nothing for an assembly — there is no stage to move
 * and no process to pick — so this is its own mutation rather than another
 * branch of `applyLine`, which answers with a part id. It is the way an
 * intake holding assembly lines finishes itself instead of being dismissed.
 */
export const createSubAssemblyFromLine = mutation({
  args: {
    lineId: v.id("releaseIntakeLines"),
    subsystemId: v.id("subsystems"),
    name: v.optional(v.string()),
  },
  returns: v.id("subAssemblies"),
  handler: async (ctx, args) => {
    const lead = await requireLead(ctx);
    const line = await ctx.db.get(args.lineId);
    if (!line) throw new Error("That line is gone.");
    if (line.target !== "subAssembly") {
      throw new Error("That line is a part. Add it to the board instead.");
    }
    if (line.subAssemblyId) {
      throw new Error("That assembly is already on the board.");
    }
    const season = await requireActiveSeason(ctx);
    const subsystem = await ctx.db.get(args.subsystemId);
    if (!subsystem) throw new Error("That subsystem is gone.");
    assertSubsystemInSeason(subsystem, season);

    // Keep the released number when it looks like one of ours, the same rule
    // a part follows — the CAD and the board agreeing is the whole point.
    const released =
      line.partNumber &&
      normalizePartNumber(line.partNumber).startsWith(
        normalizePartNumber(`${season.year}${subsystem.code}`),
      )
        ? line.partNumber
        : null;
    const partNumber =
      released ?? (await takePartNumber(ctx, season, subsystem));
    await assertNumberFree(ctx, partNumber);

    const siblings = await ctx.db
      .query("subAssemblies")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", args.subsystemId))
      .collect();
    const order = siblings.reduce((max, sa) => Math.max(max, sa.order), 0) + 1;

    const intake = await ctx.db.get(line.intakeId);
    const subAssemblyId = await ctx.db.insert("subAssemblies", {
      seasonId: season._id,
      subsystemId: args.subsystemId,
      partNumber,
      partNumberKey: normalizePartNumber(partNumber),
      name: (args.name ?? line.name).trim() || partNumber,
      order,
      revision: line.revision,
      onshapeDocumentId: line.onshapeDocumentId,
      onshapeElementId: line.onshapeElementId,
      onshapeVersionId: line.onshapeVersionId,
      lastReleasePackageId: intake?.onshapeReleasePackageId,
      lastSyncedAt: Date.now(),
    });

    await ctx.db.patch(line._id, { decision: "created", subAssemblyId });
    await maybeFinish(ctx, line.intakeId, lead.authId);
    return subAssemblyId;
  },
});

/**
 * Put something the team buys onto the Ordering board.
 *
 * Its own mutation for the same reason `createSubAssemblyFromLine` is one:
 * every decision `applyLine` offers is about a part — a stage to move, a
 * quantity already made, a process that decides where it starts — and a
 * bought item has none of those. It has a vendor and a status instead.
 *
 * It lands at `needed`, never further on. A release says the design is
 * settled, not that anybody has bought the thing, and the Ordering board is
 * where somebody has to act on it.
 */
export const createCotsItemFromLine = mutation({
  args: {
    lineId: v.id("releaseIntakeLines"),
    subsystemId: v.id("subsystems"),
    name: v.optional(v.string()),
    qtyNeeded: v.optional(v.number()),
    unit: v.optional(v.string()),
    vendor: v.optional(v.string()),
    vendorPartNumber: v.optional(v.string()),
    cost: v.optional(v.number()),
  },
  returns: v.id("cotsItems"),
  handler: async (ctx, args) => {
    // Stricter than `cots.create`, which any signed-in student may call:
    // this one also closes an intake, and that is a lead's job everywhere
    // else in this file.
    const lead = await requireLead(ctx);
    const line = await ctx.db.get(args.lineId);
    if (!line) throw new Error("That line is gone.");
    if (line.target === "subAssembly") {
      throw new Error(
        "That line is a sub-assembly, not something the team buys. Add it as a sub-assembly instead.",
      );
    }
    if (line.cotsItemId) {
      throw new Error("That's already on the Ordering board.");
    }
    if (line.decision) {
      throw new Error("That line has already been answered.");
    }
    const season = await requireActiveSeason(ctx);
    const subsystem = await ctx.db.get(args.subsystemId);
    if (!subsystem) throw new Error("That subsystem is gone.");
    assertSubsystemInSeason(subsystem, season);

    // No number is taken. A bought item is never made, so there is nothing
    // for a {YY}-{SUB}-{NNN} to label, and numbers are never reused — burning
    // one on something that will never show it leaves a permanent gap in the
    // sequence.
    //
    // The released number is kept under the inverse of the rule a
    // sub-assembly follows: that one adopts the number when it looks like
    // ours, and this one keeps it when it doesn't, because a number we never
    // issued sitting on a bought part is the vendor's own.
    const released =
      line.partNumber &&
      !normalizePartNumber(line.partNumber).startsWith(
        normalizePartNumber(`${season.year}${subsystem.code}`),
      )
        ? line.partNumber
        : undefined;
    const vendorPartNumber = args.vendorPartNumber?.trim() || released;

    const intake = await ctx.db.get(line.intakeId);
    const cotsItemId = await ctx.db.insert("cotsItems", {
      seasonId: season._id,
      subsystemId: args.subsystemId,
      name: (args.name ?? line.name).trim() || "Bought item",
      qtyNeeded: Math.max(1, Math.round(args.qtyNeeded ?? line.quantity ?? 1)),
      unit: args.unit?.trim() || undefined,
      status: "needed",
      vendor: args.vendor?.trim() || line.vendor,
      vendorPartNumber,
      cost: args.cost,
      onshapeDocumentId: line.onshapeDocumentId,
      onshapeElementId: line.onshapeElementId,
      onshapePartId: line.onshapePartId,
      onshapeVersionId: line.onshapeVersionId,
      lastReleasePackageId: intake?.onshapeReleasePackageId,
      lastSyncedAt: Date.now(),
    });

    await ctx.db.patch(line._id, { decision: "created", cotsItemId });
    await maybeFinish(ctx, line.intakeId, lead.authId);
    return cotsItemId;
  },
});

export const applyMatched = mutation({
  args: { intakeId: v.id("releaseIntakes") },
  returns: v.object({ moved: v.number() }),
  handler: async (ctx, { intakeId }) => {
    const lead = await requireLead(ctx);
    const lines = await ctx.db
      .query("releaseIntakeLines")
      .withIndex("by_intake", (q) => q.eq("intakeId", intakeId))
      .collect();
    const now = Date.now();
    // The release this intake came from, so every patch below can say which
    // one it was — the field means "last seen in", so it goes wherever
    // lastSyncedAt goes.
    const intake = await ctx.db.get(intakeId);
    const fromRelease = intake?.onshapeReleasePackageId;
    let moved = 0;

    for (const line of lines) {
      if (line.kind !== "matched" || line.decision) continue;

      // An assembly the board already knows: take the revision across and
      // call the line decided. Without this an intake carrying one could
      // never finish itself, and a lead had to dismiss the whole thing.
      if (line.target === "subAssembly") {
        if (line.subAssemblyId) {
          const assembly = await ctx.db.get(line.subAssemblyId);
          if (assembly) {
            await ctx.db.patch(assembly._id, {
              revision: line.revision ?? assembly.revision,
              lastSyncedAt: now,
              lastReleasePackageId: fromRelease,
            });
          }
        }
        await ctx.db.patch(line._id, { decision: "keep" });
        continue;
      }

      if (line.target === "cotsItem") {
        // Nothing to move — it's on the Ordering board and its status is
        // whoever buys it's business. The line is marked so the intake can
        // close, the same reason the assembly branch above exists.
        if (line.cotsItemId) {
          await ctx.db.patch(line.cotsItemId, {
            lastSyncedAt: now,
            lastReleasePackageId: fromRelease,
          });
        }
        await ctx.db.patch(line._id, { decision: "keep" });
        continue;
      }
      if (!line.partId) continue;
      const part = await ctx.db.get(line.partId);
      if (!part) continue;
      const process = await ctx.db.get(part.processTypeId);
      const shape = {
        needsDrawing: process?.needsDrawing ?? true,
        needsFinishing: process?.needsFinishing ?? true,
        machineId: process?.machineId ?? null,
      };

      if (part.stage === 1) {
        const to = nextStage(1, shape);
        if (to !== null) {
          await ctx.db.patch(part._id, {
            stage: to,
            stageSince: now,
            revision: line.revision ?? part.revision,
            lastSyncedAt: now,
            lastReleasePackageId: fromRelease,
          });
          await ctx.db.insert("stageEvents", {
            partId: part._id,
            fromStage: 1,
            toStage: to,
            userId: lead.authId,
            note: `released in Onshape${line.revision ? ` (${line.revision})` : ""}`,
          });
          moved++;
        }
      } else if (part.stage === 2 && line.revision !== part.revision) {
        // Re-released before anyone made it: the drawing is simply stale.
        await ctx.db.patch(part._id, {
          revision: line.revision ?? part.revision,
          lastSyncedAt: now,
          lastReleasePackageId: fromRelease,
          flags: [
            ...part.flags.filter((f) => f.kind !== "drawing_out_of_date"),
            {
              kind: "drawing_out_of_date" as const,
              note: "CAD moved on — redo the drawing against the new version.",
              at: now,
            },
          ],
        });
        moved++;
      } else {
        await ctx.db.patch(part._id, {
          revision: line.revision ?? part.revision,
          lastSyncedAt: now,
          lastReleasePackageId: fromRelease,
        });
      }
      await ctx.db.patch(line._id, { decision: "keep" });
    }

    await maybeFinish(ctx, intakeId, lead.authId);
    return { moved };
  },
});

export const dismiss = mutation({
  args: { intakeId: v.id("releaseIntakes") },
  returns: v.null(),
  handler: async (ctx, { intakeId }) => {
    const lead = await requireLead(ctx);
    await ctx.db.patch(intakeId, {
      status: "dismissed",
      processedByUserId: lead.authId,
    });
    return null;
  },
});

export const finish = mutation({
  args: { intakeId: v.id("releaseIntakes") },
  returns: v.null(),
  handler: async (ctx, { intakeId }) => {
    const lead = await requireLead(ctx);
    await ctx.db.patch(intakeId, {
      status: "processed",
      processedByUserId: lead.authId,
    });
    return null;
  },
});

export const removeIntake = mutation({
  args: { intakeId: v.id("releaseIntakes") },
  returns: v.null(),
  handler: async (ctx, { intakeId }) => {
    await requireLead(ctx);
    const lines = await ctx.db
      .query("releaseIntakeLines")
      .withIndex("by_intake", (q) => q.eq("intakeId", intakeId))
      .collect();
    for (const line of lines) await ctx.db.delete(line._id);
    await ctx.db.delete(intakeId);
    return null;
  },
});
