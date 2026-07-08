import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PriorityBadge } from "@/components/pm/TaskMeta";
import { IssueFormDialog } from "@/components/pm/IssueFormDialog";
import { useIsMentor } from "@/lib/roles";
import { initials, useRosterMap } from "@/lib/users";
import { useActiveProject } from "@/lib/project";
import { PRIORITIES, formatDateTime, type TaskPriority } from "@/lib/pm";
import { issueRef, issueStateMeta } from "@/lib/github";
import { cn } from "@/lib/utils";
import {
  ExternalLinkIcon,
  GitHubLogoIcon,
  Pencil1Icon,
  TrashIcon,
} from "@radix-ui/react-icons";

const NO_PROJECT = "__none__";

export function IssueDetailPage() {
  const { issueId } = useParams<{ issueId: string }>();
  const id = issueId as Id<"issues">;
  const issue = useQuery(api.github.get, { id });
  const removeIssue = useMutation(api.github.remove);
  const navigate = useNavigate();
  const isMentor = useIsMentor();

  if (issue === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (issue === null) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Issue not found.</p>
        <Link to="/issues" className="text-sm hover:underline">
          ← Back to issues
        </Link>
      </div>
    );
  }

  const stateMeta = issueStateMeta(issue.state);

  async function handleDelete() {
    if (!confirm(`Delete "${issue!.title}"? This removes its task too.`)) return;
    await removeIssue({ id });
    void navigate("/issues");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          to="/issues"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Issues
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {issueRef(issue)}
            </p>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="brand-title text-2xl">{issue.title}</h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                  stateMeta.badgeClass,
                )}
              >
                {stateMeta.label}
              </span>
              {issue.isPullRequest && (
                <Badge variant="outline" className="text-[10px] uppercase">
                  PR
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {issue.source === "manual" && (
              <IssueFormDialog
                issue={issue}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil1Icon className="mr-1.5 h-4 w-4" /> Edit
                  </Button>
                }
              />
            )}
            {issue.htmlUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={issue.htmlUrl} target="_blank" rel="noreferrer">
                  <GitHubLogoIcon className="mr-1.5 h-4 w-4" /> View on GitHub
                </a>
              </Button>
            )}
            {isMentor && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete()}
              >
                <TrashIcon className="mr-1.5 h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Description
            </h2>
            <p className="whitespace-pre-wrap text-sm">
              {issue.body || (
                <span className="text-muted-foreground">No description.</span>
              )}
            </p>
          </section>

          <CommentsSection issue={issue} />
        </div>

        <aside className="space-y-6">
          <div className="space-y-4 rounded-lg border p-4">
            <StateControl issue={issue} />
            <PriorityControl issue={issue} />
            <ProjectControl issue={issue} />
            {issue.repo && (
              <MetaRow label="Repo">
                <span className="font-mono text-xs">{issueRef(issue)}</span>
              </MetaRow>
            )}
            {issue.authorLogin && (
              <MetaRow label="Author">
                <span className="text-sm">@{issue.authorLogin}</span>
              </MetaRow>
            )}
            {issue.assigneeLogins.length > 0 && (
              <MetaRow label="Assignees">
                <span className="text-sm">
                  {issue.assigneeLogins.map((l) => `@${l}`).join(", ")}
                </span>
              </MetaRow>
            )}
            {issue.labels.length > 0 && (
              <MetaRow label="Labels">
                <div className="flex flex-wrap justify-end gap-1">
                  {issue.labels.map((l) => (
                    <Badge key={l} variant="secondary" className="text-[10px]">
                      {l}
                    </Badge>
                  ))}
                </div>
              </MetaRow>
            )}
            {issue.linkedTaskId && (
              <MetaRow label="Task">
                <Link
                  to={`/tasks/${issue.linkedTaskId}`}
                  className="text-sm text-primary hover:underline"
                >
                  Open task →
                </Link>
              </MetaRow>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function StateControl({ issue }: { issue: Doc<"issues"> }) {
  const setState = useMutation(api.github.setState);
  const setGitHubState = useAction(api.github.setGitHubState);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const nextState = issue.state === "open" ? "closed" : "open";

  async function toggle() {
    setBusy(true);
    setNote(null);
    try {
      if (issue.source === "manual") {
        await setState({ id: issue._id, state: nextState });
      } else {
        const res = await setGitHubState({
          issueId: issue._id,
          state: nextState,
        });
        setNote(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">State</span>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => void toggle()}
      >
        {issue.state === "open"
          ? issue.source === "manual"
            ? "Close issue"
            : "Close on GitHub"
          : issue.source === "manual"
            ? "Reopen issue"
            : "Reopen on GitHub"}
      </Button>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

const AUTO_PRIORITY = "__auto__";

function PriorityControl({ issue }: { issue: Doc<"issues"> }) {
  const update = useMutation(api.github.update);

  // Manual issues set priority directly.
  if (issue.source === "manual") {
    return (
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Priority
        </span>
        <Select
          value={issue.priority}
          onValueChange={(v) =>
            void update({ id: issue._id, priority: v as TaskPriority })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // GitHub issues track labels unless pinned with an in-app override.
  const overridden = issue.priorityOverride !== undefined;
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">Priority</span>
      <Select
        value={issue.priorityOverride ?? AUTO_PRIORITY}
        onValueChange={(v) =>
          void update({
            id: issue._id,
            priorityOverride: v === AUTO_PRIORITY ? null : (v as TaskPriority),
          })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_PRIORITY}>Auto (from labels)</SelectItem>
          {PRIORITIES.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {overridden ? "Pinned — survives re-sync." : "Currently"}
        {!overridden && <PriorityBadge priority={issue.priority} />}
      </p>
    </div>
  );
}

function ProjectControl({ issue }: { issue: Doc<"issues"> }) {
  const { projects } = useActiveProject();
  const update = useMutation(api.github.update);
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">Project</span>
      <Select
        value={issue.projectId ?? NO_PROJECT}
        onValueChange={(v) =>
          void update({
            id: issue._id,
            projectId: v === NO_PROJECT ? null : (v as Id<"projects">),
          })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PROJECT}>No project</SelectItem>
          {(projects ?? []).map((p) => (
            <SelectItem key={p._id} value={p._id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function CommentsSection({ issue }: { issue: Doc<"issues"> }) {
  const comments = useQuery(api.github.listComments, { issueId: issue._id });
  const addComment = useMutation(api.github.addComment);
  const commentOnGitHub = useAction(api.github.commentOnGitHub);
  const roster = useRosterMap();
  const [body, setBody] = useState("");
  const [toGitHub, setToGitHub] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const canPostToGitHub = issue.source === "github";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSaving(true);
    setNote(null);
    try {
      if (toGitHub && canPostToGitHub) {
        const res = await commentOnGitHub({ issueId: issue._id, body: trimmed });
        setNote(res.message);
        if (res.ok) setBody("");
      } else {
        await addComment({ issueId: issue._id, body: trimmed });
        setBody("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        Comments
      </h2>
      <div className="space-y-4">
        {(comments ?? []).map((c) => {
          const isGitHub = c.githubCommentId !== undefined;
          const name = isGitHub
            ? `@${c.authorLogin ?? "github"}`
            : (roster[c.authorId ?? ""]?.name ?? "Unknown");
          return (
            <div key={c._id} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {isGitHub ? (
                  <GitHubLogoIcon className="h-4 w-4" />
                ) : (
                  initials(name)
                )}
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{name}</span>
                  {isGitHub && (
                    <Badge variant="outline" className="text-[10px]">
                      GitHub
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(c._creationTime)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </div>
          );
        })}
        {comments && comments.length === 0 && (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        )}
      </div>
      <Separator className="my-4" />
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            toGitHub ? "Comment posted to GitHub…" : "Add a team note…"
          }
        />
        <div className="flex items-center justify-between">
          {canPostToGitHub ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={toGitHub}
                onChange={(e) => setToGitHub(e.target.checked)}
              />
              <ExternalLinkIcon className="h-3.5 w-3.5" /> Post to GitHub
            </label>
          ) : (
            <span className="text-xs text-muted-foreground">
              Team note (stays in the tracker)
            </span>
          )}
          <Button type="submit" size="sm" disabled={saving || !body.trim()}>
            {saving ? "Posting…" : toGitHub ? "Comment on GitHub" : "Comment"}
          </Button>
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </form>
    </section>
  );
}
