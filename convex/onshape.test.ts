// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { TestConvex } from "convex-test";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// Create a project (tag "88" — deliberately NOT the current year, to prove the
// tag drives the number) and a document "docA"/"02" mapped to it. Returns the
// project id.
async function mapDocument(
  t: TestConvex<typeof schema>,
  opts: { tag?: string; mode?: "auto" | "manual" } = {},
): Promise<Id<"projects">> {
  const tag = opts.tag ?? "88";
  const mode = opts.mode ?? "auto";
  return t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: `Project ${tag}`,
      tag,
      numberingMode: mode,
    });
    await ctx.db.insert("onshapeDocuments", {
      onshapeDocumentId: "docA",
      documentNumber: "02",
      name: "Drivetrain",
      projectId,
    });
    return projectId;
  });
}

async function asMentor(t: TestConvex<typeof schema>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "mentor1",
      email: "m@example.com",
      name: "Mentor",
      role: "mentor",
    });
  });
  return t.withIdentity({
    subject: "mentor1",
    issuer: "https://example.workos.com",
  });
}

describe("bidirectional part numbers (upsertPartFromOnshape)", () => {
  test("adopts an Onshape-provided number and asks for no write-back", async () => {
    const t = convexTest(schema, modules);
    await mapDocument(t);
    const res = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:part1",
      onshapeDocumentId: "docA",
      name: "Gearbox plate",
      onshapePartNumber: "EXISTING-123",
    });
    expect(res.partNumber).toBe("EXISTING-123");
    expect(res.writeBackPartNumber).toBeNull();
  });

  test("auto project generates 4392-<tag>-DD0001 from the project tag, not the year", async () => {
    const t = convexTest(schema, modules);
    const projectId = await mapDocument(t, { tag: "88", mode: "auto" });
    const res = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:part2",
      onshapeDocumentId: "docA",
      name: "Bracket",
    });
    expect(res.partNumber).toBe("4392-88-020001");
    expect(res.writeBackPartNumber).toBe("4392-88-020001");
    // The part is stamped with its project.
    const part = await t.run((ctx) => ctx.db.get(res.partId));
    expect(part?.projectId).toBe(projectId);
  });

  test("manual project never generates a number", async () => {
    const t = convexTest(schema, modules);
    await mapDocument(t, { tag: "SWERVE", mode: "manual" });
    const res = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:sw1",
      onshapeDocumentId: "docA",
      name: "Azimuth plate",
    });
    expect(res.partNumber).toBeNull();
    expect(res.writeBackPartNumber).toBeNull();

    // …but it still adopts a number Onshape supplies.
    const withNum = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:sw1",
      onshapeDocumentId: "docA",
      name: "Azimuth plate",
      onshapePartNumber: "4392-SWERVE-P30",
    });
    expect(withNum.partNumber).toBe("4392-SWERVE-P30");
  });

  test("re-sync of a numbered part with no Onshape number pushes the existing number back", async () => {
    const t = convexTest(schema, modules);
    await mapDocument(t);
    const first = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:part3",
      onshapeDocumentId: "docA",
      name: "Standoff",
    });
    // Onshape still reports no number → keep ours and ask to push it.
    const second = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:part3",
      onshapeDocumentId: "docA",
      name: "Standoff",
    });
    expect(second.partNumber).toBe(first.partNumber);
    expect(second.writeBackPartNumber).toBe(first.partNumber);
  });

  test("a newly synced part defaults to the in_design status", async () => {
    const t = convexTest(schema, modules);
    await mapDocument(t);
    const res = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "e:fresh",
      onshapeDocumentId: "docA",
      name: "Fresh part",
    });
    const part = await t.run((ctx) => ctx.db.get(res.partId));
    expect(part?.status).toBe("in_design");
  });

  test("adopting an Onshape number on re-sync overwrites the local one, no write-back", async () => {
    const t = convexTest(schema, modules);
    await mapDocument(t);
    const first = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:part4",
      onshapeDocumentId: "docA",
      name: "Hub",
    });
    const second = await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "elem:part4",
      onshapeDocumentId: "docA",
      name: "Hub",
      onshapePartNumber: "HUB-9000",
    });
    expect(first.partNumber).toMatch(/^4392-88-/);
    expect(second.partNumber).toBe("HUB-9000");
    expect(second.writeBackPartNumber).toBeNull();
  });
});

describe("previewNumbers (read-only projection)", () => {
  test("projects the numbers upsert would assign without consuming the counter", async () => {
    const t = convexTest(schema, modules);
    await mapDocument(t, { tag: "88", mode: "auto" });

    const preview = await t.query(internal.onshape.previewNumbers, {
      items: [
        { onshapeElementId: "e:a", onshapeDocumentId: "docA" },
        { onshapeElementId: "e:b", onshapeDocumentId: "docA" },
        {
          onshapeElementId: "e:c",
          onshapeDocumentId: "docA",
          onshapePartNumber: "EXT-1",
        },
      ],
    });

    expect(preview[0].partNumber).toBe("4392-88-020001");
    expect(preview[0].willWriteBack).toBe(true);
    expect(preview[1].partNumber).toBe("4392-88-020002");
    expect(preview[2].partNumber).toBe("EXT-1");
    expect(preview[2].willWriteBack).toBe(false);

    // Counter untouched: the real generator still hands out 0001 first.
    const generated = await t.mutation(internal.onshape.generatePartNumber, {
      tag: "88",
      documentNumber: "02",
    });
    expect(generated).toBe("4392-88-020001");
  });

  test("manual project projects a null number", async () => {
    const t = convexTest(schema, modules);
    await mapDocument(t, { tag: "SWERVE", mode: "manual" });
    const preview = await t.query(internal.onshape.previewNumbers, {
      items: [{ onshapeElementId: "e:x", onshapeDocumentId: "docA" }],
    });
    expect(preview[0].partNumber).toBeNull();
    expect(preview[0].willWriteBack).toBe(false);
  });
});

describe("projects", () => {
  test("create rejects a duplicate tag", async () => {
    const t = convexTest(schema, modules);
    const mentor = await asMentor(t);
    await mentor.mutation(api.projects.create, {
      name: "Comp robot",
      tag: "26",
      numberingMode: "auto",
    });
    await expect(
      mentor.mutation(api.projects.create, {
        name: "Other",
        tag: "26",
        numberingMode: "manual",
      }),
    ).rejects.toThrow();
  });
});

describe("project scoping of part tasks/boards", () => {
  test("a synced part's task and its Manufacturing board carry the project", async () => {
    const t = convexTest(schema, modules);
    const projectId = await mapDocument(t, { tag: "26", mode: "auto" });
    await t.mutation(internal.onshape.upsertPartFromOnshape, {
      onshapeElementId: "e:pb",
      onshapeDocumentId: "docA",
      name: "Plate",
    });
    const { tasks, boards } = await t.run(async (ctx) => ({
      tasks: await ctx.db.query("tasks").collect(),
      boards: await ctx.db.query("boards").collect(),
    }));
    const task = tasks.find((task) => task.source === "part");
    expect(task?.projectId).toBe(projectId);
    const board = boards.find((b) => b.subsystem === "manufacturing");
    expect(board?.projectId).toBe(projectId);
  });
});

describe("setThumbnailInternal", () => {
  let t: TestConvex<typeof schema>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  test("replaces the existing thumbnail and deletes the old blob", async () => {
    const asUser = t.withIdentity({
      subject: "u1",
      issuer: "https://example.workos.com",
    });
    const partId = await asUser.mutation(api.parts.create, {
      name: "Plate",
      manufacturingMethod: "mill",
    });

    const first = await t.run((ctx) =>
      ctx.storage.store(new Blob(["a"], { type: "image/png" })),
    );
    await t.mutation(internal.parts.setThumbnailInternal, {
      id: partId,
      storageId: first,
    });

    const second = await t.run((ctx) =>
      ctx.storage.store(new Blob(["b"], { type: "image/png" })),
    );
    await t.mutation(internal.parts.setThumbnailInternal, {
      id: partId,
      storageId: second,
    });

    const part = await t.run((ctx) => ctx.db.get(partId));
    expect(part?.thumbnailStorageId).toBe(second);
    const oldMeta = await t.run((ctx) => ctx.db.system.get(first));
    expect(oldMeta).toBeNull();
  });
});
