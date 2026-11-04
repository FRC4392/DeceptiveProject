// @vitest-environment edge-runtime
/// <reference types="vite/client" />
//
// Counters send a step, not the number they want. Two people looking at the
// same count and both pressing + is two more, not one more.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { requestedCount } from "./lib/counts";

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
  const [subsystem] = await mentor.query(api.subsystems.list, {});
  const [process] = await mentor.query(api.shop.listProcessTypes, {});
  return { mentor, subsystem, process };
}

describe("the rule", () => {
  test("a step moves from the count as it stands", () => {
    expect(requestedCount(4, { delta: 1 })).toBe(5);
    expect(requestedCount(4, { delta: -1 })).toBe(3);
  });
  test("a typed number is taken as given", () => {
    expect(requestedCount(4, { value: 9 })).toBe(9);
  });
  test("it has to be one or the other", () => {
    expect(() => requestedCount(4, {})).toThrow();
    expect(() => requestedCount(4, { value: 1, delta: 1 })).toThrow();
  });
});

describe("two people pressing + on the same count", () => {
  test("both land on a part's made count", async () => {
    const t = convexTest(schema, modules);
    const { mentor, subsystem, process } = await setup(t);
    const { partId } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: subsystem._id,
      name: "Side plate",
      processTypeId: process._id,
      qtyNeeded: 6,
    });
    await mentor.mutation(api.parts.setQtyMade, { partId, qtyMade: 2 });

    // Both screens show 2. Each presses +.
    await mentor.mutation(api.parts.setQtyMade, { partId, delta: 1 });
    await mentor.mutation(api.parts.setQtyMade, { partId, delta: 1 });
    expect((await mentor.query(api.parts.get, { id: partId }))?.qtyMade).toBe(
      4,
    );
  });

  test("both land on a sub-assembly's built count, and both are in its history", async () => {
    const t = convexTest(schema, modules);
    const { mentor, subsystem } = await setup(t);
    const { id } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: subsystem._id,
      name: "Roller",
    });
    await mentor.mutation(api.subAssemblies.setUnits, {
      id,
      qtyNeeded: 3,
    });

    await mentor.mutation(api.subAssemblies.setQtyBuilt, { id, delta: 1 });
    await mentor.mutation(api.subAssemblies.setQtyBuilt, { id, delta: 1 });
    expect((await mentor.query(api.subAssemblies.get, { id }))?.qtyBuilt).toBe(
      2,
    );

    const counted = (
      await mentor.query(api.subAssemblies.history, { subAssemblyId: id })
    ).filter((e) => e.kind === "qty_built");
    expect(counted).toHaveLength(2);
  });

  test("both land on what's on the shelf", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const id = await mentor.mutation(api.inventory.create, {
      name: "M5 bolts",
      onHandQty: 10,
    });
    await mentor.mutation(api.inventory.update, { id, onHandQtyDelta: -1 });
    await mentor.mutation(api.inventory.update, { id, onHandQtyDelta: -1 });
    const [item] = await mentor.query(api.inventory.list, {});
    expect(item.onHandQty).toBe(8);
  });
});

describe("what's on the shelf", () => {
  test("never goes below none, however many presses of −", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const id = await mentor.mutation(api.inventory.create, {
      name: "Zip ties",
      onHandQty: 1,
    });
    await mentor.mutation(api.inventory.update, { id, onHandQtyDelta: -1 });
    await mentor.mutation(api.inventory.update, { id, onHandQtyDelta: -1 });
    expect((await mentor.query(api.inventory.list, {}))[0].onHandQty).toBe(0);
  });

  test("a typed count is whole and not negative", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const id = await mentor.mutation(api.inventory.create, {
      name: "Washers",
      onHandQty: -3,
    });
    expect((await mentor.query(api.inventory.list, {}))[0].onHandQty).toBe(0);
    await mentor.mutation(api.inventory.update, { id, onHandQty: 4.6 });
    expect((await mentor.query(api.inventory.list, {}))[0].onHandQty).toBe(5);
  });

  test("renaming one leaves its count alone", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const id = await mentor.mutation(api.inventory.create, {
      name: "Nuts",
      onHandQty: 7,
    });
    await mentor.mutation(api.inventory.update, { id, name: "M5 nuts" });
    const [item] = await mentor.query(api.inventory.list, {});
    expect(item).toMatchObject({ name: "M5 nuts", onHandQty: 7 });
  });
});
