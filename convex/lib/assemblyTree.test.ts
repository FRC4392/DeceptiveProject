import { describe, expect, test } from "vitest";
import {
  buildAssemblyTree,
  flattenAssemblyTree,
  type TreeRow,
} from "./assemblyTree";

/** Shorthand: an assembly, what's inside it, and how many of each. */
function row(
  id: string,
  childIds: string[] = [],
  extra: Partial<TreeRow> = {},
): TreeRow {
  return { id, childIds, ...extra };
}

describe("laying the tree out", () => {
  test("nests children under the assembly that holds them", () => {
    const tree = buildAssemblyTree([
      row("000", ["frame"], { isDefault: true }),
      row("frame", ["roller"]),
      row("roller"),
    ]);

    expect(tree.map((n) => n.id)).toEqual(["000"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["frame"]);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(["roller"]);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  test("a sub-assembly in two parents appears under both", () => {
    const tree = buildAssemblyTree([
      row("000", ["main", "spare"], { isDefault: true }),
      row("main", ["roller"]),
      row("spare", ["roller"]),
      row("roller"),
    ]);

    const rollers = flattenAssemblyTree(tree).filter((n) => n.id === "roller");
    expect(rollers).toHaveLength(2);
    // Keyed by where it sits, so React can tell the two rows apart.
    expect(new Set(rollers.map((n) => n.path)).size).toBe(2);
  });

  test("carries how many of it each parent takes", () => {
    const tree = buildAssemblyTree([
      row("000", ["main", "spare"], {
        isDefault: true,
        quantities: [{ refId: "main", quantity: 2 }],
      }),
      row("main"),
      row("spare"),
    ]);

    const [main, spare] = tree[0].children;
    expect(main.quantity).toBe(2);
    // Absent means one — the row only carries counts above one.
    expect(spare.quantity).toBeUndefined();
  });

  test("an assembly nothing holds is orphaned, but the 000 isn't", () => {
    const tree = buildAssemblyTree([
      row("000", [], { isDefault: true }),
      row("stray"),
    ]);

    const byId = new Map(tree.map((n) => [n.id, n]));
    expect(byId.get("000")?.orphan).toBe(false);
    expect(byId.get("stray")?.orphan).toBe(true);
  });

  test("a nested child is never orphaned", () => {
    const tree = buildAssemblyTree([
      row("000", ["frame"], { isDefault: true }),
      row("frame"),
    ]);

    expect(tree[0].children[0].orphan).toBe(false);
  });

  test("a loop is cut where it closes, and still shows", () => {
    // Two assemblies holding each other. The editor refuses this, but older
    // data might carry it and it mustn't hang or disappear.
    const tree = buildAssemblyTree([row("a", ["b"]), row("b", ["a"])]);

    const ids = flattenAssemblyTree(tree).map((n) => n.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    // Finite, which is the whole point.
    expect(ids.length).toBeLessThan(10);
  });

  test("a child that has been deleted is skipped", () => {
    const tree = buildAssemblyTree([
      row("000", ["gone", "frame"], { isDefault: true }),
      row("frame"),
    ]);

    expect(tree[0].children.map((n) => n.id)).toEqual(["frame"]);
  });

  test("the same assembly under one parent twice keys both rows", () => {
    const tree = buildAssemblyTree([
      row("000", ["roller", "roller"], { isDefault: true }),
      row("roller"),
    ]);

    const paths = tree[0].children.map((n) => n.path);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
  });

  test("an empty subsystem lays out as nothing", () => {
    expect(buildAssemblyTree([])).toEqual([]);
  });
});
