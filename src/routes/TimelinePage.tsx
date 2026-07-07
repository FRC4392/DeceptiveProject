import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatDate, statusMeta } from "@/lib/pm";
import { useProjectArg } from "@/lib/project";
import { cn } from "@/lib/utils";

export function TimelinePage() {
  const tasks = useQuery(api.tasks.listAll, useProjectArg());

  const items = useMemo(() => {
    const scheduled = (tasks ?? [])
      .filter((t) => t.dueDate !== undefined)
      .map((t) => {
        const start = Math.min(t._creationTime, t.dueDate!);
        const end = Math.max(t.completedAt ?? t.dueDate!, start + 1);
        return { task: t, start, end };
      })
      .sort((a, b) => a.task.dueDate! - b.task.dueDate!);
    if (scheduled.length === 0) return null;
    const domainStart = Math.min(...scheduled.map((s) => s.start));
    const domainEnd = Math.max(...scheduled.map((s) => s.end));
    const span = Math.max(domainEnd - domainStart, 1);
    return { scheduled, domainStart, domainEnd, span };
  }, [tasks]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="brand-title text-3xl">Timeline</h1>
        <p className="text-sm text-muted-foreground">
          Tasks from creation to due date. Bar color reflects status.
        </p>
      </div>

      {tasks === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items === null ? (
        <p className="text-sm text-muted-foreground">
          No tasks with due dates yet.
        </p>
      ) : (
        <div className="space-y-1">
          <div className="flex justify-between px-2 text-xs text-muted-foreground">
            <span>{formatDate(items.domainStart)}</span>
            <span>{formatDate(items.domainEnd)}</span>
          </div>
          <div className="space-y-1 rounded-lg border p-2">
            {items.scheduled.map(({ task, start, end }) => {
              const leftPct =
                ((start - items.domainStart) / items.span) * 100;
              const widthPct = Math.max(((end - start) / items.span) * 100, 2);
              return (
                <div
                  key={task._id}
                  className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-2"
                >
                  <Link
                    to={`/tasks/${task._id}`}
                    className="truncate text-sm hover:underline"
                    title={task.title}
                  >
                    {task.title}
                  </Link>
                  <div className="relative h-6">
                    <div
                      className={cn(
                        "absolute top-0.5 flex h-5 items-center rounded px-2 text-[11px] font-medium",
                        statusMeta(task.status).badgeClass,
                      )}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      title={`${formatDate(start)} → ${formatDate(task.dueDate)}`}
                    >
                      <span className="truncate">
                        {formatDate(task.dueDate)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
