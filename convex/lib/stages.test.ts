import { describe, expect, test } from "vitest";
import {
  advanceLabel,
  canAdvance,
  canClaim,
  canMoveTo,
  formatPartNumber,
  isStageSkipped,
  nextStage,
  normalizePartNumber,
  partNumberMatches,
  stagePath,
  type Actor,
} from "./stages";

const MILL = { needsDrawing: true, needsFinishing: true, machineId: "m_mill" };
const PRINT = { needsDrawing: false, needsFinishing: false, machineId: "m_p" };

const PART = { subsystemId: "sub_int", qtyMade: 2, qtyNeeded: 2 };

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    role: "student",
    trainedMachineIds: [],
    ledSubsystemIds: [],
    ...overrides,
  };
}

describe("which stages a part passes through", () => {
  test("a milled part walks all six", () => {
    expect(stagePath(MILL)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("a 3D print skips the drawing and the finishing", () => {
    expect(stagePath(PRINT)).toEqual([1, 3, 5, 6]);
    expect(isStageSkipped(2, PRINT)).toBe(true);
    expect(isStageSkipped(4, PRINT)).toBe(true);
    expect(nextStage(1, PRINT)).toBe(3);
    expect(nextStage(3, PRINT)).toBe(5);
  });

  test("the button says where the part is going", () => {
    expect(advanceLabel(3, MILL)).toBe("Done making → Ready to finish");
    expect(advanceLabel(3, PRINT)).toBe("Done making → Ready to assemble");
    expect(advanceLabel(6, MILL)).toBeNull();
  });
});

describe("who may move a part on", () => {
  test("a student can't wave a drawing through", () => {
    const result = canAdvance(2, MILL, PART, actor());
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(/design lead/i);
  });

  test("a lead can", () => {
    expect(canAdvance(2, MILL, PART, actor({ role: "lead" })).allowed).toBe(
      true,
    );
  });

  test("making needs a sign-off on that machine", () => {
    const untrained = canAdvance(3, MILL, PART, actor());
    expect(untrained.allowed).toBe(false);
    expect(untrained.allowed === false && untrained.reason).toMatch(
      /signed off/i,
    );
    expect(
      canAdvance(3, MILL, PART, actor({ trainedMachineIds: ["m_mill"] }))
        .allowed,
    ).toBe(true);
  });

  test("you can't call it made before you've made them all", () => {
    const short = canAdvance(
      3,
      MILL,
      { ...PART, qtyMade: 1 },
      actor({ trainedMachineIds: ["m_mill"] }),
    );
    expect(short.allowed).toBe(false);
    expect(short.allowed === false && short.reason).toMatch(/Record all 2/);
  });

  test("anyone can finish a part", () => {
    expect(canAdvance(4, MILL, PART, actor()).allowed).toBe(true);
  });

  test("only the subsystem lead or a mentor says it's on the robot", () => {
    expect(canAdvance(5, MILL, PART, actor({ role: "lead" })).allowed).toBe(
      false,
    );
    expect(
      canAdvance(5, MILL, PART, actor({ ledSubsystemIds: ["sub_int"] }))
        .allowed,
    ).toBe(true);
    expect(canAdvance(5, MILL, PART, actor({ role: "mentor" })).allowed).toBe(
      true,
    );
  });

  test("moving backwards is a lead's call", () => {
    expect(canMoveTo(4, 2, MILL, PART, actor()).allowed).toBe(false);
    expect(canMoveTo(4, 2, MILL, PART, actor({ role: "mentor" })).allowed).toBe(
      true,
    );
  });
});

describe("claiming", () => {
  test("only when there's something to do", () => {
    expect(canClaim(1, MILL, actor({ role: "lead" })).allowed).toBe(false);
    expect(canClaim(4, MILL, actor()).allowed).toBe(true);
  });

  test("a machine you're not signed off on stays out of reach", () => {
    expect(canClaim(3, MILL, actor()).allowed).toBe(false);
    expect(
      canClaim(3, MILL, actor({ trainedMachineIds: ["m_mill"] })).allowed,
    ).toBe(true);
  });
});

describe("part numbers", () => {
  test("built from the season, the subsystem and the sequence", () => {
    expect(formatPartNumber("27", "INT", 104)).toBe("27-INT-104");
    expect(formatPartNumber("27", "DRV", 0)).toBe("27-DRV-000");
  });

  test("search forgives however someone types it", () => {
    for (const typed of [
      "27-INT-104",
      "int-104",
      "INT104",
      "104",
      "27int104",
    ]) {
      expect(partNumberMatches(typed, "27-INT-104")).toBe(true);
    }
    expect(partNumberMatches("105", "27-INT-104")).toBe(false);
    expect(normalizePartNumber(" 27-int-104 ")).toBe("27INT104");
  });
});
