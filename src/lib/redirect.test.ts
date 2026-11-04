import { describe, expect, it } from "vitest";
import { HOME, loginPathFor, safeNext } from "./redirect";

describe("where to send someone after they sign in", () => {
  it("is the page they were trying to reach", () => {
    expect(safeNext("/parts/abc123")).toBe("/parts/abc123");
    expect(safeNext("/manufacturing?machine=router")).toBe(
      "/manufacturing?machine=router",
    );
  });

  it("is home when there's nothing to go back to", () => {
    expect(safeNext(null)).toBe(HOME);
    expect(safeNext(undefined)).toBe(HOME);
    expect(safeNext("")).toBe(HOME);
  });

  // The link is in the URL, so anyone can write it.
  it("is never another site", () => {
    expect(safeNext("https://evil.example")).toBe(HOME);
    expect(safeNext("//evil.example")).toBe(HOME);
    expect(safeNext("/\\evil.example")).toBe(HOME);
    expect(safeNext("javascript:alert(1)")).toBe(HOME);
  });

  it("is never the sign-in page, which would loop", () => {
    expect(safeNext("/login")).toBe(HOME);
    expect(safeNext("/login?next=/parts")).toBe(HOME);
  });
});

describe("the sign-in link", () => {
  it("carries the page along, encoded", () => {
    expect(loginPathFor("/parts/abc?x=1")).toBe(
      "/login?next=%2Fparts%2Fabc%3Fx%3D1",
    );
  });
  it("is plain when there's nowhere to come back to", () => {
    expect(loginPathFor("/")).toBe("/login");
  });
});
