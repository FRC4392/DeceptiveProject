// @vitest-environment edge-runtime
/// <reference types="vite/client" />
//
// Who may read what. Every query is a public endpoint — the sign-in screen
// only decides what the browser renders — so each one has to check for
// itself. These pin that down module by module.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

function identity(subject: string, role: "mentor" | "student" = "student") {
  return { subject, issuer: ISSUER, email: `${subject}@example.com`, role };
}

/** A season with one part, one note, one to-do — enough to have something to leak. */
async function seeded(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  const [subsystem] = await mentor.query(api.subsystems.list, {});
  const [process] = await mentor.query(api.shop.listProcessTypes, {});
  const { partId } = await mentor.mutation(api.parts.createWithNumber, {
    subsystemId: subsystem._id,
    name: "Side plate",
    processTypeId: process._id,
    qtyNeeded: 2,
  });
  await mentor.mutation(api.parts.addNote, { partId, body: "internal" });
  await mentor.mutation(api.todos.create, { title: "Order bearings" });

  const student = t.withIdentity(identity("student_1"));
  await student.mutation(api.auth.storeCurrentUser, {});
  return { mentor, student, subsystem, partId };
}

describe("someone who isn't signed in", () => {
  test("reads nothing from any module", async () => {
    const t = convexTest(schema, modules);
    const { mentor, subsystem, partId } = await seeded(t);
    // Something is really there, so an empty answer below means "refused".
    expect(await mentor.query(api.parts.list, {})).toHaveLength(1);

    expect(await t.query(api.parts.list, {})).toEqual([]);
    expect(await t.query(api.parts.get, { id: partId })).toBeNull();
    expect(await t.query(api.parts.notes, { partId })).toEqual([]);
    expect(await t.query(api.parts.history, { partId })).toEqual([]);
    expect(await t.query(api.parts.search, { query: "Side" })).toEqual([]);
    expect(await t.query(api.parts.thumbnailUrl, { partId })).toBeNull();
    expect(await t.query(api.todos.list, {})).toEqual([]);
    expect(await t.query(api.todos.listTags, {})).toEqual([]);
    expect(
      await t.query(api.subAssemblies.list, { subsystemId: subsystem._id }),
    ).toEqual([]);
    expect(
      await t.query(api.cots.list, { subsystemId: subsystem._id }),
    ).toEqual([]);
    expect(await t.query(api.inventory.list, {})).toEqual([]);
    expect(await t.query(api.seasons.active, {})).toBeNull();
    expect(await t.query(api.seasons.list, {})).toEqual([]);
    expect(await t.query(api.subsystems.list, {})).toEqual([]);
    expect(await t.query(api.subsystems.get, { id: subsystem._id })).toBeNull();
    expect(await t.query(api.shop.listProcessTypes, {})).toEqual([]);
    expect(await t.query(api.shop.listMachines, {})).toEqual([]);
    expect(await t.query(api.competitions.list, {})).toEqual([]);
    expect(await t.query(api.competitions.next, {})).toBeNull();
    expect(await t.query(api.github.list, {})).toEqual([]);
    expect(await t.query(api.users.list, {})).toEqual([]);
  });

  test("gets an empty dashboard rather than the team's real totals", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await seeded(t);
    expect((await mentor.query(api.dashboard.summary, {})).parts.total).toBe(1);

    const summary = await t.query(api.dashboard.summary, {});
    expect(summary.parts.total).toBe(0);
    expect(summary.outstanding.total).toBe(0);
    expect(summary.todos.total).toBe(0);
  });
});

describe("a student", () => {
  test("reads the team's work like anyone on the team", async () => {
    const t = convexTest(schema, modules);
    const { student, subsystem } = await seeded(t);
    expect(await student.query(api.parts.list, {})).toHaveLength(1);
    expect(await student.query(api.todos.list, {})).toHaveLength(1);
    // The subsystem page shows its shortfall panels to everyone, so this
    // stays open to the whole team rather than to leads.
    const demand = await student.query(api.subAssemblies.demand, {
      subsystemId: subsystem._id,
    });
    expect(demand.units.length).toBeGreaterThan(0);
  });

  test("doesn't get the lead's intake queue or budget", async () => {
    const t = convexTest(schema, modules);
    const { mentor, student } = await seeded(t);
    await mentor.mutation(api.intake.addManual, {
      label: "Hand entry",
      text: "27-DRV-001",
    });
    await t.mutation(internal.onshape.recordApiCall, {
      method: "GET",
      endpoint: "/api/parts",
      status: 200,
    });
    expect(await mentor.query(api.intake.list, {})).toHaveLength(1);
    expect((await mentor.query(api.settings.budget, {})).used).toBe(1);

    expect(await student.query(api.intake.list, {})).toEqual([]);
    expect(await student.query(api.intake.pendingCount, {})).toBe(0);
    expect((await student.query(api.settings.budget, {})).used).toBe(0);
    expect(await student.query(api.parts.headsUp, {})).toEqual([]);
  });

  test("doesn't get what's behind the mentor-only admin pages", async () => {
    const t = convexTest(schema, modules);
    const { mentor, student } = await seeded(t);
    await mentor.mutation(api.settings.set, { key: "apiLimit", value: 999 });
    expect((await mentor.query(api.settings.get, {})).apiLimit).toBe(999);
    expect(await mentor.query(api.subsystems.nextNumbers, {})).not.toEqual([]);

    // The defaults, not the team's own settings.
    expect((await student.query(api.settings.get, {})).apiLimit).toBe(2500);
    expect(await student.query(api.subsystems.nextNumbers, {})).toEqual([]);
    expect(await student.query(api.onshape.listDocuments, {})).toEqual([]);
    expect(await student.query(api.github.config, {})).toEqual({
      webhookConfigured: false,
      tokenConfigured: false,
    });
    const connection = await student.query(
      api.onshapeOAuth.connectionStatus,
      {},
    );
    expect(connection.connected).toBe(false);
    expect(connection.connectedBy).toBeNull();
  });
});

// Sign-in writes the `users` row from the browser. If that write hasn't
// landed, the person is still whoever their session says — not locked out
// of every page with nothing on screen to say why.
describe("a mentor whose user row hasn't been written yet", () => {
  test("still reads the admin pages, going by their session", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await seeded(t);
    await mentor.mutation(api.settings.set, { key: "apiLimit", value: 999 });

    // Never calls storeCurrentUser.
    const rowless = t.withIdentity(identity("mentor_2", "mentor"));
    expect((await rowless.query(api.settings.get, {})).apiLimit).toBe(999);
    expect(await rowless.query(api.subsystems.nextNumbers, {})).not.toEqual([]);
  });

  test("agrees with what the screens are told about them", async () => {
    const t = convexTest(schema, modules);
    await seeded(t);
    const rowless = t.withIdentity(identity("mentor_2", "mentor"));
    // The screens decide what to render from this; the reads above decide
    // what comes back. They must not disagree.
    expect((await rowless.query(api.auth.currentUser, {}))?.role).toBe(
      "mentor",
    );
  });
});
