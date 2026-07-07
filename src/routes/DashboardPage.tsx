import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/pm/TaskMeta";
import { daysUntil, formatDate } from "@/lib/pm";
import { formatCost } from "@/lib/parts";
import { useProjectArg } from "@/lib/project";

function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function DashboardPage() {
  const projectArg = useProjectArg();
  const summary = useQuery(api.dashboard.summary, projectArg);
  const overdue = useQuery(api.tasks.listOverdue, projectArg);
  const cost = useQuery(api.parts.costRollup, projectArg);
  const issues = useQuery(api.github.stats, projectArg);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="brand-title text-3xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Team progress at a glance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overall progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="brand-title text-4xl">
              {summary ? pct(summary.doneTasks, summary.totalTasks) : "—"}%
            </div>
            <p className="text-xs text-muted-foreground">
              {summary
                ? `${summary.doneTasks} of ${summary.totalTasks} tasks done`
                : "Loading…"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="brand-title text-4xl text-danger">

              {summary ? summary.overdueCount : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              tasks past their due date
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Next competition
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.nextCompetition ? (
              <>
                <div className="brand-title text-4xl">
                  {Math.max(daysUntil(summary.nextCompetition.date), 0)}
                  <span className="ml-1 font-sans text-base font-normal normal-case not-italic text-muted-foreground">
                    days
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {summary.nextCompetition.name} ·{" "}
                  {formatDate(summary.nextCompetition.date)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No competition scheduled.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progress by subsystem</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : summary.subsystems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No boards yet. Create a board to start tracking progress.
            </p>
          ) : (
            summary.subsystems.map((s) => {
              const percent = pct(s.done, s.total);
              return (
                <div key={s.subsystem} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize">
                      {s.subsystem}
                    </span>
                    <span className="text-muted-foreground">
                      {s.done}/{s.total} · {percent}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Software issues</CardTitle>
        </CardHeader>
        <CardContent>
          {issues === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : issues.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No issues tracked yet.{" "}
              <Link to="/issues" className="underline hover:text-foreground">
                Open the issue tracker →
              </Link>
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <div className="brand-title text-4xl">{issues.open}</div>
                <p className="text-xs text-muted-foreground">open</p>
              </div>
              <div>
                <div className="brand-title text-4xl text-muted-foreground">
                  {issues.closed}
                </div>
                <p className="text-xs text-muted-foreground">closed</p>
              </div>
              <div>
                <div className="brand-title text-4xl">{issues.prs}</div>
                <p className="text-xs text-muted-foreground">pull requests</p>
              </div>
              <Link
                to="/issues"
                className="ml-auto text-sm text-primary hover:underline"
              >
                View all →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost estimate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {cost === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="brand-title text-4xl">
                {formatCost(cost.total)}
              </div>
              <p className="text-xs text-muted-foreground">
                Parts {formatCost(cost.partsTotal)} · Inventory{" "}
                {formatCost(cost.inventoryTotal)} · COTS{" "}
                {formatCost(cost.cotsTotal)}
              </p>
              <p className="text-xs text-muted-foreground">
                Estimate only — {cost.partsMissingCost} part
                {cost.partsMissingCost === 1 ? "" : "s"} missing a cost.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {overdue && overdue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overdue tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {overdue.map((t) => (
                <li
                  key={t._id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <Link
                    to={`/tasks/${t._id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {t.title}
                  </Link>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={t.status} />
                    <span className="text-xs font-medium text-danger">
                      {formatDate(t.dueDate)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
