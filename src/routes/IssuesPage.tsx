import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { IssueCard } from "@/components/tracker/IssueCard";
import { FilterChip, FilterDivider } from "@/components/tracker/FilterChip";
import { IssueFormDialog } from "@/components/pm/IssueFormDialog";
import { type IssueState } from "@/lib/github";

type StateFilter = "all" | IssueState;
type KindFilter = "all" | "issues" | "prs";

/** Software issues and pull requests, laid out like the parts board. */
export function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [newOpen, setNewOpen] = useState(false);
  const issues = useQuery(api.github.list, {
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">Issues</h1>
          <p className="text-sm text-muted-foreground">
            Software bugs and the GitHub issues and pull requests that sync in.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>Report a bug</Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={stateFilter === "open"}
          onClick={() => setStateFilter("open")}
        >
          Open
        </FilterChip>
        <FilterChip
          active={stateFilter === "closed"}
          onClick={() => setStateFilter("closed")}
        >
          Closed
        </FilterChip>
        <FilterChip
          active={stateFilter === "all"}
          onClick={() => setStateFilter("all")}
        >
          All
        </FilterChip>
        <FilterDivider />
        <FilterChip
          active={kindFilter === "issues"}
          onClick={() =>
            setKindFilter(kindFilter === "issues" ? "all" : "issues")
          }
        >
          Issues only
        </FilterChip>
        <FilterChip
          active={kindFilter === "prs"}
          onClick={() => setKindFilter(kindFilter === "prs" ? "all" : "prs")}
        >
          Pull requests
        </FilterChip>
      </div>

      {issues === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">Nothing here.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Report a bug, or import a repository from{" "}
            <Link
              to="/admin/github"
              className="text-primary underline-offset-4 hover:underline"
            >
              Admin → GitHub
            </Link>
            .
          </p>
          <Button className="mt-4" onClick={() => setNewOpen(true)}>
            Report a bug
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((issue) => (
            <IssueCard key={issue._id} issue={issue} />
          ))}
        </div>
      )}

      <IssueFormDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
