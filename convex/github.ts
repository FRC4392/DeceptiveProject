import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  httpAction,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  canRead,
  canReadAsMentor,
  requireUserId,
  requireMentor,
  getActor,
} from "./lib/auth";
import { isLeadOrAbove, isMentorOrAbove } from "./lib/stages";
import { activeSeason } from "./lib/season";
import {
  derivePriority,
  normalizeIssueNode,
  normalizeRepo,
} from "./lib/github";
import { githubFetch } from "./lib/githubRest";
import {
  ensureRepo,
  repoKey,
  repoRow,
  scopedRepos,
  type RepoScope,
} from "./lib/githubRepos";
import { asRecord, verifySignature } from "./lib/githubWebhookAuth";

export const issueStateValidator = v.union(
  v.literal("open"),
  v.literal("closed"),
);

export const priorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

const vIssue = v.object({
  _id: v.id("issues"),
  _creationTime: v.number(),
  source: v.union(v.literal("github"), v.literal("manual")),
  repo: v.optional(v.string()),
  number: v.optional(v.number()),
  githubId: v.optional(v.number()),
  title: v.string(),
  body: v.optional(v.string()),
  state: issueStateValidator,
  htmlUrl: v.optional(v.string()),
  labels: v.array(v.string()),
  assigneeLogins: v.array(v.string()),
  authorLogin: v.optional(v.string()),
  isPullRequest: v.boolean(),
  priority: priorityValidator,
  priorityOverride: v.optional(priorityValidator),
  claimedByUserId: v.optional(v.string()),
  lastSyncedAt: v.optional(v.number()),
});

// Which repos a reader is asking about. "season" is the default everywhere:
// what the team is building now, plus the bugs reported in the app itself.
export const repoScopeValidator = v.union(
  v.literal("season"),
  v.literal("ongoing"),
  v.literal("all"),
);

export const repoKindValidator = v.union(
  v.literal("season"),
  v.literal("ongoing"),
  v.literal("ignored"),
);

const vIssueComment = v.object({
  _id: v.id("issueComments"),
  _creationTime: v.number(),
  issueId: v.id("issues"),
  githubCommentId: v.optional(v.number()),
  authorLogin: v.optional(v.string()),
  authorId: v.optional(v.string()),
  body: v.string(),
});

// Upper bound for the bounded scans below. A season's issue count is far under
// this; revisit with pagination if it ever grows past it.
const SCAN_LIMIT = 2000;

// ---- Queries ----

/**
 * The issues in one repo, or in a scope — read through `by_repo_and_number`'s
 * repo prefix rather than by scanning, since a team with ten years of repos has
 * most of its rows outside whatever anybody is looking at.
 *
 * `repo: undefined` is a real key here: an issue reported in the app has no
 * repo, and those are the team's own bugs rather than nobody's.
 */
async function issuesInRepos(
  ctx: QueryCtx,
  scoped: { names: string[]; withoutRepo: boolean },
): Promise<Doc<"issues">[]> {
  const out: Doc<"issues">[] = [];
  for (const name of scoped.names) {
    out.push(
      ...(await ctx.db
        .query("issues")
        .withIndex("by_repo_and_number", (q) => q.eq("repo", name))
        .take(SCAN_LIMIT)),
    );
  }
  if (scoped.withoutRepo) {
    out.push(
      ...(await ctx.db
        .query("issues")
        .withIndex("by_repo_and_number", (q) => q.eq("repo", undefined))
        .take(SCAN_LIMIT)),
    );
  }
  return out;
}

/** The issues a scope covers, newest first. One repo wins over the scope. */
async function scopedIssues(
  ctx: QueryCtx,
  args: { scope?: RepoScope; repo?: string },
): Promise<Doc<"issues">[]> {
  const scoped =
    args.repo !== undefined
      ? { names: [args.repo], withoutRepo: false }
      : await scopedRepos(ctx, args.scope ?? "season");
  const issues =
    scoped === null
      ? await ctx.db.query("issues").take(SCAN_LIMIT)
      : await issuesInRepos(ctx, scoped);
  return issues.sort((a, b) => b._creationTime - a._creationTime);
}

export const list = query({
  args: {
    state: v.optional(issueStateValidator),
    /** Defaults to this season's repos — see `repoScopeValidator`. */
    scope: v.optional(repoScopeValidator),
    /** One repo, "owner/name". Narrows past the scope rather than within it. */
    repo: v.optional(v.string()),
  },
  returns: v.array(vIssue),
  handler: async (ctx, args) => {
    if (!(await canRead(ctx))) return [];
    const issues = await scopedIssues(ctx, args);
    return issues.filter(
      (i) => args.state === undefined || i.state === args.state,
    );
  },
});

export const get = query({
  args: { id: v.id("issues") },
  returns: v.union(vIssue, v.null()),
  handler: async (ctx, { id }) =>
    (await canRead(ctx)) ? ctx.db.get(id) : null,
});

export const listComments = query({
  args: { issueId: v.id("issues") },
  returns: v.array(vIssueComment),
  handler: async (ctx, { issueId }) =>
    !(await canRead(ctx))
      ? []
      : ctx.db
          .query("issueComments")
          .withIndex("by_issue", (q) => q.eq("issueId", issueId))
          .order("asc")
          .collect(),
});

// Counts for the dashboard widget. Scoped the same way the list is, because a
// dashboard reading "40 open" over a page showing seven is the complaint this
// change exists to fix, in a new place.
export const stats = query({
  args: { scope: v.optional(repoScopeValidator) },
  returns: v.object({
    open: v.number(),
    closed: v.number(),
    prs: v.number(),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!(await canRead(ctx))) return { open: 0, closed: 0, prs: 0, total: 0 };
    const issues = await scopedIssues(ctx, { scope: args.scope });
    let open = 0;
    let closed = 0;
    let prs = 0;
    for (const i of issues) {
      if (i.state === "open") open += 1;
      else closed += 1;
      if (i.isPullRequest) prs += 1;
    }
    return { open, closed, prs, total: issues.length };
  },
});

// Whether the GitHub secrets are configured, so the admin UI can guide setup.
// Returns booleans only — never the secret values themselves.
export const config = query({
  args: {},
  returns: v.object({
    webhookConfigured: v.boolean(),
    tokenConfigured: v.boolean(),
  }),
  handler: async (ctx) =>
    (await canReadAsMentor(ctx))
      ? {
          webhookConfigured: !!process.env.GITHUB_WEBHOOK_SECRET,
          tokenConfigured: !!process.env.GITHUB_TOKEN,
        }
      : { webhookConfigured: false, tokenConfigured: false },
});

// ---- The repo registry ----

const vRepo = v.object({
  _id: v.id("githubRepos"),
  _creationTime: v.number(),
  fullName: v.string(),
  nameKey: v.string(),
  label: v.optional(v.string()),
  kind: repoKindValidator,
  seasonId: v.optional(v.id("seasons")),
  order: v.number(),
  firstSeenAt: v.number(),
  reviewedAt: v.optional(v.number()),
  /** In the default (this season's) view. Derived, so one place decides it. */
  inSeasonScope: v.boolean(),
  open: v.number(),
  total: v.number(),
});

/**
 * Every repo the webhook has delivered from, with what it holds. Readable by
 * anyone — the issue list's chips are built from it — while changing one is a
 * mentor's call.
 */
export const repos = query({
  args: {},
  returns: v.object({
    repos: v.array(vRepo),
    /** Issues reported in the app itself. They have no repo and no season. */
    local: v.object({ open: v.number(), total: v.number() }),
    /** Rows nobody has confirmed yet, so Admin can be pointed at. */
    unreviewed: v.number(),
  }),
  handler: async (ctx) => {
    if (!(await canRead(ctx))) {
      return { repos: [], local: { open: 0, total: 0 }, unreviewed: 0 };
    }
    const rows = await ctx.db.query("githubRepos").collect();
    const season = await activeSeason(ctx);
    const out = [];
    for (const row of rows) {
      const issues = await ctx.db
        .query("issues")
        .withIndex("by_repo_and_number", (q) => q.eq("repo", row.fullName))
        .take(SCAN_LIMIT);
      out.push({
        ...row,
        inSeasonScope:
          row.kind === "season" &&
          season !== null &&
          row.seasonId === season._id,
        open: issues.filter((i) => i.state === "open").length,
        total: issues.length,
      });
    }
    out.sort(
      (a, b) => a.order - b.order || a.fullName.localeCompare(b.fullName),
    );
    const local = await ctx.db
      .query("issues")
      .withIndex("by_repo_and_number", (q) => q.eq("repo", undefined))
      .take(SCAN_LIMIT);
    return {
      repos: out,
      local: {
        open: local.filter((i) => i.state === "open").length,
        total: local.length,
      },
      unreviewed: rows.filter((r) => r.reviewedAt === undefined).length,
    };
  },
});

/**
 * Sort a repo: this season's, every season's, or ignored. Upserts, so a repo
 * can be sorted before its first delivery — which is how a mentor sets the
 * season's repo up in November rather than waiting for someone to file a bug.
 */
export const setRepo = mutation({
  args: {
    fullName: v.string(),
    kind: repoKindValidator,
    seasonId: v.optional(v.union(v.id("seasons"), v.null())),
    label: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.id("githubRepos"),
  handler: async (ctx, args) => {
    await requireMentor(ctx);
    const fullName = normalizeRepo(args.fullName);
    if (!/^[^/]+\/[^/]+$/.test(fullName)) {
      throw new Error(`Expected "owner/name", got "${fullName}".`);
    }
    // A season repo without a season would sit in no view at all, so fall back
    // to the current one rather than storing something nothing can show.
    const season = await activeSeason(ctx);
    const seasonId =
      args.kind === "season"
        ? (args.seasonId ?? season?._id ?? undefined)
        : undefined;

    const existing = await repoRow(ctx, fullName);
    if (existing) {
      await ctx.db.patch(existing._id, {
        kind: args.kind,
        seasonId,
        label:
          args.label === undefined
            ? existing.label
            : args.label?.trim() || undefined,
        reviewedAt: Date.now(),
      });
      return existing._id;
    }
    const rows = await ctx.db.query("githubRepos").collect();
    return ctx.db.insert("githubRepos", {
      fullName,
      nameKey: repoKey(fullName),
      label: args.label?.trim() || undefined,
      kind: args.kind,
      seasonId,
      order: rows.reduce((max, r) => Math.max(max, r.order), 0) + 1,
      firstSeenAt: Date.now(),
      reviewedAt: Date.now(),
    });
  },
});

/**
 * Throw away what a repo already imported, for one being ignored. Ignoring
 * stops the next delivery; this clears the ones that already arrived, which is
 * the other half of "I never want to see that repo here".
 */
export const forgetRepoIssues = mutation({
  args: { fullName: v.string() },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, { fullName }) => {
    await requireMentor(ctx);
    const row = await repoRow(ctx, fullName);
    const name = row?.fullName ?? normalizeRepo(fullName);
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_repo_and_number", (q) => q.eq("repo", name))
      .take(SCAN_LIMIT);
    for (const issue of issues) {
      const comments = await ctx.db
        .query("issueComments")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const c of comments) await ctx.db.delete(c._id);
      await ctx.db.delete(issue._id);
    }
    return { removed: issues.length };
  },
});

export const removeRepo = mutation({
  args: { id: v.id("githubRepos") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    await ctx.db.delete(id);
    return null;
  },
});

export const createManualIssue = mutation({
  args: {
    title: v.string(),
    body: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.id("issues"),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const id = await ctx.db.insert("issues", {
      source: "manual",
      title: args.title,
      body: args.body,
      state: "open",
      labels: args.labels ?? [],
      assigneeLogins: [],
      isPullRequest: false,
      priority: args.priority ?? "medium",
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("issues"),
    title: v.optional(v.string()),
    body: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(priorityValidator),
    // For GitHub rows: pin an in-app priority (survives re-sync), or pass null
    // to clear the pin and revert to the label-derived priority.
    priorityOverride: v.optional(v.union(priorityValidator, v.null())),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const issue = await ctx.db.get(args.id);
    if (!issue) throw new Error("Issue not found");

    const patch: Partial<Doc<"issues">> = {};
    if (issue.source === "manual") {
      // Title/body/labels/priority are set directly on manual rows.
      if (args.title !== undefined) patch.title = args.title;
      if (args.body !== undefined) patch.body = args.body ?? undefined;
      if (args.labels !== undefined) patch.labels = args.labels;
      if (args.priority !== undefined) patch.priority = args.priority;
    } else if (args.priorityOverride !== undefined) {
      // GitHub rows: title/body/labels track GitHub, but priority can be pinned.
      if (args.priorityOverride === null) {
        patch.priorityOverride = undefined;
        patch.priority = derivePriority(issue.labels);
      } else {
        patch.priorityOverride = args.priorityOverride;
        patch.priority = args.priorityOverride;
      }
    }
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

// Open/close a manual issue. GitHub-sourced issues change state through the
// write-back action (`setGitHubState`) so GitHub stays the source of truth.
export const setState = mutation({
  args: { id: v.id("issues"), state: issueStateValidator },
  returns: v.null(),
  handler: async (ctx, { id, state }) => {
    await requireUserId(ctx);
    const issue = await ctx.db.get(id);
    if (!issue) throw new Error("Issue not found");
    if (issue.source !== "manual") {
      throw new Error(
        "This is a GitHub issue — use “Close on GitHub” to change its state.",
      );
    }
    await ctx.db.patch(id, { state });
    return null;
  },
});

// A team note that lives only in the tracker (never posted to GitHub).
export const addComment = mutation({
  args: { issueId: v.id("issues"), body: v.string() },
  returns: v.id("issueComments"),
  handler: async (ctx, { issueId, body }) => {
    const authorId = await requireUserId(ctx);
    return ctx.db.insert("issueComments", { issueId, authorId, body });
  },
});

export const remove = mutation({
  args: { id: v.id("issues") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    const issue = await ctx.db.get(id);
    if (!issue) return null;
    const comments = await ctx.db
      .query("issueComments")
      .withIndex("by_issue", (q) => q.eq("issueId", id))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);
    await ctx.db.delete(id);
    return null;
  },
});

/** The issues this person picked up — the twin of My Parts and My To-dos. */
export const listMine = query({
  args: {},
  returns: v.array(vIssue),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const mine = await ctx.db
      .query("issues")
      .withIndex("by_claimedBy", (q) => q.eq("claimedByUserId", userId))
      .take(200);
    // Open ones first — a closed issue you fixed is history, not a job.
    return mine.sort((a, b) => {
      const aClosed = a.state === "closed";
      const bClosed = b.state === "closed";
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      return b._creationTime - a._creationTime;
    });
  },
});

// ---- Claiming ----
//
// Same three rules as parts, sub-assemblies and to-dos: anyone can pick up
// what nobody has, only the person holding it (or a lead) can put it back,
// and mentors can put someone else on it. A bug nobody has claimed should
// read the same as a part nobody has claimed.

export const claim = mutation({
  args: { id: v.id("issues") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const issue = await ctx.db.get(id);
    if (!issue) throw new Error("That issue is gone.");
    if (issue.state === "closed") {
      throw new Error("That one's closed.");
    }
    if (issue.claimedByUserId && issue.claimedByUserId !== userId) {
      throw new Error("Someone else already picked this one up.");
    }
    await ctx.db.patch(id, { claimedByUserId: userId });
    return null;
  },
});

export const unclaim = mutation({
  args: { id: v.id("issues") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const actor = await getActor(ctx);
    const issue = await ctx.db.get(id);
    if (!issue) throw new Error("That issue is gone.");
    if (issue.claimedByUserId !== actor.userId && !isLeadOrAbove(actor.role)) {
      throw new Error("Only the person who picked it up can put it back.");
    }
    await ctx.db.patch(id, { claimedByUserId: undefined });
    return null;
  },
});

/** Put someone else on an issue. Mentors only, same as parts and to-dos. */
export const assign = mutation({
  args: { id: v.id("issues"), userId: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { id, userId }) => {
    await requireMentor(ctx);
    const issue = await ctx.db.get(id);
    if (!issue) throw new Error("That issue is gone.");
    if (userId !== null) {
      const user = await ctx.db
        .query("users")
        .withIndex("authId", (q) => q.eq("authId", userId))
        .unique();
      if (!user) throw new Error("That person hasn't signed in yet.");
    }
    await ctx.db.patch(id, { claimedByUserId: userId ?? undefined });
    return null;
  },
});

// ---- Internal (webhook / write-back plumbing) ----

const vUpsertArgs = {
  repo: v.string(),
  number: v.number(),
  githubId: v.optional(v.number()),
  title: v.string(),
  body: v.optional(v.string()),
  state: issueStateValidator,
  htmlUrl: v.optional(v.string()),
  labels: v.array(v.string()),
  assigneeLogins: v.array(v.string()),
  authorLogin: v.optional(v.string()),
  isPullRequest: v.boolean(),
};

// Match on (repo, number) so replays and edits are idempotent. Preserves a
// manual project assignment / priority override; everything else tracks GitHub.
//
// Returns null for a repo the team has ignored: the delivery is accepted and
// dropped, which is what "I don't want that repo in here" has to mean when one
// organisation-level webhook feeds every repo the team owns.
export const upsertIssueFromWebhook = internalMutation({
  args: vUpsertArgs,
  returns: v.union(v.id("issues"), v.null()),
  handler: async (ctx, args) => {
    const repo = await ensureRepo(ctx, args.repo);
    if (repo.kind === "ignored") return null;

    const priority = derivePriority(args.labels);
    const existing = await ctx.db
      .query("issues")
      .withIndex("by_repo_and_number", (q) =>
        q.eq("repo", args.repo).eq("number", args.number),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        source: "github",
        githubId: args.githubId,
        title: args.title,
        body: args.body,
        state: args.state,
        htmlUrl: args.htmlUrl,
        labels: args.labels,
        assigneeLogins: args.assigneeLogins,
        authorLogin: args.authorLogin,
        isPullRequest: args.isPullRequest,
        // An in-app override wins and survives the re-sync; otherwise priority
        // tracks the GitHub labels (add a label to raise it).
        priority: existing.priorityOverride ?? priority,
        lastSyncedAt: Date.now(),
      });
      return existing._id;
    }

    const id = await ctx.db.insert("issues", {
      source: "github",
      repo: args.repo,
      number: args.number,
      githubId: args.githubId,
      title: args.title,
      body: args.body,
      state: args.state,
      htmlUrl: args.htmlUrl,
      labels: args.labels,
      assigneeLogins: args.assigneeLogins,
      authorLogin: args.authorLogin,
      isPullRequest: args.isPullRequest,
      priority,
      lastSyncedAt: Date.now(),
    });
    return id;
  },
});

export const deleteIssueFromWebhook = internalMutation({
  args: { repo: v.string(), number: v.number() },
  returns: v.null(),
  handler: async (ctx, { repo, number }) => {
    const existing = await ctx.db
      .query("issues")
      .withIndex("by_repo_and_number", (q) =>
        q.eq("repo", repo).eq("number", number),
      )
      .unique();
    if (!existing) return null;
    const comments = await ctx.db
      .query("issueComments")
      .withIndex("by_issue", (q) => q.eq("issueId", existing._id))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);
    await ctx.db.delete(existing._id);
    return null;
  },
});

export const upsertCommentFromWebhook = internalMutation({
  args: {
    repo: v.string(),
    number: v.number(),
    githubCommentId: v.number(),
    authorLogin: v.optional(v.string()),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const issue = await ctx.db
      .query("issues")
      .withIndex("by_repo_and_number", (q) =>
        q.eq("repo", args.repo).eq("number", args.number),
      )
      .unique();
    if (!issue) return null; // comment on an issue we haven't synced — ignore
    const existing = await ctx.db
      .query("issueComments")
      .withIndex("by_githubCommentId", (q) =>
        q.eq("githubCommentId", args.githubCommentId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        body: args.body,
        authorLogin: args.authorLogin,
      });
      return null;
    }
    await ctx.db.insert("issueComments", {
      issueId: issue._id,
      githubCommentId: args.githubCommentId,
      authorLogin: args.authorLogin,
      body: args.body,
    });
    return null;
  },
});

export const deleteCommentFromWebhook = internalMutation({
  args: { githubCommentId: v.number() },
  returns: v.null(),
  handler: async (ctx, { githubCommentId }) => {
    const existing = await ctx.db
      .query("issueComments")
      .withIndex("by_githubCommentId", (q) =>
        q.eq("githubCommentId", githubCommentId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

// After a successful REST state change, keep the local mirror consistent even
// if the webhook isn't configured (the webhook, if present, is idempotent).
export const applyStateFromWriteback = internalMutation({
  args: { issueId: v.id("issues"), state: issueStateValidator },
  returns: v.null(),
  handler: async (ctx, { issueId, state }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) return null;
    await ctx.db.patch(issueId, { state });
    return null;
  },
});

// Minimal issue context an action needs for REST write-back.
export const getForWriteback = internalQuery({
  args: { id: v.id("issues") },
  returns: v.union(
    v.object({
      repo: v.optional(v.string()),
      number: v.optional(v.number()),
      source: v.union(v.literal("github"), v.literal("manual")),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const issue = await ctx.db.get(id);
    if (!issue) return null;
    return { repo: issue.repo, number: issue.number, source: issue.source };
  },
});

// ---- Actions (GitHub REST write-back — default runtime, plain fetch) ----

const vWriteResult = v.object({ ok: v.boolean(), message: v.string() });

// Post a comment to the linked GitHub issue. The comment mirrors back into
// `issueComments` via the webhook, so we don't insert it locally here.
export const commentOnGitHub = action({
  args: { issueId: v.id("issues"), body: v.string() },
  returns: vWriteResult,
  handler: async (ctx, { issueId, body }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const token = process.env.GITHUB_TOKEN;
    if (!token)
      return { ok: false, message: "Set GITHUB_TOKEN to comment on GitHub." };
    const issue = await ctx.runQuery(internal.github.getForWriteback, {
      id: issueId,
    });
    if (!issue || !issue.repo || issue.number === undefined)
      return { ok: false, message: "This issue isn't linked to GitHub." };
    const res = await githubFetch(
      `/repos/${issue.repo}/issues/${issue.number}/comments`,
      { method: "POST", token, body: JSON.stringify({ body }) },
    );
    if (!res.ok) return { ok: false, message: `GitHub error ${res.status}.` };
    return { ok: true, message: "Comment posted to GitHub." };
  },
});

export const setGitHubState = action({
  args: { issueId: v.id("issues"), state: issueStateValidator },
  returns: vWriteResult,
  handler: async (ctx, { issueId, state }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const token = process.env.GITHUB_TOKEN;
    if (!token)
      return { ok: false, message: "Set GITHUB_TOKEN to update GitHub." };
    const issue = await ctx.runQuery(internal.github.getForWriteback, {
      id: issueId,
    });
    if (!issue || !issue.repo || issue.number === undefined)
      return { ok: false, message: "This issue isn't linked to GitHub." };
    const res = await githubFetch(
      `/repos/${issue.repo}/issues/${issue.number}`,
      { method: "PATCH", token, body: JSON.stringify({ state }) },
    );
    if (!res.ok) return { ok: false, message: `GitHub error ${res.status}.` };
    await ctx.runMutation(internal.github.applyStateFromWriteback, {
      issueId,
      state,
    });
    return {
      ok: true,
      message: state === "closed" ? "Closed on GitHub." : "Reopened on GitHub.",
    };
  },
});

// Mentor-triggered bulk import of a repo's existing issues (and PRs). Handy for
// first-run population and for testing without waiting on webhook traffic.
export const importIssues = action({
  args: { repo: v.string() },
  returns: v.object({ imported: v.number() }),
  handler: async (ctx, { repo }) => {
    // The shared role lookup, not a local copy of it: the copy this replaced
    // read Clerk's raw mentor flag, so someone promoted in Settings was turned
    // away and someone demoted there kept the button.
    const role = await ctx.runQuery(internal.auth.callerRole, {});
    if (!role || !isMentorOrAbove(role)) throw new Error("Mentors only.");
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Set GITHUB_TOKEN first.");
    const cleanRepo = normalizeRepo(repo);
    if (!/^[^/]+\/[^/]+$/.test(cleanRepo))
      throw new Error(`Expected "owner/name", got "${cleanRepo}".`);

    let imported = 0;
    for (let page = 1; page <= 10; page++) {
      const res = await githubFetch(
        `/repos/${cleanRepo}/issues?state=all&per_page=100&page=${page}`,
        { token },
      );
      if (!res.ok)
        throw new Error(`GitHub error ${res.status}: ${await res.text()}`);
      const items = (await res.json()) as unknown[];
      if (!Array.isArray(items) || items.length === 0) break;
      for (const item of items) {
        // REST list flags PRs via a `pull_request` key on the item itself.
        const args = normalizeIssueNode(cleanRepo, item, false);
        if (args) {
          const id = await ctx.runMutation(
            internal.github.upsertIssueFromWebhook,
            args,
          );
          // An ignored repo accepts nothing, so don't claim it imported.
          if (id !== null) imported += 1;
        }
      }
      if (items.length < 100) break;
    }
    return { imported };
  },
});

// ---- Webhook receiver ----

export const githubWebhook = httpAction(async (ctx, req) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!(await verifySignature(secret, raw, signature))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return new Response("pong", { status: 200 });

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(raw));
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const action = payload.action;
  const repo = asRecord(payload.repository).full_name;
  if (typeof repo !== "string") return new Response("ok", { status: 200 });

  try {
    if (event === "issues" || event === "pull_request") {
      const isPR = event === "pull_request";
      const node = isPR ? payload.pull_request : payload.issue;
      const number = asRecord(node).number;
      if (action === "deleted" && typeof number === "number") {
        await ctx.runMutation(internal.github.deleteIssueFromWebhook, {
          repo,
          number,
        });
      } else {
        const args = normalizeIssueNode(repo, node, isPR);
        if (args) {
          await ctx.runMutation(internal.github.upsertIssueFromWebhook, args);
        }
      }
    } else if (event === "issue_comment") {
      const number = asRecord(payload.issue).number;
      const comment = asRecord(payload.comment);
      const commentId = comment.id;
      if (typeof number === "number" && typeof commentId === "number") {
        if (action === "deleted") {
          await ctx.runMutation(internal.github.deleteCommentFromWebhook, {
            githubCommentId: commentId,
          });
        } else {
          await ctx.runMutation(internal.github.upsertCommentFromWebhook, {
            repo,
            number,
            githubCommentId: commentId,
            authorLogin:
              typeof asRecord(comment.user).login === "string"
                ? (asRecord(comment.user).login as string)
                : undefined,
            body: typeof comment.body === "string" ? comment.body : "",
          });
        }
      }
    }
  } catch (err) {
    // Never fail the webhook on a processing error — log and 200 so GitHub
    // doesn't hammer redelivery.
    console.error("github webhook processing error", err);
  }

  return new Response("ok", { status: 200 });
});
