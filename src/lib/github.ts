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
    badgeClass:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  {
    value: "closed",
    label: "Closed",
    badgeClass:
      "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  },
];

export function issueStateMeta(state: IssueState) {
  return ISSUE_STATES.find((s) => s.value === state) ?? ISSUE_STATES[0];
}

/** A short human reference like `deceivers/robot#7` for a synced issue. */
export function issueRef(issue: Issue): string {
  if (issue.repo && issue.number !== undefined) {
    return `${issue.repo}#${issue.number}`;
  }
  return "Local";
}

export function issueKindLabel(issue: Issue): string {
  return issue.isPullRequest ? "PR" : "Issue";
}
