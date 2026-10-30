import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { daysUntil, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/**
 * Three numbers across the top — what's left, what's on you, how long you
 * have — then one card per thing the app tracks.
 */
export function DashboardPage() {
  const summary = useQuery(api.dashboard.summary, {});
  const progress = useQuery(api.subsystems.progress, {});

  return (
    <div className="space-y-6">
      <header>
        <h1 className="brand-title text-3xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Where the robot is, and what's waiting on somebody.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Headline
          title="Still to do"
          value={summary ? summary.outstanding.total : undefined}
          caption="across parts, sub-assemblies, to-dos and issues"
        >
          {summary && (
            <Breakdown
              items={[
                {
                  label: "Parts",
                  value: summary.outstanding.parts,
                  to: "/parts",
                },
                {
                  label: "Sub-assemblies",
                  value: summary.outstanding.subAssemblies,
                  to: "/subsystems",
                },
                {
                  label: "To-dos",
                  value: summary.outstanding.todos,
                  to: "/todos",
                },
                {
                  label: "Issues",
                  value: summary.outstanding.issues,
                  to: "/issues",
                },
              ]}
            />
          )}
        </Headline>

        <Headline
          title="On you"
          value={summary ? summary.mine.total : undefined}
          caption={
            summary && summary.mine.total === 0
              ? "nothing picked up — the boards show what's going spare"
              : "picked up and not finished"
          }
          accent
        >
          {summary && (
            <Breakdown
              items={[
                { label: "Parts", value: summary.mine.parts, to: "/my-parts" },
                {
                  label: "Sub-assemblies",
                  value: summary.mine.subAssemblies,
                  to: "/subsystems",
                },
                { label: "To-dos", value: summary.mine.todos, to: "/my-todos" },
              ]}
            />
          )}
        </Headline>

        <Headline
          title="Next event"
          value={
            summary?.nextCompetition
              ? daysUntil(summary.nextCompetition.date)
              : undefined
          }
          caption={
            summary?.nextCompetition
              ? `days until ${summary.nextCompetition.name} · ${formatDate(
                  summary.nextCompetition.date,
                )}`
              : "nothing on the calendar"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Sub-assemblies"
          to="/subsystems"
          linkLabel="Open subsystems →"
        >
          {summary && (
            <>
              <Stat
                value={`${summary.subAssemblies.built} / ${summary.subAssemblies.total}`}
                caption="built and on the robot"
              />
              <Bar
                done={summary.subAssemblies.built}
                total={summary.subAssemblies.total}
              />
              <p className="mt-3 text-sm">
                {summary.subAssemblies.readyToBuild > 0 ? (
                  <span className="font-medium text-success">
                    {summary.subAssemblies.readyToBuild} ready to go together
                    now
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Nothing's ready to go together yet.
                  </span>
                )}
              </p>
            </>
          )}
        </Card>

        <Card title="Parts" to="/parts" linkLabel="Open the parts board →">
          {summary && (
            <>
              <Stat
                value={`${summary.parts.ready} / ${summary.parts.total}`}
                caption="in the bin or on the robot"
              />
              <Bar done={summary.parts.ready} total={summary.parts.total} />
              <div className="mt-3 space-y-1.5">
                {(progress ?? []).map((row) => (
                  <div key={row.subsystemId} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{row.name}</span>
                      <span className="text-muted-foreground">
                        {row.installed
                          ? "On the robot"
                          : `${row.ready} / ${row.total}`}
                      </span>
                    </div>
                    {/* Installed means the whole thing is on the robot, so a
                        part-full bar underneath would contradict the label. */}
                    <Bar
                      done={row.installed ? row.total : row.ready}
                      total={row.total}
                      thin
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="To-dos" to="/todos" linkLabel="Open the to-do list →">
          {summary && (
            <>
              <Stat
                value={`${summary.todos.done} / ${summary.todos.total}`}
                caption={`done · ${pct(summary.todos.done, summary.todos.total)}%`}
              />
              <Bar done={summary.todos.done} total={summary.todos.total} />
              <p className="mt-3 text-sm">
                {summary.todos.unclaimed > 0 ? (
                  <span className="font-medium text-primary">
                    {summary.todos.unclaimed} nobody's on
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Everything left is picked up.
                  </span>
                )}
              </p>
            </>
          )}
        </Card>

        <Card title="Issues" to="/issues" linkLabel="Open issues →">
          {summary && (
            <>
              <Stat value={summary.issues.open} caption="open" />
              <p className="mt-3 text-sm text-muted-foreground">
                {summary.issues.closed} closed · {summary.issues.prs} pull
                request{summary.issues.prs === 1 ? "" : "s"}
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Headline({
  title,
  value,
  caption,
  accent,
  children,
}: {
  title: string;
  value?: number;
  caption: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm",
        accent && "border-primary",
      )}
    >
      <h2 className="font-semibold">{title}</h2>
      {value === undefined ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="brand-title mt-2 text-5xl">{value}</p>
          <p className="text-xs text-muted-foreground">{caption}</p>
        </>
      )}
      {children}
    </section>
  );
}

function Breakdown({
  items,
}: {
  items: { label: string; value: number; to: string }[];
}) {
  return (
    <div className="mt-4 space-y-1 border-t pt-3">
      {items.map((item) => (
        <Link
          key={item.label}
          to={item.to}
          className="flex items-center justify-between rounded px-1 py-0.5 text-sm transition-colors hover:bg-accent"
        >
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-medium">{item.value}</span>
        </Link>
      ))}
    </div>
  );
}

function Card({
  title,
  to,
  linkLabel,
  children,
}: {
  title: string;
  to: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      <div className="grow">{children}</div>
      <Link
        to={to}
        className="mt-4 text-sm text-primary underline-offset-4 hover:underline"
      >
        {linkLabel}
      </Link>
    </section>
  );
}

function Stat({ value, caption }: { value: string | number; caption: string }) {
  return (
    <>
      <p className="brand-title mt-2 text-4xl">{value}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </>
  );
}

function Bar({
  done,
  total,
  thin,
}: {
  done: number;
  total: number;
  thin?: boolean;
}) {
  return (
    <div
      className={cn(
        "mt-2 w-full rounded-full bg-muted",
        thin ? "h-1.5" : "h-2",
      )}
    >
      <div
        className={cn("rounded-full bg-primary", thin ? "h-1.5" : "h-2")}
        style={{ width: `${pct(done, total)}%` }}
      />
    </div>
  );
}
