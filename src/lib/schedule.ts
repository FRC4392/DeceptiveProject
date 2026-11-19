/**
 * Day arithmetic and layout for the schedule's Gantt chart.
 *
 * Every date here is a day, stored as Date.UTC of the calendar date — a
 * date, not a moment. That makes a day exactly DAY_MS long whatever the
 * zone or the clocks are doing, so the server can push a task "to the day
 * after" without knowing where anyone is. Read them back with the UTC
 * getters, never the local ones.
 */
import { DAY_MS } from "../../convex/lib/scheduleDeps";

export { DAY_MS };

export type ScheduleTaskLike = {
  start: number;
  end: number;
  doneAt?: number;
};

export type TaskStatus = "done" | "overdue" | "active" | "upcoming";

export type DayRange = { from: number; to: number };

export type DragMode = "move" | "start" | "end";

/** The calendar day a moment falls on, where this browser is. */
export function dayOf(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The day `n` days after `day` (or before, for negative `n`). */
export function addDays(day: number, n: number): number {
  return day + n * DAY_MS;
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: number, b: number): number {
  return Math.round((b - a) / DAY_MS);
}

/** A day as the value an `<input type="date">` wants. */
export function toDateInputValue(day: number): string {
  return new Date(day).toISOString().slice(0, 10);
}

/** An `<input type="date">` value as a day, or undefined if it isn't one. */
export function dayFromInputValue(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(day) ? undefined : day;
}

/** Day of the week, 0 for Sunday. */
export function weekday(day: number): number {
  return new Date(day).getUTCDay();
}

/** Day of the month, 1–31. */
export function dateOfMonth(day: number): number {
  return new Date(day).getUTCDate();
}

/** Where a task stands on `today` (a day, from `dayOf`). */
export function taskStatus(task: ScheduleTaskLike, today: number): TaskStatus {
  if (task.doneAt !== undefined) return "done";
  if (task.end < today) return "overdue";
  if (task.start <= today) return "active";
  return "upcoming";
}

/** Does the task touch any day in the range? */
export function overlaps(task: ScheduleTaskLike, range: DayRange): boolean {
  return task.start <= range.to && task.end >= range.from;
}

/**
 * The whole season's span: every task and event, and today, with a few days
 * either side so nothing sits on the edge. Events are moments (a local
 * midnight from Settings), so they're turned into days here.
 */
export function chartRange(
  tasks: ScheduleTaskLike[],
  milestones: { date: number }[],
  today: number,
  pad = 3,
): DayRange {
  const days = [
    today,
    ...tasks.flatMap((t) => [t.start, t.end]),
    ...milestones.map((m) => dayOf(m.date)),
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
  return { from: addDays(today, -before), to: addDays(today, after) };
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
    timeZone: "UTC",
  });
}

/** "Mar", for the month a day is in. */
export function formatMonth(day: number): string {
  return new Date(day).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
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
