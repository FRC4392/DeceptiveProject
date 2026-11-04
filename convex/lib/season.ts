import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * The season every tracker screen works in. There are only ever a handful of
 * rows, so this reads them all rather than carrying an index for one flag.
 */
export async function activeSeason(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"seasons"> | null> {
  const seasons = await ctx.db.query("seasons").collect();
  return seasons.find((s) => s.active) ?? null;
}

/**
 * Refuse to make something in this season against a subsystem from another.
 *
 * A form left open across a season switch still holds last season's subsystem
 * id. Creating against it would file the new thing under a subsystem the board
 * no longer shows — and, for anything that takes a number, mint this year's
 * digits with last year's code.
 */
export function assertSubsystemInSeason(
  subsystem: Doc<"subsystems">,
  season: Doc<"seasons">,
): void {
  if (subsystem.seasonId !== season._id) {
    throw new Error("That subsystem is from another season. Pick it again.");
  }
}

export async function requireActiveSeason(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"seasons">> {
  const season = await activeSeason(ctx);
  if (!season) {
    throw new Error("No active season yet — set one up in Settings.");
  }
  return season;
}
