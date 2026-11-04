// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

function studentIdentity() {
  return {
    subject: "student_1",
    issuer: ISSUER,
    email: "student@example.com",
  };
}

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
  const intake = subsystems.find((s) => s.code === "INT")!;
  const processes = await mentor.query(api.shop.listProcessTypes, {});
  const router = processes.find((p) => p.name === "CNC router")!;

  const parts: Id<"parts">[] = [];
  for (const name of ["Side plate", "Roller shaft", "Cross bar"]) {
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name,
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    parts.push(partId);
  }
  return { mentor, intake, parts };
}

async function listFor(
  caller: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  subsystemId: Id<"subsystems">,
) {
  return caller.query(api.subAssemblies.list, { subsystemId });
}

/** Walk a part to "Ready to assemble". */
async function putInBin(
  mentor: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  partId: Id<"parts">,
) {
  await mentor.mutation(api.parts.moveTo, { partId, stage: 5 });
}

describe("the default sub-assembly", () => {
  test("every seeded subsystem is born with its -000", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const subsystems = await mentor.query(api.subsystems.list, {});

    for (const subsystem of subsystems) {
      const rows = await listFor(mentor, subsystem._id);
      const root = rows.find((r) => r.assembly.isDefault);
      expect(root?.assembly.partNumber).toBe(`27-${subsystem.code}-000`);
      expect(root?.assembly.name).toBe(subsystem.name);
    }
  });

  test("a new subsystem gets one too", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await mentor.mutation(api.subsystems.create, {
      code: "CLM",
      name: "Climber two",
    });
    const subsystems = await mentor.query(api.subsystems.list, {});
    const made = subsystems.find((s) => s.code === "CLM")!;
    const rows = await listFor(mentor, made._id);
    expect(rows).toHaveLength(1);
    expect(rows[0].assembly.partNumber).toBe("27-CLM-000");
  });

  test("it costs the counter nothing — the first part is still 001", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    expect(rows[0].assembly.partNumber).toBe("27-INT-000");

    const parts = await mentor.query(api.parts.list, {
      subsystemId: intake._id,
    });
    expect(parts[0].partNumber).toBe("27-INT-001");
  });

  test("it can't be deleted", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    await expect(
      mentor.mutation(api.subAssemblies.remove, { id: rows[0].assembly._id }),
    ).rejects.toThrow(/keeps its 27-INT-000/);
  });

  test("the backfill is safe to run twice", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const again = await t.mutation(internal.subAssemblies.backfillDefaults, {});
    expect(again.created).toBe(0);
  });
});

describe("numbering", () => {
  test("sub-assemblies and parts draw from one counter", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    // setup() already made 001, 002, 003.
    const frame = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    expect(frame.partNumber).toBe("27-INT-004");

    const processes = await mentor.query(api.shop.listProcessTypes, {});
    const next = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Gusset",
      processTypeId: processes[0]._id,
      qtyNeeded: 1,
    });
    expect(next.partNumber).toBe("27-INT-005");
  });

  test("a sub-assembly answers the part-number search box", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    for (const typed of ["27-INT-004", "int-004", "004"]) {
      const found = await mentor.query(api.subAssemblies.search, {
        query: typed,
      });
      expect(found.map((a) => a.partNumber)).toContain("27-INT-004");
    }
  });
});

describe("what a sub-assembly is made of", () => {
  test("two sub-assemblies can share the same part", async () => {
    // Two roller assemblies using the same end cap is ordinary, not a
    // mistake. Membership used to be exclusive and this is what changed.
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const left = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Left roller",
    });
    const right = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Right roller",
    });

    await mentor.mutation(api.subAssemblies.setMembers, {
      id: left.id,
      partIds: [parts[0], parts[1]],
      cotsItemIds: [],
      childIds: [],
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: right.id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });

    const rows = await listFor(mentor, intake._id);
    // Still in the first one — claiming it elsewhere no longer takes it away.
    expect(rows.find((r) => r.assembly._id === left.id)!.partIds).toEqual([
      parts[0],
      parts[1],
    ]);
    expect(rows.find((r) => r.assembly._id === right.id)!.partIds).toEqual([
      parts[0],
    ]);
  });

  test("the same sub-assembly can be placed in two parents", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    const frame = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    const other = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Other",
    });

    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [],
      cotsItemIds: [],
      childIds: [frame.id],
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: other.id,
      partIds: [],
      cotsItemIds: [],
      childIds: [frame.id],
    });

    const after = await listFor(mentor, intake._id);
    expect(after.find((r) => r.assembly._id === root)!.childIds).toEqual([
      frame.id,
    ]);
    expect(after.find((r) => r.assembly._id === other.id)!.childIds).toEqual([
      frame.id,
    ]);
  });

  test("how many of each is remembered", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const roller = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });
    // Two of it per roller, so the plan has to allow at least two.
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 2 });
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: roller.id,
      partIds: [parts[0], parts[1]],
      cotsItemIds: [],
      childIds: [],
      quantities: [{ refId: parts[0], quantity: 2 }],
    });

    const rows = await listFor(mentor, intake._id);
    const row = rows.find((r) => r.assembly._id === roller.id)!;
    // Only the ones used more than once are worth saying out loud.
    expect(row.quantities).toEqual([{ refId: parts[0], quantity: 2 }]);
  });

  test("nothing can go inside itself", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const frame = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    await expect(
      mentor.mutation(api.subAssemblies.setMembers, {
        id: frame.id,
        partIds: [],
        cotsItemIds: [],
        childIds: [frame.id],
      }),
    ).rejects.toThrow(/inside itself/);
  });

  test("nor inside something it already holds", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const outer = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Outer",
    });
    const inner = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Inner",
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: outer.id,
      partIds: [],
      cotsItemIds: [],
      childIds: [inner.id],
    });

    await expect(
      mentor.mutation(api.subAssemblies.setMembers, {
        id: inner.id,
        partIds: [],
        cotsItemIds: [],
        childIds: [outer.id],
      }),
    ).rejects.toThrow(/inside itself/);
  });

  test("a child has to come from the same subsystem", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const subsystems = await mentor.query(api.subsystems.list, {});
    const drivetrain = subsystems.find((s) => s.code === "DRV")!;
    const theirs = await listFor(mentor, drivetrain._id);
    const mine = await listFor(mentor, intake._id);

    await expect(
      mentor.mutation(api.subAssemblies.setMembers, {
        id: mine[0].assembly._id,
        partIds: [],
        cotsItemIds: [],
        childIds: [theirs[0].assembly._id],
      }),
    ).rejects.toThrow(/its own subsystem/);
  });

  test("one still holding something can't be deleted", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const outer = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Outer",
    });
    const inner = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Inner",
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: outer.id,
      partIds: [],
      cotsItemIds: [],
      childIds: [inner.id],
    });

    await expect(
      mentor.mutation(api.subAssemblies.remove, { id: outer.id }),
    ).rejects.toThrow(/Move or delete what's inside it first/);
  });

  test("anything no sub-assembly holds is left over", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const before = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });
    expect(before.loose).toHaveLength(3);

    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    const after = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });
    expect(after.loose).toHaveLength(2);
  });
});

describe("building one", () => {
  test("its parts go on the robot", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[0], parts[1]],
      cotsItemIds: [],
      childIds: [],
    });
    for (const partId of [parts[0], parts[1]]) await putInBin(mentor, partId);

    const result = await mentor.mutation(api.subAssemblies.complete, {
      id: root,
    });
    expect(result.moved).toBe(2);
    for (const partId of [parts[0], parts[1]]) {
      const part = await mentor.query(api.parts.get, { id: partId });
      expect(part?.stage).toBe(6);
    }
    const untouched = await mentor.query(api.parts.get, { id: parts[2] });
    expect(untouched?.stage).toBe(1);
  });

  test("only its own parts move — a child's moved when the child did", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    const frame = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });

    await mentor.mutation(api.subAssemblies.setMembers, {
      id: frame.id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[1]],
      cotsItemIds: [],
      childIds: [frame.id],
    });
    await putInBin(mentor, parts[0]);
    await putInBin(mentor, parts[1]);

    const child = await mentor.mutation(api.subAssemblies.complete, {
      id: frame.id,
    });
    expect(child.moved).toBe(1);

    const parent = await mentor.mutation(api.subAssemblies.complete, {
      id: root,
    });
    expect(parent.moved).toBe(1);
  });

  test("refuses while something inside it isn't built", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    const frame = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [frame.id],
    });
    await putInBin(mentor, parts[0]);

    await expect(
      mentor.mutation(api.subAssemblies.complete, { id: root }),
    ).rejects.toThrow(/Not built yet: 27-INT-004 Frame/);

    const stillInBin = await mentor.query(api.parts.get, { id: parts[0] });
    expect(stillInBin?.stage).toBe(5);
  });

  test("refuses while a part isn't in the bin, and moves nothing", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [parts[0], parts[1]],
      cotsItemIds: [],
      childIds: [],
    });
    await putInBin(mentor, parts[0]);

    await expect(
      mentor.mutation(api.subAssemblies.complete, { id: rows[0].assembly._id }),
    ).rejects.toThrow(/Not in the bin yet/);
    const untouched = await mentor.query(api.parts.get, { id: parts[0] });
    expect(untouched?.stage).toBe(5);
  });

  test("a student can pick one up but not install it", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const student = t.withIdentity(studentIdentity());
    await student.mutation(api.auth.storeCurrentUser, {});
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    await putInBin(mentor, parts[0]);

    await student.mutation(api.subAssemblies.claim, { id: root });
    const after = await listFor(student, intake._id);
    expect(after[0].assembly.claimedByUserId).toBe("student_1");

    await expect(
      student.mutation(api.subAssemblies.complete, { id: root }),
    ).rejects.toThrow(/subsystem lead or a mentor/i);
  });

  test("nor one holding nothing at all", async () => {
    // Without an explicit check this would slip through: with no parts, the
    // per-part permission check never runs.
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const student = t.withIdentity(studentIdentity());
    await student.mutation(api.auth.storeCurrentUser, {});
    const rows = await listFor(mentor, intake._id);

    await expect(
      student.mutation(api.subAssemblies.complete, {
        id: rows[0].assembly._id,
      }),
    ).rejects.toThrow(/subsystem lead or a mentor/i);
  });

  test("whoever picked it up is credited as the assembler", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const student = t.withIdentity(studentIdentity());
    await student.mutation(api.auth.storeCurrentUser, {});
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    await putInBin(mentor, parts[0]);
    await student.mutation(api.subAssemblies.claim, { id: root });
    await mentor.mutation(api.subAssemblies.complete, { id: root });

    const part = await mentor.query(api.parts.get, { id: parts[0] });
    expect(part?.assemblerUserId).toBe("student_1");
  });

  test("my list shows what I picked up, and why it's waiting", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const student = t.withIdentity(studentIdentity());
    await student.mutation(api.auth.storeCurrentUser, {});
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });

    // Nothing claimed yet.
    expect(await student.query(api.subAssemblies.listMine, {})).toHaveLength(0);

    await student.mutation(api.subAssemblies.claim, { id: root });
    const mine = await student.query(api.subAssemblies.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].assembly.partNumber).toBe("27-INT-000");
    expect(mine[0].subsystemName).toBe("Intake");
    expect(mine[0].ready).toBe(false);
    expect(mine[0].summary).toMatch(/27-INT-001/);

    // Once its part is in the bin it can go together.
    await putInBin(mentor, parts[0]);
    const after = await student.query(api.subAssemblies.listMine, {});
    expect(after[0].ready).toBe(true);
    expect(after[0].summary).toMatch(/in the bin/i);

    // And it's only mine — the mentor's list stays empty.
    expect(await mentor.query(api.subAssemblies.listMine, {})).toHaveLength(0);
  });

  test("someone else can't take a claimed one", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const student = t.withIdentity(studentIdentity());
    await student.mutation(api.auth.storeCurrentUser, {});
    const rows = await listFor(mentor, intake._id);

    await student.mutation(api.subAssemblies.claim, {
      id: rows[0].assembly._id,
    });
    await expect(
      mentor.mutation(api.subAssemblies.claim, { id: rows[0].assembly._id }),
    ).rejects.toThrow(/already picked this one up/i);
  });

  test("building the default is what puts the subsystem on the robot", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    await putInBin(mentor, parts[0]);

    const before = await mentor.query(api.subsystems.progress, {});
    expect(before.find((p) => p.subsystemId === intake._id)!.installed).toBe(
      false,
    );

    await mentor.mutation(api.subAssemblies.complete, { id: root });

    const after = await mentor.query(api.subsystems.progress, {});
    expect(after.find((p) => p.subsystemId === intake._id)!.installed).toBe(
      true,
    );
  });

  test("reopening leaves its parts on the robot", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    await putInBin(mentor, parts[0]);
    await mentor.mutation(api.subAssemblies.complete, { id: root });
    await mentor.mutation(api.subAssemblies.reopen, { id: root });

    const after = await listFor(mentor, intake._id);
    expect(after[0].assembly.completedAt).toBeUndefined();
    const part = await mentor.query(api.parts.get, { id: parts[0] });
    expect(part?.stage).toBe(6);
  });
});

describe("the assembly drawing link", () => {
  test("takes an https link", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setDrawing, {
      id: rows[0].assembly._id,
      url: "https://cad.onshape.com/documents/abc",
    });
    const after = await listFor(mentor, intake._id);
    expect(after[0].assembly.drawingUrl).toBe(
      "https://cad.onshape.com/documents/abc",
    );
  });

  test("refuses anything that isn't http(s)", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    await expect(
      mentor.mutation(api.subAssemblies.setDrawing, {
        id: rows[0].assembly._id,
        url: "javascript:alert(1)",
      }),
    ).rejects.toThrow(/http/i);
  });
});

describe("a part two assemblies both want", () => {
  async function sharedSetup(t: ReturnType<typeof convexTest>) {
    const { mentor, intake, parts } = await setup(t);
    const left = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Left roller",
    });
    const right = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Right roller",
    });
    const shared = parts[0];
    for (const id of [left.id, right.id]) {
      await mentor.mutation(api.subAssemblies.setMembers, {
        id,
        partIds: [shared],
        cotsItemIds: [],
        childIds: [],
      });
    }
    // In the bin, ready to go on.
    await t.run(async (ctx) => {
      await ctx.db.patch(shared, { stage: 5, qtyMade: 2 });
    });
    return { mentor, intake, left, right, shared };
  }

  test("stays in the bin while the other one still needs it", async () => {
    const t = convexTest(schema, modules);
    const { mentor, left, shared } = await sharedSetup(t);

    const result = await mentor.mutation(api.subAssemblies.complete, {
      id: left.id,
    });

    expect(result.moved).toBe(0);
    const part = await t.run((ctx) => ctx.db.get(shared));
    // Saying it's on the robot while the right roller still wants one is the
    // kind of lie that gets found at competition.
    expect(part?.stage).toBe(5);
  });

  test("goes on the robot once the last one is built", async () => {
    const t = convexTest(schema, modules);
    const { mentor, left, right, shared } = await sharedSetup(t);

    await mentor.mutation(api.subAssemblies.complete, { id: left.id });
    const result = await mentor.mutation(api.subAssemblies.complete, {
      id: right.id,
    });

    expect(result.moved).toBe(1);
    const part = await t.run((ctx) => ctx.db.get(shared));
    expect(part?.stage).toBe(6);
  });

  test("a part only one assembly wants still moves straight away", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const solo = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Solo",
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: solo.id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { stage: 5, qtyMade: 1 });
    });

    const result = await mentor.mutation(api.subAssemblies.complete, {
      id: solo.id,
    });
    expect(result.moved).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(parts[0])))?.stage).toBe(6);
  });
});

describe("how many the robot needs", () => {
  test("multiplies placements down the tree and flags a shortfall", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const root = rows[0].assembly._id;
    const roller = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });

    // Two rollers on the robot, two of this part in each roller: four.
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [],
      cotsItemIds: [],
      childIds: [roller.id],
      quantities: [{ refId: roller.id, quantity: 2 }],
    });
    // Four will be wanted (two rollers × two each); only two are planned.
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 4 });
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: roller.id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
      quantities: [{ refId: parts[0], quantity: 2 }],
    });
    await mentor.mutation(api.subAssemblies.setUnits, {
      id: roller.id,
      qtyNeeded: 2,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 2 });
    });

    const demand = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });

    expect(demand.units.find((u) => u.id === roller.id)?.units).toBe(2);
    expect(demand.shortfalls).toHaveLength(1);
    expect(demand.shortfalls[0]).toMatchObject({
      kind: "part",
      needed: 4,
      planned: 2,
    });
  });

  test("spares are whole extra units", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const roller = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [],
      cotsItemIds: [],
      childIds: [roller.id],
      quantities: [{ refId: roller.id, quantity: 2 }],
    });
    await mentor.mutation(api.subAssemblies.setUnits, {
      id: roller.id,
      qtyNeeded: 2,
      qtySpares: 1,
    });

    const demand = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });
    expect(demand.units.find((u) => u.id === roller.id)?.units).toBe(3);
  });

  test("says nothing when the plan covers the robot", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    const demand = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });
    expect(demand.shortfalls).toEqual([]);
  });
});

describe("how many of a part one assembly may take", () => {
  test("refuses more than the plan leaves after the others", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 3 });
    });
    const left = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Left",
    });
    const right = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Right",
    });

    await mentor.mutation(api.subAssemblies.setMembers, {
      id: left.id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
      quantities: [{ refId: parts[0], quantity: 2 }],
    });

    // Three planned, two taken: one left.
    await expect(
      mentor.mutation(api.subAssemblies.setMembers, {
        id: right.id,
        partIds: [parts[0]],
        cotsItemIds: [],
        childIds: [],
        quantities: [{ refId: parts[0], quantity: 2 }],
      }),
    ).rejects.toThrow(/Only 1 of that left/);

    await mentor.mutation(api.subAssemblies.setMembers, {
      id: right.id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
      quantities: [{ refId: parts[0], quantity: 1 }],
    });
  });

  test("editing one doesn't count its own old rows against it", async () => {
    // Otherwise saving the same thing twice would refuse the second time.
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 2 });
    });
    const roller = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });
    const args = {
      id: roller.id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
      quantities: [{ refId: parts[0], quantity: 2 }],
    };
    await mentor.mutation(api.subAssemblies.setMembers, args);
    await mentor.mutation(api.subAssemblies.setMembers, args);
  });

  test("the allowance divides by how many of the assembly get built", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 6 });
    });
    const roller = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });
    await mentor.mutation(api.subAssemblies.setUnits, {
      id: roller.id,
      qtyNeeded: 2,
    });

    const demand = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
      forAssemblyId: roller.id,
    });
    // Six planned, two of this assembly: three each.
    expect(demand.allowance.find((a) => a.refId === parts[0])?.max).toBe(3);
  });
});

describe("building them one at a time", () => {
  test("counts up to needed plus spares and no further", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const roller = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });
    await mentor.mutation(api.subAssemblies.setUnits, {
      id: roller.id,
      qtyNeeded: 2,
      qtySpares: 1,
    });

    await mentor.mutation(api.subAssemblies.setQtyBuilt, {
      id: roller.id,
      qtyBuilt: 99,
    });
    expect((await t.run((ctx) => ctx.db.get(roller.id)))?.qtyBuilt).toBe(3);

    await mentor.mutation(api.subAssemblies.setQtyBuilt, {
      id: roller.id,
      qtyBuilt: -5,
    });
    expect((await t.run((ctx) => ctx.db.get(roller.id)))?.qtyBuilt).toBe(0);
  });
});

describe("an assembly placed more often than it's built", () => {
  test("says so, since the count is typed in rather than derived", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const roller = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [],
      cotsItemIds: [],
      childIds: [roller.id],
      quantities: [{ refId: roller.id, quantity: 2 }],
    });

    const demand = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });
    expect(demand.underbuilt).toHaveLength(1);
    expect(demand.underbuilt[0]).toMatchObject({ placed: 2, building: 1 });

    await mentor.mutation(api.subAssemblies.setUnits, {
      id: roller.id,
      qtyNeeded: 2,
    });
    const after = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });
    expect(after.underbuilt).toEqual([]);
  });
});

describe("one sub-assembly on its own", () => {
  test("can be fetched by id, and a stale id reads as gone", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);

    const got = await mentor.query(api.subAssemblies.get, {
      id: rows[0].assembly._id,
    });
    expect(got?.partNumber).toBe("27-INT-000");

    const { id } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    await mentor.mutation(api.subAssemblies.remove, { id });
    expect(await mentor.query(api.subAssemblies.get, { id })).toBeNull();
  });
});

describe("notes on a sub-assembly", () => {
  test("come back newest first, and an empty one is refused", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const id = rows[0].assembly._id;

    await mentor.mutation(api.subAssemblies.addNote, {
      subAssemblyId: id,
      body: "Left plate first",
    });
    await mentor.mutation(api.subAssemblies.addNote, {
      subAssemblyId: id,
      body: "  Bolts are M4  ",
    });

    const notes = await mentor.query(api.subAssemblies.notes, {
      subAssemblyId: id,
    });
    expect(notes.map((n) => n.body)).toEqual([
      "Bolts are M4",
      "Left plate first",
    ]);

    await expect(
      mentor.mutation(api.subAssemblies.addNote, {
        subAssemblyId: id,
        body: "   ",
      }),
    ).rejects.toThrow(/Write something/);
  });

  test("go when the sub-assembly does", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const { id } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    await mentor.mutation(api.subAssemblies.addNote, {
      subAssemblyId: id,
      body: "Scrapped the first one",
    });

    await mentor.mutation(api.subAssemblies.remove, { id });

    expect(
      await mentor.query(api.subAssemblies.notes, { subAssemblyId: id }),
    ).toEqual([]);
  });
});

describe("the history of a sub-assembly", () => {
  test("records the build count moving, but not a no-op", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const id = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setUnits, { id, qtyNeeded: 3 });

    await mentor.mutation(api.subAssemblies.setQtyBuilt, { id, qtyBuilt: 2 });
    await mentor.mutation(api.subAssemblies.setQtyBuilt, { id, qtyBuilt: 2 });

    const events = await mentor.query(api.subAssemblies.history, {
      subAssemblyId: id,
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("qty_built");
    expect(events[0].from).toBe(0);
    expect(events[0].to).toBe(2);
  });

  test("records being built and then reopened, newest first", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    const id = rows[0].assembly._id;
    await mentor.mutation(api.subAssemblies.setMembers, {
      id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    await putInBin(mentor, parts[0]);

    await mentor.mutation(api.subAssemblies.complete, { id });
    await mentor.mutation(api.subAssemblies.reopen, { id });

    const events = await mentor.query(api.subAssemblies.history, {
      subAssemblyId: id,
    });
    // Reopening also starts the count again, and says so.
    expect(events.map((e) => e.kind)).toEqual([
      "reopened",
      "qty_built",
      "built",
    ]);
    expect(events[0].userId).toBe("mentor_1");
    expect(events[1]).toMatchObject({ from: 1, to: 0 });
  });
});

describe("what no sub-assembly has spoken for", () => {
  test("lists a part nothing holds at all", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });

    const { loose } = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });

    // Two of the three parts are in nothing, so nothing is waiting on them.
    const untouched = loose.filter((l) => l.claimed === 0);
    expect(untouched).toHaveLength(2);
    expect(loose.find((l) => l.refId === parts[0])).toBeUndefined();
  });

  test("lists a part only some of which is spoken for", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 5 });
    });
    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
      quantities: [{ refId: parts[0], quantity: 2 }],
    });

    const { loose } = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });

    const partial = loose.find((l) => l.refId === parts[0]);
    expect(partial).toMatchObject({ planned: 5, claimed: 2, kind: "part" });
  });

  test("says nothing about a part the tree fully accounts for", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(parts[0], { qtyNeeded: 2 });
    });
    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
      quantities: [{ refId: parts[0], quantity: 2 }],
    });

    const { loose } = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });
    expect(loose.find((l) => l.refId === parts[0])).toBeUndefined();
  });

  test("counts a bought item the same way", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    await mentor.mutation(api.cots.create, {
      subsystemId: intake._id,
      name: "Bearing",
      qtyNeeded: 4,
    });

    const { loose } = await mentor.query(api.subAssemblies.demand, {
      subsystemId: intake._id,
    });

    const bearing = loose.find((l) => l.label === "Bearing");
    expect(bearing).toMatchObject({ kind: "cots", planned: 4, claimed: 0 });
  });
});

// Built means every unit is built. The count and the Done button are two
// records of one fact, and they mustn't be allowed to disagree.
describe("the build count and being built", () => {
  /** A roller inside the intake's -000, the roller built. */
  async function builtRoller(t: ReturnType<typeof convexTest>) {
    const base = await setup(t);
    const { mentor, intake } = base;
    const root = (await listFor(mentor, intake._id)).find(
      (r) => r.assembly.isDefault,
    )!.assembly._id;
    const { id: roller } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller",
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [],
      cotsItemIds: [],
      childIds: [roller],
    });
    await mentor.mutation(api.subAssemblies.complete, { id: roller });
    const get = (id: Id<"subAssemblies">) =>
      mentor.query(api.subAssemblies.get, { id });
    return { ...base, root, roller, get };
  }

  test("taking the count below full un-builds it", async () => {
    const t = convexTest(schema, modules);
    const { mentor, roller, get } = await builtRoller(t);
    expect((await get(roller))?.completedAt).toBeDefined();

    await mentor.mutation(api.subAssemblies.setQtyBuilt, {
      id: roller,
      qtyBuilt: 0,
    });
    const after = await get(roller);
    expect(after?.completedAt).toBeUndefined();
    expect(after?.qtyBuilt).toBe(0);
  });

  // This is why it matters: a built child unblocks its parent.
  test("and stops the assembly it sits in from going together", async () => {
    const t = convexTest(schema, modules);
    const { mentor, root, roller } = await builtRoller(t);
    await mentor.mutation(api.subAssemblies.setQtyBuilt, {
      id: roller,
      qtyBuilt: 0,
    });
    await expect(
      mentor.mutation(api.subAssemblies.complete, { id: root }),
    ).rejects.toThrow(/Roller/);
  });

  test("history says it was reopened, and by the count", async () => {
    const t = convexTest(schema, modules);
    const { mentor, roller } = await builtRoller(t);
    await mentor.mutation(api.subAssemblies.setQtyBuilt, {
      id: roller,
      qtyBuilt: 0,
    });
    const events = await mentor.query(api.subAssemblies.history, {
      subAssemblyId: roller,
    });
    expect(events.map((e) => e.kind)).toEqual([
      "reopened",
      "qty_built",
      "built",
    ]);
  });

  test("a student can't un-build one from the counter", async () => {
    const t = convexTest(schema, modules);
    const { roller, get } = await builtRoller(t);
    const student = t.withIdentity(studentIdentity());
    await student.mutation(api.auth.storeCurrentUser, {});

    await expect(
      student.mutation(api.subAssemblies.setQtyBuilt, {
        id: roller,
        qtyBuilt: 0,
      }),
    ).rejects.toThrow("The subsystem lead or a mentor changes a built one.");
    const still = await get(roller);
    expect(still?.completedAt).toBeDefined();
    expect(still?.qtyBuilt).toBe(1);
  });

  // Same rule as the Done button, so the counter is no way round it.
  test("only the lead of its own subsystem, not any lead", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, roller } = await builtRoller(t);
    const subsystems = await mentor.query(api.subsystems.list, {});
    const drivetrain = subsystems.find((s) => s.code === "DRV")!;
    for (const [who, subsystem] of [
      ["drv_lead", drivetrain],
      ["int_lead", intake],
    ] as const) {
      const lead = t.withIdentity({ subject: who, issuer: ISSUER });
      await lead.mutation(api.auth.storeCurrentUser, {});
      await mentor.mutation(api.shop.setUserRole, {
        userId: who,
        role: "lead",
      });
      await mentor.mutation(api.subsystems.update, {
        id: subsystem._id,
        leadUserId: who,
      });
    }

    const drvLead = t.withIdentity({ subject: "drv_lead", issuer: ISSUER });
    await expect(
      drvLead.mutation(api.subAssemblies.setQtyBuilt, {
        id: roller,
        qtyBuilt: 0,
      }),
    ).rejects.toThrow(/subsystem lead/);

    const intLead = t.withIdentity({ subject: "int_lead", issuer: ISSUER });
    await intLead.mutation(api.subAssemblies.setQtyBuilt, {
      id: roller,
      qtyBuilt: 0,
    });
  });

  // Done does more than count — it puts parts on the robot — so + doesn't.
  test("filling the count doesn't mark it built", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, get } = await builtRoller(t);
    const { id: frame } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    await mentor.mutation(api.subAssemblies.setQtyBuilt, {
      id: frame,
      qtyBuilt: 1,
    });
    const after = await get(frame);
    expect(after?.qtyBuilt).toBe(1);
    expect(after?.completedAt).toBeUndefined();
  });

  test("reopening starts the count again", async () => {
    const t = convexTest(schema, modules);
    const { mentor, roller, get } = await builtRoller(t);
    expect((await get(roller))?.qtyBuilt).toBe(1);

    await mentor.mutation(api.subAssemblies.reopen, { id: roller });
    const after = await get(roller);
    expect(after?.completedAt).toBeUndefined();
    expect(after?.qtyBuilt).toBe(0);
  });

  test("reopening one that's gone says so", async () => {
    const t = convexTest(schema, modules);
    const { mentor, roller } = await builtRoller(t);
    await t.run((ctx) => ctx.db.delete(roller));
    await expect(
      mentor.mutation(api.subAssemblies.reopen, { id: roller }),
    ).rejects.toThrow("That sub-assembly is gone.");
  });
});
