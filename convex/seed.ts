// Sample data for trying the tracker out — not part of the app itself.
//
//   npx convex run seed:sampleParts
//   npx convex run seed:sampleParts '{"codes":["DRV"]}'
//   npx convex run seed:wipeParts
//
// Internal on purpose: these are run from a terminal by someone with deploy
// access, never from the UI.
import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveSeason } from "./lib/season";
import { ensureDefaultSubAssembly } from "./subAssemblies";
import { takePartNumber } from "./lib/numbering";
import { asStage, isClaimableStage, normalizePartNumber } from "./lib/stages";

const DAY = 24 * 60 * 60 * 1000;

type Sample = {
  name: string;
  process: string;
  qtyNeeded: number;
  qtySpares?: number;
  stage: number;
  /** How many are actually made; defaults to "all of them" past stage 3. */
  qtyMade?: number;
  material?: string;
  /** Days ago this part last moved, so the board isn't all one timestamp. */
  daysInStage?: number;
  claim?: boolean;
  flag?: Doc<"parts">["flags"][number]["kind"];
  flagNote?: string;
  flagQty?: number;
  note?: string;
  problem?: { reason: Doc<"problems">["reason"]; qty: number; note: string };
  notesForMaker?: string;
};

const DRIVETRAIN: Sample[] = [
  {
    name: "Frame Rail",
    process: "Bandsaw + drill",
    qtyNeeded: 2,
    stage: 5,
    material: '2×1" 1/16 wall tube',
    daysInStage: 2,
  },
  {
    name: "Bellypan",
    process: "CNC router",
    qtyNeeded: 1,
    stage: 2,
    material: '1/8" 6061 aluminum',
    daysInStage: 5,
    notesForMaker: "Nest it with the gussets — one sheet should do both.",
  },
  {
    name: "Frame Gusset",
    process: "CNC router",
    qtyNeeded: 6,
    qtySpares: 2,
    stage: 4,
    qtyMade: 8,
    material: '1/8" 6061 aluminum',
    daysInStage: 1,
    claim: true,
  },
  {
    name: "Bumper Bracket",
    process: "Bandsaw + drill",
    qtyNeeded: 8,
    stage: 3,
    qtyMade: 4,
    daysInStage: 1,
    flag: "changed_after_made",
    flagNote: "Mounting holes moved 3 mm — 4 were already cut.",
    flagQty: 4,
  },
  {
    name: "Swerve Module Plate",
    process: "CNC router",
    qtyNeeded: 4,
    qtySpares: 1,
    stage: 3,
    qtyMade: 0,
    material: '1/4" 6061 aluminum',
    daysInStage: 2,
  },
  {
    name: "Gearbox Spacer",
    process: "Lathe",
    qtyNeeded: 8,
    stage: 3,
    qtyMade: 5,
    material: '1" aluminum round',
    daysInStage: 3,
    claim: true,
  },
  {
    name: "Motor Mount",
    process: "Mill",
    qtyNeeded: 4,
    stage: 2,
    material: '3/8" 6061 plate',
    daysInStage: 4,
  },
  {
    name: "Bellypan Cover",
    process: "3D print",
    qtyNeeded: 2,
    stage: 1,
    daysInStage: 1,
  },
  {
    name: "Battery Mount",
    process: "Bandsaw + drill",
    qtyNeeded: 1,
    stage: 6,
    daysInStage: 6,
  },
  {
    name: "Bumper Corner",
    process: "3D print",
    qtyNeeded: 4,
    stage: 5,
    daysInStage: 3,
  },
  {
    name: "Wheel Spacer",
    process: "Lathe",
    qtyNeeded: 16,
    qtySpares: 4,
    stage: 4,
    qtyMade: 20,
    daysInStage: 2,
  },
  {
    name: "Electronics Panel",
    process: "CNC router",
    qtyNeeded: 1,
    stage: 1,
    material: '1/4" polycarbonate',
    daysInStage: 1,
  },
];

const INTAKE: Sample[] = [
  {
    name: "Intake Side Plate",
    process: "CNC router",
    qtyNeeded: 2,
    qtySpares: 1,
    stage: 3,
    qtyMade: 1,
    material: '1/4" 6061 aluminum',
    daysInStage: 1,
    claim: true,
    notesForMaker:
      "Bearing holes are a press fit. Test cut on scrap first if the router was re-zeroed today.",
    note: "Moved the pivot hole 5 mm up this revision — use the new DXF.",
  },
  {
    name: "Intake Roller Shaft",
    process: "Lathe",
    qtyNeeded: 3,
    stage: 2,
    material: '1/2" hex stock',
    // Long enough in stage 2 to show up under Heads up.
    daysInStage: 4,
  },
  {
    name: "Intake Pivot Plate",
    process: "CNC router",
    qtyNeeded: 2,
    stage: 4,
    qtyMade: 2,
    daysInStage: 2,
    flag: "waiting",
    flagNote: "At the sponsor for powder coat",
  },
  {
    name: "Intake Cross Bar",
    process: "Bandsaw + drill",
    qtyNeeded: 2,
    stage: 5,
    daysInStage: 3,
  },
  {
    name: "Intake Frame Tube",
    process: "Bandsaw + drill",
    qtyNeeded: 2,
    stage: 6,
    daysInStage: 7,
  },
  {
    name: "Bearing Block",
    process: "3D print",
    qtyNeeded: 4,
    stage: 5,
    daysInStage: 2,
  },
  {
    name: "Roller Spacer",
    process: "3D print",
    qtyNeeded: 12,
    stage: 5,
    daysInStage: 2,
  },
  {
    name: "Motor Plate",
    process: "CNC router",
    qtyNeeded: 1,
    stage: 4,
    qtyMade: 1,
    daysInStage: 1,
  },
  {
    name: "Intake Gusset",
    process: "CNC router",
    qtyNeeded: 4,
    stage: 1,
    daysInStage: 1,
  },
  {
    name: "Compliant Wheel Hub",
    process: "3D print",
    qtyNeeded: 8,
    qtySpares: 2,
    stage: 3,
    qtyMade: 3,
    daysInStage: 2,
  },
  {
    name: "Intake Tensioner",
    process: "Mill",
    qtyNeeded: 2,
    stage: 2,
    daysInStage: 1,
  },
  {
    name: "Intake Standoff",
    process: "Lathe",
    qtyNeeded: 6,
    stage: 3,
    qtyMade: 6,
    daysInStage: 1,
    problem: {
      reason: "wrong_size",
      qty: 1,
      note: "One came out 2 mm short — needs remaking.",
    },
  },
];

const COTS: Record<
  string,
  { name: string; qtyNeeded: number; status: Doc<"cotsItems">["status"] }[]
> = {
  DRV: [
    { name: "Kraken X60 motor", qtyNeeded: 8, status: "arrived" },
    { name: "Swerve module kit", qtyNeeded: 4, status: "arrived" },
    { name: 'Colson wheel, 4"', qtyNeeded: 4, status: "ordered" },
    { name: "Battery, 12V", qtyNeeded: 3, status: "arrived" },
  ],
  INT: [
    { name: "Brushless motor", qtyNeeded: 1, status: "arrived" },
    { name: 'Flanged bearing, 1/2" hex', qtyNeeded: 8, status: "arrived" },
    { name: 'Compliant wheel, 2"', qtyNeeded: 12, status: "ordered" },
    { name: "Belt + pulleys", qtyNeeded: 1, status: "needed" },
  ],
};

const SAMPLES: Record<string, Sample[]> = { DRV: DRIVETRAIN, INT: INTAKE };

export const sampleParts = internalMutation({
  args: { codes: v.optional(v.array(v.string())) },
  returns: v.object({
    parts: v.number(),
    cots: v.number(),
    subsystems: v.array(v.string()),
    substituted: v.array(v.string()),
  }),
  handler: async (ctx, { codes }) => {
    const season = await requireActiveSeason(ctx);
    const wanted = (codes ?? ["DRV", "INT"]).map((c) => c.toUpperCase());

    const processes = await ctx.db.query("processTypes").collect();
    const makeable = processes.filter((p) => !p.isBought);
    if (makeable.length === 0) {
      throw new Error("No processes set up yet — add some in Settings first.");
    }
    const substituted: string[] = [];

    /**
     * Sample parts name the processes a typical team has, but a team may have
     * renamed or deleted them. Fall back to something that exists rather than
     * dropping the part, and say so in the result.
     */
    function resolveProcess(wanted: string): Id<"processTypes"> {
      const exact = processes.find((p) => p.name === wanted);
      if (exact) return exact._id;
      const loose = processes.find(
        (p) => p.name.toLowerCase() === wanted.toLowerCase(),
      );
      if (loose) return loose._id;
      const fallback = makeable[0];
      substituted.push(`${wanted} → ${fallback.name}`);
      return fallback._id;
    }
    const users = await ctx.db.query("users").take(100);
    const now = Date.now();

    let partCount = 0;
    let cotsCount = 0;
    const touched: string[] = [];

    for (const code of wanted) {
      const subsystem = await ctx.db
        .query("subsystems")
        .withIndex("by_season_and_code", (q) =>
          q.eq("seasonId", season._id).eq("code", code),
        )
        .unique();
      if (!subsystem) continue;
      touched.push(code);

      // Re-running tops up rather than duplicating: a sample whose name is
      // already in this subsystem is left alone.
      const existing = await ctx.db
        .query("parts")
        .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystem._id))
        .take(5000);
      const haveNames = new Set(existing.map((p) => p.name));

      for (const sample of SAMPLES[code] ?? []) {
        if (haveNames.has(sample.name)) continue;
        const processTypeId = resolveProcess(sample.process);

        const partNumber = await takePartNumber(ctx, season, subsystem);
        const target = sample.qtyNeeded + (sample.qtySpares ?? 0);
        const qtyMade = sample.qtyMade ?? (sample.stage >= 4 ? target : 0);
        const stageSince = now - (sample.daysInStage ?? 1) * DAY;
        // Spread the claims over whoever has signed in, so "My parts" and the
        // "Up for grabs" filter both have something to show.
        const claimant =
          sample.claim && users.length > 0
            ? users[partCount % users.length].authId
            : undefined;

        const partId = await ctx.db.insert("parts", {
          seasonId: season._id,
          subsystemId: subsystem._id,
          partNumber,
          partNumberKey: normalizePartNumber(partNumber),
          name: sample.name,
          processTypeId,
          material: sample.material,
          qtyNeeded: sample.qtyNeeded,
          qtySpares: sample.qtySpares ?? 0,
          qtyMade,
          stage: sample.stage,
          claimedByUserId: isClaimableStage(asStage(sample.stage))
            ? claimant
            : undefined,
          designerUserId: users[0]?.authId,
          makerUserId: sample.stage > 3 ? claimant : undefined,
          stageSince,
          isArchived: false,
          notesForMaker: sample.notesForMaker,
          flags: sample.flag
            ? [
                {
                  kind: sample.flag,
                  note: sample.flagNote,
                  qty: sample.flagQty,
                  at: stageSince,
                  byUserId: users[0]?.authId,
                },
              ]
            : [],
        });
        partCount++;

        // A plausible trail, so the part page's history isn't empty.
        const steps = [
          { from: 0, to: 1, note: `got the number ${partNumber}` },
          { from: 1, to: 2, note: "released in Onshape" },
          { from: 2, to: 3, note: "drawing checked" },
          { from: 3, to: 4, note: "done making" },
          { from: 4, to: 5, note: "finishing done" },
          { from: 5, to: 6, note: "installed on the robot" },
        ];
        for (const step of steps) {
          if (step.to > sample.stage) break;
          await ctx.db.insert("stageEvents", {
            partId,
            fromStage: step.from,
            toStage: step.to,
            userId: users[0]?.authId ?? "seed",
            note: step.note,
          });
        }

        if (sample.note && users[0]) {
          await ctx.db.insert("partNotes", {
            partId,
            userId: users[0].authId,
            body: sample.note,
          });
        }

        if (sample.problem) {
          await ctx.db.insert("problems", {
            partId,
            reason: sample.problem.reason,
            qtyAffected: sample.problem.qty,
            note: sample.problem.note,
            openedByUserId: users[0]?.authId ?? "seed",
          });
          await ctx.db.patch(partId, {
            qtyMade: Math.max(0, qtyMade - sample.problem.qty),
            flags: [
              {
                kind: "remake" as const,
                note: sample.problem.note,
                qty: sample.problem.qty,
                at: stageSince,
                byUserId: users[0]?.authId,
              },
            ],
          });
        }
      }

      const haveCots = new Set(
        (
          await ctx.db
            .query("cotsItems")
            .withIndex("by_subsystem", (q) =>
              q.eq("subsystemId", subsystem._id),
            )
            .take(1000)
        ).map((c) => c.name),
      );
      for (const item of COTS[code] ?? []) {
        if (haveCots.has(item.name)) continue;
        await ctx.db.insert("cotsItems", {
          seasonId: season._id,
          subsystemId: subsystem._id,
          name: item.name,
          qtyNeeded: item.qtyNeeded,
          status: item.status,
          eta: item.status === "ordered" ? now + 4 * DAY : undefined,
        });
        cotsCount++;
      }
    }

    // A small nested tree per subsystem, so "Can we build it yet?" has
    // something to answer on a fresh setup.
    for (const code of touched) {
      const subsystem = await ctx.db
        .query("subsystems")
        .withIndex("by_season_and_code", (q) =>
          q.eq("seasonId", season._id).eq("code", code),
        )
        .unique();
      if (!subsystem) continue;
      await buildSampleTree(ctx, season, subsystem);
    }

    return {
      parts: partCount,
      cots: cotsCount,
      subsystems: touched,
      // De-duplicated: one line per process that had to be swapped out.
      substituted: Array.from(new Set(substituted)),
    };
  },
});

/**
 * Put the subsystem's parts into a default assembly with one sub-assembly
 * inside it, so the readout shows a real tree rather than a flat list.
 * Skipped if someone has already set the tree up by hand.
 */
async function buildSampleTree(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  subsystem: Doc<"subsystems">,
): Promise<void> {
  const rootId = await ensureDefaultSubAssembly(ctx, season, subsystem);
  const existing = await ctx.db
    .query("subAssemblyMembers")
    .withIndex("by_parent", (q) => q.eq("subAssemblyId", rootId))
    .take(1);
  if (existing.length > 0) return;

  const parts = await ctx.db
    .query("parts")
    .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystem._id))
    .take(100);
  if (parts.length === 0) return;

  const partNumber = await takePartNumber(ctx, season, subsystem);
  const childId = await ctx.db.insert("subAssemblies", {
    seasonId: season._id,
    subsystemId: subsystem._id,
    partNumber,
    partNumberKey: normalizePartNumber(partNumber),
    name: `${subsystem.name} frame`,
    order: 1,
  });

  // Roughly half inside the child, the rest directly in the whole thing.
  const split = Math.ceil(parts.length / 2);
  for (const [i, part] of parts.entries()) {
    await ctx.db.insert("subAssemblyMembers", {
      subAssemblyId: i < split ? childId : rootId,
      partId: part._id,
    });
  }
  await ctx.db.insert("subAssemblyMembers", {
    subAssemblyId: rootId,
    childSubAssemblyId: childId,
  });

  const cots = await ctx.db
    .query("cotsItems")
    .withIndex("by_subsystem", (q) => q.eq("subsystemId", subsystem._id))
    .take(100);
  for (const item of cots) {
    await ctx.db.insert("subAssemblyMembers", {
      subAssemblyId: rootId,
      cotsItemId: item._id,
    });
  }
}

/**
 * Clear the tracker's parts and everything hanging off them.
 *
 * `resetNumbers` also clears the per-subsystem counters so numbering starts
 * at 001 again. That is only ever right for throwaway sample data — in a real
 * season a number is never reused, even for a deleted part.
 */
export const wipeParts = internalMutation({
  args: {
    includeCots: v.optional(v.boolean()),
    resetNumbers: v.optional(v.boolean()),
  },
  returns: v.object({ parts: v.number(), cots: v.number() }),
  handler: async (ctx, { includeCots, resetNumbers }) => {
    const parts = await ctx.db.query("parts").take(5000);
    for (const part of parts) {
      for (const table of ["stageEvents", "partNotes", "problems"] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_part", (q) => q.eq("partId", part._id))
          .collect();
        for (const row of rows) await ctx.db.delete(row._id);
      }
      const links = await ctx.db
        .query("subAssemblyMembers")
        .withIndex("by_part", (q) => q.eq("partId", part._id))
        .collect();
      for (const link of links) await ctx.db.delete(link._id);
      if (part.thumbnailStorageId) {
        await ctx.storage.delete(part.thumbnailStorageId);
      }
      await ctx.db.delete(part._id);
    }

    const members = await ctx.db.query("subAssemblyMembers").take(5000);
    for (const member of members) await ctx.db.delete(member._id);

    let cots = 0;
    if (includeCots) {
      const items = await ctx.db.query("cotsItems").take(5000);
      for (const item of items) {
        await ctx.db.delete(item._id);
        cots++;
      }
    }

    if (resetNumbers) {
      const counters = await ctx.db.query("partNumberCounters").take(1000);
      for (const counter of counters) await ctx.db.delete(counter._id);
    }

    return { parts: parts.length, cots };
  },
});
