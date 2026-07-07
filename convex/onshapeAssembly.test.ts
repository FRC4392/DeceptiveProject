import { describe, expect, test } from "vitest";
import {
  aggregateAssemblyParts,
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
        occurrences: [
          { path: ["i1"] },
          { path: ["i2"] },
          { path: ["i3"] },
        ],
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

  test("skips standard content (fasteners) and suppressed instances", () => {
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
        occurrences: [
          { path: ["i1"] },
          { path: ["bolt"] },
          { path: ["sup"] },
        ],
      },
    };
    const parts = aggregateAssemblyParts(def, DOC);
    expect(parts).toHaveLength(1);
    expect(parts[0].partId).toBe("P1");
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
          { id: "a", type: "Part", name: "A <1>", partId: "JHD", documentId: DOC, elementId: "ps1" },
          { id: "b", type: "Part", name: "B <1>", partId: "JHD", documentId: DOC, elementId: "ps2" },
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
