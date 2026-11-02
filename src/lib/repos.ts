import type { api } from "../../convex/_generated/api";

export type RepoRow = (typeof api.github.repos)["_returnType"]["repos"][number];

/**
 * The chip key for issues that belong to no repo — the ones reported in the app
 * itself. A repo full name always contains a slash, so this can't collide.
 */
export const LOCAL_REPO = "local";

/** What to call a repo: what the team calls it, else what GitHub calls it. */
export function repoLabel(
  row: { label?: string } | undefined,
  fullName: string,
): string {
  return row?.label?.trim() || fullName;
}
