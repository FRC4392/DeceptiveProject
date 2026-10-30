// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

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

  test("a student needs the machine sign-off to claim and to finish making", async () => {
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

    await expect(student.mutation(api.parts.claim, { partId })).rejects.toThrow(
      /signed off/i,
    );

    await mentor.mutation(api.shop.signOffTraining, {
      userId: "student_1",
      machineId: router.machineId as Id<"machines">,
    });
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
