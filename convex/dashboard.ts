// The dashboard's numbers: what's outstanding across the whole app, what's on
// you, and how long until the robot has to be done.
import { query } from "./_generated/server";
import { v } from "convex/values";
import { activeSeason } from "./lib/season";
import {
  ASSEMBLED_STAGE,
  computeAssemblyStatuses,
  READY_STAGE,
  type AssemblyInput,
} from "./lib/assembly";

const SCAN_LIMIT = 5000;

const vCount = v.object({
  parts: v.number(),
  subAssemblies: v.number(),
  todos: v.number(),
  issues: v.number(),
  total: v.number(),
});

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
    nextCompetition: v.union(
      v.object({ name: v.string(), date: v.number() }),
      v.null(),
    ),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.subject;
    const season = await activeSeason(ctx);

    const parts = season
      ? (
          await ctx.db
            .query("parts")
            .withIndex("by_season", (q) => q.eq("seasonId", season._id))
            .take(SCAN_LIMIT)
        ).filter((p) => !p.isArchived)
      : [];
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
    const issues = await ctx.db.query("issues").take(SCAN_LIMIT);

    // How many sub-assemblies could be put together right now — the one
    // number that says what today's work could be.
    const members = await ctx.db.query("subAssemblyMembers").take(SCAN_LIMIT);
    const partById = new Map(parts.map((p) => [p._id as string, p]));
    const inputs: AssemblyInput[] = assemblies.map((assembly) => {
      const mine = members.filter((m) => m.subAssemblyId === assembly._id);
      return {
        id: assembly._id,
        number: assembly.partNumber,
        name: assembly.name,
        order: assembly.order,
        completed: assembly.completedAt !== undefined,
        childIds: mine
          .map((m) => m.childSubAssemblyId)
          .filter((id): id is NonNullable<typeof id> => id !== undefined),
        members: mine
          .filter((m) => m.partId !== undefined)
          .map((m) => {
            const part = partById.get(m.partId as string);
            return {
              kind: "part" as const,
              label: part?.partNumber ?? "",
              stageLabel: "",
              ready: (part?.stage ?? 0) >= READY_STAGE,
            };
          }),
      };
    });
    const statuses = computeAssemblyStatuses(inputs);

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

    const upcoming = await ctx.db
      .query("competitions")
      .withIndex("by_date", (q) => q.gte("date", Date.now()))
      .take(1);

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
        issues: 0,
        total: mineParts.length + mineAssemblies.length + mineTodos.length,
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
      nextCompetition: upcoming[0]
        ? { name: upcoming[0].name, date: upcoming[0].date }
        : null,
    };
  },
});
