// Sub-assemblies: the named, numbered things a subsystem goes together from.
//
// One holds parts, bought items and other sub-assemblies, mirroring the CAD.
// Every subsystem has exactly one default — {YY}-{SUB}-000 — and marking that
// one built is what "the subsystem is on the robot" means.
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getActor, requireLead, requireUserId } from "./lib/auth";
import { activeSeason, requireActiveSeason } from "./lib/season";
import {
  assertNumberFree,
  defaultSubAssemblyNumber,
  takePartNumber,
} from "./lib/numbering";
import {
  ASSEMBLED_STAGE,
  READY_STAGE,
  isSafeDrawingUrl,
  wouldCycle,
} from "./lib/assembly";
import {
  asStage,
  canAdvance,
  isLeadOrAbove,
  isMentorOrAbove,
  normalizePartNumber,
} from "./lib/stages";

const SCAN_LIMIT = 5000;

const vSubAssembly = v.object({
  _id: v.id("subAssemblies"),
  _creationTime: v.number(),
  seasonId: v.id("seasons"),
  subsystemId: v.id("subsystems"),
  partNumber: v.string(),
  partNumberKey: v.string(),
  name: v.string(),
  order: v.number(),
  isDefault: v.optional(v.boolean()),
  onshapeDocumentId: v.optional(v.string()),
  onshapeElementId: v.optional(v.string()),
  onshapeVersionId: v.optional(v.string()),
  revision: v.optional(v.string()),
  lastReleasePackageId: v.optional(v.string()),
  lastSyncedAt: v.optional(v.number()),
  drawingUrl: v.optional(v.string()),
  claimedByUserId: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  completedByUserId: v.optional(v.string()),
});

// ---- Creating ----

/**
 * The subsystem's default sub-assembly, made if it isn't there yet. Idempotent
 * on purpose: `subsystems.create`, the season seeder and the backfill all call
 * this same function, so there is only one way a default comes into being.
 */
export async function ensureDefaultSubAssembly(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  subsystem: Doc<"subsystems">,
): Promise<Id<"subAssemblies">> {
  const existing = await ctx.db
    .query("subAssemblies")
    .withIndex("by_subsystem_and_default", (q) =>
      q.eq("subsystemId", subsystem._id).eq("isDefault", true),
    )
    .unique();
  if (existing) return existing._id;

  const partNumber = defaultSubAssemblyNumber(season.year, subsystem.code);
  return ctx.db.insert("subAssemblies", {
    seasonId: season._id,
    subsystemId: subsystem._id,
    partNumber,
    partNumberKey: normalizePartNumber(partNumber),
    name: subsystem.name,
    order: 0,
    isDefault: true,
  });
}

/** Give every subsystem in the active season its default. Safe to re-run. */
export const backfillDefaults = internalMutation({
  args: {},
  returns: v.object({ created: v.number() }),
  handler: async (ctx) => {
    const season = await requireActiveSeason(ctx);
    const subsystems = await ctx.db
      .query("subsystems")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    let created = 0;
    for (const subsystem of subsystems) {
      const before = await ctx.db
        .query("subAssemblies")
        .withIndex("by_subsystem_and_default", (q) =>
          q.eq("subsystemId", subsystem._id).eq("isDefault", true),
        )
        .unique();
      await ensureDefaultSubAssembly(ctx, season, subsystem);
      if (!before) created++;
    }
    return { created };
  },
});

export const create = mutation({
  args: { subsystemId: v.id("subsystems"), name: v.string() },
  returns: v.object({ id: v.id("subAssemblies"), partNumber: v.string() }),
  handler: async (ctx, { subsystemId, name }) => {
    await requireLead(ctx);
    const season = await requireActiveSeason(ctx);
    const subsystem = await ctx.db.get(subsystemId);
    if (!subsystem) throw new Error("That subsystem is gone.");

    const siblings = await ctx.db
      .query("subAssemblies")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .collect();
    const order = siblings.reduce((max, s) => Math.max(max, s.order), 0) + 1;

    const partNumber = await takePartNumber(ctx, season, subsystem);
    await assertNumberFree(ctx, partNumber);

    const id = await ctx.db.insert("subAssemblies", {
      seasonId: season._id,
      subsystemId,
      partNumber,
      partNumberKey: normalizePartNumber(partNumber),
      name: name.trim() || partNumber,
      order,
    });
    return { id, partNumber };
  },
});

// ---- Reading ----

export const list = query({
  args: { subsystemId: v.id("subsystems") },
  returns: v.array(
    v.object({
      assembly: vSubAssembly,
      partIds: v.array(v.id("parts")),
      cotsItemIds: v.array(v.id("cotsItems")),
      childIds: v.array(v.id("subAssemblies")),
    }),
  ),
  handler: async (ctx, { subsystemId }) => {
    const assemblies = await ctx.db
      .query("subAssemblies")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .collect();
    assemblies.sort((a, b) => a.order - b.order);

    const out = [];
    for (const assembly of assemblies) {
      const members = await ctx.db
        .query("subAssemblyMembers")
        .withIndex("by_parent", (q) => q.eq("subAssemblyId", assembly._id))
        .collect();
      out.push({
        assembly,
        partIds: members
          .map((m) => m.partId)
          .filter((id): id is Id<"parts"> => id !== undefined),
        cotsItemIds: members
          .map((m) => m.cotsItemId)
          .filter((id): id is Id<"cotsItems"> => id !== undefined),
        childIds: members
          .map((m) => m.childSubAssemblyId)
          .filter((id): id is Id<"subAssemblies"> => id !== undefined),
      });
    }
    return out;
  },
});

/** Everything in this subsystem that no sub-assembly holds yet. */
export const unassigned = query({
  args: { subsystemId: v.id("subsystems") },
  returns: v.object({
    partIds: v.array(v.id("parts")),
    cotsItemIds: v.array(v.id("cotsItems")),
  }),
  handler: async (ctx, { subsystemId }) => {
    const assemblies = await ctx.db
      .query("subAssemblies")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .collect();
    const held = new Set<string>();
    for (const assembly of assemblies) {
      const members = await ctx.db
        .query("subAssemblyMembers")
        .withIndex("by_parent", (q) => q.eq("subAssemblyId", assembly._id))
        .collect();
      for (const m of members) {
        if (m.partId) held.add(m.partId);
        if (m.cotsItemId) held.add(m.cotsItemId);
      }
    }

    const parts = await ctx.db
      .query("parts")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .take(SCAN_LIMIT);
    const cots = await ctx.db
      .query("cotsItems")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .take(SCAN_LIMIT);

    return {
      partIds: parts
        .filter((p) => !p.isArchived && !held.has(p._id))
        .map((p) => p._id),
      cotsItemIds: cots.filter((c) => !held.has(c._id)).map((c) => c._id),
    };
  },
});

// ---- Editing ----

export const rename = mutation({
  args: { id: v.id("subAssemblies"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    await requireLead(ctx);
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("Give it a name.");
    await ctx.db.patch(id, { name: trimmed });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("subAssemblies") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireLead(ctx);
    const assembly = await ctx.db.get(id);
    if (!assembly) return null;
    if (assembly.isDefault) {
      throw new Error(
        `Every subsystem keeps its ${assembly.partNumber} assembly.`,
      );
    }

    const children = await ctx.db
      .query("subAssemblyMembers")
      .withIndex("by_parent", (q) => q.eq("subAssemblyId", id))
      .collect();
    if (children.some((m) => m.childSubAssemblyId !== undefined)) {
      throw new Error("Move or delete what's inside it first.");
    }
    for (const member of children) await ctx.db.delete(member._id);

    // And take it out of whatever it was inside.
    const parentLinks = await ctx.db
      .query("subAssemblyMembers")
      .withIndex("by_child", (q) => q.eq("childSubAssemblyId", id))
      .collect();
    for (const link of parentLinks) await ctx.db.delete(link._id);

    await ctx.db.delete(id);
    return null;
  },
});

/** A drawing that isn't in Onshape. The CAD link is derived, not set here. */
export const setDrawing = mutation({
  args: { id: v.id("subAssemblies"), url: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { id, url }) => {
    await requireLead(ctx);
    const trimmed = url?.trim() ?? "";
    if (trimmed.length === 0) {
      await ctx.db.patch(id, { drawingUrl: undefined });
      return null;
    }
    if (!isSafeDrawingUrl(trimmed)) {
      throw new Error("That needs to be a http:// or https:// link.");
    }
    await ctx.db.patch(id, { drawingUrl: trimmed });
    return null;
  },
});

/**
 * Set what a sub-assembly is made of.
 *
 * Three rules, all enforced here because this is the only thing that writes
 * membership: a part or bought item belongs to exactly one sub-assembly, so
 * putting it here takes it off whatever had it; a child must come from the
 * same subsystem; and nothing may end up inside itself.
 */
export const setMembers = mutation({
  args: {
    id: v.id("subAssemblies"),
    partIds: v.array(v.id("parts")),
    cotsItemIds: v.array(v.id("cotsItems")),
    childIds: v.array(v.id("subAssemblies")),
  },
  returns: v.null(),
  handler: async (ctx, { id, partIds, cotsItemIds, childIds }) => {
    await requireLead(ctx);
    const assembly = await ctx.db.get(id);
    if (!assembly) throw new Error("That sub-assembly is gone.");

    const siblings = await ctx.db
      .query("subAssemblies")
      .withIndex("by_subsystem", (q) =>
        q.eq("subsystemId", assembly.subsystemId),
      )
      .collect();
    const siblingIds = new Set(siblings.map((s) => s._id as string));

    // Build the containment graph as it stands, so cycles can be spotted
    // before anything is written.
    const edges = new Map<string, string[]>();
    for (const sibling of siblings) {
      const members = await ctx.db
        .query("subAssemblyMembers")
        .withIndex("by_parent", (q) => q.eq("subAssemblyId", sibling._id))
        .collect();
      edges.set(
        sibling._id,
        members
          .map((m) => m.childSubAssemblyId)
          .filter((c): c is Id<"subAssemblies"> => c !== undefined),
      );
    }
    // Pretend the new children are already in place.
    edges.set(id, childIds);

    for (const childId of childIds) {
      if (!siblingIds.has(childId)) {
        throw new Error(
          "A sub-assembly can only hold ones from its own subsystem.",
        );
      }
      const child = await ctx.db.get(childId);
      if (wouldCycle(id, childId, edges)) {
        throw new Error(`That would put ${child?.name ?? "it"} inside itself.`);
      }
    }

    const existing = await ctx.db
      .query("subAssemblyMembers")
      .withIndex("by_parent", (q) => q.eq("subAssemblyId", id))
      .collect();
    for (const member of existing) await ctx.db.delete(member._id);

    // Anything claimed here comes off whatever else was holding it.
    const wanted = new Set<string>([...partIds, ...cotsItemIds, ...childIds]);
    for (const sibling of siblings) {
      if (sibling._id === id) continue;
      const members = await ctx.db
        .query("subAssemblyMembers")
        .withIndex("by_parent", (q) => q.eq("subAssemblyId", sibling._id))
        .collect();
      for (const member of members) {
        const claimed =
          (member.partId && wanted.has(member.partId)) ||
          (member.cotsItemId && wanted.has(member.cotsItemId)) ||
          (member.childSubAssemblyId && wanted.has(member.childSubAssemblyId));
        if (claimed) await ctx.db.delete(member._id);
      }
    }

    for (const partId of partIds) {
      await ctx.db.insert("subAssemblyMembers", { subAssemblyId: id, partId });
    }
    for (const cotsItemId of cotsItemIds) {
      await ctx.db.insert("subAssemblyMembers", {
        subAssemblyId: id,
        cotsItemId,
      });
    }
    for (const childSubAssemblyId of childIds) {
      await ctx.db.insert("subAssemblyMembers", {
        subAssemblyId: id,
        childSubAssemblyId,
      });
    }
    return null;
  },
});

// ---- Picking one up, and building it ----

export const claim = mutation({
  args: { id: v.id("subAssemblies") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const assembly = await ctx.db.get(id);
    if (!assembly) throw new Error("That sub-assembly is gone.");
    if (assembly.completedAt !== undefined) {
      throw new Error("That one is already built.");
    }
    if (assembly.claimedByUserId && assembly.claimedByUserId !== userId) {
      throw new Error("Someone else already picked this one up.");
    }
    await ctx.db.patch(id, { claimedByUserId: userId });
    return null;
  },
});

export const unclaim = mutation({
  args: { id: v.id("subAssemblies") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const actor = await getActor(ctx);
    const assembly = await ctx.db.get(id);
    if (!assembly) throw new Error("That sub-assembly is gone.");
    if (
      assembly.claimedByUserId !== actor.userId &&
      !isLeadOrAbove(actor.role)
    ) {
      throw new Error("Only the person who picked it up can put it back.");
    }
    await ctx.db.patch(id, { claimedByUserId: undefined });
    return null;
  },
});

/**
 * It's built: its parts go on the robot.
 *
 * Only its *direct* parts — a child's parts went to the robot when the child
 * was built, so nothing moves twice. Refuses rather than lying: an unbuilt
 * child, a part not in the bin or a bought item still on order all stop it,
 * and nothing moves when it stops.
 */
export const complete = mutation({
  args: { id: v.id("subAssemblies") },
  returns: v.object({ moved: v.number() }),
  handler: async (ctx, { id }) => {
    const actor = await getActor(ctx);
    const assembly = await ctx.db.get(id);
    if (!assembly) throw new Error("That sub-assembly is gone.");
    if (assembly.completedAt !== undefined) return { moved: 0 };

    // Putting something on the robot is the subsystem lead's or a mentor's
    // call. Checking it here and not only per part matters: a sub-assembly
    // holding nothing but children would otherwise never reach a check.
    if (
      !isMentorOrAbove(actor.role) &&
      !actor.ledSubsystemIds.includes(assembly.subsystemId as string)
    ) {
      throw new Error("The subsystem lead or a mentor marks it installed.");
    }

    const members = await ctx.db
      .query("subAssemblyMembers")
      .withIndex("by_parent", (q) => q.eq("subAssemblyId", id))
      .collect();

    const unbuilt: string[] = [];
    for (const member of members) {
      if (!member.childSubAssemblyId) continue;
      const child = await ctx.db.get(member.childSubAssemblyId);
      if (child && child.completedAt === undefined) {
        unbuilt.push(`${child.partNumber} ${child.name}`);
      }
    }
    if (unbuilt.length > 0) {
      throw new Error(`Not built yet: ${unbuilt.join(", ")}.`);
    }

    const parts = [];
    for (const member of members) {
      if (!member.partId) continue;
      const part = await ctx.db.get(member.partId);
      if (part && !part.isArchived) parts.push(part);
    }
    const waiting = parts.filter((p) => p.stage < READY_STAGE);
    if (waiting.length > 0) {
      throw new Error(
        `Not in the bin yet: ${waiting.map((p) => p.partNumber).join(", ")}.`,
      );
    }

    const notArrived: string[] = [];
    for (const member of members) {
      if (!member.cotsItemId) continue;
      const item = await ctx.db.get(member.cotsItemId);
      if (item && item.status !== "arrived") notArrived.push(item.name);
    }
    if (notArrived.length > 0) {
      throw new Error(`Still waiting on: ${notArrived.join(", ")}.`);
    }

    const now = Date.now();
    let moved = 0;
    for (const part of parts) {
      if (part.stage >= ASSEMBLED_STAGE) continue;
      const process = await ctx.db.get(part.processTypeId);
      const shape = {
        needsDrawing: process?.needsDrawing ?? true,
        needsFinishing: process?.needsFinishing ?? true,
        machineId: process?.machineId ?? null,
      };
      const permission = canAdvance(
        asStage(part.stage),
        shape,
        {
          subsystemId: part.subsystemId as string,
          qtyMade: part.qtyMade,
          qtyNeeded: part.qtyNeeded,
        },
        actor,
      );
      if (!permission.allowed) throw new Error(permission.reason);

      await ctx.db.patch(part._id, {
        stage: ASSEMBLED_STAGE,
        stageSince: now,
        claimedByUserId: undefined,
        assemblerUserId: assembly.claimedByUserId ?? actor.userId,
      });
      await ctx.db.insert("stageEvents", {
        partId: part._id,
        fromStage: part.stage,
        toStage: ASSEMBLED_STAGE,
        userId: actor.userId,
        note: `went on the robot with "${assembly.partNumber} ${assembly.name}"`,
      });
      moved++;
    }

    await ctx.db.patch(id, {
      completedAt: now,
      completedByUserId: actor.userId,
    });
    return { moved };
  },
});

/** Reopen one marked built too early. Leaves its parts on the robot. */
export const reopen = mutation({
  args: { id: v.id("subAssemblies") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireLead(ctx);
    await ctx.db.patch(id, {
      completedAt: undefined,
      completedByUserId: undefined,
    });
    return null;
  },
});

/** Sub-assembly numbers answer to the same search box parts do. */
export async function searchSubAssemblies(
  ctx: QueryCtx,
  seasonId: Id<"seasons">,
  matches: (partNumber: string, name: string) => boolean,
): Promise<Doc<"subAssemblies">[]> {
  const all = await ctx.db
    .query("subAssemblies")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .take(SCAN_LIMIT);
  return all.filter((a) => matches(a.partNumber, a.name));
}

export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(vSubAssembly),
  handler: async (ctx, { query: term, limit }) => {
    const trimmed = term.trim();
    if (trimmed.length === 0) return [];
    const season = await activeSeason(ctx);
    if (!season) return [];
    const lowered = trimmed.toLowerCase();
    const key = normalizePartNumber(trimmed);
    const found = await searchSubAssemblies(
      ctx,
      season._id,
      (partNumber, name) =>
        normalizePartNumber(partNumber).endsWith(key) ||
        name.toLowerCase().includes(lowered),
    );
    return found.slice(0, limit ?? 10);
  },
});
