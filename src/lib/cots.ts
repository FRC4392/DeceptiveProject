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

function shortDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * The state with the date that matters for it, which is never the same date
 * twice: what you want to know about something on order is when it's coming,
 * and about something here is when it landed.
 *
 * Every date here is one the app knows without being told — the move stamps
 * it — so this reads as a fact rather than as an empty field.
 */
export function cotsStatusLabel(item: Doc<"cotsItems">): string {
  if (item.status === "arrived") {
    return item.arrivedAt
      ? `Arrived · ${shortDate(item.arrivedAt)}`
      : "Arrived";
  }
  if (item.status === "ordered") {
    // An expected date beats the order date: it's the one that says whether
    // to start chasing it.
    if (item.eta) return `Expected · ${shortDate(item.eta)}`;
    if (item.orderedAt) return `Ordered · ${shortDate(item.orderedAt)}`;
    return "Ordered";
  }
  return "Needed";
}

/** What happens to it next, or null once it's here. */
export function nextCotsStatus(status: CotsStatus): CotsStatus | null {
  if (status === "needed") return "ordered";
  if (status === "ordered") return "arrived";
  return null;
}

export function previousCotsStatus(status: CotsStatus): CotsStatus | null {
  if (status === "arrived") return "ordered";
  if (status === "ordered") return "needed";
  return null;
}

/**
 * The wording on the one big button, in the same shape a part uses:
 * what you did, then where that puts it.
 */
export function cotsAdvanceLabel(status: CotsStatus): string | null {
  if (status === "needed") return "Placed the order → Ordered";
  if (status === "ordered") return "It turned up → Arrived";
  return null;
}

/** What someone is waiting on, said plainly. */
export function cotsTask(status: CotsStatus): string {
  if (status === "needed") return "Somebody has to buy these.";
  if (status === "ordered") return "On its way — mark it when it turns up.";
  return "In the shop, and ready to go on.";
}
