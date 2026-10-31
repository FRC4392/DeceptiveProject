import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  httpAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  requireUserId,
  requireMentor,
  getCurrentUser,
  getActor,
} from "./lib/auth";
import { isLeadOrAbove } from "./lib/stages";
import {
  derivePriority,
  normalizeIssueNode,
  normalizeRepo,
} from "./lib/github";
import { githubFetch } from "./lib/githubRest";
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

export const list = query({
  args: {
    state: v.optional(issueStateValidator),
  },
  returns: v.array(vIssue),
  handler: async (ctx, args) => {
    let issues: Doc<"issues">[];
    if (args.state !== undefined) {
      issues = await ctx.db
        .query("issues")
        .withIndex("by_state", (q) => q.eq("state", args.state!))
        .take(SCAN_LIMIT);
    } else {
      issues = await ctx.db.query("issues").order("desc").take(SCAN_LIMIT);
    }
    return issues.filter(
      (i) => args.state === undefined || i.state === args.state,
    );
  },
});

export const get = query({
  args: { id: v.id("issues") },
  returns: v.union(vIssue, v.null()),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const listComments = query({
  args: { issueId: v.id("issues") },
  returns: v.array(vIssueComment),
  handler: async (ctx, { issueId }) =>
    ctx.db
      .query("issueComments")
      .withIndex("by_issue", (q) => q.eq("issueId", issueId))
      .order("asc")
      .collect(),
});

// Counts for the dashboard widget.
export const stats = query({
  args: {},
  returns: v.object({
    open: v.number(),
    closed: v.number(),
    prs: v.number(),
    total: v.number(),
  }),
  handler: async (ctx) => {
    const issues = await ctx.db.query("issues").take(SCAN_LIMIT);
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
    repos: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const issues = await ctx.db.query("issues").take(SCAN_LIMIT);
    const repos = [
      ...new Set(
        issues
          .map((i) => i.repo)
          .filter((r): r is string => typeof r === "string"),
      ),
    ].sort();
    return {
      webhookConfigured: !!process.env.GITHUB_WEBHOOK_SECRET,
      tokenConfigured: !!process.env.GITHUB_TOKEN,
      repos,
    };
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
export const upsertIssueFromWebhook = internalMutation({
  args: vUpsertArgs,
  returns: v.id("issues"),
  handler: async (ctx, args) => {
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

export const callerRole = internalQuery({
  args: {},
  returns: v.union(v.literal("mentor"), v.literal("student"), v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? (user.role ?? "student") : null;
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
    const role = await ctx.runQuery(internal.github.callerRole, {});
    if (role !== "mentor") throw new Error("Mentors only.");
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
          await ctx.runMutation(internal.github.upsertIssueFromWebhook, args);
          imported += 1;
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
