import { describe, expect, test } from "vitest";
import { cotsStatusLabel } from "@/lib/cots";
import type { Doc } from "../../convex/_generated/dataModel";

const MARCH = new Date("2026-03-03T12:00:00").getTime();
const APRIL = new Date("2026-04-09T12:00:00").getTime();

function item(overrides: Partial<Doc<"cotsItems">>) {
  return { name: "Wheels", status: "needed", ...overrides } as Doc<"cotsItems">;
}

describe("what a bought item's chip says", () => {
  test("nothing to date before anyone buys it", () => {
    expect(cotsStatusLabel(item({ status: "needed" }))).toBe("Needed");
  });

  test("once ordered it says so with the date it was ordered", () => {
    // The date the move stamped — no one typed this in.
    expect(cotsStatusLabel(item({ status: "ordered", orderedAt: MARCH }))).toBe(
      "Ordered · Mar 3",
    );
  });

  test("says both when both are known", () => {
    // How long it's been on order is what tells you to chase it, and the
    // expected date alone doesn't answer that.
    expect(
      cotsStatusLabel(
        item({ status: "ordered", orderedAt: MARCH, eta: APRIL }),
      ),
    ).toBe("Ordered · Mar 3 · expected Apr 9");
  });

  test("an expected date with no order date still reads", () => {
    expect(cotsStatusLabel(item({ status: "ordered", eta: APRIL }))).toBe(
      "Ordered · expected Apr 9",
    );
  });

  test("once here it says when it landed", () => {
    expect(
      cotsStatusLabel(
        item({ status: "arrived", orderedAt: MARCH, arrivedAt: APRIL }),
      ),
    ).toBe("Arrived · Apr 9");
  });

  test("an old row with no stamps still reads sensibly", () => {
    expect(cotsStatusLabel(item({ status: "ordered" }))).toBe("Ordered");
    expect(cotsStatusLabel(item({ status: "arrived" }))).toBe("Arrived");
  });
});
