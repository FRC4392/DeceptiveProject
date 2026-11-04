// The dashboard's numbers: what's outstanding across the whole app, what's on
// you, and how long until the robot has to be done.
import { query } from "./_generated/server";
import { v } from "convex/values";
import { activeSeason } from "./lib/season";
import { inScope, scopedRepos } from "./lib/githubRepos";
import {
  ASSEMBLED_STAGE,
  buildAssemblyInput,
  computeAssemblyStatuses,
  groupMemberRefs,
  READY_STAGE,
} from "./lib/assembly";

const SCAN_LIMIT = 5000;

const vCount = v.object({
  parts: v.number(),
  subAssemblies: v.number(),
  todos: v.number(),
  issues: v.number(),
  total: v.number(),
});

const NO_COUNT = { parts: 0, subAssemblies: 0, todos: 0, issues: 0, total: 0 };

/** What someone who isn't signed in gets: the shape, with nothing in it. */
const NOTHING = {
  outstanding: NO_COUNT,
  mine: NO_COUNT,
  parts: { ready: 0, total: 0 },
  subAssemblies: { built: 0, total: 0, readyToBuild: 0 },
  todos: { done: 0, total: 0, unclaimed: 0 },
  issues: { open: 0, closed: 0, prs: 0, total: 0 },
  bought: { toOrder: 0, ordered: 0, arrived: 0, total: 0 },
  nextCompetition: null,
};

export const summary = query({
  args: {},
  returns: v.object({
    /** Still to do, across everything. */
    outstanding: vCount,
    /** Of that, what this person has picked up. Issues are never counted:
     *  GitHub assignees are GitHub logins, which don't map to people here. */
    mine: vCount,
    parts: v.object({ ready: v.number(), total: v.number() }),
    subAssemblies: v.object({
      built: v.number(),
      total: v.number(),
      readyToBuild: v.number(),
    }),
    todos: v.object({
      done: v.number(),
      total: v.number(),
      unclaimed: v.number(),
    }),
    issues: v.object({
      open: v.number(),
      closed: v.number(),
      prs: v.number(),
      total: v.number(),
    }),
    /** Things the team buys. Two numbers, because they're two jobs: one is
     *  somebody's to order, the other is only waiting on the post. */
    bought: v.object({
      toOrder: v.number(),
      ordered: v.number(),
      arrived: v.number(),
      total: v.number(),
    }),
    nextCompetition: v.union(
      v.object({ name: v.string(), date: v.number() }),
      v.null(),
    ),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    // Asked for without signing in, this used to answer with the team's real
    // totals — only "mine" came back empty.
    if (!identity) return NOTHING;
    const me = identity.subject;
    const season = await activeSeason(ctx);

    const seasonParts = season
      ? await ctx.db
          .query("parts")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .take(SCAN_LIMIT)
      : [];
    const parts = seasonParts.filter((p) => !p.isArchived);
    const assemblies = season
      ? await ctx.db
          .query("subAssemblies")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .take(SCAN_LIMIT)
      : [];
    const todos = season
      ? await ctx.db
          .query("todos")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .take(SCAN_LIMIT)
      : [];
    // Issues carry no season of their own; their repo does. Count the ones in
    // the season's repos, plus the bugs reported in the app, so this agrees
    // with what the Issues page shows by default.
    const issueScope = await scopedRepos(ctx, "season");
    const issues = (await ctx.db.query("issues").take(SCAN_LIMIT)).filter((i) =>
      inScope(issueScope, i),
    );

    const bought = season
      ? await ctx.db
          .query("cotsItems")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .take(SCAN_LIMIT)
      : [];

    // How many sub-assemblies could be put together right now — the one
    // number that says what today's work could be. Built the same way, from
    // the same rows, as each person's own list of assemblies, so the two
    // can't disagree about what's ready.
    const refsById = groupMemberRefs(
      await ctx.db.query("subAssemblyMembers").take(SCAN_LIMIT),
    );
    const partById = new Map(seasonParts.map((p) => [p._id as string, p]));
    const cotsById = new Map(bought.map((c) => [c._id as string, c]));
    const statuses = computeAssemblyStatuses(
      assemblies.map((assembly) =>
        buildAssemblyInput(
          {
            id: assembly._id,
            number: assembly.partNumber,
            name: assembly.name,
            order: assembly.order,
            completed: assembly.completedAt !== undefined,
          },
          refsById.get(assembly._id),
          partById,
          cotsById,
        ),
      ),
    );

    const outstandingParts = parts.filter((p) => p.stage < ASSEMBLED_STAGE);
    const outstandingAssemblies = assemblies.filter(
      (a) => a.completedAt === undefined,
    );
    const outstandingTodos = todos.filter((t) => t.doneAt === undefined);
    const openIssues = issues.filter((i) => i.state === "open");

    const mineParts = outstandingParts.filter(
      (p) => me !== undefined && p.claimedByUserId === me,
    );
    const mineAssemblies = outstandingAssemblies.filter(
      (a) => me !== undefined && a.claimedByUserId === me,
    );
    const mineTodos = outstandingTodos.filter(
      (t) => me !== undefined && t.claimedByUserId === me,
    );
    // Issues used to be left out of "on you" because GitHub assignees are
    // GitHub logins rather than people on the team. They can be claimed here
    // now, so they count like everything else.
    const mineIssues = openIssues.filter(
      (i) => me !== undefined && i.claimedByUserId === me,
    );

    const upcoming = season
      ? await ctx.db
          .query("competitions")
          .withIndex("by_season_and_date", (q) =>
            q.eq("seasonId", season._id).gte("date", Date.now()),
          )
          .take(1)
      : [];

    return {
      outstanding: {
        parts: outstandingParts.length,
        subAssemblies: outstandingAssemblies.length,
        todos: outstandingTodos.length,
        issues: openIssues.length,
        total:
          outstandingParts.length +
          outstandingAssemblies.length +
          outstandingTodos.length +
          openIssues.length,
      },
      mine: {
        parts: mineParts.length,
        subAssemblies: mineAssemblies.length,
        todos: mineTodos.length,
        issues: mineIssues.length,
        total:
          mineParts.length +
          mineAssemblies.length +
          mineTodos.length +
          mineIssues.length,
      },
      parts: {
        ready: parts.filter((p) => p.stage >= READY_STAGE).length,
        total: parts.length,
      },
      subAssemblies: {
        built: assemblies.length - outstandingAssemblies.length,
        total: assemblies.length,
        readyToBuild: statuses.filter((s) => s.ready && !s.done).length,
      },
      todos: {
        done: todos.length - outstandingTodos.length,
        total: todos.length,
        unclaimed: outstandingTodos.filter((t) => !t.claimedByUserId).length,
      },
      issues: {
        open: openIssues.length,
        closed: issues.length - openIssues.length,
        prs: issues.filter((i) => i.isPullRequest).length,
        total: issues.length,
      },
      bought: {
        toOrder: bought.filter((b) => b.status === "needed").length,
        ordered: bought.filter((b) => b.status === "ordered").length,
        arrived: bought.filter((b) => b.status === "arrived").length,
        total: bought.length,
      },
      nextCompetition: upcoming[0]
        ? { name: upcoming[0].name, date: upcoming[0].date }
        : null,
    };
  },
});
