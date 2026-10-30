import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { daysUntil, formatDate } from "@/lib/dates";

function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function DashboardPage() {
  const summary = useQuery(api.dashboard.summary, {});
  const progress = useQuery(api.subsystems.progress, {});
  const issues = useQuery(api.github.stats, {});

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
          <CardHeader>
            <CardTitle className="text-base">To-do list</CardTitle>
          </CardHeader>
          <CardContent>
            {summary === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="brand-title text-4xl">
                  {summary.doneTodos} / {summary.totalTodos}
                </div>
                <p className="text-xs text-muted-foreground">
                  done · {pct(summary.doneTodos, summary.totalTodos)}%
                </p>
                <Link
                  to="/todos"
                  className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
                >
                  Open the list →
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">On you</CardTitle>
          </CardHeader>
          <CardContent>
            {summary === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="brand-title text-4xl">
                  {summary.claimedByMe}
                </div>
                <p className="text-xs text-muted-foreground">
                  to-do{summary.claimedByMe === 1 ? "" : "s"} you've picked up
                </p>
                <Link
                  to="/my-todos"
                  className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
                >
                  See them →
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next event</CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.nextCompetition ? (
              <>
                <div className="brand-title text-4xl">
                  {daysUntil(summary.nextCompetition.date)}
                </div>
                <p className="text-xs text-muted-foreground">
                  days until {summary.nextCompetition.name} ·{" "}
                  {formatDate(summary.nextCompetition.date)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No events on the calendar.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Robot parts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {progress === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : progress.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subsystems set up yet.
            </p>
          ) : (
            <>
              <div className="brand-title text-4xl">
                {progress.reduce((sum, row) => sum + row.ready, 0)} /{" "}
                {progress.reduce((sum, row) => sum + row.total, 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                ready or on the robot
              </p>
              <div className="space-y-1.5">
                {progress.map((row) => (
                  <div key={row.subsystemId} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{row.name}</span>
                      <span className="text-muted-foreground">
                        {row.installed
                          ? "On the robot"
                          : `${row.ready} / ${row.total}`}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-1.5 rounded-full bg-primary"
                        style={{ width: `${pct(row.ready, row.total)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Link
                to="/parts"
                className="inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                Open the parts board →
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      {issues && issues.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Software</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="brand-title text-4xl">{issues.open}</div>
            <p className="text-xs text-muted-foreground">
              open · {issues.closed} closed · {issues.prs} pull requests
            </p>
            <Link
              to="/issues"
              className="inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              Open issues →
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
