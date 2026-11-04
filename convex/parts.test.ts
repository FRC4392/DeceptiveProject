// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

function identity(subject: string, role: "mentor" | "student" = "student") {
  return { subject, issuer: ISSUER, email: `${subject}@example.com`, role };
}

/** A season, one subsystem, a machine and two processes — the minimum shop. */
async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });

  const subsystems = await mentor.query(api.subsystems.list, {});
  const intake = subsystems.find((s) => s.code === "INT")!;
  const processes = await mentor.query(api.shop.listProcessTypes, {});
  const router = processes.find((p) => p.name === "CNC router")!;
  const print = processes.find((p) => p.name === "3D print")!;

  return { mentor, intake, router, print };
}

describe("part numbers", () => {
  test("are issued in order, per subsystem", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);

    const first = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 2,
    });
    const second = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Roller shaft",
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    expect(first.partNumber).toBe("27-INT-001");
    expect(second.partNumber).toBe("27-INT-002");
  });

  test("are never handed out twice, even when everyone asks at once", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        mentor.mutation(api.parts.createWithNumber, {
          subsystemId: intake._id,
          name: `Part ${i}`,
          processTypeId: router._id,
          qtyNeeded: 1,
        }),
      ),
    );

    const numbers = results.map((r) => r.partNumber);
    expect(new Set(numbers).size).toBe(12);
    expect(numbers.slice().sort()).toEqual(
      Array.from(
        { length: 12 },
        (_, i) => `27-INT-${String(i + 1).padStart(3, "0")}`,
      ),
    );
  });

  test("a number is never reused, even after the part is deleted", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);

    const first = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    await mentor.mutation(api.parts.remove, { partId: first.partId });
    const second = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate, again",
      processTypeId: router._id,
      qtyNeeded: 1,
    });

    expect(second.partNumber).toBe("27-INT-002");
  });

  test("finds a part however the number is typed", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });

    for (const typed of ["27-INT-001", "int-001", "INT001", "001"]) {
      const found = await mentor.query(api.parts.search, { query: typed });
      expect(found.map((p) => p.partNumber)).toContain("27-INT-001");
    }
  });
});

describe("moving a part along", () => {
  test("a process with no drawing skips straight to Ready to make", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, print } = await setup(t);

    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Bearing block",
      processTypeId: print._id,
      qtyNeeded: 1,
    });
    const result = await mentor.mutation(api.parts.advance, { partId });
    expect(result.stage).toBe(3);
  });

  test("a student can't check a drawing; a mentor can", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    await mentor.mutation(api.parts.advance, { partId }); // 1 -> 2

    await expect(
      student.mutation(api.parts.advance, { partId }),
    ).rejects.toThrow(/design lead/i);

    await mentor.mutation(api.parts.advance, { partId }); // 2 -> 3
    const part = await mentor.query(api.parts.get, { id: partId });
    expect(part?.stage).toBe(3);
  });

  test("a student claims it, makes them all, and moves it on", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 2,
    });
    await mentor.mutation(api.parts.advance, { partId }); // -> 2
    await mentor.mutation(api.parts.advance, { partId }); // -> 3

    await student.mutation(api.parts.claim, { partId });

    // Still can't call it done before both are actually made.
    await expect(
      student.mutation(api.parts.advance, { partId }),
    ).rejects.toThrow(/Record all 2/);

    await student.mutation(api.parts.setQtyMade, { partId, qtyMade: 2 });
    await student.mutation(api.parts.advance, { partId });
    const part = await mentor.query(api.parts.get, { id: partId });
    expect(part?.stage).toBe(4);
    expect(part?.makerUserId).toBe("student_1");
  });

  test("a mentor puts someone on a part, and takes them off", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });

    await mentor.mutation(api.parts.assign, { partId, userId: "student_1" });
    expect(
      (await mentor.query(api.parts.get, { id: partId }))?.claimedByUserId,
    ).toBe("student_1");

    await mentor.mutation(api.parts.assign, { partId, userId: null });
    expect(
      (await mentor.query(api.parts.get, { id: partId }))?.claimedByUserId,
    ).toBeUndefined();
  });

  test("a mentor can hand a part from one person to another", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    for (const who of ["student_1", "student_2"]) {
      const caller = t.withIdentity(identity(who));
      await caller.mutation(api.auth.storeCurrentUser, {});
    }
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });

    await t
      .withIdentity(identity("student_1"))
      .mutation(api.parts.claim, { partId });
    // Claiming refuses to take someone else's; assigning is allowed to.
    await mentor.mutation(api.parts.assign, { partId, userId: "student_2" });
    expect(
      (await mentor.query(api.parts.get, { id: partId }))?.claimedByUserId,
    ).toBe("student_2");
  });

  test("students can't assign, and nobody can assign a stranger", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });

    await expect(
      student.mutation(api.parts.assign, { partId, userId: "student_1" }),
    ).rejects.toThrow(/mentor/i);

    await expect(
      mentor.mutation(api.parts.assign, { partId, userId: "never_signed_in" }),
    ).rejects.toThrow(/hasn't signed in/i);
  });

  test("a part in the bin can't be assigned", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, print } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Bearing block",
      processTypeId: print._id,
      qtyNeeded: 1,
    });
    await mentor.mutation(api.parts.moveTo, { partId, stage: 5 });

    await expect(
      mentor.mutation(api.parts.assign, { partId, userId: "student_1" }),
    ).rejects.toThrow(/in the bin/i);
  });

  test("something going wrong puts it back on the machine", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 2,
    });
    await mentor.mutation(api.parts.advance, { partId });
    await mentor.mutation(api.parts.advance, { partId });
    await mentor.mutation(api.parts.setQtyMade, { partId, qtyMade: 2 });
    await mentor.mutation(api.parts.advance, { partId }); // -> 4

    await student.mutation(api.parts.reportProblem, {
      partId,
      reason: "broke",
      qtyAffected: 1,
      note: "cracked on the press fit",
    });

    const part = await mentor.query(api.parts.get, { id: partId });
    expect(part?.stage).toBe(3);
    expect(part?.qtyMade).toBe(1);
    expect(part?.flags.some((f) => f.kind === "remake")).toBe(true);

    const headsUp = await mentor.query(api.parts.headsUp, {});
    expect(headsUp.some((h) => h.kind === "problem")).toBe(true);
  });

  test("only a lead can drag a part backwards", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, print } = await setup(t);
    const student = t.withIdentity(identity("student_1"));
    await student.mutation(api.auth.storeCurrentUser, {});

    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Bearing block",
      processTypeId: print._id,
      qtyNeeded: 1,
    });
    await mentor.mutation(api.parts.advance, { partId }); // -> 3

    await expect(
      student.mutation(api.parts.moveTo, { partId, stage: 1 }),
    ).rejects.toThrow(/lead or mentor/i);
    await mentor.mutation(api.parts.moveTo, { partId, stage: 1 });
    const part = await mentor.query(api.parts.get, { id: partId });
    expect(part?.stage).toBe(1);
  });
});

describe("when something goes wrong more than once", () => {
  async function plate(t: ReturnType<typeof convexTest>) {
    const { mentor, intake, router } = await setup(t);
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 4,
    });
    await mentor.mutation(api.parts.setQtyMade, { partId, qtyMade: 4 });
    return { mentor, partId };
  }

  // Each problem used to add its own chip: two problems, two "Remake 1"s.
  test("the part wears one remake chip, counting them all", async () => {
    const t = convexTest(schema, modules);
    const { mentor, partId } = await plate(t);
    await mentor.mutation(api.parts.reportProblem, {
      partId,
      reason: "broke",
      qtyAffected: 1,
    });
    await mentor.mutation(api.parts.reportProblem, {
      partId,
      reason: "scrapped",
      qtyAffected: 2,
    });

    const part = await mentor.query(api.parts.get, { id: partId });
    const remakes = part!.flags.filter((f) => f.kind === "remake");
    expect(remakes).toHaveLength(1);
    expect(remakes[0].qty).toBe(3);
    // The problems stay separate, and Heads up still lists each.
    expect(await mentor.query(api.parts.problems, { partId })).toHaveLength(2);
    const headsUp = await mentor.query(api.parts.headsUp, {});
    expect(headsUp.filter((h) => h.kind === "problem")).toHaveLength(2);
  });

  test("Heads up drops a problem once it's resolved", async () => {
    const t = convexTest(schema, modules);
    const { mentor, partId } = await plate(t);
    await mentor.mutation(api.parts.reportProblem, {
      partId,
      reason: "broke",
      qtyAffected: 1,
    });
    const [problem] = await mentor.query(api.parts.problems, { partId });
    await mentor.mutation(api.parts.resolveProblem, { problemId: problem._id });
    const headsUp = await mentor.query(api.parts.headsUp, {});
    expect(headsUp.filter((h) => h.kind === "problem")).toEqual([]);
  });
});

describe("searching for an archived part", () => {
  // The board hides archived parts, and a partial number never found them;
  // typing the whole number used to land on one anyway.
  test("finds it neither by its whole number nor by its name", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const { partId, partNumber } = await mentor.mutation(
      api.parts.createWithNumber,
      {
        subsystemId: intake._id,
        name: "Old bracket",
        processTypeId: router._id,
        qtyNeeded: 1,
      },
    );
    expect(
      await mentor.query(api.parts.search, { query: partNumber }),
    ).toHaveLength(1);

    await mentor.mutation(api.parts.setArchived, { partId, archived: true });
    expect(await mentor.query(api.parts.search, { query: partNumber })).toEqual(
      [],
    );
    expect(
      await mentor.query(api.parts.search, { query: "Old bracket" }),
    ).toEqual([]);
  });
});

describe("clearing a flag", () => {
  test("only takes a kind of flag a part can carry", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    await expect(
      mentor.mutation(api.parts.clearFlag, {
        partId,
        kind: "not_a_flag" as "waiting",
      }),
    ).rejects.toThrow();
  });
});
