import { describe, expect, it } from "vitest";
import {
  daysUntil,
  fromDateInputValue,
  isOverdue,
  priorityLabel,
  statusLabel,
  toDateInputValue,
} from "./pm";

describe("pm helpers", () => {
  it("maps status and priority values to labels", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("done")).toBe("Done");
    expect(priorityLabel("high")).toBe("High");
    expect(priorityLabel("low")).toBe("Low");
  });

  it("flags overdue tasks only when past due and not done", () => {
    const past = Date.now() - 86_400_000;
    const future = Date.now() + 86_400_000;
    expect(isOverdue({ dueDate: past, status: "todo" })).toBe(true);
    expect(isOverdue({ dueDate: past, status: "done" })).toBe(false);
    expect(isOverdue({ dueDate: future, status: "todo" })).toBe(false);
    expect(isOverdue({ dueDate: undefined, status: "todo" })).toBe(false);
  });

  it("round-trips date input values", () => {
    const ts = fromDateInputValue("2026-07-10");
    expect(ts).toBeTypeOf("number");
    expect(toDateInputValue(ts)).toBe("2026-07-10");
    expect(fromDateInputValue("")).toBeUndefined();
    expect(toDateInputValue(undefined)).toBe("");
  });

  it("counts whole days until a future timestamp", () => {
    const inThreeDays = Date.now() + 3 * 86_400_000;
    expect(daysUntil(inThreeDays)).toBeGreaterThanOrEqual(2);
    expect(daysUntil(inThreeDays)).toBeLessThanOrEqual(3);
  });
});
