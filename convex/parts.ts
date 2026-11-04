// The part tracker itself: issuing numbers, moving parts through the six
// stages, claiming, recording how many were made, and raising problems.
//
// Every rule about who may move what lives in ./lib/stages.ts, which the React
// screens import too — so a button is disabled for the same reason the server
// would refuse it.
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { flagValidator } from "./schema";
import {
  canRead,
  canReadAsLead,
  getActor,
  requireUserId,
  requireLead,
  requireMentor,
} from "./lib/auth";
import {
  activeSeason,
  assertSubsystemInSeason,
  requireActiveSeason,
} from "./lib/season";
import { assertNumberFree, takePartNumber } from "./lib/numbering";
import {
  asStage,
  canAdvance,
  canClaim,
  canMoveTo,
  isLeadOrAbove,
  nextStage,
  normalizePartNumber,
  partNumberMatches,
  stageLabel,
  type ProcessShape,
  type Stage,
} from "./lib/stages";

const SCAN_LIMIT = 5000;

export const vPart = v.object({
  _id: v.id("parts"),
  _creationTime: v.number(),
  seasonId: v.id("seasons"),
  subsystemId: v.id("subsystems"),
  partNumber: v.string(),
  partNumberKey: v.string(),
  name: v.string(),
  processTypeId: v.id("processTypes"),
  material: v.optional(v.string()),
  qtyNeeded: v.number(),
  qtySpares: v.number(),
  qtyMade: v.number(),
  stage: v.number(),
  claimedByUserId: v.optional(v.string()),
  designerUserId: v.optional(v.string()),
  drawingCheckedByUserId: v.optional(v.string()),
  makerUserId: v.optional(v.string()),
  assemblerUserId: v.optional(v.string()),
  stageSince: v.number(),
  isArchived: v.boolean(),
  binLabel: v.optional(v.string()),
  notesForMaker: v.optional(v.string()),
  thumbnailStorageId: v.optional(v.id("_storage")),
  onshapeDocumentId: v.optional(v.string()),
  onshapeElementId: v.optional(v.string()),
  onshapePartId: v.optional(v.string()),
  onshapeVersionId: v.optional(v.string()),
  revision: v.optional(v.string()),
  lastReleasePackageId: v.optional(v.string()),
  lastSyncedAt: v.optional(v.number()),
  flags: v.array(flagValidator),
});

async function processShape(
  ctx: QueryCtx | MutationCtx,
  processTypeId: Id<"processTypes">,
): Promise<ProcessShape> {
  const process = await ctx.db.get(processTypeId);
  if (!process) {
    // A deleted process shouldn't strand a part: treat it as the common case.
    return { needsDrawing: true, needsFinishing: true, machineId: null };
  }
  return {
    needsDrawing: process.needsDrawing,
    needsFinishing: process.needsFinishing,
    machineId: process.machineId ?? null,
  };
}

// ---- Reads ----

export const list = query({
  args: {
    subsystemId: v.optional(v.id("subsystems")),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(vPart),
  handler: async (ctx, { subsystemId, includeArchived }) => {
    if (!(await canRead(ctx))) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];
    const parts =
      subsystemId !== undefined
        ? await ctx.db
            .query("parts")
            .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
            .take(SCAN_LIMIT)
        : await ctx.db
            .query("parts")
            .withIndex("by_season", (q) => q.eq("seasonId", season._id))
            .take(SCAN_LIMIT);
    const visible = includeArchived
      ? parts
      : parts.filter((p) => !p.isArchived);
    return visible.sort((a, b) => a.partNumber.localeCompare(b.partNumber));
  },
});

export const get = query({
  args: { id: v.id("parts") },
  returns: v.union(vPart, v.null()),
  handler: async (ctx, { id }) =>
    (await canRead(ctx)) ? ctx.db.get(id) : null,
});

/** Parts this person has claimed — the "My parts" screen and shop shortcuts. */
export const listMine = query({
  args: {},
  returns: v.array(vPart),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    // This season's, like the board — a claim from last year's robot isn't a
    // job any more, and `subAssemblies.listMine` beside it is already scoped.
    const season = await activeSeason(ctx);
    if (!season) return [];
    // Claimant first and season second: one person's claims are tens of rows,
    // so this reads far less than starting from the whole season would.
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_claimedBy", (q) => q.eq("claimedByUserId", userId))
      .take(SCAN_LIMIT);
    return parts
      .filter((p) => !p.isArchived && p.seasonId === season._id)
      .sort(
        (a, b) => a.stage - b.stage || a.partNumber.localeCompare(b.partNumber),
      );
  },
});

/**
 * Forgiving part-number lookup: "27-INT-104", "int-104", "INT104" and "104"
 * all land on the same part. Exact matches come first; anything else is a
 * pick list.
 */
export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(vPart),
  handler: async (ctx, { query: term, limit }) => {
    if (!(await canRead(ctx))) return [];
    const trimmed = term.trim();
    if (trimmed.length === 0) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];

    const key = normalizePartNumber(trimmed);
    if (key.length > 0) {
      const exact = (
        await ctx.db
          .query("parts")
          .withIndex("by_partNumberKey", (q) => q.eq("partNumberKey", key))
          .take(5)
      )
        // That index spans every season. The year prefix normally keeps them
        // apart, but don't lean on that to decide what this season can see.
        .filter((part) => part.seasonId === season._id);
      if (exact.length > 0) return exact;
    }

    const parts = await ctx.db
      .query("parts")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const lowered = trimmed.toLowerCase();
    const matches = parts.filter(
      (p) =>
        !p.isArchived &&
        (partNumberMatches(trimmed, p.partNumber) ||
          p.name.toLowerCase().includes(lowered)),
    );
    // Shortest number first: "104" should offer 27-INT-104 before 27-INT-1041.
    matches.sort(
      (a, b) =>
        a.partNumber.length - b.partNumber.length ||
        a.partNumber.localeCompare(b.partNumber),
    );
    return matches.slice(0, limit ?? 20);
  },
});

export const history = query({
  args: { partId: v.id("parts") },
  returns: v.array(
    v.object({
      _id: v.id("stageEvents"),
      _creationTime: v.number(),
      partId: v.id("parts"),
      fromStage: v.number(),
      toStage: v.number(),
      userId: v.string(),
      note: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { partId }) => {
    if (!(await canRead(ctx))) return [];
    const events = await ctx.db
      .query("stageEvents")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .collect();
    return events.sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const notes = query({
  args: { partId: v.id("parts") },
  returns: v.array(
    v.object({
      _id: v.id("partNotes"),
      _creationTime: v.number(),
      partId: v.id("parts"),
      userId: v.string(),
      body: v.string(),
    }),
  ),
  handler: async (ctx, { partId }) => {
    if (!(await canRead(ctx))) return [];
    const rows = await ctx.db
      .query("partNotes")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .collect();
    return rows.sort((a, b) => b._creationTime - a._creationTime);
  },
});

const vProblem = v.object({
  _id: v.id("problems"),
  _creationTime: v.number(),
  partId: v.id("parts"),
  reason: v.union(
    v.literal("broke"),
    v.literal("scrapped"),
    v.literal("out_of_material"),
    v.literal("wrong_size"),
    v.literal("unsure"),
    v.literal("other"),
  ),
  qtyAffected: v.number(),
  note: v.optional(v.string()),
  openedByUserId: v.string(),
  resolvedByUserId: v.optional(v.string()),
  resolution: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
});

export const problems = query({
  args: { partId: v.id("parts") },
  returns: v.array(vProblem),
  handler: async (ctx, { partId }) => {
    if (!(await canRead(ctx))) return [];
    const rows = await ctx.db
      .query("problems")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .collect();
    return rows.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * The leads-and-mentors list: parts changed after someone made them, drawings
 * that have waited too long for a check, and open problems.
 */
export const headsUp = query({
  args: { waitingDays: v.optional(v.number()) },
  returns: v.array(
    v.object({
      kind: v.union(
        v.literal("changed_after_made"),
        v.literal("waiting_on_check"),
        v.literal("problem"),
      ),
      partId: v.id("parts"),
      partNumber: v.string(),
      name: v.string(),
      detail: v.string(),
    }),
  ),
  handler: async (ctx, { waitingDays }) => {
    // The board only asks for this as a lead; a student gets an empty list
    // rather than an error, the same as the board would show them anyway.
    if (!(await canReadAsLead(ctx))) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];
    const days = waitingDays ?? 3;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);

    // One scan for every open problem, grouped by part — this runs on the
    // board for every lead, so it mustn't be a query per part.
    const openByPart = new Map<Id<"parts">, Doc<"problems">[]>();
    for (const problem of await ctx.db.query("problems").take(SCAN_LIMIT)) {
      if (problem.resolvedAt !== undefined) continue;
      const list = openByPart.get(problem.partId) ?? [];
      list.push(problem);
      openByPart.set(problem.partId, list);
    }

    const out: {
      kind: "changed_after_made" | "waiting_on_check" | "problem";
      partId: Id<"parts">;
      partNumber: string;
      name: string;
      detail: string;
    }[] = [];

    for (const part of parts) {
      if (part.isArchived) continue;
      const changed = part.flags.find((f) => f.kind === "changed_after_made");
      if (changed) {
        out.push({
          kind: "changed_after_made",
          partId: part._id,
          partNumber: part.partNumber,
          name: part.name,
          detail:
            changed.note ??
            `was changed in Onshape after ${part.qtyMade} were already made.`,
        });
      }
      if (part.stage === 2 && part.stageSince < cutoff) {
        const waited = Math.floor((Date.now() - part.stageSince) / 86_400_000);
        out.push({
          kind: "waiting_on_check",
          partId: part._id,
          partNumber: part.partNumber,
          name: part.name,
          detail: `drawing has waited ${waited} day${waited === 1 ? "" : "s"} for a check.`,
        });
      }
      for (const problem of openByPart.get(part._id) ?? []) {
        out.push({
          kind: "problem",
          partId: part._id,
          partNumber: part.partNumber,
          name: part.name,
          detail: problem.note
            ? problem.note
            : `${problem.qtyAffected} ${problem.reason.replace(/_/g, " ")}.`,
        });
      }
    }
    return out;
  },
});

// ---- Creating ----

export const createWithNumber = mutation({
  args: {
    subsystemId: v.id("subsystems"),
    name: v.string(),
    processTypeId: v.id("processTypes"),
    qtyNeeded: v.number(),
    qtySpares: v.optional(v.number()),
    material: v.optional(v.string()),
    notesForMaker: v.optional(v.string()),
  },
  returns: v.object({ partId: v.id("parts"), partNumber: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const season = await requireActiveSeason(ctx);
    const subsystem = await ctx.db.get(args.subsystemId);
    if (!subsystem) throw new Error("Pick a subsystem.");
    assertSubsystemInSeason(subsystem, season);
    const process = await ctx.db.get(args.processTypeId);
    if (!process) throw new Error("Pick how it gets made.");

    const partNumber = await takePartNumber(ctx, season, subsystem);
    const partNumberKey = normalizePartNumber(partNumber);
    await assertNumberFree(ctx, partNumber);

    // A bought item never gets made, so it starts in the bin queue; everything
    // else starts in design.
    const stage: Stage = process.isBought ? 5 : 1;
    const now = Date.now();
    const partId = await ctx.db.insert("parts", {
      seasonId: season._id,
      subsystemId: args.subsystemId,
      partNumber,
      partNumberKey,
      name: args.name.trim(),
      processTypeId: args.processTypeId,
      material: args.material?.trim() || undefined,
      qtyNeeded: Math.max(1, args.qtyNeeded),
      qtySpares: Math.max(0, args.qtySpares ?? 0),
      qtyMade: 0,
      stage,
      designerUserId: userId,
      stageSince: now,
      isArchived: false,
      notesForMaker: args.notesForMaker?.trim() || undefined,
      flags: [],
    });
    await ctx.db.insert("stageEvents", {
      partId,
      fromStage: 0,
      toStage: stage,
      userId,
      note: `got the number ${partNumber}`,
    });
    return { partId, partNumber };
  },
});

// ---- Stage moves ----

async function recordStageMove(
  ctx: MutationCtx,
  part: Doc<"parts">,
  to: Stage,
  userId: string,
  note?: string,
): Promise<void> {
  const from = asStage(part.stage);
  const patch: Partial<Doc<"parts">> = { stage: to, stageSince: Date.now() };

  // Remember who did the thing the part just left behind, so the part page can
  // say who drew it, who made it and who put it on the robot.
  if (from === 2 && to > from) patch.drawingCheckedByUserId = userId;
  if (from === 3 && to > from)
    patch.makerUserId = part.claimedByUserId ?? userId;
  if (from === 5 && to > from) patch.assemblerUserId = userId;
  // A claim is for the stage it was made in; moving on releases it.
  if (to !== from) patch.claimedByUserId = undefined;
  // Moving forward past a drawing check clears a stale-drawing flag.
  if (to > from) {
    patch.flags = part.flags.filter((f) => f.kind !== "drawing_out_of_date");
  }

  await ctx.db.patch(part._id, patch);
  await ctx.db.insert("stageEvents", {
    partId: part._id,
    fromStage: from,
    toStage: to,
    userId,
    note,
  });
}

export const advance = mutation({
  args: { partId: v.id("parts"), note: v.optional(v.string()) },
  returns: v.object({ stage: v.number() }),
  handler: async (ctx, { partId, note }) => {
    const actor = await getActor(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("That part is gone.");
    const process = await processShape(ctx, part.processTypeId);
    const from = asStage(part.stage);
    const to = nextStage(from, process);
    if (to === null) throw new Error("This part is already on the robot.");

    const permission = canAdvance(
      from,
      process,
      {
        subsystemId: part.subsystemId as string,
        qtyMade: part.qtyMade,
        qtyNeeded: part.qtyNeeded,
      },
      actor,
    );
    if (!permission.allowed) throw new Error(permission.reason);

    await recordStageMove(ctx, part, to, actor.userId, note);
    return { stage: to };
  },
});

export const moveTo = mutation({
  args: {
    partId: v.id("parts"),
    stage: v.number(),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { partId, stage, note }) => {
    const actor = await getActor(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("That part is gone.");
    const process = await processShape(ctx, part.processTypeId);
    const to = asStage(stage);
    const from = asStage(part.stage);
    if (to === from) return null;

    const permission = canMoveTo(
      from,
      to,
      process,
      {
        subsystemId: part.subsystemId as string,
        qtyMade: part.qtyMade,
        qtyNeeded: part.qtyNeeded,
      },
      actor,
    );
    if (!permission.allowed) throw new Error(permission.reason);

    await recordStageMove(
      ctx,
      part,
      to,
      actor.userId,
      note ?? (to < from ? `moved back to ${stageLabel(to)}` : undefined),
    );
    return null;
  },
});

// ---- Claiming ----

export const claim = mutation({
  args: { partId: v.id("parts") },
  returns: v.null(),
  handler: async (ctx, { partId }) => {
    const actor = await getActor(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("That part is gone.");
    if (part.claimedByUserId && part.claimedByUserId !== actor.userId) {
      throw new Error("Someone else already claimed this one.");
    }
    const permission = canClaim(asStage(part.stage));
    if (!permission.allowed) throw new Error(permission.reason);
    await ctx.db.patch(partId, { claimedByUserId: actor.userId });
    return null;
  },
});

/**
 * Put someone else on a part. Mentors only — claiming is for taking work
 * yourself, this is for handing it out, and the two want different rules.
 * Passing no userId takes whoever had it off.
 */
export const assign = mutation({
  args: { partId: v.id("parts"), userId: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { partId, userId }) => {
    await requireMentor(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("That part is gone.");
    if (userId !== null) {
      const permission = canClaim(asStage(part.stage));
      if (!permission.allowed) throw new Error(permission.reason);
      const user = await ctx.db
        .query("users")
        .withIndex("authId", (q) => q.eq("authId", userId))
        .unique();
      if (!user) throw new Error("That person hasn't signed in yet.");
    }
    await ctx.db.patch(partId, { claimedByUserId: userId ?? undefined });
    return null;
  },
});

export const unclaim = mutation({
  args: { partId: v.id("parts") },
  returns: v.null(),
  handler: async (ctx, { partId }) => {
    const actor = await getActor(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("That part is gone.");
    if (part.claimedByUserId !== actor.userId && !isLeadOrAbove(actor.role)) {
      throw new Error("Only the person who claimed it can put it back.");
    }
    await ctx.db.patch(partId, { claimedByUserId: undefined });
    return null;
  },
});

// ---- Quantities ----

export const setQtyMade = mutation({
  args: { partId: v.id("parts"), qtyMade: v.number() },
  returns: v.null(),
  handler: async (ctx, { partId, qtyMade }) => {
    await requireUserId(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("That part is gone.");
    const target = part.qtyNeeded + part.qtySpares;
    await ctx.db.patch(partId, {
      qtyMade: Math.min(Math.max(0, Math.round(qtyMade)), target),
    });
    return null;
  },
});

// ---- Problems ----

export const reportProblem = mutation({
  args: {
    partId: v.id("parts"),
    reason: v.union(
      v.literal("broke"),
      v.literal("scrapped"),
      v.literal("out_of_material"),
      v.literal("wrong_size"),
      v.literal("unsure"),
      v.literal("other"),
    ),
    qtyAffected: v.optional(v.number()),
    note: v.optional(v.string()),
    /** Knock the affected ones off the made count so they get remade. */
    remake: v.optional(v.boolean()),
  },
  returns: v.id("problems"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const part = await ctx.db.get(args.partId);
    if (!part) throw new Error("That part is gone.");
    const qtyAffected = Math.max(0, args.qtyAffected ?? 1);

    const problemId = await ctx.db.insert("problems", {
      partId: args.partId,
      reason: args.reason,
      qtyAffected,
      note: args.note?.trim() || undefined,
      openedByUserId: userId,
    });

    const patch: Partial<Doc<"parts">> = {
      flags: [
        ...part.flags,
        {
          kind: "remake" as const,
          note: args.note?.trim() || args.reason.replace(/_/g, " "),
          qty: qtyAffected,
          at: Date.now(),
          byUserId: userId,
        },
      ],
    };
    if (args.remake !== false && qtyAffected > 0) {
      patch.qtyMade = Math.max(0, part.qtyMade - qtyAffected);
      // Something has to be made again, so it belongs back on a machine.
      if (part.stage > 3) {
        patch.stage = 3;
        patch.stageSince = Date.now();
      }
    }
    await ctx.db.patch(args.partId, patch);

    if (patch.stage !== undefined) {
      await ctx.db.insert("stageEvents", {
        partId: args.partId,
        fromStage: part.stage,
        toStage: patch.stage,
        userId,
        note: `something went wrong: ${args.reason.replace(/_/g, " ")}`,
      });
    }
    return problemId;
  },
});

export const resolveProblem = mutation({
  args: { problemId: v.id("problems"), resolution: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { problemId, resolution }) => {
    const user = await requireLead(ctx);
    const problem = await ctx.db.get(problemId);
    if (!problem) return null;
    await ctx.db.patch(problemId, {
      resolvedByUserId: user.authId,
      resolution: resolution?.trim() || undefined,
      resolvedAt: Date.now(),
    });
    const part = await ctx.db.get(problem.partId);
    if (part) {
      const stillOpen = await ctx.db
        .query("problems")
        .withIndex("by_part", (q) => q.eq("partId", problem.partId))
        .collect();
      if (stillOpen.every((p) => p.resolvedAt !== undefined)) {
        await ctx.db.patch(part._id, {
          flags: part.flags.filter((f) => f.kind !== "remake"),
        });
      }
    }
    return null;
  },
});

// ---- Flags ----

export const clearFlag = mutation({
  args: { partId: v.id("parts"), kind: v.string() },
  returns: v.null(),
  handler: async (ctx, { partId, kind }) => {
    await requireLead(ctx);
    const part = await ctx.db.get(partId);
    if (!part) return null;
    await ctx.db.patch(partId, {
      flags: part.flags.filter((f) => f.kind !== kind),
    });
    return null;
  },
});

export const addFlag = mutation({
  args: {
    partId: v.id("parts"),
    kind: v.union(
      v.literal("changed_after_made"),
      v.literal("drawing_out_of_date"),
      v.literal("remake"),
      v.literal("waiting"),
    ),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { partId, kind, note }) => {
    const userId = await requireUserId(ctx);
    const part = await ctx.db.get(partId);
    if (!part) return null;
    await ctx.db.patch(partId, {
      flags: [
        ...part.flags.filter((f) => f.kind !== kind),
        {
          kind,
          note: note?.trim() || undefined,
          at: Date.now(),
          byUserId: userId,
        },
      ],
    });
    return null;
  },
});

// ---- Notes ----

export const addNote = mutation({
  args: { partId: v.id("parts"), body: v.string() },
  returns: v.id("partNotes"),
  handler: async (ctx, { partId, body }) => {
    const userId = await requireUserId(ctx);
    const trimmed = body.trim();
    if (trimmed.length === 0) throw new Error("Write something first.");
    return ctx.db.insert("partNotes", { partId, userId, body: trimmed });
  },
});

// ---- Editing, archiving ----

export const update = mutation({
  args: {
    partId: v.id("parts"),
    name: v.optional(v.string()),
    processTypeId: v.optional(v.id("processTypes")),
    material: v.optional(v.union(v.string(), v.null())),
    qtyNeeded: v.optional(v.number()),
    qtySpares: v.optional(v.number()),
    subsystemId: v.optional(v.id("subsystems")),
    binLabel: v.optional(v.union(v.string(), v.null())),
    notesForMaker: v.optional(v.union(v.string(), v.null())),
    designerUserId: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { partId, ...rest }) => {
    await requireLead(ctx);
    const patch: Partial<Doc<"parts">> = {};
    if (rest.name !== undefined) patch.name = rest.name.trim();
    if (rest.processTypeId !== undefined)
      patch.processTypeId = rest.processTypeId;
    if (rest.material !== undefined)
      patch.material = rest.material ?? undefined;
    if (rest.qtyNeeded !== undefined)
      patch.qtyNeeded = Math.max(1, Math.round(rest.qtyNeeded));
    if (rest.qtySpares !== undefined)
      patch.qtySpares = Math.max(0, Math.round(rest.qtySpares));
    if (rest.subsystemId !== undefined) patch.subsystemId = rest.subsystemId;
    if (rest.binLabel !== undefined)
      patch.binLabel = rest.binLabel ?? undefined;
    if (rest.notesForMaker !== undefined)
      patch.notesForMaker = rest.notesForMaker ?? undefined;
    if (rest.designerUserId !== undefined)
      patch.designerUserId = rest.designerUserId ?? undefined;
    await ctx.db.patch(partId, patch);
    return null;
  },
});

export const setArchived = mutation({
  args: { partId: v.id("parts"), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { partId, archived }) => {
    await requireLead(ctx);
    await ctx.db.patch(partId, { isArchived: archived });
    return null;
  },
});

export const remove = mutation({
  args: { partId: v.id("parts") },
  returns: v.null(),
  handler: async (ctx, { partId }) => {
    await requireMentor(ctx);
    const part = await ctx.db.get(partId);
    if (!part) return null;
    for (const table of ["stageEvents", "partNotes", "problems"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_part", (q) => q.eq("partId", partId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    const links = await ctx.db
      .query("subAssemblyMembers")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .collect();
    for (const link of links) await ctx.db.delete(link._id);
    if (part.thumbnailStorageId)
      await ctx.storage.delete(part.thumbnailStorageId);
    await ctx.db.delete(partId);
    return null;
  },
});

// ---- Thumbnails ----

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const setThumbnail = mutation({
  args: { partId: v.id("parts"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { partId, storageId }) => {
    await requireUserId(ctx);
    const part = await ctx.db.get(partId);
    if (part?.thumbnailStorageId)
      await ctx.storage.delete(part.thumbnailStorageId);
    await ctx.db.patch(partId, { thumbnailStorageId: storageId });
    return null;
  },
});

export const setThumbnailInternal = internalMutation({
  args: { partId: v.id("parts"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { partId, storageId }) => {
    const part = await ctx.db.get(partId);
    if (part?.thumbnailStorageId)
      await ctx.storage.delete(part.thumbnailStorageId);
    await ctx.db.patch(partId, { thumbnailStorageId: storageId });
    return null;
  },
});

/**
 * A part's picture. Asked for by part rather than by storage id, so it can
 * only ever hand out a URL for a file some part actually points at — taking a
 * bare storage id, it would sign a URL for anything in storage.
 */
export const thumbnailUrl = query({
  args: { partId: v.id("parts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { partId }) => {
    if (!(await canRead(ctx))) return null;
    const part = await ctx.db.get(partId);
    if (!part?.thumbnailStorageId) return null;
    return ctx.storage.getUrl(part.thumbnailStorageId);
  },
});
