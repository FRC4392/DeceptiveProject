import { Badge } from "@/components/ui/badge";
import { priorityMeta, type Priority } from "@/lib/priority";
import { cn } from "@/lib/utils";

/** The priority chip shared by issues and to-dos. */
export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  const meta = priorityMeta(priority);
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", meta.badgeClass, className)}
    >
      {meta.label}
    </Badge>
  );
}
