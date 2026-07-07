import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { STATUSES, type TaskStatus } from "@/lib/pm";
import { useProjectArg } from "@/lib/project";
import { cn } from "@/lib/utils";

export function MobilePage() {
  const tasks = useQuery(api.tasks.listMine, useProjectArg());
  const updateTask = useMutation(api.tasks.update);

  function setStatus(id: Id<"tasks">, status: TaskStatus) {
    void updateTask({ id, status });
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="brand-title text-3xl">Quick update</h1>
        <p className="text-sm text-muted-foreground">
          Tap a status to move your tasks. Big targets for the shop floor.
        </p>
      </div>

      {tasks === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing assigned to you.</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task._id} className="rounded-lg border p-3">
              <Link
                to={`/tasks/${task._id}`}
                className="text-sm font-medium hover:underline"
              >
                {task.title}
              </Link>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {STATUSES.map((s) => {
                  const active = task.status === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStatus(task._id, s.value)}
                      className={cn(
                        "h-11 rounded-md border text-sm font-medium transition-colors",
                        active
                          ? s.badgeClass + " border-transparent"
                          : "hover:bg-accent",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
