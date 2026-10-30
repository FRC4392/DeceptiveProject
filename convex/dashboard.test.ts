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

  test("an empty app reports zeroes rather than failing", async () => {
    const t = convexTest(schema, modules);
    const anyone = t.withIdentity(identity("student_1"));
    const summary = await anyone.query(api.dashboard.summary, {});
    expect(summary.outstanding.total).toBe(0);
    expect(summary.nextCompetition).toBeNull();
  });
});
