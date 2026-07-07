import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriorityBadge } from "@/components/pm/TaskMeta";
import { IssueFormDialog } from "@/components/pm/IssueFormDialog";
import { issueRef, issueStateMeta, type IssueState } from "@/lib/github";
import { useProjectArg } from "@/lib/project";
import { cn } from "@/lib/utils";
import { GitHubLogoIcon } from "@radix-ui/react-icons";

type StateFilter = "all" | IssueState;
type KindFilter = "all" | "issues" | "prs";

export function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const projectArg = useProjectArg();
  const issues = useQuery(api.github.list, {
    ...projectArg,
    state: stateFilter === "all" ? undefined : stateFilter,
  });

  const shown = (issues ?? []).filter((i) =>
    kindFilter === "all"
      ? true
      : kindFilter === "prs"
        ? i.isPullRequest
        : !i.isPullRequest,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">Issues</h1>
          <p className="text-sm text-muted-foreground">
            Software bugs and GitHub issues/PRs — each mirrors into a task on the
            Software board.
          </p>
        </div>
        <IssueFormDialog trigger={<Button>New issue</Button>} />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(["open", "closed", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStateFilter(f)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
                stateFilter === f
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5">
          {(["all", "issues", "prs"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setKindFilter(f)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                kindFilter === f
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "all" ? "All" : f === "prs" ? "PRs" : "Issues"}
            </button>
          ))}
        </div>
      </div>

      {issues === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No issues match. Create one, or import a repo from{" "}
          <Link to="/admin/github" className="underline hover:text-foreground">
            Admin → GitHub
          </Link>
          .
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Ref</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Labels</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((issue) => {
                const stateMeta = issueStateMeta(issue.state);
                return (
                  <TableRow key={issue._id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {issue.source === "github" && (
                          <GitHubLogoIcon className="h-3.5 w-3.5" />
                        )}
                        {issueRef(issue)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/issues/${issue._id}`}
                        className="font-medium hover:underline"
                      >
                        {issue.title}
                      </Link>
                      {issue.isPullRequest && (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[10px] uppercase"
                        >
                          PR
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          stateMeta.badgeClass,
                        )}
                      >
                        {stateMeta.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={issue.priority} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {issue.labels.slice(0, 3).map((l) => (
                          <Badge
                            key={l}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {l}
                          </Badge>
                        ))}
                        {issue.labels.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{issue.labels.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
