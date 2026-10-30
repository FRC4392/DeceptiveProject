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

export async function requireActiveSeason(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"seasons">> {
  const season = await activeSeason(ctx);
  if (!season) {
    throw new Error("No active season yet — set one up in Settings.");
  }
  return season;
}
