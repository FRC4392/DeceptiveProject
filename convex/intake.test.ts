// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity({
    subject: "mentor_1",
    issuer: ISSUER,
    email: "mentor@example.com",
    role: "mentor" as const,
  });
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  const subsystems = await mentor.query(api.subsystems.list, {});
  const processes = await mentor.query(api.shop.listProcessTypes, {});
  return {
    mentor,
    intake: subsystems.find((s) => s.code === "INT")!,
    router: processes.find((p) => p.name === "CNC router")!,
  };
}

describe("taking a release in by hand", () => {
  test("a released part in design moves to Needs drawing", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 2,
    });

    const { intakeId } = await mentor.mutation(api.intake.addManual, {
      label: "Intake release",
      text: "27-INT-001 A",
      subsystemId: intake._id,
    });

    const queued = await mentor.query(api.intake.list, {});
    const mine = queued.find((row) => row.intake._id === intakeId)!;
    expect(mine.lines[0].kind).toBe("matched");

    const result = await mentor.mutation(api.intake.applyMatched, { intakeId });
    expect(result.moved).toBe(1);

    const part = await mentor.query(api.parts.get, { id: partId });
    expect(part?.stage).toBe(2);
    expect(part?.revision).toBe("A");
  });

  test("an unknown number becomes a part with a number we issue", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);

    const { intakeId } = await mentor.mutation(api.intake.addManual, {
      label: "Mystery release",
      text: "SOMEONES-OWN-NUMBER",
    });
    const rows = await mentor.query(api.intake.list, {});
    const line = rows.find((r) => r.intake._id === intakeId)!.lines[0];
    expect(line.kind).toBe("unknown");

    const partId = await mentor.mutation(api.intake.applyLine, {
      lineId: line._id,
      decision: "created",
      subsystemId: intake._id,
      processTypeId: router._id,
      qtyNeeded: 3,
    });

    const part = await mentor.query(api.parts.get, { id: partId! });
    expect(part?.partNumber).toBe("27-INT-001");
    expect(part?.qtyNeeded).toBe(3);
    expect(part?.stage).toBe(2); // a router part needs a drawing first
  });

  test("a part changed after it was made waits for a lead's decision", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Bumper bracket",
      processTypeId: router._id,
      qtyNeeded: 8,
    });
    await mentor.mutation(api.intake.addManual, {
      label: "First release",
      text: "27-INT-001 B",
      subsystemId: intake._id,
    });
    const first = await mentor.query(api.intake.list, {});
    await mentor.mutation(api.intake.applyMatched, {
      intakeId: first[0].intake._id,
    });
    await mentor.mutation(api.parts.advance, { partId }); // -> Ready to make
    await mentor.mutation(api.parts.setQtyMade, { partId, qtyMade: 4 });

    const { intakeId } = await mentor.mutation(api.intake.addManual, {
      label: "Second release",
      text: "27-INT-001 C",
      subsystemId: intake._id,
    });
    const rows = await mentor.query(api.intake.list, {});
    const line = rows.find((r) => r.intake._id === intakeId)!.lines[0];
    expect(line.kind).toBe("changed");
    expect(line.note).toMatch(/4 were already made/);

    await mentor.mutation(api.intake.applyLine, {
      lineId: line._id,
      decision: "remake_all",
    });
    const part = await mentor.query(api.parts.get, { id: partId });
    expect(part?.qtyMade).toBe(0);
    expect(part?.stage).toBe(3);
    expect(part?.revision).toBe("C");
  });

  test("a BOM import matches rows by part number", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });

    const result = await mentor.mutation(api.intake.importCsv, {
      label: "Intake BOM",
      csv: "Part number,Name,Revision,Quantity\n27-INT-001,Side plate,A,2",
      subsystemId: intake._id,
    });
    expect(result.lines).toBe(1);

    const rows = await mentor.query(api.intake.list, {});
    const line = rows.find((r) => r.intake._id === result.intakeId)!.lines[0];
    expect(line.kind).toBe("matched");
    expect(line.quantity).toBe(2);
  });

  test("a BOM with no part-number column says so", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await expect(
      mentor.mutation(api.intake.importCsv, {
        label: "Bad BOM",
        csv: "Name,Quantity\nSide plate,2",
      }),
    ).rejects.toThrow(/Part number/);
  });
});
