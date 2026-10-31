import { describe, expect, test } from "vitest";
import {
  blockingSummary,
  computeAssemblyStatuses,
  isSafeDrawingUrl,
  wouldCycle,
  type AssemblyInput,
  type AssemblyMember,
  rollUpDemand,
  findShortfalls,
  type DemandAssembly,
} from "./assembly";

function part(label: string, ready: boolean): AssemblyMember {
  return {
    kind: "part",
    label,
    stageLabel: ready ? "in the bin" : "ready to make",
    ready,
  };
}

function node(
  id: string,
  order: number,
  members: AssemblyMember[],
  childIds: string[] = [],
): AssemblyInput {
  return {
    id,
    number: `27-INT-00${order}`,
    name: `Assembly ${order}`,
    order,
    members,
    childIds,
  };
}

function statusOf(
  statuses: ReturnType<typeof computeAssemblyStatuses>,
  id: string,
) {
  return statuses.find((s) => s.id === id)!;
}

describe("whether a sub-assembly can go together", () => {
  test("everything in the bin means go", () => {
    const [status] = computeAssemblyStatuses([
      node("a", 1, [part("27-INT-001", true), part("27-INT-002", true)]),
    ]);
    expect(status.ready).toBe(true);
    expect(blockingSummary(status)).toBe("Everything's in the bin.");
  });

  test("it names the parts holding it up", () => {
    const [status] = computeAssemblyStatuses([
      node("a", 1, [part("27-INT-001", true), part("27-INT-002", false)]),
    ]);
    expect(status.ready).toBe(false);
    expect(blockingSummary(status)).toBe("27-INT-002 ready to make");
  });

  test("one holding nothing at all is ready", () => {
    const [status] = computeAssemblyStatuses([node("a", 1, [])]);
    expect(status.ready).toBe(true);
  });

  test("a long list is trimmed with a count of the rest", () => {
    const [status] = computeAssemblyStatuses([
      node(
        "a",
        1,
        ["1", "2", "3", "4", "5"].map((n) => part(`27-INT-00${n}`, false)),
      ),
    ]);
    expect(blockingSummary(status)).toContain("+2 more");
  });
});

describe("one sub-assembly inside another", () => {
  test("the parent waits while the child isn't built", () => {
    const statuses = computeAssemblyStatuses([
      node("child", 1, [part("27-INT-001", true)]),
      node("parent", 2, [part("27-INT-002", true)], ["child"]),
    ]);
    const parent = statusOf(statuses, "parent");
    expect(parent.ready).toBe(false);
    expect(blockingSummary(parent)).toBe("27-INT-001 Assembly 1 not built yet");
  });

  test("a child that is merely ready still blocks the parent", () => {
    // Everything in the child is in the bin, but nobody has built it — a pile
    // of parts is not a sub-assembly.
    const statuses = computeAssemblyStatuses([
      node("child", 1, [part("27-INT-001", true)]),
      node("parent", 2, [], ["child"]),
    ]);
    expect(statusOf(statuses, "child").ready).toBe(true);
    expect(statusOf(statuses, "child").done).toBe(false);
    expect(statusOf(statuses, "parent").ready).toBe(false);
  });

  test("building the child releases the parent", () => {
    const statuses = computeAssemblyStatuses([
      { ...node("child", 1, [part("27-INT-001", false)]), completed: true },
      node("parent", 2, [part("27-INT-002", true)], ["child"]),
    ]);
    expect(statusOf(statuses, "parent").ready).toBe(true);
  });

  test("a parent of nothing but finished children is good to go", () => {
    const statuses = computeAssemblyStatuses([
      { ...node("a", 1, []), completed: true },
      { ...node("b", 2, []), completed: true },
      node("parent", 3, [], ["a", "b"]),
    ]);
    expect(statusOf(statuses, "parent").ready).toBe(true);
  });

  test("the hold-up carries up three levels", () => {
    const statuses = computeAssemblyStatuses([
      node("grandchild", 1, [part("27-INT-001", false)]),
      node("child", 2, [], ["grandchild"]),
      node("parent", 3, [], ["child"]),
    ]);
    expect(statusOf(statuses, "parent").ready).toBe(false);
    expect(blockingSummary(statusOf(statuses, "parent"))).toContain(
      "not built yet",
    );
  });

  test("a missing part and an unbuilt child land in the same line", () => {
    const statuses = computeAssemblyStatuses([
      node("child", 1, []),
      node("parent", 2, [part("27-INT-009", false)], ["child"]),
    ]);
    expect(blockingSummary(statusOf(statuses, "parent"))).toBe(
      "27-INT-009 ready to make · 27-INT-001 Assembly 1 not built yet",
    );
  });

  test("a child that no longer exists is ignored, not fatal", () => {
    const [status] = computeAssemblyStatuses([
      node("a", 1, [part("27-INT-001", true)], ["deleted"]),
    ]);
    expect(status.ready).toBe(true);
  });

  test("two pointing at each other still render", () => {
    const statuses = computeAssemblyStatuses([
      node("a", 1, [], ["b"]),
      node("b", 2, [], ["a"]),
    ]);
    expect(statuses).toHaveLength(2);
  });

  test("a built one reads as done whatever its parts say now", () => {
    const [status] = computeAssemblyStatuses([
      { ...node("a", 1, [part("27-INT-001", false)]), completed: true },
    ]);
    expect(status.done).toBe(true);
    expect(blockingSummary(status)).toBe("Built and on the robot.");
  });
});

describe("refusing to put something inside itself", () => {
  const edges = new Map<string, string[]>([
    ["root", ["frame"]],
    ["frame", ["bracket"]],
    ["bracket", []],
  ]);

  test("inside itself", () => {
    expect(wouldCycle("frame", "frame", edges)).toBe(true);
  });

  test("inside its own child", () => {
    expect(wouldCycle("frame", "bracket", edges)).toBe(false);
    expect(wouldCycle("bracket", "frame", edges)).toBe(true);
  });

  test("inside its own grandchild", () => {
    expect(wouldCycle("bracket", "root", edges)).toBe(true);
  });

  test("a genuine sibling is fine", () => {
    const withSibling = new Map(edges);
    withSibling.set("rollers", []);
    expect(wouldCycle("root", "rollers", withSibling)).toBe(false);
  });

  test("an existing loop doesn't hang the check", () => {
    const looped = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    expect(wouldCycle("a", "b", looped)).toBe(true);
  });
});

describe("drawing links", () => {
  test("http and https get through", () => {
    expect(isSafeDrawingUrl("https://cad.onshape.com/documents/abc")).toBe(
      true,
    );
    expect(isSafeDrawingUrl("http://shop.local/drawings/1.pdf")).toBe(true);
  });

  test("anything that could run as script does not", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      expect(isSafeDrawingUrl(url)).toBe(false);
    }
  });
});

describe("multiplying the tree out", () => {
  // The robot: two roller assemblies, each two end caps and one shaft.
  const robot: DemandAssembly = {
    id: "robot",
    placements: [{ refId: "roller", kind: "child", quantity: 2 }],
  };
  const roller: DemandAssembly = {
    id: "roller",
    placements: [
      { refId: "endcap", kind: "part", quantity: 2 },
      { refId: "shaft", kind: "part" },
    ],
  };

  test("a top-level assembly is needed once", () => {
    expect(rollUpDemand([robot, roller]).units.get("robot")).toBe(1);
  });

  test("a sub-assembly is needed as many times as it is placed", () => {
    expect(rollUpDemand([robot, roller]).units.get("roller")).toBe(2);
  });

  test("parts multiply through both levels", () => {
    // Two per roller, two rollers: four.
    const { perRef } = rollUpDemand([robot, roller]);
    expect(perRef.get("endcap")).toBe(4);
    expect(perRef.get("shaft")).toBe(2);
  });

  test("a part shared by two assemblies adds up across both", () => {
    // The ordinary case this exists for: both rollers use the same end cap.
    const left: DemandAssembly = {
      id: "left",
      placements: [{ refId: "endcap", kind: "part", quantity: 2 }],
    };
    const right: DemandAssembly = {
      id: "right",
      placements: [{ refId: "endcap", kind: "part", quantity: 2 }],
    };
    const top: DemandAssembly = {
      id: "top",
      placements: [
        { refId: "left", kind: "child" },
        { refId: "right", kind: "child" },
      ],
    };
    expect(rollUpDemand([top, left, right]).perRef.get("endcap")).toBe(4);
  });

  test("spares are whole extra units, and their parts come with them", () => {
    const { units, perRef } = rollUpDemand([robot, { ...roller, spares: 1 }]);
    expect(units.get("roller")).toBe(3);
    expect(perRef.get("endcap")).toBe(6);
  });

  test("a missing quantity means one", () => {
    const { perRef } = rollUpDemand([
      { id: "a", placements: [{ refId: "bolt", kind: "part" }] },
    ]);
    expect(perRef.get("bolt")).toBe(1);
  });

  test("bought items are counted the same as parts", () => {
    const { perRef } = rollUpDemand([
      robot,
      {
        ...roller,
        placements: [{ refId: "bearing", kind: "cots", quantity: 4 }],
      },
    ]);
    expect(perRef.get("bearing")).toBe(8);
  });

  test("a loop doesn't hang the readout", () => {
    const a: DemandAssembly = {
      id: "a",
      placements: [{ refId: "b", kind: "child" }],
    };
    const b: DemandAssembly = {
      id: "b",
      placements: [
        { refId: "a", kind: "child" },
        { refId: "bolt", kind: "part" },
      ],
    };
    expect(() => rollUpDemand([a, b])).not.toThrow();
  });
});

describe("spotting a shortfall", () => {
  const demand = rollUpDemand([
    {
      id: "robot",
      placements: [{ refId: "roller", kind: "child", quantity: 2 }],
    },
    {
      id: "roller",
      placements: [{ refId: "endcap", kind: "part", quantity: 2 }],
    },
  ]);

  test("says so when the plan doesn't cover the robot", () => {
    const short = findShortfalls(demand, new Map([["endcap", 2]]));
    expect(short).toEqual([{ refId: "endcap", needed: 4, planned: 2 }]);
  });

  test("stays quiet when there are enough", () => {
    expect(findShortfalls(demand, new Map([["endcap", 4]]))).toEqual([]);
    expect(findShortfalls(demand, new Map([["endcap", 10]]))).toEqual([]);
  });

  test("ignores anything the tree doesn't know about", () => {
    // A part nobody has put in an assembly yet isn't short, it's unplaced.
    expect(findShortfalls(demand, new Map([["spare-bolt", 0]]))).toEqual([]);
  });

  test("worst gap first, so the lead reads the real problem", () => {
    const wide = rollUpDemand([
      {
        id: "robot",
        placements: [
          { refId: "a", kind: "part", quantity: 10 },
          { refId: "b", kind: "part", quantity: 3 },
        ],
      },
    ]);
    const short = findShortfalls(
      wide,
      new Map([
        ["a", 9],
        ["b", 0],
      ]),
    );
    expect(short.map((s) => s.refId)).toEqual(["b", "a"]);
  });
});
