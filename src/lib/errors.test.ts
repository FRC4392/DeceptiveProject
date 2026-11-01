import { describe, expect, test } from "vitest";
import { errorText } from "./errors";

describe("the sentence a mutation meant to show you", () => {
  test("pulls it out of Convex's wrapper", () => {
    const err = new Error(
      "[CONVEX M(subsystems:setNextNumber)] [Request ID: 0dfc4c6c] Server Error\nUncaught Error: This subsystem is already up to 15, and a number is never reused. Pick 15 or higher. at handler (../convex/subsystems.ts:275:8)\n  Called by client",
    );
    expect(errorText(err, "No luck.")).toBe(
      "This subsystem is already up to 15, and a number is never reused. Pick 15 or higher.",
    );
  });

  test("prefers ConvexError's own payload", () => {
    const err = Object.assign(new Error("[CONVEX M(x)] Server Error …"), {
      data: "Only 1 of that left.",
    });
    expect(errorText(err, "No luck.")).toBe("Only 1 of that left.");
  });

  test("leaves an ordinary message alone", () => {
    expect(errorText(new Error("Write something first."), "No luck.")).toBe(
      "Write something first.",
    );
  });

  test("falls back when there's nothing to show", () => {
    expect(errorText(undefined, "No luck.")).toBe("No luck.");
    expect(errorText({}, "No luck.")).toBe("No luck.");
    expect(errorText(new Error("[CONVEX M(x)] Server Error"), "No luck.")).toBe(
      "No luck.",
    );
  });
});
