import type { Doc } from "../../convex/_generated/dataModel";

export type Issue = Doc<"issues">;
export type IssueState = "open" | "closed";

export const ISSUE_STATES: {
  value: IssueState;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: "open",
    label: "Open",
    // Brand status tokens (swap automatically in dark mode). Open = active/good.
    badgeClass: "bg-success/10 text-success",
  },
  {
    value: "closed",
    label: "Closed",
    // No second brand color: closed resolves to a disciplined neutral.
    badgeClass: "bg-muted text-muted-foreground",
  },
];

export function issueStateMeta(state: IssueState) {
  return ISSUE_STATES.find((s) => s.value === state) ?? ISSUE_STATES[0];
}

/**
 * A short human reference like `deceivers/robot#7` for a synced issue, or the
 * team's own name for the repo where one is set — "Robot code#7" is what people
 * say out loud, and the full owner/name is on the issue's own page.
 */
export function issueRef(issue: Issue, repoLabel?: string): string {
  if (issue.repo && issue.number !== undefined) {
    return `${repoLabel ?? issue.repo}#${issue.number}`;
  }
  return "Local";
}

export function issueKindLabel(issue: Issue): string {
  return issue.isPullRequest ? "PR" : "Issue";
}
