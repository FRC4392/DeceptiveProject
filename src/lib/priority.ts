/** The three priorities a to-do or an issue can carry. */
export type Priority = "low" | "medium" | "high";

export const PRIORITIES: {
  value: Priority;
  label: string;
  badgeClass: string;
}[] = [
  { value: "low", label: "Low", badgeClass: "bg-muted text-muted-foreground" },
  {
    value: "medium",
    label: "Medium",
    badgeClass: "bg-secondary text-secondary-foreground",
  },
  { value: "high", label: "High", badgeClass: "bg-danger/10 text-danger" },
];

export function priorityMeta(priority: Priority) {
  return PRIORITIES.find((p) => p.value === priority) ?? PRIORITIES[1];
}

export function priorityLabel(priority: Priority): string {
  return priorityMeta(priority).label;
}
