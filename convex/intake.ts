// "New from Onshape": the queue of releases waiting for a design lead, and the
// manual tools that do the same job without spending a single API call.
//
// Nothing in this file talks to Onshape. A release arrives here either from a
// webhook/sync that has already been paid for, or because a lead typed the
// numbers in or uploaded a BOM export.
import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireLead } from "./lib/auth";
import { requireActiveSeason } from "./lib/season";
import { takePartNumber } from "./lib/numbering";
import {
  classifyRelease,
  parseBomCsv,
  parseManualNumbers,
  type IntakeLineInput,
  type KnownPart,
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
  subsystemId: v.optional(v.id("subsystems")),
  note: v.optional(v.string()),
});

/** How many releases are waiting on a lead — the sidebar's badge. */
export const pendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
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

  // Compare against the parts we already hold — the whole season, or just one
  // subsystem when the lead said which assembly this release came from.
  const existing =
    args.subsystemId !== undefined
      ? await ctx.db
          .query("parts")
          .withIndex("by_subsystem", (q) =>
            q.eq("subsystemId", args.subsystemId!),
          )
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

  const classified = classifyRelease(args.lines, known, {
    detectRemoved: args.detectRemoved,
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
    await ctx.db.insert("releaseIntakeLines", {
      intakeId,
      partNumber: line.partNumber,
      revision: line.revision,
      name: line.name,
      quantity: line.quantity,
      kind: line.kind,
      partId: match?._id,
      subsystemId: match?.subsystemId ?? args.subsystemId,
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
        "No part numbers found. The BOM needs a column called Part number.",
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
    const season = await requireActiveSeason(ctx);
    const now = Date.now();

    const patchLine = async (
      decision: typeof args.decision,
      partId?: Id<"parts">,
    ) => {
      await ctx.db.patch(line._id, { decision, partId: partId ?? line.partId });
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
          lastSyncedAt: now,
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
        });
        await patchLine("linked", part._id);
        return part._id;
      }

      case "rework": {
        const part = await requirePart(ctx, line.partId);
        await ctx.db.patch(part._id, {
          revision: line.revision ?? part.revision,
          lastSyncedAt: now,
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
    let moved = 0;

    for (const line of lines) {
      if (line.kind !== "matched" || line.decision || !line.partId) continue;
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
