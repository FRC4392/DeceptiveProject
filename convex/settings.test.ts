// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { allowancePeriodStart } from "./lib/budget";
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

// The allowance is a year's. Calls from before it renewed don't count against
// this one — and a Manual the app forced when last year's ran out lifts too.
describe("when the allowance renews", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();

  /** Five calls last year, two this year, renewing on 1 August. */
  async function acrossARenewal(t: ReturnType<typeof convexTest>) {
    // Start the clock before anything is written: convex-test stamps
    // `_creationTime` in order, so a row can't be dated earlier than one
    // written before it. Winding back after setup would date "June" in
    // whatever month the suite happens to run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(day("2026-06-01"));
    const mentor = t.withIdentity(mentorIdentity());
    await mentor.mutation(api.auth.storeCurrentUser, {});
    await mentor.mutation(api.settings.set, {
      key: "renewalDate",
      value: day("2026-08-01"),
    });
    await spend(t, 5);
    vi.setSystemTime(day("2026-09-01"));
    await spend(t, 2);
    return mentor;
  }

  test("counts only this year's calls — not none, and not every call ever", async () => {
    const t = convexTest(schema, modules);
    const mentor = await acrossARenewal(t);
    const budget = await mentor.query(api.settings.budget, {});
    expect(budget.used).toBe(2);
    expect(budget.remaining).toBe(2498);
  });

  test("rolls over on its own the next year", async () => {
    const t = convexTest(schema, modules);
    const mentor = await acrossARenewal(t);
    vi.setSystemTime(day("2027-08-15"));
    await spend(t, 1);
    expect((await mentor.query(api.settings.budget, {})).used).toBe(1);
  });

  test("with no renewal date it still counts every call, as before", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(day("2026-06-01"));
    const mentor = t.withIdentity(mentorIdentity());
    await mentor.mutation(api.auth.storeCurrentUser, {});
    await spend(t, 5);
    vi.setSystemTime(day("2026-09-01"));
    await spend(t, 2);
    expect((await mentor.query(api.settings.budget, {})).used).toBe(7);
  });

  test("lifts a Manual the app forced when last year's allowance ran out", async () => {
    const t = convexTest(schema, modules);
    const mentor = await acrossARenewal(t);
    vi.setSystemTime(day("2026-07-01"));
    await t.mutation(internal.settings.forceManualMode, {
      reason: "Onshape said the allowance was spent (402).",
    });
    vi.setSystemTime(day("2026-09-01"));

    const budget = await mentor.query(api.settings.budget, {});
    expect(budget.forced).toBe(false);
    expect(budget.forcedReason).toBeNull();
    expect(budget.mode).toBe("normal");
  });

  test("keeps a Manual the app forced this year", async () => {
    const t = convexTest(schema, modules);
    const mentor = await acrossARenewal(t);
    await t.mutation(internal.settings.forceManualMode, {
      reason: "Onshape said the allowance was spent (402).",
    });
    const budget = await mentor.query(api.settings.budget, {});
    expect(budget.mode).toBe("manual");
    expect(budget.forced).toBe(true);
  });

  test("keeps a mode a mentor chose, renewal or not", async () => {
    const t = convexTest(schema, modules);
    const mentor = await acrossARenewal(t);
    vi.setSystemTime(day("2026-07-01"));
    // The app forced it first…
    await t.mutation(internal.settings.forceManualMode, { reason: "402" });
    // …then a mentor chose Lean, which is theirs and carries no reason.
    await mentor.mutation(api.settings.set, {
      key: "forcedMode",
      value: "lean",
    });
    vi.setSystemTime(day("2026-09-01"));

    const budget = await mentor.query(api.settings.budget, {});
    expect(budget.mode).toBe("lean");
    expect(budget.forced).toBe(true);
    expect(budget.forcedReason).toBeNull();
  });
});

describe("a 402 in a new allowance year", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();

  // Last year's forced Manual is still stored after the renewal. A fresh 402
  // has to count as this year's, or the brake comes off just as it's needed.
  test("forces Manual again, dated this year", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(day("2026-06-01"));
    const mentor = t.withIdentity(mentorIdentity());
    await mentor.mutation(api.auth.storeCurrentUser, {});
    await mentor.mutation(api.settings.set, {
      key: "renewalDate",
      value: day("2026-08-01"),
    });
    await t.mutation(internal.settings.forceManualMode, { reason: "402" });

    vi.setSystemTime(day("2026-09-01"));
    expect((await mentor.query(api.settings.budget, {})).mode).toBe("normal");

    await t.mutation(internal.settings.forceManualMode, {
      reason: "402 again",
    });
    const budget = await mentor.query(api.settings.budget, {});
    expect(budget.mode).toBe("manual");
    expect(budget.forcedReason).toBe("402 again");
  });

  test("still leaves a Manual a mentor chose alone", async () => {
    const t = convexTest(schema, modules);
    const mentor = t.withIdentity(mentorIdentity());
    await mentor.mutation(api.auth.storeCurrentUser, {});
    await mentor.mutation(api.settings.set, {
      key: "forcedMode",
      value: "manual",
    });
    await t.mutation(internal.settings.forceManualMode, { reason: "402" });
    // Still the mentor's: no reason of the app's written over it.
    expect(
      (await mentor.query(api.settings.budget, {})).forcedReason,
    ).toBeNull();
  });
});

describe("setting it from the command line", () => {
  test("works with nobody signed in, the way npx convex run calls it", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.settings.configure, {
      key: "apiLimit",
      value: 100,
    });
    const mentor = t.withIdentity(mentorIdentity());
    await mentor.mutation(api.auth.storeCurrentUser, {});
    expect((await mentor.query(api.settings.get, {})).apiLimit).toBe(100);
  });

  test("the public one refuses a caller with no session", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.settings.set, { key: "apiLimit", value: 1 }),
    ).rejects.toThrow();
  });
});

describe("where the allowance year starts", () => {
  const at = (iso: string) => new Date(iso).getTime();

  test("is the most recent anniversary that isn't in the future", () => {
    // Renewal entered as last year's date…
    expect(
      allowancePeriodStart(
        at("2025-08-01T00:00:00Z"),
        at("2026-09-01T00:00:00Z"),
      ),
    ).toBe(at("2026-08-01T00:00:00Z"));
    // …or as next year's: the same answer either way.
    expect(
      allowancePeriodStart(
        at("2027-08-01T00:00:00Z"),
        at("2026-09-01T00:00:00Z"),
      ),
    ).toBe(at("2026-08-01T00:00:00Z"));
  });

  test("before this year's renewal, it's still last year's", () => {
    expect(
      allowancePeriodStart(
        at("2026-08-01T00:00:00Z"),
        at("2026-03-01T00:00:00Z"),
      ),
    ).toBe(at("2025-08-01T00:00:00Z"));
  });

  test("on the day itself, the new year has started", () => {
    expect(
      allowancePeriodStart(
        at("2026-08-01T00:00:00Z"),
        at("2026-08-01T00:00:00Z"),
      ),
    ).toBe(at("2026-08-01T00:00:00Z"));
  });

  test("with no renewal date there's no start: count everything", () => {
    expect(allowancePeriodStart(null, Date.now())).toBeNull();
  });
});
