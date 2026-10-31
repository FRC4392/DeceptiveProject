import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Chip } from "@/components/tracker/PartChips";
import { ClaimLine } from "@/components/tracker/ClaimLine";
import { useCurrentUserId } from "@/lib/roles";
import { issueRef, issueStateMeta } from "@/lib/github";
import { priorityMeta } from "@/lib/priority";
import { cn } from "@/lib/utils";

/** One issue in the list, built to read like a part or a to-do card. */
export function IssueCard({
  issue,
  claimantName,
}: {
  issue: Doc<"issues">;
  claimantName?: string;
}) {
  const currentUserId = useCurrentUserId();
  const claim = useMutation(api.github.claim);
  const unclaim = useMutation(api.github.unclaim);
  const state = issueStateMeta(issue.state);
  const closed = issue.state === "closed";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/40",
        closed && "opacity-60",
      )}
    >
      <Link to={`/issues/${issue._id}`} className="block">
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
            <Chip className={priorityMeta("high").badgeClass}>
              High priority
            </Chip>
          )}
          {issue.labels.slice(0, 3).map((label) => (
            <Chip
              key={label}
              className="bg-secondary text-secondary-foreground"
            >
              {label}
            </Chip>
          ))}
          {issue.labels.length > 3 && (
            <span className="self-center text-xs text-muted-foreground">
              +{issue.labels.length - 3}
            </span>
          )}
        </div>
      </Link>

      <ClaimLine
        claimantName={
          issue.claimedByUserId ? (claimantName ?? "Someone") : undefined
        }
        mine={issue.claimedByUserId === currentUserId}
        closed={closed}
        onClaim={() => claim({ id: issue._id })}
        onRelease={() => unclaim({ id: issue._id })}
      >
        {issue.authorLogin && (
          <span className="self-center text-xs text-muted-foreground">
            @{issue.authorLogin}
          </span>
        )}
      </ClaimLine>
    </div>
  );
}
