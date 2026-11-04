// @vitest-environment edge-runtime
/// <reference types="vite/client" />
//
// Moving a bought item forward is anyone's job; moving it back undoes what
// someone recorded, so it's a lead's. The screens only offer "Move it back"
// to a lead — this is the server agreeing.
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
  const [subsystem] = await mentor.query(api.subsystems.list, {});

  const student = t.withIdentity(identity("student_1"));
  await student.mutation(api.auth.storeCurrentUser, {});
  const lead = t.withIdentity(identity("lead_1"));
  await lead.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.shop.setUserRole, {
    userId: "lead_1",
    role: "lead",
  });

  const id = await student.mutation(api.cots.create, {
    subsystemId: subsystem._id,
    name: "Kraken X60",
    qtyNeeded: 2,
  });
  const read = async () =>
    (await mentor.query(api.cots.list, { subsystemId: subsystem._id })).find(
      (c) => c._id === id,
    )!;
  return { student, lead, id, read };
}

describe("moving a bought item", () => {
  test("anyone can move one forward", async () => {
    const t = convexTest(schema, modules);
    const { student, id, read } = await setup(t);
    await student.mutation(api.cots.setStatus, { id, status: "ordered" });
    await student.mutation(api.cots.setStatus, { id, status: "arrived" });
    expect((await read()).status).toBe("arrived");
  });

  test("a student can't move one back", async () => {
    const t = convexTest(schema, modules);
    const { student, id, read } = await setup(t);
    await student.mutation(api.cots.setStatus, { id, status: "arrived" });
    const arrivedAt = (await read()).arrivedAt;

    await expect(
      student.mutation(api.cots.setStatus, { id, status: "needed" }),
    ).rejects.toThrow("A lead or a mentor moves a bought item back.");
    // And nothing was cleared on the way.
    expect(await read()).toMatchObject({ status: "arrived", arrivedAt });
  });

  test("a lead can move one back", async () => {
    const t = convexTest(schema, modules);
    const { student, lead, id, read } = await setup(t);
    await student.mutation(api.cots.setStatus, { id, status: "arrived" });
    await lead.mutation(api.cots.setStatus, { id, status: "ordered" });
    expect((await read()).status).toBe("ordered");
  });

  // "It actually came on Tuesday" — open to everyone, as the screens have it.
  test("anyone can correct a date without moving it", async () => {
    const t = convexTest(schema, modules);
    const { student, id, read } = await setup(t);
    await student.mutation(api.cots.setStatus, { id, status: "arrived" });
    const tuesday = new Date(2027, 1, 2).getTime();
    await student.mutation(api.cots.setStatus, {
      id,
      status: "arrived",
      arrivedAt: tuesday,
    });
    expect((await read()).arrivedAt).toBe(tuesday);
  });
});
