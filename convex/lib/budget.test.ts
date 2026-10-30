import { describe, expect, test } from "vitest";
import {
  blockedReason,
  isCallAllowed,
  modeForShare,
  type BudgetMode,
  type CallPurpose,
} from "./budget";

describe("what each mode allows", () => {
  const table: Array<[BudgetMode, CallPurpose, boolean]> = [
    ["normal", "release", true],
    ["normal", "sync", true],
    ["normal", "admin", true],
    ["lean", "release", true],
    ["lean", "sync", false],
    ["lean", "admin", true],
    ["manual", "release", false],
    ["manual", "sync", false],
    ["manual", "admin", true],
  ];

  test.each(table)("%s mode, %s call → %s", (mode, purpose, allowed) => {
    expect(isCallAllowed(mode, purpose)).toBe(allowed);
  });

  test("lean keeps the cheap automatic path and drops the expensive one", () => {
    // This is the whole point of lean: one call per release still runs, one
    // call per part does not.
    expect(isCallAllowed("lean", "release")).toBe(true);
    expect(isCallAllowed("lean", "sync")).toBe(false);
  });

  test("manual never traps the team in manual", () => {
    // Turning the integration off costs one call. Refusing it would mean a
    // mentor couldn't stop the thing that spent the budget.
    expect(isCallAllowed("manual", "admin")).toBe(true);
  });
});

describe("telling someone why", () => {
  test("an allowed call has nothing to explain", () => {
    expect(blockedReason("normal", "sync")).toBeNull();
    expect(blockedReason("lean", "release")).toBeNull();
  });

  test("every refusal says what still works", () => {
    expect(blockedReason("lean", "sync")).toMatch(/releases still come in/i);
    expect(blockedReason("manual", "sync")).toMatch(/type the numbers in/i);
    expect(blockedReason("manual", "release")).toMatch(/reconcile/i);
  });
});

describe("picking a mode from what's left", () => {
  test("plenty left is normal", () => {
    expect(modeForShare(1, 0.3, 0.1)).toBe("normal");
    expect(modeForShare(0.3, 0.3, 0.1)).toBe("normal");
  });

  test("under the lean threshold is lean", () => {
    expect(modeForShare(0.29, 0.3, 0.1)).toBe("lean");
    expect(modeForShare(0.1, 0.3, 0.1)).toBe("lean");
  });

  test("under the manual threshold is manual", () => {
    expect(modeForShare(0.09, 0.3, 0.1)).toBe("manual");
    expect(modeForShare(0, 0.3, 0.1)).toBe("manual");
  });
});
