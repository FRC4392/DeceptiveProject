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
    issuer: "https://example.clerk.accounts.dev",
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

async function firstIssueId(t: TestConvex<typeof schema>) {
  const issues = await t.query(api.github.list, {});
  return issues[0]._id;
}

describe("the issue sync", () => {
  test("a synced issue lands as a GitHub-sourced issue", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));

    expect(issue?.source).toBe("github");
    expect(issue?.state).toBe("open");
    expect(issue?.title).toBe("Drive motor stalls");
  });

  test("re-sync is idempotent and updates the same issue", async () => {
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

    const issues = await t.run((ctx) => ctx.db.query("issues").collect());
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Drive motor stalls intermittently");
  });

  test("closing an issue closes it here too", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs(),
    );
    await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ state: "closed" }),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.state).toBe("closed");
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

  test("a PR is marked as one", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ number: 12, isPullRequest: true, title: "Add climber" }),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.isPullRequest).toBe(true);
    expect(issue?.title).toBe("Add climber");
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
      issueId: await firstIssueId(t),
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
  test("createManualIssue opens one, and setState closes it", async () => {
    const t = convexTest(schema, modules);
    const user = await asUser(t);
    const id = await user.mutation(api.github.createManualIssue, {
      title: "Auton drifts left",
      priority: "high",
    });

    let issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.state).toBe("open");
    expect(issue?.priority).toBe("high");
    expect(issue?.source).toBe("manual");

    await user.mutation(api.github.setState, { id, state: "closed" });
    issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.state).toBe("closed");
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
  test("deleteIssueFromWebhook removes the issue", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs());
    await t.mutation(internal.github.deleteIssueFromWebhook, {
      repo: "deceivers/robot",
      number: 7,
    });
    const issues = await t.run((ctx) => ctx.db.query("issues").collect());
    expect(issues).toHaveLength(0);
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
