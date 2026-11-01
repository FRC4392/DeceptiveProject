import { describe, expect, test } from "vitest";
import {
  classifyAssemblyLine,
  classifyLine,
  classifyRelease,
  parseBomCsv,
  parseManualNumbers,
  splitCsvLine,
  type KnownBoughtItem,
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

  test("the team's own BOM header carries the vendor through", () => {
    const lines = parseBomCsv(
      "Item,Quantity,Name,Vendor,Part Number,Revision\n" +
        "1,4,Compliant wheel,AndyMark,am-3104,B",
    );
    expect(lines).toEqual([
      {
        name: "Compliant wheel",
        partNumber: "am-3104",
        revision: "B",
        quantity: 4,
        vendor: "AndyMark",
      },
    ]);
  });

  test("a hardware row with no number still arrives, if it names a vendor", () => {
    // Blank Part Number is normal for bought hardware, and dropping the row
    // meant the one thing the team can only buy never reached the queue.
    const lines = parseBomCsv(
      "Quantity,Name,Vendor,Part Number\n40,M4 bolt,McMaster,",
    );
    expect(lines).toEqual([
      { name: "M4 bolt", vendor: "McMaster", quantity: 40 },
    ]);
  });

  test("a row that is neither numbered nor sold by anyone is skipped", () => {
    expect(
      parseBomCsv("Quantity,Name,Vendor,Part Number\n,Subtotal,,"),
    ).toEqual([]);
  });

  test("quoted commas stay inside their field", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });
});

describe("matching a release against the Ordering board", () => {
  const onOrder: KnownBoughtItem = {
    vendorPartNumber: "am-3104",
    name: 'Compliant wheel, 2"',
    status: "ordered",
  };

  test("a vendor number the board already holds is matched, not new", () => {
    const [line] = classifyRelease(
      [{ partNumber: "AM-3104", name: "Compliant wheel" }],
      [],
      { bought: [onOrder] },
    );
    expect(line.kind).toBe("matched");
    expect(line.target).toBe("cotsItem");
  });

  test("the explanation says where it's got to, so nobody re-buys it", () => {
    const [line] = classifyRelease(
      [{ partNumber: "am-3104", name: "Compliant wheel" }],
      [],
      { bought: [onOrder] },
    );
    expect(line.explanation).toMatch(/on order/i);
    const [arrived] = classifyRelease(
      [{ partNumber: "am-3104", name: "Compliant wheel" }],
      [],
      { bought: [{ ...onOrder, status: "arrived" }] },
    );
    expect(arrived.explanation).toMatch(/in the shop/i);
  });

  test("a part wins a number a bought item also claims", () => {
    // Only reachable if a vendor's number happens to look like one of ours,
    // and the part is still the right answer.
    const [line] = classifyRelease(
      [{ partNumber: "27-INT-104", name: "Intake Side Plate", revision: "A" }],
      [inDesign],
      {
        bought: [{ ...onOrder, vendorPartNumber: "27-INT-104" }],
      },
    );
    expect(line.kind).toBe("matched");
    expect(line.target).toBe("part");
  });

  test("a number neither side knows is still a question for a lead", () => {
    const [line] = classifyRelease(
      [{ partNumber: "99-XXX-001", name: "Mystery" }],
      [inDesign],
      { bought: [onOrder] },
    );
    expect(line.kind).toBe("unknown");
    expect(line.target).toBeUndefined();
  });

  test("a bought item the release didn't mention is not reported removed", () => {
    // Most bought items aren't in the CAD at all, so silence about one means
    // nothing. Only parts can go missing from an assembly.
    const lines = classifyRelease([], [], {
      bought: [onOrder],
      detectRemoved: true,
    });
    expect(lines).toEqual([]);
  });

  test("passing no bought items leaves part matching exactly as it was", () => {
    const [line] = classifyRelease(
      [{ partNumber: "27-INT-104", name: "Intake Side Plate", revision: "A" }],
      [inDesign],
    );
    expect(line.kind).toBe("matched");
    expect(line.explanation).toMatch(/moves out of design/i);
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
