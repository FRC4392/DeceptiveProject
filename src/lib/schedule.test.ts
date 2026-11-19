import { describe, expect, it } from "vitest";
import {
  addDays,
  chartRange,
  daysBetween,
  dragResult,
  overlaps,
  taskStatus,
  toDateInputValue,
  windowAround,
} from "./schedule";

const day = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).getTime();

describe("day arithmetic", () => {
  it("steps whole days, landing on midnight across a clock change", () => {
    // US clocks go forward on 14 March 2027 and back on 7 November; Europe's
    // on 28 March and 31 October. Whichever zone this runs in, every step
    // should land on a local midnight.
    for (const start of [day(2027, 3, 10), day(2027, 10, 28)]) {
      for (let n = 0; n < 14; n++) {
        const d = new Date(addDays(start, n));
        expect(d.getHours()).toBe(0);
        expect(daysBetween(start, d.getTime())).toBe(n);
      }
    }
  });

  it("formats a day for a date input", () => {
    expect(toDateInputValue(day(2027, 3, 5))).toBe("2027-03-05");
  });
});

describe("taskStatus", () => {
  const task = { start: day(2027, 3, 1), end: day(2027, 3, 7) };

  it("is upcoming before the first day, active from it to the last, and overdue after", () => {
    expect(taskStatus(task, day(2027, 2, 28))).toBe("upcoming");
    expect(taskStatus(task, day(2027, 3, 1))).toBe("active");
    // Any time on the last day still counts as that day.
    expect(taskStatus(task, day(2027, 3, 7) + 23 * 3_600_000)).toBe("active");
    expect(taskStatus(task, day(2027, 3, 8))).toBe("overdue");
  });

  it("is done once marked done, whatever the date", () => {
    expect(taskStatus({ ...task, doneAt: 1 }, day(2027, 4, 1))).toBe("done");
  });
});

describe("dragResult", () => {
  const task = { start: day(2027, 3, 1), end: day(2027, 3, 4) };

  it("moves both ends together", () => {
    expect(dragResult(task, "move", 3)).toEqual({
      start: day(2027, 3, 4),
      end: day(2027, 3, 7),
    });
  });

  it("resizes one end, never past the other", () => {
    expect(dragResult(task, "end", 2).end).toBe(day(2027, 3, 6));
    expect(dragResult(task, "end", -10)).toEqual({
      start: task.start,
      end: task.start,
    });
    expect(dragResult(task, "start", 10)).toEqual({
      start: task.end,
      end: task.end,
    });
  });
});

describe("ranges", () => {
  it("covers every task, event and today, at least four weeks wide", () => {
    const today = day(2027, 3, 10);
    const range = chartRange(
      [{ start: day(2027, 3, 12), end: day(2027, 3, 14) }],
      [{ date: day(2027, 3, 20) }],
      today,
    );
    expect(range.from).toBe(day(2027, 3, 7));
    expect(daysBetween(range.from, range.to)).toBeGreaterThanOrEqual(28);
    expect(range.to).toBeGreaterThanOrEqual(day(2027, 3, 20));
  });

  it("knows which tasks touch a window", () => {
    const weeks = windowAround(day(2027, 3, 10), 7, 35);
    expect(weeks.from).toBe(day(2027, 3, 3));
    expect(weeks.to).toBe(day(2027, 4, 14));
    expect(
      overlaps({ start: day(2027, 2, 1), end: day(2027, 3, 3) }, weeks),
    ).toBe(true);
    expect(
      overlaps({ start: day(2027, 2, 1), end: day(2027, 3, 2) }, weeks),
    ).toBe(false);
  });
});
