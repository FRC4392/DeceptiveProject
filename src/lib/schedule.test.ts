import { describe, expect, it } from "vitest";
import {
  addDays,
  chartRange,
  dayFromInputValue,
  dayOf,
  daysBetween,
  dragResult,
  overlaps,
  taskStatus,
  toDateInputValue,
  windowAround,
} from "./schedule";

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("days", () => {
  it("are calendar dates: exactly a day apart, whatever the clocks do", () => {
    // 14 March 2027 is when US clocks go forward; it makes no difference.
    expect(addDays(day(2027, 3, 13), 2)).toBe(day(2027, 3, 15));
    expect(daysBetween(day(2027, 3, 1), day(2027, 4, 1))).toBe(31);
  });

  it("go to and from a date input", () => {
    expect(toDateInputValue(day(2027, 3, 5))).toBe("2027-03-05");
    expect(dayFromInputValue("2027-03-05")).toBe(day(2027, 3, 5));
    expect(dayFromInputValue("")).toBeUndefined();
    expect(dayFromInputValue("2027-3-5")).toBeUndefined();
  });

  it("take today from this browser's own calendar", () => {
    // Late evening locally is still that day, wherever UTC has got to.
    const lateEvening = new Date(2027, 2, 5, 23, 30).getTime();
    expect(dayOf(lateEvening)).toBe(day(2027, 3, 5));
  });
});

describe("taskStatus", () => {
  const task = { start: day(2027, 3, 1), end: day(2027, 3, 7) };

  it("is upcoming before the first day, active from it to the last, and overdue after", () => {
    expect(taskStatus(task, day(2027, 2, 28))).toBe("upcoming");
    expect(taskStatus(task, day(2027, 3, 1))).toBe("active");
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
