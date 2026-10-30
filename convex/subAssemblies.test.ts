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
  test("a part belongs to one — adding it elsewhere moves it", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const frame = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Frame",
    });
    const rollers = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Rollers",
    });

    await mentor.mutation(api.subAssemblies.setMembers, {
      id: frame.id,
      partIds: [parts[0], parts[1]],
      cotsItemIds: [],
      childIds: [],
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rollers.id,
      partIds: [parts[1], parts[2]],
      cotsItemIds: [],
      childIds: [],
    });

    const rows = await listFor(mentor, intake._id);
    expect(rows.find((r) => r.assembly._id === frame.id)!.partIds).toEqual([
      parts[0],
    ]);
    expect(rows.find((r) => r.assembly._id === rollers.id)!.partIds).toEqual([
      parts[1],
      parts[2],
    ]);
  });

  test("so does a sub-assembly — it has at most one parent", async () => {
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
    expect(after.find((r) => r.assembly._id === root)!.childIds).toEqual([]);
    expect(after.find((r) => r.assembly._id === other.id)!.childIds).toEqual([
      frame.id,
    ]);
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

  test("anything no sub-assembly holds shows as unassigned", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, parts } = await setup(t);
    const before = await mentor.query(api.subAssemblies.unassigned, {
      subsystemId: intake._id,
    });
    expect(before.partIds).toHaveLength(3);

    const rows = await listFor(mentor, intake._id);
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: rows[0].assembly._id,
      partIds: [parts[0]],
      cotsItemIds: [],
      childIds: [],
    });
    const after = await mentor.query(api.subAssemblies.unassigned, {
      subsystemId: intake._id,
    });
    expect(after.partIds).toHaveLength(2);
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
