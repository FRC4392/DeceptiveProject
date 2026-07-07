import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { TaskCard } from "@/components/pm/TaskCard";
import { STATUSES } from "@/lib/pm";
import { useProjectArg } from "@/lib/project";

export function MyTasksPage() {
  const tasks = useQuery(api.tasks.listMine, useProjectArg());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="brand-title text-3xl">My tasks</h1>
        <p className="text-sm text-muted-foreground">
          Everything assigned to you across all boards.
        </p>
      </div>

      {tasks === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing assigned to you right now.
        </p>
      ) : (
        <div className="space-y-6">
          {STATUSES.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.value);
            if (colTasks.length === 0) return null;
            return (
              <section key={col.value} className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {col.label} · {colTasks.length}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {colTasks.map((task) => (
                    <TaskCard key={task._id} task={task} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
