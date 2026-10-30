/** Date formatting shared by the admin and issue screens. */
export function formatDate(ts?: number | null): string {
  if (ts == null) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(ts?: number | null): string {
  if (ts == null) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A `<input type="date">` value back to a timestamp, at local midnight. */
export function fromDateInputValue(value: string): number | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day).getTime();
}

export function daysUntil(ts: number): number {
  return Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
}
