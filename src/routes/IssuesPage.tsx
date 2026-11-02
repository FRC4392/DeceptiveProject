import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { IssueCard } from "@/components/tracker/IssueCard";
import { FilterChip, FilterDivider } from "@/components/tracker/FilterChip";
import { IssueFormDialog } from "@/components/pm/IssueFormDialog";
import { type IssueState } from "@/lib/github";
import { LOCAL_REPO, repoLabel, type RepoRow } from "@/lib/repos";
import { useRosterMap } from "@/lib/users";

type StateFilter = "all" | IssueState;
type KindFilter = "all" | "issues" | "prs";
type ScopeFilter = "season" | "ongoing" | "all";

const SCOPES: { value: ScopeFilter; label: string }[] = [
  // The default is deliberately the narrowest: the robot the team is building
  // now. A repo that runs year after year is a separate question, not a louder
  // version of this one.
  { value: "season", label: "This season" },
  { value: "ongoing", label: "Every season" },
  { value: "all", label: "All repos" },
];

/** Software issues and pull requests, laid out like the parts board. */
export function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("season");
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const roster = useRosterMap();
  const registry = useQuery(api.github.repos, {});
  const issues = useQuery(api.github.list, {
    state: stateFilter === "all" ? undefined : stateFilter,
    scope,
    // One repo wins over the scope, so a chip still works under "All repos".
    repo: repoFilter === LOCAL_REPO ? undefined : (repoFilter ?? undefined),
  });

  // The repos worth offering as chips: the ones this scope is about. Local
  // issues — reported in the app, belonging to no repo — get a chip of their
  // own wherever they're included, since otherwise there's no way to see just
  // the team's own bugs.
  const chipRepos: RepoRow[] = useMemo(() => {
    const rows = registry?.repos ?? [];
    if (scope === "ongoing") return rows.filter((r) => r.kind === "ongoing");
    if (scope === "all") return rows;
    return rows.filter((r) => r.inSeasonScope);
  }, [registry, scope]);
  const showLocalChip = scope !== "ongoing" && (registry?.local.total ?? 0) > 0;

  const labelFor = useMemo(() => {
    const byName = new Map((registry?.repos ?? []).map((r) => [r.fullName, r]));
    return (repo?: string) =>
      repo === undefined ? "Local" : repoLabel(byName.get(repo), repo);
  }, [registry]);

  const shown = (issues ?? [])
    .filter((i) =>
      kindFilter === "all"
        ? true
        : kindFilter === "prs"
          ? i.isPullRequest
          : !i.isPullRequest,
    )
    // "Local" is a repo chip like any other to a reader, but the server has no
    // name to filter on, so it's done here.
    .filter((i) => (repoFilter === LOCAL_REPO ? i.repo === undefined : true));

  const groups = useMemo(() => {
    if (!grouped) return null;
    const byRepo = new Map<string, typeof shown>();
    for (const issue of shown) {
      const key = issue.repo ?? LOCAL_REPO;
      byRepo.set(key, [...(byRepo.get(key) ?? []), issue]);
    }
    return [...byRepo.entries()].sort((a, b) =>
      labelFor(a[0] === LOCAL_REPO ? undefined : a[0]).localeCompare(
        labelFor(b[0] === LOCAL_REPO ? undefined : b[0]),
      ),
    );
  }, [grouped, shown, labelFor]);

  const unreviewed = registry?.unreviewed ?? 0;

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

      {unreviewed > 0 && !dismissedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-sm">
          <p>
            {unreviewed} repo{unreviewed === 1 ? "" : "s"} showed up and{" "}
            {unreviewed === 1 ? "hasn't" : "haven't"} been sorted. They're
            showing as this season's until somebody says otherwise.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/github">Sort them</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissedNotice(true)}
            >
              Not now
            </Button>
          </div>
        </div>
      )}

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

      <div className="flex flex-wrap items-center gap-2">
        {SCOPES.map((s) => (
          <FilterChip
            key={s.value}
            active={scope === s.value}
            onClick={() => {
              setScope(s.value);
              setRepoFilter(null);
            }}
          >
            {s.label}
          </FilterChip>
        ))}
        {(chipRepos.length > 0 || showLocalChip) && <FilterDivider />}
        {chipRepos.map((row) => (
          <FilterChip
            key={row._id}
            active={repoFilter === row.fullName}
            onClick={() =>
              setRepoFilter(repoFilter === row.fullName ? null : row.fullName)
            }
          >
            {repoLabel(row, row.fullName)}
            {row.open > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {row.open}
              </span>
            )}
          </FilterChip>
        ))}
        {showLocalChip && (
          <FilterChip
            active={repoFilter === LOCAL_REPO}
            onClick={() =>
              setRepoFilter(repoFilter === LOCAL_REPO ? null : LOCAL_REPO)
            }
          >
            Local
            {(registry?.local.open ?? 0) > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {registry?.local.open}
              </span>
            )}
          </FilterChip>
        )}
        {chipRepos.length > 1 && (
          <>
            <FilterDivider />
            <FilterChip active={grouped} onClick={() => setGrouped(!grouped)}>
              Group by repo
            </FilterChip>
          </>
        )}
      </div>

      {issues === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          scope={scope}
          anyRepos={(registry?.repos.length ?? 0) > 0}
          onReport={() => setNewOpen(true)}
        />
      ) : groups ? (
        <div className="space-y-6">
          {groups.map(([key, rows]) => (
            <section key={key} className="space-y-3">
              <h2 className="text-sm font-semibold">
                {labelFor(key === LOCAL_REPO ? undefined : key)} · {rows.length}
              </h2>
              <IssueGrid
                issues={rows}
                roster={roster}
                labelFor={labelFor}
                showRepo={false}
              />
            </section>
          ))}
        </div>
      ) : (
        <IssueGrid
          issues={shown}
          roster={roster}
          labelFor={labelFor}
          showRepo
        />
      )}

      <IssueFormDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function IssueGrid({
  issues,
  roster,
  labelFor,
  showRepo,
}: {
  issues: (typeof api.github.list)["_returnType"];
  roster: Record<string, { name: string }>;
  labelFor: (repo?: string) => string;
  showRepo: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {issues.map((issue) => (
        <IssueCard
          key={issue._id}
          issue={issue}
          claimantName={
            issue.claimedByUserId
              ? roster[issue.claimedByUserId]?.name
              : undefined
          }
          repoLabel={showRepo ? labelFor(issue.repo) : undefined}
        />
      ))}
    </div>
  );
}

function EmptyState({
  scope,
  anyRepos,
  onReport,
}: {
  scope: ScopeFilter;
  anyRepos: boolean;
  onReport: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="font-medium">Nothing here.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {!anyRepos ? (
          <>
            No repo has synced yet. Set the webhook up, or import one, from{" "}
            <Link
              to="/admin/github"
              className="text-primary underline-offset-4 hover:underline"
            >
              Admin → GitHub
            </Link>
            .
          </>
        ) : scope === "season" ? (
          <>
            Nothing in this season's repos. Check which repos count as this
            season's in{" "}
            <Link
              to="/admin/github"
              className="text-primary underline-offset-4 hover:underline"
            >
              Admin → GitHub
            </Link>
            , or look at all repos above.
          </>
        ) : (
          <>Nothing matching those filters.</>
        )}
      </p>
      <Button className="mt-4" onClick={onReport}>
        Report a bug
      </Button>
    </div>
  );
}
