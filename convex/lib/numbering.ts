import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { formatPartNumber, normalizePartNumber } from "./stages";

/**
 * Digits the sequence is padded to when a season doesn't say otherwise.
 * A season may widen it, but only before it has issued anything — see
 * `seasons.update`, and the comment on `seasons.numberPad` in the schema.
 */
export const DEFAULT_PAD = 3;

/**
 * The next number for a subsystem, taken inside the mutation's transaction so
 * two students pressing "Get a part number" at the same moment can't be handed
 * the same one. A number is never reused — not even one belonging to a part
 * that was deleted.
 *
 * Parts and sub-assemblies draw from this one counter, so a number identifies
 * exactly one thing. Sequence 0 is never issued here; it is reserved for the
 * subsystem's default sub-assembly (see `defaultSubAssemblyNumber`).
 */
export async function takePartNumber(
  ctx: MutationCtx,
  season: Doc<"seasons">,
  subsystem: Doc<"subsystems">,
): Promise<string> {
  const counter = await ctx.db
    .query("partNumberCounters")
    .withIndex("by_season_and_subsystem", (q) =>
      q.eq("seasonId", season._id).eq("subsystemId", subsystem._id),
    )
    .unique();
  let sequence: number;
  if (counter) {
    sequence = counter.next;
    await ctx.db.patch(counter._id, { next: sequence + 1 });
  } else {
    sequence = 1;
    await ctx.db.insert("partNumberCounters", {
      seasonId: season._id,
      subsystemId: subsystem._id,
      next: 2,
    });
  }
  return formatPartNumber(
    season.year,
    subsystem.code,
    sequence,
    season.numberPad ?? DEFAULT_PAD,
  );
}

/**
 * {YY}-{SUB}-000, the subsystem's default sub-assembly — the whole thing, the
 * one that going together means the subsystem is on the robot. It costs the
 * counter nothing because the counter starts at 1.
 */
export function defaultSubAssemblyNumber(
  year: string,
  code: string,
  pad: number = DEFAULT_PAD,
): string {
  return formatPartNumber(year, code, 0, pad);
}

/**
 * A number belongs to one thing. Since parts and sub-assemblies share a
 * counter this can only really fire on a double-default or a hand-set number,
 * which is exactly when you want to hear about it.
 */
export async function assertNumberFree(
  ctx: QueryCtx | MutationCtx,
  partNumber: string,
): Promise<void> {
  const key = normalizePartNumber(partNumber);
  const part = await ctx.db
    .query("parts")
    .withIndex("by_partNumberKey", (q) => q.eq("partNumberKey", key))
    .unique();
  if (part) throw new Error(`${partNumber} is already a part.`);
  const assembly = await ctx.db
    .query("subAssemblies")
    .withIndex("by_partNumberKey", (q) => q.eq("partNumberKey", key))
    .unique();
  if (assembly) throw new Error(`${partNumber} is already a sub-assembly.`);
}
