import { describe, expect, test } from "vitest";
import {
  aggregateAssemblyParts,
  rootSubAssemblies,
  type AssemblyDefinition,
} from "./lib/onshapeAssembly";

const DOC = "assemblyDoc";

// A part instance living in this document's Part Studio "psA".
function partInstance(id: string, partId: string, name: string) {
  return {
    id,
    type: "Part",
    name,
    partId,
    documentId: DOC,
    elementId: "psA",
  };
}

describe("aggregateAssemblyParts", () => {
  test("sums duplicate top-level instances of the same part", () => {
    const def: AssemblyDefinition = {
      rootAssembly: {
        instances: [
          partInstance("i1", "P1", "Bracket <1>"),
          partInstance("i2", "P1", "Bracket <2>"),
          partInstance("i3", "P2", "Standoff <1>"),
        ],
        occurrences: [{ path: ["i1"] }, { path: ["i2"] }, { path: ["i3"] }],
      },
    };
    const parts = aggregateAssemblyParts(def, DOC);
    const bracket = parts.find((p) => p.partId === "P1");
    const standoff = parts.find((p) => p.partId === "P2");
    expect(bracket?.quantity).toBe(2);
    expect(bracket?.name).toBe("Bracket"); // "<n>" suffix stripped
    expect(standoff?.quantity).toBe(1);
  });

  test("multiplies quantities through a subassembly instanced twice", () => {
    // Subassembly definition "sub" contains one part "PX". It is placed twice
    // (sa1, sa2), so PX's total quantity is 2.
    const def: AssemblyDefinition = {
      rootAssembly: {
        instances: [
          { id: "sa1", type: "Assembly", name: "Gearbox <1>" },
          { id: "sa2", type: "Assembly", name: "Gearbox <2>" },
        ],
        occurrences: [
          { path: ["sa1"] },
          { path: ["sa1", "px"] },
          { path: ["sa2"] },
          { path: ["sa2", "px"] },
        ],
      },
      subAssemblies: [
        {
          instances: [
            {
              id: "px",
              type: "Part",
              name: "Output shaft <1>",
              partId: "PX",
              documentId: DOC,
              elementId: "psGear",
            },
          ],
        },
      ],
    };
    const parts = aggregateAssemblyParts(def, DOC);
    expect(parts).toHaveLength(1);
    expect(parts[0].partId).toBe("PX");
    expect(parts[0].quantity).toBe(2);
    expect(parts[0].sourceElementId).toBe("psGear");
  });

  test("tags standard content and still skips suppressed instances", () => {
    const def: AssemblyDefinition = {
      rootAssembly: {
        instances: [
          partInstance("i1", "P1", "Plate <1>"),
          {
            id: "bolt",
            type: "Part",
            name: "M4 Bolt <1>",
            partId: "BOLT",
            documentId: DOC,
            elementId: "std",
            isStandardContent: true,
          },
          {
            id: "sup",
            type: "Part",
            name: "Old part <1>",
            partId: "OLD",
            documentId: DOC,
            elementId: "psA",
            suppressed: true,
          },
        ],
        occurrences: [{ path: ["i1"] }, { path: ["bolt"] }, { path: ["sup"] }],
      },
    };
    const parts = aggregateAssemblyParts(def, DOC);
    // The bolt comes through now — it's hardware somebody has to buy, and the
    // intake offers Buy it for exactly this. The suppressed part still never
    // existed as far as the assembly is concerned.
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.partId)).toEqual(["P1", "BOLT"]);
    expect(parts.find((p) => p.partId === "BOLT")?.standardContent).toBe(true);
    expect(parts.find((p) => p.partId === "P1")?.standardContent).toBe(false);
    expect(parts.some((p) => p.partId === "OLD")).toBe(false);
  });

  test("counts every placement of one fastener as a single line", () => {
    // A box of bolts is one thing to buy, not forty. The aggregator already
    // keys on elementId:partId, so this falls out of counting placements.
    const def: AssemblyDefinition = {
      rootAssembly: {
        instances: [
          {
            id: "bolt",
            type: "Part",
            name: "M4 Bolt <1>",
            partId: "BOLT",
            documentId: "other-doc",
            elementId: "std",
            isStandardContent: true,
          },
        ],
        occurrences: [
          { path: ["bolt"] },
          { path: ["bolt"] },
          { path: ["bolt"] },
        ],
      },
    };
    const parts = aggregateAssemblyParts(def, DOC);
    expect(parts).toHaveLength(1);
    expect(parts[0].quantity).toBe(3);
    expect(parts[0].standardContent).toBe(true);
    // Library content lives in Onshape's documents, so there is nothing of
    // ours to enrich it from.
    expect(parts[0].sameDocument).toBe(false);
  });

  test("flags parts sourced from another document as cross-document", () => {
    const def: AssemblyDefinition = {
      rootAssembly: {
        instances: [
          partInstance("i1", "P1", "Local plate <1>"),
          {
            id: "i2",
            type: "Part",
            name: "Linked part <1>",
            partId: "P9",
            documentId: "otherDoc",
            elementId: "psOther",
          },
        ],
        occurrences: [{ path: ["i1"] }, { path: ["i2"] }],
      },
    };
    const parts = aggregateAssemblyParts(def, DOC);
    expect(parts.find((p) => p.partId === "P1")?.sameDocument).toBe(true);
    const linked = parts.find((p) => p.partId === "P9");
    expect(linked?.sameDocument).toBe(false);
    expect(linked?.sourceDocumentId).toBe("otherDoc");
  });

  test("keeps parts with the same partId in different source elements distinct", () => {
    const def: AssemblyDefinition = {
      rootAssembly: {
        instances: [
          {
            id: "a",
            type: "Part",
            name: "A <1>",
            partId: "JHD",
            documentId: DOC,
            elementId: "ps1",
          },
          {
            id: "b",
            type: "Part",
            name: "B <1>",
            partId: "JHD",
            documentId: DOC,
            elementId: "ps2",
          },
        ],
        occurrences: [{ path: ["a"] }, { path: ["b"] }],
      },
    };
    const parts = aggregateAssemblyParts(def, DOC);
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.sourceElementId).sort()).toEqual(["ps1", "ps2"]);
  });

  test("returns empty for a definition with no rootAssembly", () => {
    expect(aggregateAssemblyParts({}, DOC)).toEqual([]);
  });
});

describe("the sub-assemblies placed directly inside one", () => {
  const def = {
    rootAssembly: {
      instances: [
        {
          id: "a",
          type: "Part",
          partId: "p1",
          elementId: "studio",
          documentId: "doc",
        },
        {
          id: "b",
          type: "Assembly",
          name: "Frame <1>",
          elementId: "frame",
          documentId: "doc",
        },
        {
          id: "c",
          type: "Assembly",
          name: "Frame <2>",
          elementId: "frame",
          documentId: "doc",
        },
        {
          id: "d",
          type: "Assembly",
          name: "Rollers",
          elementId: "rollers",
          documentId: "other",
        },
        {
          id: "e",
          type: "Assembly",
          name: "Hidden",
          elementId: "x",
          documentId: "doc",
          suppressed: true,
        },
      ],
      occurrences: [],
    },
  };

  test("one entry per child element, counting the placements", () => {
    const children = rootSubAssemblies(def, "doc");
    expect(children).toHaveLength(2);
    const frame = children.find((c) => c.elementId === "frame")!;
    expect(frame.quantity).toBe(2);
    expect(frame.name).toBe("Frame");
  });

  test("it keeps children from another document, with that document's id", () => {
    const rollers = rootSubAssemblies(def, "doc").find(
      (c) => c.elementId === "rollers",
    )!;
    expect(rollers.documentId).toBe("other");
  });

  test("parts and suppressed instances are not children", () => {
    const ids = rootSubAssemblies(def, "doc").map((c) => c.elementId);
    expect(ids).not.toContain("studio");
    expect(ids).not.toContain("x");
  });

  test("a Part Studio-shaped definition has none", () => {
    expect(rootSubAssemblies({}, "doc")).toEqual([]);
    expect(rootSubAssemblies({ rootAssembly: {} }, "doc")).toEqual([]);
  });
});

describe("an assembly definition in a shape we didn't expect", () => {
  // `type` is Onshape's JSON too. A release package sent a sibling field as
  // a number once, and `(x ?? "").toLowerCase()` only guards null — so this
  // is the same crash waiting on a different field.
  test("a non-string instance type is skipped, not fatal", () => {
    const def = {
      rootAssembly: {
        instances: [
          { id: "i1", type: 3 as never, elementId: "e1", documentId: "d1" },
          {
            id: "i2",
            type: "Part",
            elementId: "e2",
            documentId: "d1",
            partId: "p1",
          },
        ],
        occurrences: [{ path: ["i1"] }, { path: ["i2"] }],
      },
      subAssemblies: [],
    };

    const parts = aggregateAssemblyParts(def, "d1");

    expect(parts.map((p) => p.partId)).toEqual(["p1"]);
    expect(() => rootSubAssemblies(def, "d1")).not.toThrow();
  });

  test("a non-string name doesn't break the suffix strip", () => {
    const parts = aggregateAssemblyParts(
      {
        rootAssembly: {
          instances: [
            {
              id: "i1",
              type: "Part",
              elementId: "e1",
              documentId: "d1",
              partId: "p1",
              name: 42 as never,
            },
          ],
          occurrences: [{ path: ["i1"] }],
        },
        subAssemblies: [],
      },
      "d1",
    );

    // Not a crash, and it falls back to the usual placeholder rather than
    // carrying a number into a field the board renders.
    expect(parts[0].name).toBe("Onshape part");
  });
});
