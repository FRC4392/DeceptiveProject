import { describe, expect, it } from "vitest";
import { inferMethodFromMaterial } from "./inferMethod";

describe("inferMethodFromMaterial", () => {
  it("detects 3D-print materials", () => {
    expect(inferMethodFromMaterial("3D Printed ONYX")).toBe("3d_print");
    expect(inferMethodFromMaterial("Markforged Onyx")).toBe("3d_print");
    expect(inferMethodFromMaterial("PLA")).toBe("3d_print");
    expect(inferMethodFromMaterial("PETG")).toBe("3d_print");
    expect(inferMethodFromMaterial("Nylon 12")).toBe("3d_print");
  });

  it("returns undefined for non-print or missing materials", () => {
    expect(inferMethodFromMaterial("6061 Aluminum")).toBeUndefined();
    expect(inferMethodFromMaterial("Steel")).toBeUndefined();
    expect(inferMethodFromMaterial("")).toBeUndefined();
    expect(inferMethodFromMaterial(undefined)).toBeUndefined();
  });
});
