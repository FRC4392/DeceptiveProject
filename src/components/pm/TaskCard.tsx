import { Link } from "react-router-dom";
import type { Doc } from "../../../convex/_generated/dataModel";
import { AssigneeAvatars, PriorityBadge } from "@/components/pm/TaskMeta";
import { Badge } from "@/components/ui/badge";
import { formatDate, isOverdue } from "@/lib/pm";
import { cn } from "@/lib/utils";

export function TaskCard({ task }: { task: Doc<"tasks"> }) {
  const overdue = isOverdue(task);
  return (
    <Link
      to={`/tasks/${task._id}`}
      draggable={false}
      className="block rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        <PriorityBadge priority={task.priority} />
      </div>

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <Badge key={label} variant="secondary" className="text-[10px]">
              {label}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <AssigneeAvatars assigneeIds={task.assigneeIds} />
        <div className="flex items-center gap-2">
          {task.source !== "manual" && (
            <Badge variant="outline" className="text-[10px] capitalize">
              {task.source}
            </Badge>
          )}
          {task.dueDate !== undefined && (
            <span
              className={cn(
                "text-xs",
                overdue ? "font-medium text-danger" : "text-muted-foreground",
              )}
            >
              {formatDate(task.dueDate)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
