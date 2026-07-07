import { format } from "date-fns";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high";

export const STATUSES: {
  value: TaskStatus;
  label: string;
  badgeClass: string;
  columnClass: string;
}[] = [
  {
    value: "todo",
    label: "To do",
    badgeClass: "bg-muted text-muted-foreground",
    columnClass: "border-border",
  },
  {
    value: "in_progress",
    label: "In progress",
    badgeClass: "bg-secondary text-secondary-foreground",
    columnClass: "border-primary",
  },
  {
    value: "blocked",
    label: "Blocked",
    badgeClass: "bg-danger/10 text-danger",
    columnClass: "border-danger",
  },
  {
    value: "done",
    label: "Done",
    badgeClass: "bg-success/10 text-success",
    columnClass: "border-success",
  },
];

export const PRIORITIES: {
  value: TaskPriority;
  label: string;
  className: string;
}[] = [
  { value: "low", label: "Low", className: "text-muted-foreground" },
  { value: "medium", label: "Medium", className: "text-warning" },
  { value: "high", label: "High", className: "text-danger font-semibold" },
];

export function statusMeta(status: TaskStatus) {
  return STATUSES.find((s) => s.value === status) ?? STATUSES[0];
}

export function statusLabel(status: TaskStatus): string {
  return statusMeta(status).label;
}

export function priorityMeta(priority: TaskPriority) {
  return PRIORITIES.find((p) => p.value === priority) ?? PRIORITIES[1];
}

export function priorityLabel(priority: TaskPriority): string {
  return priorityMeta(priority).label;
}

// --- Dates ---

export function formatDate(ts?: number | null): string {
  if (ts == null) return "—";
  return format(new Date(ts), "MMM d, yyyy");
}

export function formatDateTime(ts?: number | null): string {
  if (ts == null) return "—";
  return format(new Date(ts), "MMM d, yyyy h:mm a");
}

/** yyyy-MM-dd for <input type="date"> values. */
export function toDateInputValue(ts?: number): string {
  if (ts == null) return "";
  return format(new Date(ts), "yyyy-MM-dd");
}

/** Parse a yyyy-MM-dd input into a timestamp (local midnight), or undefined. */
export function fromDateInputValue(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(ts) ? undefined : ts;
}

export function isOverdue(task: {
  dueDate?: number;
  status: TaskStatus;
}): boolean {
  return (
    task.dueDate !== undefined &&
    task.dueDate < Date.now() &&
    task.status !== "done"
  );
}

export function daysUntil(ts: number): number {
  const ms = ts - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
