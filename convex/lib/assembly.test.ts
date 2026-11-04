import { describe, expect, test } from "vitest";
import {
  blockingSummary,
  buildAssemblyInput,
  computeAssemblyStatuses,
  groupMemberRefs,
  isSafeDrawingUrl,
  wouldCycle,
  type AssemblyInput,
  type AssemblyMember,
  rollUpDemand,
  findShortfalls,
  type DemandAssembly,
  remainingFor,
  findUnderbuilt,
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
  // Two roller assemblies get built, each using two end caps and one shaft.
  const robot: DemandAssembly = {
    id: "robot",
    placements: [{ refId: "roller", kind: "child", quantity: 2 }],
  };
  const roller: DemandAssembly = {
    id: "roller",
    needed: 2,
    placements: [
      { refId: "endcap", kind: "part", quantity: 2 },
      { refId: "shaft", kind: "part" },
    ],
  };

  test("an assembly builds as many as it says it does", () => {
    const { units } = rollUpDemand([robot, roller]);
    expect(units.get("robot")).toBe(1);
    expect(units.get("roller")).toBe(2);
  });

  test("parts multiply by how many of their assembly get built", () => {
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
    expect(rollUpDemand([left, right]).perRef.get("endcap")).toBe(4);
  });

  test("spares are whole extra units, and their parts come with them", () => {
    const { units, perRef } = rollUpDemand([
      robot,
      { ...roller, needed: 2, spares: 1 },
    ]);
    expect(units.get("roller")).toBe(3);
    expect(perRef.get("endcap")).toBe(6);
  });

  test("a missing quantity means one, and a missing count means one unit", () => {
    const { units, perRef } = rollUpDemand([
      { id: "a", placements: [{ refId: "bolt", kind: "part" }] },
    ]);
    expect(units.get("a")).toBe(1);
    expect(perRef.get("bolt")).toBe(1);
  });

  test("bought items are counted the same as parts", () => {
    const { perRef } = rollUpDemand([
      {
        id: "roller",
        needed: 2,
        placements: [{ refId: "bearing", kind: "cots", quantity: 4 }],
      },
    ]);
    expect(perRef.get("bearing")).toBe(8);
  });

  test("it remembers which assembly asked for what", () => {
    const { perRefByAssembly } = rollUpDemand([
      {
        id: "left",
        placements: [{ refId: "endcap", kind: "part", quantity: 2 }],
      },
      { id: "right", placements: [{ refId: "endcap", kind: "part" }] },
    ]);
    const byAssembly = perRefByAssembly.get("endcap")!;
    expect(byAssembly.get("left")).toBe(2);
    expect(byAssembly.get("right")).toBe(1);
  });
});

describe("what's left of a part to go round", () => {
  const assemblies: DemandAssembly[] = [
    {
      id: "left",
      placements: [{ refId: "endcap", kind: "part", quantity: 2 }],
    },
    {
      id: "right",
      placements: [{ refId: "endcap", kind: "part", quantity: 1 }],
    },
  ];

  test("leaves room for what everything else already took", () => {
    // Six planned, the right roller has one: five left for the left roller.
    const demand = rollUpDemand(assemblies);
    expect(remainingFor(demand, "endcap", "left", 6)).toBe(5);
  });

  test("divides the allowance by how many of this one get built", () => {
    // Two of this assembly get built, so each may use two of the six.
    const demand = rollUpDemand([
      {
        id: "left",
        needed: 2,
        placements: [{ refId: "endcap", kind: "part" }],
      },
    ]);
    expect(remainingFor(demand, "endcap", "left", 6)).toBe(3);
  });

  test("never goes negative when the plan is already oversubscribed", () => {
    const demand = rollUpDemand(assemblies);
    expect(remainingFor(demand, "endcap", "left", 0)).toBe(0);
  });

  test("a part nothing else uses is limited only by the plan", () => {
    const demand = rollUpDemand(assemblies);
    expect(remainingFor(demand, "bolt", "left", 4)).toBe(4);
  });
});

describe("an assembly nobody is building enough of", () => {
  test("spots the count and the placements disagreeing", () => {
    // The robot wants two rollers; the roller is set to build one.
    const under = findUnderbuilt([
      {
        id: "robot",
        placements: [{ refId: "roller", kind: "child", quantity: 2 }],
      },
      { id: "roller", needed: 1, placements: [] },
    ]);
    expect(under).toEqual([{ assemblyId: "roller", placed: 2, building: 1 }]);
  });

  test("stays quiet when the count covers the placements", () => {
    expect(
      findUnderbuilt([
        {
          id: "robot",
          placements: [{ refId: "roller", kind: "child", quantity: 2 }],
        },
        { id: "roller", needed: 2, placements: [] },
      ]),
    ).toEqual([]);
  });

  test("counts a child placed in an assembly that is itself built twice", () => {
    // Two arms, one roller in each: two rollers.
    const under = findUnderbuilt([
      {
        id: "arm",
        needed: 2,
        placements: [{ refId: "roller", kind: "child" }],
      },
      { id: "roller", needed: 1, placements: [] },
    ]);
    expect(under[0]).toMatchObject({ placed: 2, building: 1 });
  });

  test("spares count towards covering the placements", () => {
    expect(
      findUnderbuilt([
        {
          id: "robot",
          placements: [{ refId: "roller", kind: "child", quantity: 2 }],
        },
        { id: "roller", needed: 1, spares: 1, placements: [] },
      ]),
    ).toEqual([]);
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
      needed: 2,
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

describe("building the readiness input", () => {
  const header = {
    id: "a1",
    number: "27-INT-001",
    name: "Roller",
    order: 1,
    completed: false,
  };

  test("groups member rows by the assembly holding them", () => {
    const refs = groupMemberRefs([
      { subAssemblyId: "a1", partId: "p1" },
      { subAssemblyId: "a1", cotsItemId: "c1" },
      { subAssemblyId: "a1", childSubAssemblyId: "a2" },
      { subAssemblyId: "a2", partId: "p2" },
    ]);
    expect(refs.get("a1")).toEqual({
      partIds: ["p1"],
      cotsItemIds: ["c1"],
      childIds: ["a2"],
    });
    expect(refs.get("a2")?.partIds).toEqual(["p2"]);
  });

  test("a bought item holds the build up until it arrives", () => {
    const refs = { partIds: [], cotsItemIds: ["c1"], childIds: [] };
    const waiting = buildAssemblyInput(
      header,
      refs,
      new Map(),
      new Map([["c1", { name: "Motor", status: "ordered" }]]),
    );
    expect(computeAssemblyStatuses([waiting])[0].ready).toBe(false);

    const here = buildAssemblyInput(
      header,
      refs,
      new Map(),
      new Map([["c1", { name: "Motor", status: "arrived" }]]),
    );
    expect(computeAssemblyStatuses([here])[0].ready).toBe(true);
  });

  test("a member it can't find holds the build up rather than counting as there", () => {
    const input = buildAssemblyInput(
      header,
      { partIds: ["gone"], cotsItemIds: ["gone too"], childIds: [] },
      new Map(),
      new Map(),
    );
    const [status] = computeAssemblyStatuses([input]);
    expect(status.ready).toBe(false);
    expect(status.blocking).toHaveLength(2);
  });

  test("an assembly with no members at all is ready", () => {
    const input = buildAssemblyInput(header, undefined, new Map(), new Map());
    expect(computeAssemblyStatuses([input])[0].ready).toBe(true);
  });
});
