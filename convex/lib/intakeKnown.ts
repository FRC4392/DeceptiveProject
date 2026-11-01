/**
 * What the tracker already holds, loaded the same way for every path in.
 *
 * The release webhook, the Onshape panel sync and the BOM importer each have
 * to answer "do we know this number already?", and each used to build its own
 * comparison set. Three copies of one question is how they drift apart, and
 * the insert loops then re-derived the match a second time after the
 * classifier had already decided it. This is the one place that answers it.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizePartNumber } from "./stages";
import type { KnownBoughtItem, KnownPart } from "./intake";

export type KnownSet = {
  known: KnownPart[];
  /** The part rows themselves, for the loops that patch what they matched. */
  byNumber: Map<string, Doc<"parts">>;
  bought: KnownBoughtItem[];
  /** Bought rows by vendor number. First one wins; see `classifyRelease`. */
  boughtByNumber: Map<string, Doc<"cotsItems">>;
};

/**
 * Omitting `subsystemId` compares against the whole season, which is what a
 * release needs — one release can span subsystems, where a panel sync is
 * always looking at one document.
 */
export async function loadKnown(
  ctx: MutationCtx,
  args: { seasonId: Id<"seasons">; subsystemId?: Id<"subsystems"> },
): Promise<KnownSet> {
  const parts = args.subsystemId
    ? await ctx.db
        .query("parts")
        .withIndex("by_subsystem", (q) =>
          q.eq("subsystemId", args.subsystemId!),
        )
        .take(5000)
    : await ctx.db
        .query("parts")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .take(5000);
  const live = parts.filter((p) => !p.isArchived);

  // No `isArchived` filter here, because a bought item has no archive flag —
  // every row in the season counts. Not an oversight.
  const boughtRows = args.subsystemId
    ? await ctx.db
        .query("cotsItems")
        .withIndex("by_subsystem", (q) =>
          q.eq("subsystemId", args.subsystemId!),
        )
        .take(5000)
    : await ctx.db
        .query("cotsItems")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .take(5000);

  const boughtByNumber = new Map<string, Doc<"cotsItems">>();
  for (const item of boughtRows) {
    const key = item.vendorPartNumberKey;
    if (key && !boughtByNumber.has(key)) boughtByNumber.set(key, item);
  }

  return {
    known: live.map((p) => ({
      partNumber: p.partNumber,
      stage: p.stage,
      qtyMade: p.qtyMade,
      revision: p.revision,
    })),
    byNumber: new Map(live.map((p) => [normalizePartNumber(p.partNumber), p])),
    bought: boughtRows
      .filter((i) => i.vendorPartNumber)
      .map((i) => ({
        vendorPartNumber: i.vendorPartNumber!,
        name: i.name,
        status: i.status,
      })),
    boughtByNumber,
  };
}
