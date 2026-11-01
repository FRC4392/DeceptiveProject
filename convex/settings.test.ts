// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

function mentorIdentity() {
  return {
    subject: "mentor_1",
    issuer: ISSUER,
    email: "mentor@example.com",
    role: "mentor" as const,
  };
}

async function spend(
  t: ReturnType<typeof convexTest>,
  calls: number,
  status = 200,
) {
  for (let i = 0; i < calls; i++) {
    await t.mutation(internal.onshape.recordApiCall, {
      method: "GET",
      endpoint: "/api/releasepackages/abc",
      status,
    });
  }
}

describe("the Onshape budget", () => {
  test("starts in Normal and counts only the calls that landed", async () => {
    const t = convexTest(schema, modules);
    await spend(t, 10);
    await spend(t, 5, 429); // rate-limited calls don't count against the plan

    const budget = await t
      .withIdentity(mentorIdentity())
      .query(api.settings.budget, {});
    expect(budget.used).toBe(10);
    expect(budget.limit).toBe(2500);
    expect(budget.mode).toBe("normal");
  });

  test("drops to Lean under 30% left, then Manual under 10%", async () => {
    const t = convexTest(schema, modules);
    const mentor = t.withIdentity(mentorIdentity());
    await mentor.mutation(api.auth.storeCurrentUser, {});
    // A small limit keeps the test honest without 2,500 inserts.
    await mentor.mutation(api.settings.set, { key: "apiLimit", value: 100 });

    await spend(t, 50);
    expect((await mentor.query(api.settings.budget, {})).mode).toBe("normal");

    await spend(t, 25); // 25 left — a quarter
    expect((await mentor.query(api.settings.budget, {})).mode).toBe("lean");

    await spend(t, 20); // 5 left
    const manual = await mentor.query(api.settings.budget, {});
    expect(manual.mode).toBe("manual");
    expect(manual.remaining).toBe(5);
  });

  test("a mentor can force Manual whatever the meter says", async () => {
    const t = convexTest(schema, modules);
    const mentor = t.withIdentity(mentorIdentity());
    await mentor.mutation(api.auth.storeCurrentUser, {});
    await mentor.mutation(api.settings.set, {
      key: "forcedMode",
      value: "manual",
    });

    const budget = await mentor.query(api.settings.budget, {});
    expect(budget.mode).toBe("manual");
    expect(budget.forced).toBe(true);
  });

  test("only mentors can change the thresholds", async () => {
    const t = convexTest(schema, modules);
    const student = t.withIdentity({
      subject: "student_1",
      issuer: ISSUER,
      email: "student@example.com",
    });
    await student.mutation(api.auth.storeCurrentUser, {});
    await expect(
      student.mutation(api.settings.set, { key: "apiLimit", value: 10 }),
    ).rejects.toThrow(/mentor/i);
  });
});
