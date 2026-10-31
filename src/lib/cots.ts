import type { Doc } from "../../convex/_generated/dataModel";

export type CotsStatus = Doc<"cotsItems">["status"];

/** In the order the thing actually happens. */
export const COTS_STATUSES: { value: CotsStatus; label: string }[] = [
  { value: "needed", label: "Needed" },
  { value: "ordered", label: "Ordered" },
  { value: "arrived", label: "Arrived" },
];

export function cotsChipClass(status: CotsStatus): string {
  if (status === "arrived") return "bg-success/10 text-success";
  if (status === "ordered") return "bg-info/10 text-info";
  return "bg-muted text-muted-foreground";
}

/** "Ordered · 3 Mar" once there's a date to say. */
export function cotsStatusLabel(item: Doc<"cotsItems">): string {
  if (item.status === "arrived") return "Arrived";
  if (item.status === "ordered") {
    return item.eta
      ? `Ordered · ${new Date(item.eta).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}`
      : "Ordered";
  }
  return "Needed";
}
