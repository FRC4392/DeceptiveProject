// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
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

/**
 * The upsert returns null only for a repo the team has ignored; every case
 * below is about a repo that is being tracked.
 */
function mustId(id: Id<"issues"> | null): Id<"issues"> {
  if (id === null) throw new Error("expected the issue to be stored");
  return id;
}

async function firstIssueId(t: TestConvex<typeof schema>) {
  const issues = await t.query(api.github.list, {});
  return issues[0]._id;
}

describe("the issue sync", () => {
  test("a synced issue lands as a GitHub-sourced issue", async () => {
    const t = convexTest(schema, modules);
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));

    expect(issue?.source).toBe("github");
    expect(issue?.state).toBe("open");
    expect(issue?.title).toBe("Drive motor stalls");
  });

  test("re-sync is idempotent and updates the same issue", async () => {
    const t = convexTest(schema, modules);
    const first = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
    );
    const second = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ title: "Drive motor stalls intermittently" }),
      ),
    );
    expect(second).toBe(first);

    const issues = await t.run((ctx) => ctx.db.query("issues").collect());
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Drive motor stalls intermittently");
  });

  test("closing an issue closes it here too", async () => {
    const t = convexTest(schema, modules);
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
    );
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ state: "closed" }),
      ),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.state).toBe("closed");
  });

  test("priority is derived from labels", async () => {
    const t = convexTest(schema, modules);
    const id = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ labels: ["bug", "urgent"] }),
      ),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priority).toBe("high");
  });

  test("a PR is marked as one", async () => {
    const t = convexTest(schema, modules);
    const id = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ number: 12, isPullRequest: true, title: "Add climber" }),
      ),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.isPullRequest).toBe(true);
    expect(issue?.title).toBe("Add climber");
  });
});

describe("comment mirroring", () => {
  test("upsert then delete a GitHub comment", async () => {
    const t = convexTest(schema, modules);
    mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
    );

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
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
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
    mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
    );
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
    const id = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ labels: ["bug"] }), // derives medium
      ),
    );
    await user.mutation(api.github.update, { id, priorityOverride: "high" });

    let issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priority).toBe("high");
    expect(issue?.priorityOverride).toBe("high");

    // A re-sync whose labels would derive "low" must not clobber the pin.
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ labels: ["minor"] }),
      ),
    );
    issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priority).toBe("high");
  });

  test("clearing the override reverts priority to the labels", async () => {
    const t = convexTest(schema, modules);
    const user = await asUser(t);
    const id = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ labels: ["urgent"] }), // derives high
      ),
    );
    await user.mutation(api.github.update, { id, priorityOverride: "low" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.priority).toBe("low");

    await user.mutation(api.github.update, { id, priorityOverride: null });
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.priorityOverride).toBeUndefined();
    expect(issue?.priority).toBe("high");
  });
});

describe("picking up an issue", () => {
  test("anyone can take one nobody has", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs({})),
    );

    await dana.mutation(api.github.claim, { id });
    expect((await t.run((ctx) => ctx.db.get(id)))?.claimedByUserId).toBe(
      "dana",
    );
  });

  test("but not one someone else already has", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const sam = await asUser(t, "sam");
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs({})),
    );

    await dana.mutation(api.github.claim, { id });
    await expect(sam.mutation(api.github.claim, { id })).rejects.toThrow(
      /already picked this one up/i,
    );
  });

  test("a closed issue isn't work to pick up", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const id = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ state: "closed" }),
      ),
    );
    await expect(dana.mutation(api.github.claim, { id })).rejects.toThrow(
      /closed/i,
    );
  });

  test("only the person holding it can put it back", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const sam = await asUser(t, "sam");
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs({})),
    );
    await dana.mutation(api.github.claim, { id });

    await expect(sam.mutation(api.github.unclaim, { id })).rejects.toThrow(
      /only the person/i,
    );
    await dana.mutation(api.github.unclaim, { id });
    expect(
      (await t.run((ctx) => ctx.db.get(id)))?.claimedByUserId,
    ).toBeUndefined();
  });

  test("a GitHub re-sync leaves the claim alone", async () => {
    // The whole point of a separate field: GitHub owns assignees, the tracker
    // owns who on the team picked it up, and a webhook must not wipe it.
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs({})),
    );
    await dana.mutation(api.github.claim, { id });

    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ title: "Retitled upstream", labels: ["bug"] }),
      ),
    );
    const issue = await t.run((ctx) => ctx.db.get(id));
    expect(issue?.title).toBe("Retitled upstream");
    expect(issue?.claimedByUserId).toBe("dana");
  });

  test("a student can't put someone else on one", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs({})),
    );
    await expect(
      dana.mutation(api.github.assign, { id, userId: "sam" }),
    ).rejects.toThrow(/mentor/i);
  });
});

describe("my issues", () => {
  test("lists what you picked up and nothing anyone else did", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const sam = await asUser(t, "sam");
    const mine = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ number: 1, title: "Mine" }),
      ),
    );
    const theirs = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ number: 2, title: "Theirs" }),
      ),
    );
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ number: 3, title: "Nobody's" }),
      ),
    );
    await dana.mutation(api.github.claim, { id: mine });
    await sam.mutation(api.github.claim, { id: theirs });

    const listed = await dana.query(api.github.listMine, {});
    expect(listed.map((i) => i.title)).toEqual(["Mine"]);
  });

  test("open ones come before ones you already closed", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const closed = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ number: 1, title: "Already fixed", state: "closed" }),
      ),
    );
    const open = mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ number: 2, title: "Still broken" }),
      ),
    );
    // Claiming a closed issue is refused, so put the claim on directly — it's
    // what an issue you fixed after claiming looks like.
    await t.run(async (ctx) => {
      await ctx.db.patch(closed, { claimedByUserId: "dana" });
    });
    await dana.mutation(api.github.claim, { id: open });

    const listed = await dana.query(api.github.listMine, {});
    expect(listed.map((i) => i.title)).toEqual([
      "Still broken",
      "Already fixed",
    ]);
  });

  test("putting one back takes it off your list", async () => {
    const t = convexTest(schema, modules);
    const dana = await asUser(t, "dana");
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs({})),
    );
    await dana.mutation(api.github.claim, { id });
    expect(await dana.query(api.github.listMine, {})).toHaveLength(1);

    await dana.mutation(api.github.unclaim, { id });
    expect(await dana.query(api.github.listMine, {})).toHaveLength(0);
  });
});

/**
 * One organisation webhook delivers every repo the team owns, so which of them
 * anybody looks at is decided here rather than in GitHub's settings. These
 * cases are about that decision surviving the thing that used to break it: the
 * turn of the season.
 */
describe("the repo registry", () => {
  async function mentorWithSeason(t: TestConvex<typeof schema>) {
    const mentor = t.withIdentity({
      subject: "mentor_1",
      issuer: "https://example.clerk.accounts.dev",
      email: "mentor_1@example.com",
      role: "mentor",
    });
    await mentor.mutation(api.auth.storeCurrentUser, {});
    await mentor.mutation(api.seasons.seedDefaults, {
      year: "27",
      name: "2027 robot",
    });
    return mentor;
  }

  test("a repo nobody has sorted registers itself as this season's", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorWithSeason(t);
    mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
    );

    const { repos, unreviewed } = await mentor.query(api.github.repos, {});
    expect(repos).toHaveLength(1);
    expect(repos[0].fullName).toBe("deceivers/robot");
    expect(repos[0].kind).toBe("season");
    expect(repos[0].inSeasonScope).toBe(true);
    expect(repos[0].open).toBe(1);
    // Registered, but nobody has said that guess is right.
    expect(unreviewed).toBe(1);
  });

  test("an ignored repo's deliveries are accepted and dropped", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorWithSeason(t);
    await mentor.mutation(api.github.setRepo, {
      fullName: "deceivers/scratch",
      kind: "ignored",
    });

    const id = await t.mutation(
      internal.github.upsertIssueFromWebhook,
      upsertArgs({ repo: "deceivers/scratch", number: 1 }),
    );
    expect(id).toBeNull();
    expect(await mentor.query(api.github.list, { scope: "all" })).toHaveLength(
      0,
    );
  });

  test("the default view is this season's repos and the app's own bugs", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorWithSeason(t);
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ repo: "deceivers/robot-2027", title: "This year" }),
      ),
    );
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ repo: "deceivers/tracker", title: "The tracker" }),
      ),
    );
    await mentor.mutation(api.github.setRepo, {
      fullName: "deceivers/tracker",
      kind: "ongoing",
    });
    await mentor.mutation(api.github.createManualIssue, {
      title: "Reported in the pit",
    });

    const season = await mentor.query(api.github.list, {});
    expect(season.map((i) => i.title).sort()).toEqual([
      "Reported in the pit",
      "This year",
    ]);

    const ongoing = await mentor.query(api.github.list, { scope: "ongoing" });
    expect(ongoing.map((i) => i.title)).toEqual(["The tracker"]);

    const all = await mentor.query(api.github.list, { scope: "all" });
    expect(all).toHaveLength(3);

    const one = await mentor.query(api.github.list, {
      scope: "all",
      repo: "deceivers/tracker",
    });
    expect(one.map((i) => i.title)).toEqual(["The tracker"]);
  });

  test("the counts agree with the default view", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorWithSeason(t);
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ repo: "deceivers/robot-2027" }),
      ),
    );
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ repo: "deceivers/tracker" }),
      ),
    );
    await mentor.mutation(api.github.setRepo, {
      fullName: "deceivers/tracker",
      kind: "ongoing",
    });

    // The dashboard saying 2 over a page showing 1 is the complaint this
    // change exists to fix, so the two read the same source.
    expect(await mentor.query(api.github.stats, {})).toMatchObject({
      open: 1,
      total: 1,
    });
    expect(
      await mentor.query(api.github.stats, { scope: "all" }),
    ).toMatchObject({ open: 2, total: 2 });
    expect((await mentor.query(api.dashboard.summary, {})).issues.open).toBe(1);
  });

  test("moving to the next season moves the default view with it", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorWithSeason(t);
    mustId(
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        upsertArgs({ repo: "deceivers/robot-2027", title: "Last year" }),
      ),
    );
    expect(await mentor.query(api.github.list, {})).toHaveLength(1);

    const next = await mentor.mutation(api.seasons.create, {
      year: "28",
      name: "2028 robot",
    });
    await mentor.mutation(api.seasons.setActive, { id: next });

    // Nothing was touched but the season. Last year's repo keeps last year's
    // season, so its issues leave the default view on their own — and are
    // still there under All repos.
    expect(await mentor.query(api.github.list, {})).toHaveLength(0);
    const all = await mentor.query(api.github.list, { scope: "all" });
    expect(all.map((i) => i.title)).toEqual(["Last year"]);
  });

  test("forgetting an ignored repo's issues takes their comments too", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorWithSeason(t);
    const id = mustId(
      await t.mutation(internal.github.upsertIssueFromWebhook, upsertArgs()),
    );
    await t.mutation(internal.github.upsertCommentFromWebhook, {
      repo: "deceivers/robot",
      number: 7,
      githubCommentId: 1,
      body: "Looking at it",
    });

    const res = await mentor.mutation(api.github.forgetRepoIssues, {
      fullName: "deceivers/robot",
    });
    expect(res.removed).toBe(1);
    expect(await mentor.query(api.github.get, { id })).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("issueComments").collect()),
    ).toHaveLength(0);
  });

  test("a repo can be sorted before its first delivery", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorWithSeason(t);
    await mentor.mutation(api.github.setRepo, {
      fullName: "https://github.com/deceivers/robot-2028.git",
      kind: "season",
      label: "Next year",
    });

    const { repos } = await mentor.query(api.github.repos, {});
    // A pasted URL is the same repo as the one a payload will name.
    expect(repos[0].fullName).toBe("deceivers/robot-2028");
    expect(repos[0].label).toBe("Next year");
    expect(repos[0].reviewedAt).toBeDefined();
  });

  test("only mentors sort repos", async () => {
    const t = convexTest(schema, modules);
    const student = await asUser(t, "sam");
    await expect(
      student.mutation(api.github.setRepo, {
        fullName: "deceivers/robot",
        kind: "ignored",
      }),
    ).rejects.toThrow();
  });
});

// Import is mentor-only, and "mentor" means what Settings says, not just what
// Clerk says. A role granted in Settings lives in `appRole` and has to win.
describe("who may import issues", () => {
  async function withRoles(
    t: TestConvex<typeof schema>,
    subject: string,
    role: "mentor" | "student",
    appRole?: "student" | "lead" | "mentor" | "admin",
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: subject,
        email: `${subject}@example.com`,
        name: subject,
        role,
        ...(appRole ? { appRole } : {}),
      });
    });
    return t.withIdentity({
      subject,
      issuer: "https://example.clerk.accounts.dev",
    });
  }

  // Getting as far as the token check means the role check let them through.
  test("an admin made in Settings gets past the role check", async () => {
    const t = convexTest(schema, modules);
    const admin = await withRoles(t, "admin_1", "student", "admin");
    await expect(
      admin.action(api.github.importIssues, { repo: "deceivers/robot" }),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });

  test("a mentor made in Settings gets past the role check", async () => {
    const t = convexTest(schema, modules);
    const mentor = await withRoles(t, "mentor_1", "student", "mentor");
    await expect(
      mentor.action(api.github.importIssues, { repo: "deceivers/robot" }),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });

  test("someone demoted in Settings is turned away, whatever Clerk says", async () => {
    const t = convexTest(schema, modules);
    const demoted = await withRoles(t, "ex_mentor", "mentor", "student");
    await expect(
      demoted.action(api.github.importIssues, { repo: "deceivers/robot" }),
    ).rejects.toThrow(/Mentors only/);
  });

  test("a lead can't import", async () => {
    const t = convexTest(schema, modules);
    const lead = await withRoles(t, "lead_1", "student", "lead");
    await expect(
      lead.action(api.github.importIssues, { repo: "deceivers/robot" }),
    ).rejects.toThrow(/Mentors only/);
  });
});
