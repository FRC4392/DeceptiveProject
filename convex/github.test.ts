// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { TestConvex } from "convex-test";

const modules = import.meta.glob("./**/*.ts");

async function asUser(t: TestConvex<typeof schema>, subject = "u1") {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", subject))
      .unique();
    if (!existing) {
      await ctx.db.insert("users", {
        authId: subject,
        email: `${subject}@example.com`,
        name: subject,
        role: "student",
      });
    }
  });
  return t.withIdentity({
    subject,
    issuer: "https://example.workos.com",
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

// Args mirroring what the webhook's normalizeIssueNode produces.
function upsertArgs(overrides: Record<string, unknown> = {}) {
  return {
    repo: "deceivers/robot",
    number: 7,
    githubId: 100,
    title: "Drive motor stalls",
    state: "open" as const,
    labels: ["bug"],
    assigneeLogins: [],
    isPullRequest: false,
    ...overrides,
  };
}

describe("syncTaskForIssue (via upsertIssueFromWebhook)", () => {
  test("a synced issue creates a linked task on a Software board", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );

    const { issue, task, board } = await t.run(async (ctx) => {
      const issue = await ctx.db.get(id);
      const task = issue?.linkedTaskId
        ? await ctx.db.get(issue.linkedTaskId)
        : null;
      const board = task ? await ctx.db.get(task.boardId) : null;
      return { issue, task, board };
    });

    expect(issue?.source).toBe("github");
    expect(task?.source).toBe("issue");
    expect(task?.sourceId).toBe(id);
    expect(task?.status).toBe("todo");
    expect(task?.title).toBe("Issue #7: Drive motor stalls");
    expect(board?.subsystem).toBe("software");
  });

  test("re-sync is idempotent and updates the same task", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );
    const second = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ title: "Drive motor stalls intermittently" }),
    );
    expect(second).toBe(first);

    const { issueCount, tasks } = await t.run(async (ctx) => ({
      issueCount: (await ctx.db.query("issues").collect()).length,
      tasks: await ctx.db.query("tasks").collect(),
    }));
    expect(issueCount).toBe(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Issue #7: Drive motor stalls intermittently");
  });

  test("closing an issue marks its task done with completedAt", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );
    await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ state: "closed" }),
    );
    const task = await t.run(async (ctx) => {
      const issue = await ctx.db.get(id);
      return issue?.linkedTaskId ? ctx.db.get(issue.linkedTaskId) : null;
    });
    expect(task?.status).toBe("done");
    expect(task?.completedAt).toBeTypeOf("number");
  });

  test("priority is derived from labels", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ labels: ["bug", "urgent"] }),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priority).toBe("high");
  });

  test("a PR is labeled and titled as a PR", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ number: 12, isPullRequest: true, title: "Add climber" }),
    );
    const task = await t.run(async (ctx) => {
      const issue = await ctx.db.get(id);
      return issue?.linkedTaskId ? ctx.db.get(issue.linkedTaskId) : null;
    });
    expect(task?.title).toBe("PR #12: Add climber");
    expect(task?.labels).toContain("pr");
  });
});

describe("comment mirroring", () => {
  test("upsert then delete a GitHub comment", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs());

    await t.mutation(internal.github.upsertCommentFromWebhook, {
      repo: "deceivers/robot",
      number: 7,
      githubCommentId: 555,
      authorLogin: "carol",
      body: "Looking into it.",
    });
    let comments = await t.query(api.github.listComments, {
      issueId: (await firstIssueId(t)),
    });
    expect(comments).toHaveLength(1);
    expect(comments[0].authorLogin).toBe("carol");

    // Editing the same GitHub comment id updates in place (no duplicate).
    await t.mutation(internal.github.upsertCommentFromWebhook, {
      repo: "deceivers/robot",
      number: 7,
      githubCommentId: 555,
      authorLogin: "carol",
      body: "Fixed in #8.",
    });
    comments = await t.query(api.github.listComments, {
      issueId: await firstIssueId(t),
    });
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Fixed in #8.");

    await t.mutation(internal.github.deleteCommentFromWebhook, {
      githubCommentId: 555,
    });
    comments = await t.query(api.github.listComments, {
      issueId: await firstIssueId(t),
    });
    expect(comments).toHaveLength(0);
  });
});

describe("manual issues", () => {
  test("createManualIssue makes a to-do and setState closes it", async () => {
    const t = convexTest(schema, modules);
    const user = await asUser(t);
    const id = await user.mutation(api.github.createManualIssue, {
      title: "Auton drifts left",
      priority: "high",
    });

    let task = await t.run(async (ctx) => {
      const issue = await ctx.db.get(id);
      return issue?.linkedTaskId ? ctx.db.get(issue.linkedTaskId) : null;
    });
    expect(task?.status).toBe("todo");
    expect(task?.priority).toBe("high");

    await user.mutation(api.github.setState, { id, state: "closed" });
    task = await t.run(async (ctx) => {
      const issue = await ctx.db.get(id);
      return issue?.linkedTaskId ? ctx.db.get(issue.linkedTaskId) : null;
    });
    expect(task?.status).toBe("done");
  });

  test("setState rejects GitHub-sourced issues", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );
    const user = await asUser(t);
    await expect(
      user.mutation(api.github.setState, { id, state: "closed" }),
    ).rejects.toThrow();
  });
});

describe("delete", () => {
  test("deleteIssueFromWebhook removes the issue and its mirror task", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs());
    await t.mutation(internal.github.deleteIssueFromWebhook, {
      repo: "deceivers/robot",
      number: 7,
    });
    const { issues, tasks } = await t.run(async (ctx) => ({
      issues: await ctx.db.query("issues").collect(),
      tasks: await ctx.db.query("tasks").collect(),
    }));
    expect(issues).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });
});

describe("priority override", () => {
  test("an in-app override wins and survives a GitHub re-sync", async () => {
    const t = convexTest(schema, modules);
    const user = await asUser(t);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ labels: ["bug"] }), // derives medium
    );
    await user.mutation(api.github.update, { id, priorityOverride: "high" });

    let issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priority).toBe("high");
    expect(issue?.priorityOverride).toBe("high");

    // A re-sync whose labels would derive "low" must not clobber the pin.
    await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ labels: ["minor"] }),
    );
    issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priority).toBe("high");

    const task = await t.run(async (ctx) => {
      const i = await ctx.db.get(id);
      return i?.linkedTaskId ? ctx.db.get(i.linkedTaskId) : null;
    });
    expect(task?.priority).toBe("high");
  });

  test("clearing the override reverts priority to the labels", async () => {
    const t = convexTest(schema, modules);
    const user = await asUser(t);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ labels: ["urgent"] }), // derives high
    );
    await user.mutation(api.github.update, { id, priorityOverride: "low" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.priority).toBe("low");

    await user.mutation(api.github.update, { id, priorityOverride: null });
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priorityOverride).toBeUndefined();
    expect(issue?.priority).toBe("high");
  });
});

describe("repo → project mapping", () => {
  test("a new synced issue inherits its repo's mapped project", async () => {
    const t = convexTest(schema, modules);
    const mentor = await asMentor(t);
    const projectId = await t.run((ctx) =>
      ctx.db.insert("projects", {
        name: "2026",
        tag: "26",
        numberingMode: "auto",
      }),
    );
    await mentor.mutation(api.github.setRepoProject, {
      repo: "deceivers/robot",
      projectId,
    });

    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );
    expect((await t.run((ctx) => ctx.db.get(id)))?.projectId).toBe(projectId);

    // The mirror task inherits the project too.
    const task = await t.run(async (ctx) => {
      const i = await ctx.db.get(id);
      return i?.linkedTaskId ? ctx.db.get(i.linkedTaskId) : null;
    });
    expect(task?.projectId).toBe(projectId);
  });

  test("mapping backfills unassigned issues but not manually triaged ones", async () => {
    const t = convexTest(schema, modules);
    const mentor = await asMentor(t);
    const { pA, pB } = await t.run(async (ctx) => ({
      pA: await ctx.db.insert("projects", {
        name: "A",
        tag: "AA",
        numberingMode: "manual",
      }),
      pB: await ctx.db.insert("projects", {
        name: "B",
        tag: "BB",
        numberingMode: "manual",
      }),
    }));

    const id7 = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ number: 7 }),
    );
    const id8 = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ number: 8 }),
    );
    // #8 is manually triaged to project B before the mapping exists.
    await mentor.mutation(api.github.update, { id: id8, projectId: pB });

    const res = await mentor.mutation(api.github.setRepoProject, {
      repo: "deceivers/robot",
      projectId: pA,
    });
    expect(res.assigned).toBe(1); // only #7 was unassigned

    expect((await t.run((ctx) => ctx.db.get(id7)))?.projectId).toBe(pA);
    expect((await t.run((ctx) => ctx.db.get(id8)))?.projectId).toBe(pB);
  });

  test("applyRepoProject (import path) maps the repo so later inserts inherit it", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.run((ctx) =>
      ctx.db.insert("projects", {
        name: "Imp",
        tag: "IM",
        numberingMode: "manual",
      }),
    );
    // The import sets the mapping first…
    await t.mutation(internal.github.applyRepoProject, {
      repo: "deceivers/robot",
      projectId,
    });
    // …then each imported issue upserts in and inherits it.
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );
    expect((await t.run((ctx) => ctx.db.get(id)))?.projectId).toBe(projectId);
  });

  test("setRepoProject requires the mentor role", async () => {
    const t = convexTest(schema, modules);
    const user = await asUser(t);
    const projectId = await t.run((ctx) =>
      ctx.db.insert("projects", {
        name: "X",
        tag: "XX",
        numberingMode: "manual",
      }),
    );
    await expect(
      user.mutation(api.github.setRepoProject, {
        repo: "deceivers/robot",
        projectId,
      }),
    ).rejects.toThrow();
  });
});

async function firstIssueId(t: TestConvex<typeof schema>) {
  const issues = await t.query(api.github.list, {});
  return issues[0]._id;
}
