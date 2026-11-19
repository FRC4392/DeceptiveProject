import { describe, expect, it } from "vitest";
import {
  cascade,
  clashes,
  DAY_MS,
  wouldCycle,
  type DepTask,
} from "./scheduleDeps";

const D = (n: number) => n * DAY_MS;
const task = (
  id: string,
  start: number,
  end: number,
  dependsOn: string[] = [],
  done = false,
): DepTask => ({ id, start: D(start), end: D(end), dependsOn, done });

describe("cascade", () => {
  it("pushes a chain along when the first one slips", () => {
    const tasks = [
      task("a", 0, 6), // slipped from 0–4
      task("b", 5, 7, ["a"]),
      task("c", 8, 8, ["b"]),
    ];
    const out = cascade(tasks, ["a"]);
    expect(out.get("b")).toEqual({ start: D(7), end: D(9) });
    expect(out.get("c")).toEqual({ start: D(10), end: D(10) });
    expect(out.has("a")).toBe(false);
  });

  it("pulls it back when the first one finishes early", () => {
    const out = cascade([task("a", 0, 2), task("b", 5, 7, ["a"])], ["a"]);
    expect(out.get("b")).toEqual({ start: D(3), end: D(5) });
  });

  it("waits for the latest of several, and moves each task once", () => {
    // A diamond: d waits for b and c, which both wait for a.
    const out = cascade(
      [
        task("a", 0, 3),
        task("b", 2, 2, ["a"]),
        task("c", 2, 6, ["a"]),
        task("d", 4, 4, ["b", "c"]),
      ],
      ["a"],
    );
    expect(out.get("b")).toEqual({ start: D(4), end: D(4) });
    expect(out.get("c")).toEqual({ start: D(4), end: D(8) });
    expect(out.get("d")).toEqual({ start: D(9), end: D(9) });
  });

  it("leaves a moved task where it was put, unless asked to snap it", () => {
    const tasks = [task("a", 0, 4), task("b", 2, 3, ["a"])];
    expect(cascade(tasks, ["b"]).size).toBe(0);
    expect(cascade(tasks, ["b"], ["b"]).get("b")).toEqual({
      start: D(5),
      end: D(6),
    });
  });

  it("doesn't move a finished task, or what only it leads to", () => {
    const out = cascade(
      [task("a", 0, 9), task("b", 5, 6, ["a"], true), task("c", 7, 7, ["b"])],
      ["a"],
    );
    expect(out.size).toBe(0);
  });

  it("leaves alone what doesn't wait on the moved task", () => {
    const out = cascade(
      [task("a", 0, 9), task("x", 1, 1), task("y", 2, 2, ["x"])],
      ["a"],
    );
    expect(out.size).toBe(0);
  });
});

describe("wouldCycle", () => {
  const tasks = [
    task("a", 0, 0),
    task("b", 1, 1, ["a"]),
    task("c", 2, 2, ["b"]),
  ];
  it("spots a loop, however long", () => {
    expect(wouldCycle(tasks, "a", "c")).toBe(true);
    expect(wouldCycle(tasks, "a", "a")).toBe(true);
  });
  it("allows a link that goes forwards", () => {
    expect(wouldCycle(tasks, "c", "a")).toBe(false);
  });
});

describe("clashes", () => {
  it("names what hasn't finished by the time a task starts", () => {
    const a = task("a", 0, 4);
    const b = task("b", 3, 5, ["a"]);
    const byId = new Map([a, b].map((t) => [t.id, t]));
    expect(clashes(b, byId).map((t) => t.id)).toEqual(["a"]);
    expect(clashes({ ...b, start: D(5) }, byId)).toEqual([]);
    expect(clashes({ ...b, done: true }, byId)).toEqual([]);
  });
});
