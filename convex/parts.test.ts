// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const IDENTITY = {
  subject: "user_test",
  issuer: "https://example.clerk.accounts.dev",
};

describe("part → task sync", () => {
  test("creating a part creates a linked Manufacturing task", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(IDENTITY);

    const partId = await asUser.mutation(api.parts.create, {
      name: "Gearbox plate",
      manufacturingMethod: "mill",
    });

    const { tasks, boards } = await t.run(async (ctx) => ({
      tasks: await ctx.db.query("tasks").collect(),
      boards: await ctx.db.query("boards").collect(),
    }));

    expect(tasks).toHaveLength(1);
    expect(tasks[0].source).toBe("part");
    expect(tasks[0].sourceId).toBe(partId);
    expect(tasks[0].status).toBe("todo");
    expect(boards.some((b) => b.subsystem === "manufacturing")).toBe(true);
  });

  test("installed completes the task; blocked flags it and clears completion", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(IDENTITY);

    const partId = await asUser.mutation(api.parts.create, {
      name: "Bracket",
      manufacturingMethod: "waterjet",
    });

    await asUser.mutation(api.parts.updateStatus, {
      id: partId,
      status: "installed",
    });
    let task = await t.run((ctx) => ctx.db.query("tasks").first());
    expect(task?.status).toBe("done");
    expect(task?.completedAt).toBeTypeOf("number");

    await asUser.mutation(api.parts.flagBlocked, {
      id: partId,
      blocked: true,
      reason: "waiting on stock",
    });
    task = await t.run((ctx) => ctx.db.query("tasks").first());
    expect(task?.status).toBe("blocked");
    expect(task?.completedAt).toBeUndefined();
  });

  test("create requires authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.parts.create, {
        name: "x",
        manufacturingMethod: "mill",
      }),
    ).rejects.toThrow();
  });
});
