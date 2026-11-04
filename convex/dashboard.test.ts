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

async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
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

describe("the dashboard summary", () => {
  test("counts what's outstanding across all four things", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);

    await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    await mentor.mutation(api.todos.create, { title: "Pack the cart" });

    const summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.outstanding.parts).toBe(1);
    expect(summary.outstanding.todos).toBe(1);
    // seedDefaults gives every subsystem its default sub-assembly.
    expect(summary.outstanding.subAssemblies).toBe(5);
    expect(summary.outstanding.total).toBe(7);
  });

  test("a finished thing stops being outstanding", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const id = await mentor.mutation(api.todos.create, { title: "Pack" });

    expect(
      (await mentor.query(api.dashboard.summary, {})).outstanding.todos,
    ).toBe(1);
    await mentor.mutation(api.todos.setDone, { id, done: true });
    expect(
      (await mentor.query(api.dashboard.summary, {})).outstanding.todos,
    ).toBe(0);
    expect((await mentor.query(api.dashboard.summary, {})).todos.done).toBe(1);
  });

  test("'on you' counts only what you picked up", async () => {
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
    const todoId = await mentor.mutation(api.todos.create, { title: "Pack" });
    await student.mutation(api.parts.claim, { partId });
    await student.mutation(api.todos.claim, { id: todoId });

    const theirs = await student.query(api.dashboard.summary, {});
    expect(theirs.mine.parts).toBe(1);
    expect(theirs.mine.todos).toBe(1);
    expect(theirs.mine.total).toBe(2);

    const mentors = await mentor.query(api.dashboard.summary, {});
    expect(mentors.mine.total).toBe(0);
  });

  test("it says how many sub-assemblies could go together now", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const rows = await mentor.query(api.subAssemblies.list, {
      subsystemId: intake._id,
    });
    const root = rows[0].assembly._id;
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [partId],
      cotsItemIds: [],
      childIds: [],
    });

    // The part isn't in the bin, so this one is waiting. The four empty
    // defaults are ready, holding nothing.
    let summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.subAssemblies.readyToBuild).toBe(4);

    await mentor.mutation(api.parts.moveTo, { partId, stage: 5 });
    summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.subAssemblies.readyToBuild).toBe(5);

    await mentor.mutation(api.subAssemblies.complete, { id: root });
    summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.subAssemblies.built).toBe(1);
    expect(summary.subAssemblies.readyToBuild).toBe(4);
  });

  // The test above only ever put parts in an assembly, so it couldn't see that
  // the dashboard left bought items out of the count altogether.
  test("an assembly waiting on something bought isn't ready to build", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await mentor.query(api.subAssemblies.list, {
      subsystemId: intake._id,
    });
    const root = rows[0].assembly._id;
    const motor = await mentor.mutation(api.cots.create, {
      subsystemId: intake._id,
      name: "Kraken X60",
      qtyNeeded: 1,
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [],
      cotsItemIds: [motor],
      childIds: [],
    });

    // The motor hasn't been bought: the four empty defaults are ready, this
    // one isn't — and the Done button agrees.
    let summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.subAssemblies.readyToBuild).toBe(4);
    await expect(
      mentor.mutation(api.subAssemblies.complete, { id: root }),
    ).rejects.toThrow();

    await mentor.mutation(api.cots.setStatus, { id: motor, status: "ordered" });
    summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.subAssemblies.readyToBuild).toBe(4); // on its way isn't here

    await mentor.mutation(api.cots.setStatus, { id: motor, status: "arrived" });
    summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.subAssemblies.readyToBuild).toBe(5);
  });

  test("agrees with each person's own list about what's ready", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const rows = await mentor.query(api.subAssemblies.list, {
      subsystemId: intake._id,
    });
    const root = rows[0].assembly._id;
    const motor = await mentor.mutation(api.cots.create, {
      subsystemId: intake._id,
      name: "Kraken X60",
      qtyNeeded: 1,
    });
    await mentor.mutation(api.subAssemblies.setMembers, {
      id: root,
      partIds: [],
      cotsItemIds: [motor],
      childIds: [],
    });
    await mentor.mutation(api.subAssemblies.claim, { id: root });

    const [mine] = await mentor.query(api.subAssemblies.listMine, {});
    expect(mine.ready).toBe(false);
    expect(mine.summary).toContain("Kraken X60");
  });

  test("an empty app reports zeroes rather than failing", async () => {
    const t = convexTest(schema, modules);
    const anyone = t.withIdentity(identity("student_1"));
    const summary = await anyone.query(api.dashboard.summary, {});
    expect(summary.outstanding.total).toBe(0);
    expect(summary.nextCompetition).toBeNull();
  });
});

describe("what still has to be bought", () => {
  test("splits what needs ordering from what's only waiting on the post", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);

    const made = [];
    for (const [name, status] of [
      ["Wheels", "needed"],
      ["Belt", "needed"],
      ["Bearings", "ordered"],
      ["Standoffs", "arrived"],
    ] as const) {
      made.push(
        await mentor.mutation(api.cots.create, {
          subsystemId: intake._id,
          name,
          qtyNeeded: 1,
          status,
        }),
      );
    }
    expect(made).toHaveLength(4);

    const summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.bought).toEqual({
      toOrder: 2,
      ordered: 1,
      arrived: 1,
      total: 4,
    });
  });

  test("reads zero when nothing has been bought", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const summary = await mentor.query(api.dashboard.summary, {});
    expect(summary.bought).toEqual({
      toOrder: 0,
      ordered: 0,
      arrived: 0,
      total: 0,
    });
  });
});

describe("when a bought item moved", () => {
  async function anItem(t: ReturnType<typeof convexTest>) {
    const { mentor, intake } = await setup(t);
    const id = await mentor.mutation(api.cots.create, {
      subsystemId: intake._id,
      name: "Wheels",
      qtyNeeded: 4,
    });
    return { mentor, id };
  }

  test("ordering one stamps today without anyone typing a date", async () => {
    const t = convexTest(schema, modules);
    const { mentor, id } = await anItem(t);
    const before = Date.now();

    await mentor.mutation(api.cots.setStatus, { id, status: "ordered" });

    const item = await t.run((ctx) => ctx.db.get(id));
    expect(item?.orderedAt).toBeGreaterThanOrEqual(before);
    expect(item?.arrivedAt).toBeUndefined();
  });

  test("marking it arrived stamps that too, and keeps the order date", async () => {
    const t = convexTest(schema, modules);
    const { mentor, id } = await anItem(t);
    await mentor.mutation(api.cots.setStatus, { id, status: "ordered" });
    const ordered = (await t.run((ctx) => ctx.db.get(id)))?.orderedAt;

    await mentor.mutation(api.cots.setStatus, { id, status: "arrived" });

    const item = await t.run((ctx) => ctx.db.get(id));
    expect(item?.orderedAt).toBe(ordered);
    expect(item?.arrivedAt).toBeTypeOf("number");
  });

  test("re-marking it doesn't move the date it already has", async () => {
    const t = convexTest(schema, modules);
    const { mentor, id } = await anItem(t);
    await mentor.mutation(api.cots.setStatus, { id, status: "ordered" });
    const first = (await t.run((ctx) => ctx.db.get(id)))?.orderedAt;

    await mentor.mutation(api.cots.setStatus, { id, status: "ordered" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.orderedAt).toBe(first);
  });

  test("moving it back forgets what hadn't happened after all", async () => {
    const t = convexTest(schema, modules);
    const { mentor, id } = await anItem(t);
    await mentor.mutation(api.cots.setStatus, { id, status: "arrived" });

    await mentor.mutation(api.cots.setStatus, { id, status: "ordered" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.arrivedAt).toBeUndefined();

    await mentor.mutation(api.cots.setStatus, { id, status: "needed" });
    const item = await t.run((ctx) => ctx.db.get(id));
    expect(item?.orderedAt).toBeUndefined();
    expect(item?.eta).toBeUndefined();
  });

  test("a date typed in afterwards wins over the stamp", async () => {
    // "It actually came on Tuesday."
    const t = convexTest(schema, modules);
    const { mentor, id } = await anItem(t);
    const tuesday = new Date("2026-03-03T12:00:00").getTime();

    await mentor.mutation(api.cots.setStatus, { id, status: "arrived" });
    await mentor.mutation(api.cots.setStatus, {
      id,
      status: "arrived",
      arrivedAt: tuesday,
    });

    expect((await t.run((ctx) => ctx.db.get(id)))?.arrivedAt).toBe(tuesday);
  });
});
