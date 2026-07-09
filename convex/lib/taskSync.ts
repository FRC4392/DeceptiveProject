import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type TaskStatus = Doc<"tasks">["status"];
type PartStatus = Doc<"parts">["status"];
type IssueState = Doc<"issues">["state"];

// Map a part's manufacturing stage to a PM task status. A blocked part
// overrides this (handled in syncTaskForPart).
const PART_STATUS_TO_TASK: Record<PartStatus, TaskStatus> = {
  needs_design: "todo",
  in_design: "todo",
  designed: "todo",
  queued: "todo",
  in_progress: "in_progress",
  manufactured: "in_progress",
  qc: "in_progress",
  installed: "done",
  scrapped: "done",
};

// Get (or lazily create) the board that auto-generated tasks live on, keyed by
// (subsystem, project) so each project gets its own board per source area.
export async function getOrCreateBoard(
  ctx: MutationCtx,
  name: string,
  subsystem: string,
  projectId?: Id<"projects">,
): Promise<Id<"boards">> {
  const boards = await ctx.db.query("boards").collect();
  const existing = boards.find(
    (b) => b.subsystem === subsystem && b.projectId === projectId,
  );
  if (existing) return existing._id;
  const order = boards.reduce((max, b) => Math.max(max, b.order), -1) + 1;
  return ctx.db.insert("boards", { name, subsystem, order, projectId });
}

/**
 * Mirror a part's lifecycle into the single `tasks` list — one code path that
 * decides "does this change need a to-do." A task exists from "needs_design"
 * onward (source: "part", sourceId: part._id). Called from every part mutation
 * that changes status/assignment/blocked, and (Phase 3) the Onshape webhook.
 */
export async function syncTaskForPart(
  ctx: MutationCtx,
  part: Doc<"parts">,
): Promise<void> {
  const taskStatus: TaskStatus = part.blocked
    ? "blocked"
    : PART_STATUS_TO_TASK[part.status];
  const title = part.partNumber
    ? `${part.partNumber} · ${part.name}`
    : `Part: ${part.name}`;
  const assigneeIds = part.assigneeId ? [part.assigneeId] : [];

  const existing = await ctx.db
    .query("tasks")
    .withIndex("by_source", (q) =>
      q.eq("source", "part").eq("sourceId", part._id),
    )
    .unique();

  if (existing) {
    const patch: Partial<Doc<"tasks">> = {
      title,
      status: taskStatus,
      assigneeIds,
      projectId: part.projectId,
    };
    if (taskStatus === "done" && existing.status !== "done") {
      patch.completedAt = Date.now();
    } else if (taskStatus !== "done" && existing.status === "done") {
      patch.completedAt = undefined;
    }
    await ctx.db.patch(existing._id, patch);
    if (part.linkedTaskId !== existing._id) {
      await ctx.db.patch(part._id, { linkedTaskId: existing._id });
    }
    return;
  }

  const boardId = await getOrCreateBoard(
    ctx,
    "Manufacturing",
    "manufacturing",
    part.projectId,
  );
  const taskId = await ctx.db.insert("tasks", {
    title,
    boardId,
    assigneeIds,
    status: taskStatus,
    completedAt: taskStatus === "done" ? Date.now() : undefined,
    priority: "medium",
    labels: ["part"],
    dependsOn: [],
    source: "part",
    sourceId: part._id,
    projectId: part.projectId,
  });
  await ctx.db.patch(part._id, { linkedTaskId: taskId });
}

/**
 * Delete the task mirrored from a part (used when the part itself is removed).
 */
export async function deleteTaskForPart(
  ctx: MutationCtx,
  partId: Id<"parts">,
): Promise<void> {
  await deleteMirrorTask(ctx, "part", partId);
}

// Map a GitHub issue/PR state to a PM task status. Open work is a to-do;
// closed issues are done. (A blocked/in-progress nuance isn't modeled — GitHub
// carries no such state without extra label conventions.)
const ISSUE_STATE_TO_TASK: Record<IssueState, TaskStatus> = {
  open: "todo",
  closed: "done",
};

/**
 * Mirror an issue's lifecycle into the single `tasks` list — the issue-side twin
 * of `syncTaskForPart`. A task exists for every issue (source: "issue",
 * sourceId: issue._id) on the shared "Software" board. Called from every issue
 * mutation and the GitHub webhook. Assignees are intentionally left untouched
 * (GitHub logins don't map to Clerk ids), so a mirror task keeps any manual
 * PM assignment across re-syncs.
 */
export async function syncTaskForIssue(
  ctx: MutationCtx,
  issue: Doc<"issues">,
): Promise<void> {
  const taskStatus: TaskStatus = ISSUE_STATE_TO_TASK[issue.state];
  const ref =
    issue.number !== undefined
      ? `${issue.isPullRequest ? "PR" : "Issue"} #${issue.number}: `
      : "";
  const title = `${ref}${issue.title}`;
  const labels = issue.isPullRequest ? ["issue", "pr"] : ["issue"];

  const existing = await ctx.db
    .query("tasks")
    .withIndex("by_source", (q) =>
      q.eq("source", "issue").eq("sourceId", issue._id),
    )
    .unique();

  if (existing) {
    const patch: Partial<Doc<"tasks">> = {
      title,
      status: taskStatus,
      priority: issue.priority,
      projectId: issue.projectId,
    };
    if (taskStatus === "done" && existing.status !== "done") {
      patch.completedAt = Date.now();
    } else if (taskStatus !== "done" && existing.status === "done") {
      patch.completedAt = undefined;
    }
    await ctx.db.patch(existing._id, patch);
    if (issue.linkedTaskId !== existing._id) {
      await ctx.db.patch(issue._id, { linkedTaskId: existing._id });
    }
    return;
  }

  const boardId = await getOrCreateBoard(
    ctx,
    "Software",
    "software",
    issue.projectId,
  );
  const taskId = await ctx.db.insert("tasks", {
    title,
    boardId,
    assigneeIds: [],
    status: taskStatus,
    completedAt: taskStatus === "done" ? Date.now() : undefined,
    priority: issue.priority,
    labels,
    dependsOn: [],
    source: "issue",
    sourceId: issue._id,
    projectId: issue.projectId,
  });
  await ctx.db.patch(issue._id, { linkedTaskId: taskId });
}

/**
 * Delete the task mirrored from an issue (used when the issue is removed).
 */
export async function deleteTaskForIssue(
  ctx: MutationCtx,
  issueId: Id<"issues">,
): Promise<void> {
  await deleteMirrorTask(ctx, "issue", issueId);
}

// Shared teardown for a source-mirrored task and its comments.
async function deleteMirrorTask(
  ctx: MutationCtx,
  source: "part" | "issue",
  sourceId: Id<"parts"> | Id<"issues">,
): Promise<void> {
  const existing = await ctx.db
    .query("tasks")
    .withIndex("by_source", (q) =>
      q.eq("source", source).eq("sourceId", sourceId),
    )
    .unique();
  if (!existing) return;
  const comments = await ctx.db
    .query("taskComments")
    .withIndex("by_task", (q) => q.eq("taskId", existing._id))
    .collect();
  for (const c of comments) await ctx.db.delete(c._id);
  await ctx.db.delete(existing._id);
}
