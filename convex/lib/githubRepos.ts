/**
 * Which repos the issue list is about.
 *
 * One organisation-level webhook delivers every repo the team owns, so the
 * question "is this this year's work?" has to be answered here rather than in
 * GitHub's webhook settings. A repo is this season's, reused every season, or
 * ignored; the issue itself carries no season, so nothing needs backfilling
 * when the team moves on — last year's repo keeps last year's `seasonId` and
 * its issues leave the default view on their own.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { activeSeason } from "./season";

export type RepoScope = "season" | "ongoing" | "all";

/** GitHub is case-insensitive about repo names; the typed one rarely matches. */
export function repoKey(fullName: string): string {
  return fullName.trim().toLowerCase();
}

export async function repoRow(
  ctx: QueryCtx | MutationCtx,
  fullName: string,
): Promise<Doc<"githubRepos"> | null> {
  return ctx.db
    .query("githubRepos")
    .withIndex("by_nameKey", (q) => q.eq("nameKey", repoKey(fullName)))
    .unique();
}

/**
 * The row for a repo a delivery just arrived from, made if it isn't there yet.
 *
 * A new repo defaults to **this season's**, because that is what a repo
 * appearing mid-season nearly always is — and defaulting the other way would
 * mean a team that never visits Admin sees nothing of the robot they are
 * building. `reviewedAt` stays unset so Admin can ask.
 */
export async function ensureRepo(
  ctx: MutationCtx,
  fullName: string,
): Promise<Doc<"githubRepos">> {
  const existing = await repoRow(ctx, fullName);
  if (existing) return existing;

  const season = await activeSeason(ctx);
  const rows = await ctx.db.query("githubRepos").collect();
  const order = rows.reduce((max, r) => Math.max(max, r.order), 0) + 1;
  const id = await ctx.db.insert("githubRepos", {
    fullName: fullName.trim(),
    nameKey: repoKey(fullName),
    kind: "season",
    seasonId: season?._id,
    order,
    firstSeenAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

/**
 * Which repos a scope covers, and whether issues with no repo at all belong in
 * it. `null` names no repos because the scope is every one of them.
 *
 * A manual issue — "Report a bug" in the pit — has no repo, and belongs with
 * the work happening now rather than nowhere, so the season scope takes it.
 */
export async function scopedRepos(
  ctx: QueryCtx | MutationCtx,
  scope: RepoScope,
): Promise<{ names: string[]; withoutRepo: boolean } | null> {
  if (scope === "all") return null;
  const rows = await ctx.db.query("githubRepos").collect();
  if (scope === "ongoing") {
    return {
      names: rows.filter((r) => r.kind === "ongoing").map((r) => r.fullName),
      withoutRepo: false,
    };
  }
  // A season repo belongs to the current season — except that a repo seen
  // before any season existed has none to belong to, and a team with no active
  // season has no "this season" to compare against. Hiding either would mean a
  // default view that is empty for a reason nobody can see, so both are in.
  const season = await activeSeason(ctx);
  return {
    names: rows
      .filter(
        (r) =>
          r.kind === "season" &&
          (r.seasonId === undefined ||
            season === null ||
            r.seasonId === (season._id as Id<"seasons">)),
      )
      .map((r) => r.fullName),
    withoutRepo: true,
  };
}

/** Does this issue fall inside the scope? `null` means every issue does. */
export function inScope(
  scoped: { names: string[]; withoutRepo: boolean } | null,
  issue: Pick<Doc<"issues">, "repo">,
): boolean {
  if (scoped === null) return true;
  if (issue.repo === undefined) return scoped.withoutRepo;
  const key = repoKey(issue.repo);
  return scoped.names.some((n) => repoKey(n) === key);
}
