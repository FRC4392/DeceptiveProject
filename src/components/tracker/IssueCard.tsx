import { Link } from "react-router-dom";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Chip } from "@/components/tracker/PartChips";
import { issueRef, issueStateMeta } from "@/lib/github";
import { priorityMeta } from "@/lib/priority";
import { cn } from "@/lib/utils";

/** One issue in the list, built to read like a part or a to-do card. */
export function IssueCard({ issue }: { issue: Doc<"issues"> }) {
  const state = issueStateMeta(issue.state);
  const closed = issue.state === "closed";

  return (
    <Link
      to={`/issues/${issue._id}`}
      className={cn(
        "block rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/40",
        closed && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-sm font-medium">
          {issue.source === "github" && (
            <GitHubLogoIcon className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {issueRef(issue)}
        </span>
        <Chip className={state.badgeClass}>{state.label}</Chip>
      </div>

      <p className="mt-1 text-sm font-semibold leading-snug">{issue.title}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {issue.isPullRequest && (
          <Chip className="bg-muted text-muted-foreground">Pull request</Chip>
        )}
        {issue.priority === "high" && (
          <Chip className={priorityMeta("high").badgeClass}>High priority</Chip>
        )}
        {issue.labels.slice(0, 3).map((label) => (
          <Chip key={label} className="bg-secondary text-secondary-foreground">
            {label}
          </Chip>
        ))}
        {issue.labels.length > 3 && (
          <span className="self-center text-xs text-muted-foreground">
            +{issue.labels.length - 3}
          </span>
        )}
      </div>

      {issue.authorLogin && (
        <div className="mt-3 border-t pt-2">
          <span className="text-xs text-muted-foreground">
            @{issue.authorLogin}
          </span>
        </div>
      )}
    </Link>
  );
}
