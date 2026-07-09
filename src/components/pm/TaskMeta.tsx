import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  priorityMeta,
  statusMeta,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/pm";
import { initials, useRosterMap } from "@/lib/users";

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        meta.badgeClass,
      )}
    >
      {meta.label}
    </span>
  );
}

export function PriorityFlag({ priority }: { priority: TaskPriority }) {
  const meta = priorityMeta(priority);
  return (
    <span className={cn("text-xs", meta.className)}>{meta.label} priority</span>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const meta = priorityMeta(priority);
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      {meta.label}
    </Badge>
  );
}

/** Overlapping avatar stack for a set of Clerk user ids. */
export function AssigneeAvatars({
  assigneeIds,
  max = 4,
}: {
  assigneeIds: string[];
  max?: number;
}) {
  const roster = useRosterMap();
  if (assigneeIds.length === 0) {
    return <span className="text-xs text-muted-foreground">Unassigned</span>;
  }
  const shown = assigneeIds.slice(0, max);
  const extra = assigneeIds.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((id) => {
        const name = roster[id]?.name ?? "?";
        return (
          <Avatar
            key={id}
            className="h-6 w-6 border-2 border-background"
            title={name}
          >
            <AvatarFallback className="text-[10px]">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {extra > 0 && (
        <Avatar className="h-6 w-6 border-2 border-background">
          <AvatarFallback className="text-[10px]">+{extra}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
