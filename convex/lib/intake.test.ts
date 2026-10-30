import { describe, expect, test } from "vitest";
import {
  classifyAssemblyLine,
  classifyLine,
  classifyRelease,
  parseBomCsv,
  parseManualNumbers,
  splitCsvLine,
  type KnownPart,
} from "./intake";

const inDesign: KnownPart = {
  partNumber: "27-INT-104",
  stage: 1,
  qtyMade: 0,
  revision: "A",
};

describe("matching a release against the board", () => {
  test("a number we issued, still in design, simply moves along", () => {
    const line = classifyLine(
      { partNumber: "27-INT-104", name: "Intake Side Plate", revision: "A" },
      inDesign,
    );
    expect(line.kind).toBe("matched");
  });

  test("a re-release before anyone made it only dates the drawing", () => {
    const line = classifyLine(
      { partNumber: "27-INT-104", name: "Intake Side Plate", revision: "B" },
      { ...inDesign, stage: 2 },
    );
    expect(line.kind).toBe("matched");
    expect(line.explanation).toMatch(/out of date/i);
  });

  test("a re-release after some were made needs a lead", () => {
    const line = classifyLine(
      { partNumber: "27-DRV-031", name: "Bumper Bracket", revision: "C" },
      { partNumber: "27-DRV-031", stage: 3, qtyMade: 4, revision: "B" },
    );
    expect(line.kind).toBe("changed");
    expect(line.explanation).toMatch(/4 were already made/);
  });

  test("a number we never issued is a question, not a part", () => {
    expect(
      classifyLine({ partNumber: "99-XXX-001", name: "Mystery" }, undefined)
        .kind,
    ).toBe("unknown");
  });

  test("anything the release didn't mention has been removed", () => {
    const lines = classifyRelease(
      [{ partNumber: "27-INT-104", name: "Intake Side Plate", revision: "A" }],
      [inDesign, { partNumber: "27-INT-108", stage: 1, qtyMade: 0 }],
      { detectRemoved: true },
    );
    const removed = lines.filter((l) => l.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].partNumber).toBe("27-INT-108");
    expect(removed[0].explanation).toMatch(/nobody started it/i);
  });

  test("something half-made that disappears is flagged, not quietly archived", () => {
    const lines = classifyRelease(
      [],
      [{ partNumber: "27-INT-108", stage: 3, qtyMade: 2 }],
      { detectRemoved: true },
    );
    expect(lines[0].explanation).toMatch(/work has already gone into it/i);
  });
});

describe("the manual ways in", () => {
  test("numbers typed one per line, with or without a revision", () => {
    expect(parseManualNumbers("27-INT-104 B\n27-INT-110\n")).toEqual([
      { partNumber: "27-INT-104", name: "27-INT-104", revision: "B" },
      { partNumber: "27-INT-110", name: "27-INT-110", revision: undefined },
    ]);
  });

  test("a BOM export, however its columns are spelled", () => {
    const csv = [
      "Part number,Name,Revision,Quantity",
      "27-INT-104,Intake Side Plate,B,2",
      '27-INT-110,"Roller Shaft, long",A,3',
    ].join("\n");
    expect(parseBomCsv(csv)).toEqual([
      {
        partNumber: "27-INT-104",
        name: "Intake Side Plate",
        revision: "B",
        quantity: 2,
      },
      {
        partNumber: "27-INT-110",
        name: "Roller Shaft, long",
        revision: "A",
        quantity: 3,
      },
    ]);
  });

  test("a BOM with no part-number column can't be matched", () => {
    expect(parseBomCsv("Name,Quantity\nSide plate,2")).toEqual([]);
  });

  test("quoted commas stay inside their field", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });
});

describe("matching a released assembly", () => {
  const known = {
    partNumber: "27-INT-000",
    revision: "A",
    built: false,
  };

  test("a number the tracker issued is matched", () => {
    const line = classifyAssemblyLine(
      { partNumber: "27-INT-000", name: "Intake" },
      known,
    );
    expect(line.kind).toBe("matched");
  });

  test("one it didn't issue is a question for a lead", () => {
    const line = classifyAssemblyLine(
      { partNumber: "99-XXX-000", name: "Mystery" },
      undefined,
    );
    expect(line.kind).toBe("unknown");
    expect(line.explanation).toMatch(/isn't a sub-assembly/);
  });

  test("re-released after it was built needs a decision", () => {
    const line = classifyAssemblyLine(
      { partNumber: "27-INT-000", name: "Intake", revision: "B" },
      { ...known, built: true },
    );
    expect(line.kind).toBe("changed");
    expect(line.explanation).toMatch(/already built/);
  });

  test("re-released before anyone built it just updates", () => {
    const line = classifyAssemblyLine(
      { partNumber: "27-INT-000", name: "Intake", revision: "B" },
      known,
    );
    expect(line.kind).toBe("matched");
  });
});
