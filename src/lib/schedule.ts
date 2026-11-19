/**
 * Day arithmetic and layout for the schedule's Gantt chart.
 *
 * Every date here is a day: the timestamp of a local midnight. Days are
 * stepped with `new Date(y, m, d + n)` rather than by adding milliseconds, so
 * a clock change in spring or autumn can't knock a bar an hour into the
 * wrong day.
 */

export type ScheduleTaskLike = {
  start: number;
  end: number;
  doneAt?: number;
};

export type TaskStatus = "done" | "overdue" | "active" | "upcoming";

export type DayRange = { from: number; to: number };

export type DragMode = "move" | "start" | "end";

/** Local midnight of the day `ts` falls in. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The day `n` days after `day` (or before, for negative `n`). */
export function addDays(day: number, n: number): number {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: number, b: number): number {
  // Rounding absorbs the hour a clock change adds or takes away.
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
}

/** A day as the value an `<input type="date">` wants. */
export function toDateInputValue(day: number): string {
  const d = new Date(day);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function taskStatus(task: ScheduleTaskLike, today: number): TaskStatus {
  if (task.doneAt !== undefined) return "done";
  const day = startOfDay(today);
  if (task.end < day) return "overdue";
  if (task.start <= day) return "active";
  return "upcoming";
}

/** Does the task touch any day in the range? */
export function overlaps(task: ScheduleTaskLike, range: DayRange): boolean {
  return task.start <= range.to && task.end >= range.from;
}

/**
 * The whole season's span: every task and event, and today, with a few days
 * either side so nothing sits on the edge.
 */
export function chartRange(
  tasks: ScheduleTaskLike[],
  milestones: { date: number }[],
  today: number,
  pad = 3,
): DayRange {
  const days = [
    startOfDay(today),
    ...tasks.flatMap((t) => [t.start, t.end]),
    ...milestones.map((m) => startOfDay(m.date)),
  ];
  const from = Math.min(...days);
  const to = Math.max(...days);
  // At least four weeks wide, so a schedule with one task still reads.
  const span = daysBetween(from, to);
  const extra = Math.max(0, 28 - span);
  return { from: addDays(from, -pad), to: addDays(to, pad + extra) };
}

/** The days around today: `before` days back to `after` days ahead. */
export function windowAround(
  today: number,
  before: number,
  after: number,
): DayRange {
  const day = startOfDay(today);
  return { from: addDays(day, -before), to: addDays(day, after) };
}

/** Where a dragged or nudged bar ends up. The start never passes the end. */
export function dragResult(
  task: { start: number; end: number },
  mode: DragMode,
  dayDelta: number,
): { start: number; end: number } {
  if (mode === "move") {
    return {
      start: addDays(task.start, dayDelta),
      end: addDays(task.end, dayDelta),
    };
  }
  if (mode === "start") {
    const start = addDays(task.start, dayDelta);
    return { start: start > task.end ? task.end : start, end: task.end };
  }
  const end = addDays(task.end, dayDelta);
  return { start: task.start, end: end < task.start ? task.start : end };
}

/** Each day in the range, first to last. */
export function daysIn(range: DayRange): number[] {
  const out: number[] = [];
  const count = daysBetween(range.from, range.to);
  for (let i = 0; i <= count; i++) out.push(addDays(range.from, i));
  return out;
}

export function formatDay(day: number): string {
  return new Date(day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "Mar 3 – Mar 9", or one date for a one-day task. */
export function formatSpan(start: number, end: number): string {
  return start === end
    ? formatDay(start)
    : `${formatDay(start)} – ${formatDay(end)}`;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  done: "done",
  overdue: "overdue",
  active: "in progress",
  upcoming: "upcoming",
};
