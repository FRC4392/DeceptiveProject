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
import { PriorityBadge } from "@/components/pm/PriorityBadge";
import { IssueFormDialog } from "@/components/pm/IssueFormDialog";
import { MarkdownBody } from "@/components/pm/MarkdownBody";
import { Chip } from "@/components/tracker/PartChips";
import { useIsMentor } from "@/lib/roles";
import { initials, useRosterMap } from "@/lib/users";
import { PRIORITIES, type Priority } from "@/lib/priority";
import { formatDateTime } from "@/lib/dates";
import { errorText } from "@/lib/errors";
import { issueRef, issueStateMeta } from "@/lib/github";
import {
  ExternalLinkIcon,
  GitHubLogoIcon,
  Pencil1Icon,
  TrashIcon,
} from "@radix-ui/react-icons";

export function IssueDetailPage() {
  const { issueId } = useParams<{ issueId: string }>();
  const id = issueId as Id<"issues">;
  const issue = useQuery(api.github.get, { id });
  const removeIssue = useMutation(api.github.remove);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    // It takes its comments with it. A GitHub issue is only gone from here:
    // it's still on GitHub, and a later delivery will bring it back.
    const where =
      issue!.source === "github"
        ? " from the tracker? It stays on GitHub."
        : "?";
    if (!confirm(`Delete "${issue!.title}" and its comments${where}`)) return;
    setError(null);
    try {
      await removeIssue({ id });
      void navigate("/issues");
    } catch (err) {
      setError(errorText(err, "That didn't delete."));
    }
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/issues" className="hover:text-foreground hover:underline">
          Issues
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{issueRef(issue)}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="brand-title break-words text-3xl">{issue.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip className={stateMeta.badgeClass}>{stateMeta.label}</Chip>
            {issue.isPullRequest && (
              <Chip className="bg-muted text-muted-foreground">
                Pull request
              </Chip>
            )}
            {issue.labels.map((label) => (
              <Chip
                key={label}
                className="bg-secondary text-secondary-foreground"
              >
                {label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {issue.source === "manual" && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil1Icon className="mr-1.5 h-4 w-4" /> Edit
            </Button>
          )}
          {issue.htmlUrl && (
            <Button asChild variant="outline">
              <a href={issue.htmlUrl} target="_blank" rel="noreferrer">
                <GitHubLogoIcon className="mr-1.5 h-4 w-4" /> View on GitHub
              </a>
            </Button>
          )}
          {isMentor && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => void handleDelete()}
            >
              <TrashIcon className="mr-1.5 h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </header>
      {error && <p className="text-sm text-danger">{error}</p>}

      {/* What to do about it, the way a part page leads with its one action. */}
      <section className="rounded-lg border-2 border-primary bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Right now
        </p>
        <h2 className="mt-1 text-lg font-semibold">
          {issue.state === "open" ? "Open — somebody has to fix it" : "Closed"}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <StateControl issue={issue} />
          <PriorityControl issue={issue} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Description</h2>
            {issue.body ? (
              <MarkdownBody body={issue.body} className="mt-3" />
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No description.
              </p>
            )}
          </section>

          <CommentsSection issue={issue} />
        </div>

        <aside className="space-y-4">
          <section className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Details</h2>
            {issue.repo && (
              <MetaRow label="Repo">
                <span className="break-all font-mono text-xs">
                  {issueRef(issue)}
                </span>
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
            {issue.lastSyncedAt !== undefined && (
              <MetaRow label="Last synced">
                <span className="text-sm">
                  {formatDateTime(issue.lastSyncedAt)}
                </span>
              </MetaRow>
            )}
          </section>
        </aside>
      </div>

      <IssueFormDialog issue={issue} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

function StateControl({ issue }: { issue: Doc<"issues"> }) {
  const setState = useMutation(api.github.setState);
  const setGitHubState = useAction(api.github.setGitHubState);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextState = issue.state === "open" ? "closed" : "open";

  async function toggle() {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      if (issue.source === "manual") {
        await setState({ id: issue._id, state: nextState });
      } else {
        const res = await setGitHubState({
          issueId: issue._id,
          state: nextState,
        });
        // "GitHub error 403." is a failure, not a status update.
        if (res.ok) setNote(res.message);
        else setError(res.message);
      }
    } catch (err) {
      setError(errorText(err, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size="lg"
        variant={issue.state === "open" ? "default" : "outline"}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {issue.state === "open"
          ? issue.source === "manual"
            ? "Close it"
            : "Close it on GitHub"
          : issue.source === "manual"
            ? "Reopen it"
            : "Reopen it on GitHub"}
      </Button>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const AUTO_PRIORITY = "__auto__";

function PriorityControl({ issue }: { issue: Doc<"issues"> }) {
  const update = useMutation(api.github.update);
  const [error, setError] = useState<string | null>(null);
  function save(args: Parameters<typeof update>[0]) {
    setError(null);
    update(args).catch((err: unknown) =>
      setError(errorText(err, "That didn't save.")),
    );
  }
  const errorLine = error && <p className="text-xs text-danger">{error}</p>;

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
            save({ id: issue._id, priority: v as Priority })
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
        {errorLine}
      </div>
    );
  }

  // GitHub issues track labels unless pinned with an in-app override.
  const overridden = issue.priorityOverride !== undefined;
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        Priority
      </span>
      <Select
        value={issue.priorityOverride ?? AUTO_PRIORITY}
        onValueChange={(v) =>
          save({
            id: issue._id,
            priorityOverride: v === AUTO_PRIORITY ? null : (v as Priority),
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
      {errorLine}
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
  const [error, setError] = useState<string | null>(null);

  const canPostToGitHub = issue.source === "github";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSaving(true);
    setNote(null);
    setError(null);
    try {
      if (toGitHub && canPostToGitHub) {
        const res = await commentOnGitHub({
          issueId: issue._id,
          body: trimmed,
        });
        if (res.ok) {
          setNote(res.message);
          setBody("");
        } else {
          setError(res.message);
        }
      } else {
        await addComment({ issueId: issue._id, body: trimmed });
        setBody("");
      }
    } catch (err) {
      // The text stays in the box, so nothing typed is lost.
      setError(errorText(err, "That comment didn't post."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="font-semibold">Comments</h2>
      <div className="mt-3 space-y-4">
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
              {/* min-w-0 is what keeps a long comment inside the card: a flex
                  item's default min-width is its content, so without it the
                  widest unbroken line in the comment sets the width. */}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
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
                <MarkdownBody body={c.body} />
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
        {error && <p className="text-xs text-danger">{error}</p>}
      </form>
    </section>
  );
}
