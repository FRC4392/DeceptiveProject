// @vitest-environment edge-runtime
/// <reference types="vite/client" />
//
// "My parts", "My to-dos" and "My issues" are this season's work, the same as
// the boards they come from. A claim from last year's robot isn't a job.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

function identity(subject: string, role: "mentor" | "student" = "student") {
  return { subject, issuer: ISSUER, email: `${subject}@example.com`, role };
}

/** 2027 live, with a part and a to-do claimed by Dana; 2028 waiting. */
async function twoSeasons(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity(identity("mentor_1", "mentor"));
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  const y2027 = (await mentor.query(api.seasons.active, {}))!;

  const dana = t.withIdentity(identity("dana"));
  await dana.mutation(api.auth.storeCurrentUser, {});
  const [subsystem] = await mentor.query(api.subsystems.list, {});
  const [process] = await mentor.query(api.shop.listProcessTypes, {});
  const { partId } = await mentor.mutation(api.parts.createWithNumber, {
    subsystemId: subsystem._id,
    name: "2027 side plate",
    processTypeId: process._id,
    qtyNeeded: 1,
  });
  await dana.mutation(api.parts.claim, { partId });
  const todoId = await mentor.mutation(api.todos.create, {
    title: "2027 to-do",
  });
  await dana.mutation(api.todos.claim, { id: todoId });

  const y2028 = await mentor.mutation(api.seasons.create, {
    year: "28",
    name: "2028 robot",
  });
  return { mentor, dana, y2027, y2028 };
}

describe("my work, across a change of season", () => {
  test("last season's claims leave the lists when the team moves on", async () => {
    const t = convexTest(schema, modules);
    const { mentor, dana, y2028 } = await twoSeasons(t);
    expect(await dana.query(api.parts.listMine, {})).toHaveLength(1);
    expect(await dana.query(api.todos.listMine, {})).toHaveLength(1);

    await mentor.mutation(api.seasons.setActive, { id: y2028 });

    expect(await dana.query(api.parts.listMine, {})).toEqual([]);
    expect(await dana.query(api.todos.listMine, {})).toEqual([]);
  });

  // The claim isn't lost, only out of view — switching back brings it home.
  test("they come back when the team switches back", async () => {
    const t = convexTest(schema, modules);
    const { mentor, dana, y2027, y2028 } = await twoSeasons(t);
    await mentor.mutation(api.seasons.setActive, { id: y2028 });
    await mentor.mutation(api.seasons.setActive, { id: y2027._id });

    expect(await dana.query(api.parts.listMine, {})).toHaveLength(1);
    expect(await dana.query(api.todos.listMine, {})).toHaveLength(1);
  });

  test("agrees with what the dashboard counts as yours", async () => {
    const t = convexTest(schema, modules);
    const { mentor, dana, y2028 } = await twoSeasons(t);
    await mentor.mutation(api.seasons.setActive, { id: y2028 });

    const summary = await dana.query(api.dashboard.summary, {});
    expect(summary.mine.parts).toBe(
      (await dana.query(api.parts.listMine, {})).length,
    );
    expect(summary.mine.todos).toBe(
      (await dana.query(api.todos.listMine, {})).length,
    );
  });
});

describe("my issues, across a change of season", () => {
  /** A 2027 repo, an ongoing one, and a manual report — each claimed by Dana. */
  async function claimedIssues(t: ReturnType<typeof convexTest>) {
    const base = await twoSeasons(t);
    const { mentor, dana, y2027 } = base;
    await mentor.mutation(api.github.setRepo, {
      fullName: "team/robot-2027",
      kind: "season",
      seasonId: y2027._id,
    });
    await mentor.mutation(api.github.setRepo, {
      fullName: "team/scouting",
      kind: "ongoing",
    });
    const issue = (repo: string, number: number) => ({
      repo,
      number,
      githubId: number,
      title: `${repo}#${number}`,
      state: "open" as const,
      labels: [],
      assigneeLogins: [],
      isPullRequest: false,
    });
    for (const id of [
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        issue("team/robot-2027", 1),
      ),
      await t.mutation(
        internal.github.upsertIssueFromWebhook,
        issue("team/scouting", 2),
      ),
      await dana.mutation(api.github.createManualIssue, {
        title: "Pit laptop won't boot",
      }),
    ]) {
      await dana.mutation(api.github.claim, { id: id! });
    }
    return base;
  }

  test("drops a past season's repo but keeps the ones reused every year", async () => {
    const t = convexTest(schema, modules);
    const { mentor, dana, y2028 } = await claimedIssues(t);
    expect(await dana.query(api.github.listMine, {})).toHaveLength(3);

    await mentor.mutation(api.seasons.setActive, { id: y2028 });

    const titles = (await dana.query(api.github.listMine, {})).map(
      (i) => i.title,
    );
    expect(titles).not.toContain("team/robot-2027#1");
    expect(titles).toContain("team/scouting#2");
    expect(titles).toContain("Pit laptop won't boot");
  });
});
