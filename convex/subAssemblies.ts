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
import { canRead, getActor, requireLead, requireUserId } from "./lib/auth";
import {
  activeSeason,
  assertSubsystemInSeason,
  requireActiveSeason,
} from "./lib/season";
import {
  assertNumberFree,
  defaultSubAssemblyNumber,
  takePartNumber,
} from "./lib/numbering";
import {
  ASSEMBLED_STAGE,
  READY_STAGE,
  blockingSummary,
  computeAssemblyStatuses,
  findShortfalls,
  findUnderbuilt,
  isSafeDrawingUrl,
  remainingFor,
  unitsOf,
  rollUpDemand,
  wouldCycle,
  type AssemblyInput,
  type DemandAssembly,
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
  qtyNeeded: v.optional(v.number()),
  qtySpares: v.optional(v.number()),
  qtyBuilt: v.optional(v.number()),
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

  const partNumber = defaultSubAssemblyNumber(
    season.year,
    subsystem.code,
    season.numberPad,
  );
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
    assertSubsystemInSeason(subsystem, season);

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
      /** How many of each member, for anything used more than once. */
      quantities: v.array(
        v.object({ refId: v.string(), quantity: v.number() }),
      ),
    }),
  ),
  handler: async (ctx, { subsystemId }) => {
    if (!(await canRead(ctx))) return [];
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
        quantities: members
          .filter((m) => (m.quantity ?? 1) > 1)
          .map((m) => ({
            refId: (m.partId ?? m.cotsItemId ?? m.childSubAssemblyId) as string,
            quantity: m.quantity ?? 1,
          })),
      });
    }
    return out;
  },
});

/** One sub-assembly, for its own page. */
export const get = query({
  args: { id: v.id("subAssemblies") },
  returns: v.union(vSubAssembly, v.null()),
  handler: async (ctx, { id }) =>
    (await canRead(ctx)) ? ctx.db.get(id) : null,
});

export const notes = query({
  args: { subAssemblyId: v.id("subAssemblies") },
  returns: v.array(
    v.object({
      _id: v.id("subAssemblyNotes"),
      _creationTime: v.number(),
      subAssemblyId: v.id("subAssemblies"),
      userId: v.string(),
      body: v.string(),
    }),
  ),
  handler: async (ctx, { subAssemblyId }) => {
    if (!(await canRead(ctx))) return [];
    const rows = await ctx.db
      .query("subAssemblyNotes")
      .withIndex("by_subAssembly", (q) => q.eq("subAssemblyId", subAssemblyId))
      .collect();
    return rows.sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const addNote = mutation({
  args: { subAssemblyId: v.id("subAssemblies"), body: v.string() },
  returns: v.id("subAssemblyNotes"),
  handler: async (ctx, { subAssemblyId, body }) => {
    const userId = await requireUserId(ctx);
    const trimmed = body.trim();
    if (trimmed.length === 0) throw new Error("Write something first.");
    return ctx.db.insert("subAssemblyNotes", {
      subAssemblyId,
      userId,
      body: trimmed,
    });
  },
});

/** Built, reopened, and the build count moving — newest first. */
export const history = query({
  args: { subAssemblyId: v.id("subAssemblies") },
  returns: v.array(
    v.object({
      _id: v.id("assemblyEvents"),
      _creationTime: v.number(),
      subAssemblyId: v.id("subAssemblies"),
      kind: v.union(
        v.literal("built"),
        v.literal("reopened"),
        v.literal("qty_built"),
      ),
      userId: v.string(),
      from: v.optional(v.number()),
      to: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { subAssemblyId }) => {
    if (!(await canRead(ctx))) return [];
    const events = await ctx.db
      .query("assemblyEvents")
      .withIndex("by_subAssembly", (q) => q.eq("subAssemblyId", subAssemblyId))
      .collect();
    return events.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * The sub-assemblies this person has picked up, for "My parts" — with
 * whether each can go together yet worked out here, so the screen doesn't
 * have to pull the whole membership graph to find out.
 */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      assembly: vSubAssembly,
      subsystemName: v.string(),
      ready: v.boolean(),
      summary: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const season = await activeSeason(ctx);
    if (!season) return [];

    const all = await ctx.db
      .query("subAssemblies")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const mine = all.filter((a) => a.claimedByUserId === userId);
    if (mine.length === 0) return [];

    // Readiness needs the whole season's tree, since a child of mine may sit
    // anywhere in it.
    const members = await ctx.db.query("subAssemblyMembers").take(SCAN_LIMIT);
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const partById = new Map(parts.map((p) => [p._id as string, p]));
    const cots = await ctx.db
      .query("cotsItems")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .take(SCAN_LIMIT);
    const cotsById = new Map(cots.map((c) => [c._id as string, c]));

    const inputs: AssemblyInput[] = all.map((assembly) => {
      const own = members.filter((m) => m.subAssemblyId === assembly._id);
      return {
        id: assembly._id,
        number: assembly.partNumber,
        name: assembly.name,
        order: assembly.order,
        completed: assembly.completedAt !== undefined,
        childIds: own
          .map((m) => m.childSubAssemblyId)
          .filter((id): id is Id<"subAssemblies"> => id !== undefined),
        members: [
          ...own
            .filter((m) => m.partId !== undefined)
            .map((m) => {
              const part = partById.get(m.partId as string);
              return {
                kind: "part" as const,
                label: part?.partNumber ?? "a part",
                stageLabel: "not in the bin yet",
                ready: (part?.stage ?? 0) >= READY_STAGE,
              };
            }),
          ...own
            .filter((m) => m.cotsItemId !== undefined)
            .map((m) => {
              const item = cotsById.get(m.cotsItemId as string);
              return {
                kind: "cots" as const,
                label: item?.name ?? "a bought item",
                stageLabel: item?.status ?? "needed",
                ready: item?.status === "arrived",
              };
            }),
        ],
      };
    });
    const statusById = new Map(
      computeAssemblyStatuses(inputs).map((s) => [s.id, s]),
    );

    const subsystems = await ctx.db.query("subsystems").collect();
    const subsystemName = new Map(
      subsystems.map((s) => [s._id as string, s.name]),
    );

    return mine.map((assembly) => {
      const status = statusById.get(assembly._id);
      return {
        assembly,
        subsystemName: subsystemName.get(assembly.subsystemId as string) ?? "",
        ready: status?.ready ?? false,
        summary: status ? blockingSummary(status) : "",
      };
    });
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

    for (const note of await ctx.db
      .query("subAssemblyNotes")
      .withIndex("by_subAssembly", (q) => q.eq("subAssemblyId", id))
      .collect()) {
      await ctx.db.delete(note._id);
    }
    for (const event of await ctx.db
      .query("assemblyEvents")
      .withIndex("by_subAssembly", (q) => q.eq("subAssemblyId", id))
      .collect()) {
      await ctx.db.delete(event._id);
    }

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
 * Set what a sub-assembly is made of, and how many of each.
 *
 * Two rules, both enforced here because this is the only thing that writes
 * membership: a child must come from the same subsystem, and nothing may end
 * up inside itself.
 *
 * Membership used to be exclusive — putting a part here took it off whatever
 * else had it. That was wrong about how robots are built: two roller
 * assemblies share an end cap, and the tracker's job is to add that up, not
 * to make the team pick one. What it costs is `rollUpDemand`'s problem.
 */
export const setMembers = mutation({
  args: {
    id: v.id("subAssemblies"),
    partIds: v.array(v.id("parts")),
    cotsItemIds: v.array(v.id("cotsItems")),
    childIds: v.array(v.id("subAssemblies")),
    /** How many of a given member, where it isn't one. */
    quantities: v.optional(
      v.array(v.object({ refId: v.string(), quantity: v.number() })),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { id, partIds, cotsItemIds, childIds, quantities }) => {
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

    const counts = new Map(
      (quantities ?? []).map((q) => [
        q.refId,
        Math.max(1, Math.round(q.quantity)),
      ]),
    );

    // You can't take more of a part than the plan leaves. The editor caps the
    // input, but the rule belongs here: a stale page or a second person
    // editing alongside you would otherwise walk straight past it.
    const rolled = rollUpDemand(
      (await subsystemPlacements(ctx, assembly.subsystemId)).map((a) =>
        // This assembly's own placements are being replaced, so leave them
        // out of what counts as already taken.
        a.id === id ? { ...a, placements: [] } : a,
      ),
    );
    for (const [refId, wanted] of counts) {
      const target =
        (await ctx.db.get(refId as Id<"parts">))?.qtyNeeded ??
        (await ctx.db.get(refId as Id<"cotsItems">))?.qtyNeeded;
      if (target === undefined) continue; // a child assembly, not a part
      const most = remainingFor(rolled, refId, id, target);
      if (wanted > most) {
        throw new Error(
          `Only ${most} of that left — the rest are spoken for by other sub-assemblies.`,
        );
      }
    }

    const qty = (refId: string) => counts.get(refId);

    for (const partId of partIds) {
      await ctx.db.insert("subAssemblyMembers", {
        subAssemblyId: id,
        partId,
        quantity: qty(partId),
      });
    }
    for (const cotsItemId of cotsItemIds) {
      await ctx.db.insert("subAssemblyMembers", {
        subAssemblyId: id,
        cotsItemId,
        quantity: qty(cotsItemId),
      });
    }
    for (const childSubAssemblyId of childIds) {
      await ctx.db.insert("subAssemblyMembers", {
        subAssemblyId: id,
        childSubAssemblyId,
        quantity: qty(childSubAssemblyId),
      });
    }
    return null;
  },
});

/**
 * How many of everything this subsystem actually needs, once the tree is
 * multiplied out — and where the plan doesn't cover it.
 *
 * The shortfall list is the point. Two end caps in a roller, two rollers on
 * the robot, and a part set to make four is short by four; nobody works that
 * out by eye, and the alternative is finding out in the pit.
 */
export const demand = query({
  args: {
    subsystemId: v.id("subsystems"),
    /** The one being edited, for the per-member allowance. */
    forAssemblyId: v.optional(v.id("subAssemblies")),
  },
  returns: v.object({
    units: v.array(
      v.object({
        id: v.id("subAssemblies"),
        /** Whole units to build, spares included. */
        units: v.number(),
        built: v.number(),
      }),
    ),
    shortfalls: v.array(
      v.object({
        kind: v.union(v.literal("part"), v.literal("cots")),
        label: v.string(),
        needed: v.number(),
        planned: v.number(),
      }),
    ),
    /** Sub-assemblies placed more often than they're set to be built. */
    underbuilt: v.array(
      v.object({
        id: v.id("subAssemblies"),
        label: v.string(),
        placed: v.number(),
        building: v.number(),
      }),
    ),
    /**
     * The most of each part or bought item one unit of the given assembly may
     * take, after what everything else has spoken for. Only present when the
     * caller named an assembly.
     */
    allowance: v.array(v.object({ refId: v.string(), max: v.number() })),
    /**
     * Parts and bought items the tree doesn't fully account for. `planned` is
     * what someone set out to make, `claimed` is what every assembly between
     * them asked for; `claimed === 0` means nothing is waiting on it at all.
     */
    loose: v.array(
      v.object({
        refId: v.string(),
        kind: v.union(v.literal("part"), v.literal("cots")),
        label: v.string(),
        planned: v.number(),
        claimed: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { subsystemId, forAssemblyId }) => {
    if (!(await canRead(ctx))) {
      return {
        units: [],
        shortfalls: [],
        underbuilt: [],
        allowance: [],
        loose: [],
      };
    }
    const placements = await subsystemPlacements(ctx, subsystemId);
    const rolled = rollUpDemand(placements);

    const assemblies = await ctx.db
      .query("subAssemblies")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .collect();

    // What each part or bought item in this subsystem is set to produce, and
    // what to call it when it turns out to be short. Everything in the
    // subsystem, not just what's already placed — the editor needs an
    // allowance for the ones nobody has picked yet too.
    const planned = new Map<string, number>();
    const labels = new Map<string, { kind: "part" | "cots"; label: string }>();
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .take(2000);
    for (const part of parts) {
      if (part.isArchived) continue;
      planned.set(part._id, part.qtyNeeded);
      labels.set(part._id, {
        kind: "part",
        label: `${part.partNumber} ${part.name}`,
      });
    }
    const items = await ctx.db
      .query("cotsItems")
      .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
      .take(2000);
    for (const item of items) {
      planned.set(item._id, item.qtyNeeded);
      labels.set(item._id, { kind: "cots", label: item.name });
    }

    const byId = new Map(assemblies.map((a) => [a._id as string, a]));
    return {
      units: assemblies.map((a) => ({
        id: a._id,
        units: Math.max(1, rolled.units.get(a._id) ?? 1),
        built: a.qtyBuilt ?? 0,
      })),
      underbuilt: findUnderbuilt(placements).flatMap((under) => {
        const assembly = byId.get(under.assemblyId);
        return assembly
          ? [
              {
                id: assembly._id,
                label: `${assembly.partNumber} ${assembly.name}`,
                placed: under.placed,
                building: under.building,
              },
            ]
          : [];
      }),
      allowance: forAssemblyId
        ? Array.from(planned, ([refId, count]) => ({
            refId,
            max: remainingFor(rolled, refId, forAssemblyId, count),
          }))
        : [],
      loose: Array.from(planned).flatMap(([refId, count]) => {
        const claimed = rolled.perRef.get(refId) ?? 0;
        const named = labels.get(refId);
        return claimed < count && named
          ? [
              {
                refId,
                kind: named.kind,
                label: named.label,
                planned: count,
                claimed,
              },
            ]
          : [];
      }),
      shortfalls: findShortfalls(rolled, planned).flatMap((short) => {
        const named = labels.get(short.refId);
        return named
          ? [
              {
                kind: named.kind,
                label: named.label,
                needed: short.needed,
                planned: short.planned,
              },
            ]
          : [];
      }),
    };
  },
});

/** How many go on the robot, and how many extra to build. */
export const setUnits = mutation({
  args: {
    id: v.id("subAssemblies"),
    qtyNeeded: v.optional(v.number()),
    qtySpares: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, qtyNeeded, qtySpares }) => {
    await requireLead(ctx);
    const assembly = await ctx.db.get(id);
    if (!assembly) throw new Error("That sub-assembly is gone.");
    await ctx.db.patch(id, {
      ...(qtyNeeded === undefined
        ? {}
        : { qtyNeeded: Math.max(1, Math.round(qtyNeeded)) }),
      ...(qtySpares === undefined
        ? {}
        : { qtySpares: Math.max(0, Math.round(qtySpares)) || undefined }),
    });
    return null;
  },
});

/**
 * How many are actually built. The twin of a part's "made so far", and the
 * reason a sub-assembly built twice out of three doesn't have to read as
 * either done or untouched.
 */
export const setQtyBuilt = mutation({
  args: { id: v.id("subAssemblies"), qtyBuilt: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, qtyBuilt }) => {
    const userId = await requireUserId(ctx);
    const assembly = await ctx.db.get(id);
    if (!assembly) throw new Error("That sub-assembly is gone.");
    const target = unitsOf({
      id,
      needed: assembly.qtyNeeded,
      spares: assembly.qtySpares,
      placements: [],
    });
    const next = Math.min(target, Math.max(0, Math.round(qtyBuilt)));
    const before = assembly.qtyBuilt ?? 0;
    await ctx.db.patch(id, { qtyBuilt: next });
    if (next !== before) {
      await ctx.db.insert("assemblyEvents", {
        subAssemblyId: id,
        kind: "qty_built",
        userId,
        from: before,
        to: next,
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
      // A part can sit in more than one sub-assembly. Saying it's on the
      // robot while another assembly still needs one would be a lie, and the
      // lie is the kind that gets found at competition — so it waits until
      // every assembly using it is built.
      if (await stillWantedElsewhere(ctx, part._id, id)) continue;
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
      // Marking it built means all of them, which for the ordinary
      // single-unit assembly is exactly what pressing the button meant.
      qtyBuilt: Math.max(
        assembly.qtyBuilt ?? 0,
        await unitsNeeded(ctx, assembly),
      ),
    });

    await ctx.db.insert("assemblyEvents", {
      subAssemblyId: id,
      kind: "built",
      userId: actor.userId,
    });

    // Building this one may have been the last thing a shared part was
    // waiting on, so sweep the assemblies it also belongs to.
    moved += await releaseSharedParts(ctx, id, actor, now);
    return { moved };
  },
});

/**
 * The placements of every sub-assembly in a subsystem, as the demand rollup
 * wants them. One read of the membership table rather than one per assembly.
 */
async function subsystemPlacements(
  ctx: QueryCtx,
  subsystemId: Id<"subsystems">,
): Promise<DemandAssembly[]> {
  const assemblies = await ctx.db
    .query("subAssemblies")
    .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystemId))
    .collect();
  const out: DemandAssembly[] = [];
  for (const assembly of assemblies) {
    const members = await ctx.db
      .query("subAssemblyMembers")
      .withIndex("by_parent", (q) => q.eq("subAssemblyId", assembly._id))
      .collect();
    out.push({
      id: assembly._id,
      needed: assembly.qtyNeeded,
      spares: assembly.qtySpares,
      placements: members.map((m) => ({
        refId: (m.partId ?? m.cotsItemId ?? m.childSubAssemblyId) as string,
        kind: m.partId ? "part" : m.cotsItemId ? "cots" : "child",
        quantity: m.quantity,
      })),
    });
  }
  return out;
}

/** How many whole units of this sub-assembly the robot needs, spares and all. */
async function unitsNeeded(
  ctx: QueryCtx,
  assembly: Doc<"subAssemblies">,
): Promise<number> {
  const demand = rollUpDemand(
    await subsystemPlacements(ctx, assembly.subsystemId),
  );
  return Math.max(1, demand.units.get(assembly._id) ?? 1);
}

/**
 * Is this part still listed by a sub-assembly that hasn't been built?
 * `exclude` is the one being completed right now, whose row hasn't been
 * written yet when this is asked.
 */
async function stillWantedElsewhere(
  ctx: MutationCtx,
  partId: Id<"parts">,
  exclude: Id<"subAssemblies">,
): Promise<boolean> {
  const holders = await ctx.db
    .query("subAssemblyMembers")
    .withIndex("by_part", (q) => q.eq("partId", partId))
    .collect();
  for (const holder of holders) {
    if (holder.subAssemblyId === exclude) continue;
    const other = await ctx.db.get(holder.subAssemblyId);
    if (other && other.completedAt === undefined) return true;
  }
  return false;
}

/**
 * Parts held back earlier because something else still wanted them. Building
 * the last holdout is what finally puts them on the robot, and nothing else
 * would notice that moment.
 */
async function releaseSharedParts(
  ctx: MutationCtx,
  justBuilt: Id<"subAssemblies">,
  actor: Awaited<ReturnType<typeof getActor>>,
  now: number,
): Promise<number> {
  const members = await ctx.db
    .query("subAssemblyMembers")
    .withIndex("by_parent", (q) => q.eq("subAssemblyId", justBuilt))
    .collect();

  let moved = 0;
  for (const member of members) {
    if (!member.partId) continue;
    // Every other assembly holding this part, to see if they're all done.
    const holders = await ctx.db
      .query("subAssemblyMembers")
      .withIndex("by_part", (q) => q.eq("partId", member.partId))
      .collect();
    let outstanding = false;
    for (const holder of holders) {
      const other = await ctx.db.get(holder.subAssemblyId);
      if (other && other.completedAt === undefined) outstanding = true;
    }
    if (outstanding) continue;

    const part = await ctx.db.get(member.partId);
    if (!part || part.isArchived || part.stage >= ASSEMBLED_STAGE) continue;
    if (part.stage < READY_STAGE) continue;

    await ctx.db.patch(part._id, {
      stage: ASSEMBLED_STAGE,
      stageSince: now,
      claimedByUserId: undefined,
      assemblerUserId: actor.userId,
    });
    await ctx.db.insert("stageEvents", {
      partId: part._id,
      fromStage: part.stage,
      toStage: ASSEMBLED_STAGE,
      userId: actor.userId,
      note: "every sub-assembly using it is built",
    });
    moved++;
  }
  return moved;
}

/** Reopen one marked built too early. Leaves its parts on the robot. */
export const reopen = mutation({
  args: { id: v.id("subAssemblies") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const user = await requireLead(ctx);
    await ctx.db.patch(id, {
      completedAt: undefined,
      completedByUserId: undefined,
    });
    await ctx.db.insert("assemblyEvents", {
      subAssemblyId: id,
      kind: "reopened",
      userId: user.authId,
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
    if (!(await canRead(ctx))) return [];
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
