import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
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
import { TaskFormDialog } from "@/components/pm/TaskFormDialog";
import { AssigneeAvatars, StatusBadge } from "@/components/pm/TaskMeta";
import { useIsMentor } from "@/lib/roles";
import { initials, useRosterMap } from "@/lib/users";
import {
  PRIORITIES,
  STATUSES,
  formatDate,
  formatDateTime,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/pm";
import {
  Cross2Icon,
  Pencil1Icon,
  TrashIcon,
  UploadIcon,
} from "@radix-ui/react-icons";

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const id = taskId as Id<"tasks">;
  const task = useQuery(api.tasks.get, { id });
  const boards = useQuery(api.boards.list, {});
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);
  const navigate = useNavigate();
  const isMentor = useIsMentor();

  if (task === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (task === null) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Task not found.</p>
        <Link to="/boards" className="text-sm hover:underline">
          ← Back to boards
        </Link>
      </div>
    );
  }

  const board = boards?.find((b) => b._id === task.boardId);

  async function handleDelete() {
    if (!confirm(`Delete "${task!.title}"? This can't be undone.`)) return;
    await removeTask({ id });
    void navigate(`/boards/${task!.boardId}`);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          to={`/boards/${task.boardId}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {board?.name ?? "Board"}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>
          <div className="flex items-center gap-2">
            <TaskFormDialog
              task={task}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil1Icon className="mr-1.5 h-4 w-4" /> Edit
                </Button>
              }
            />
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
              {task.description || (
                <span className="text-muted-foreground">No description.</span>
              )}
            </p>
          </section>

          <SubtasksSection task={task} />
          <CommentsSection taskId={id} />
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border p-4">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Status
                </label>
                <Select
                  value={task.status}
                  onValueChange={(v) =>
                    void updateTask({ id, status: v as TaskStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Priority
                </label>
                <Select
                  value={task.priority}
                  onValueChange={(v) =>
                    void updateTask({ id, priority: v as TaskPriority })
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
              <MetaRow label="Due">
                <span>{formatDate(task.dueDate)}</span>
              </MetaRow>
              <MetaRow label="Assignees">
                <AssigneeAvatars assigneeIds={task.assigneeIds} />
              </MetaRow>
              {task.completedAt !== undefined && (
                <MetaRow label="Completed">
                  <span>{formatDate(task.completedAt)}</span>
                </MetaRow>
              )}
              {task.labels.length > 0 && (
                <MetaRow label="Labels">
                  <div className="flex flex-wrap gap-1">
                    {task.labels.map((l) => (
                      <Badge key={l} variant="secondary" className="text-[10px]">
                        {l}
                      </Badge>
                    ))}
                  </div>
                </MetaRow>
              )}
              {task.source !== "manual" && (
                <MetaRow label="Source">
                  <Badge variant="outline" className="capitalize">
                    {task.source}
                  </Badge>
                </MetaRow>
              )}
            </div>
          </div>

          <DependenciesSection task={task} />
          <AttachmentsSection taskId={id} />
        </aside>
      </div>
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

function SubtasksSection({ task }: { task: Doc<"tasks"> }) {
  const subtasks = useQuery(api.tasks.listSubtasks, { parentTaskId: task._id });
  const updateTask = useMutation(api.tasks.update);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Subtasks</h2>
        <TaskFormDialog
          defaultBoardId={task.boardId}
          defaultParentTaskId={task._id}
          trigger={
            <Button variant="ghost" size="sm">
              + Add subtask
            </Button>
          }
        />
      </div>
      {subtasks === undefined ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : subtasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No subtasks.</p>
      ) : (
        <ul className="space-y-1">
          {subtasks.map((st) => (
            <li
              key={st._id}
              className="flex items-center gap-2 rounded-md border px-3 py-2"
            >
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={st.status === "done"}
                onChange={(e) =>
                  void updateTask({
                    id: st._id,
                    status: e.target.checked ? "done" : "todo",
                  })
                }
              />
              <Link
                to={`/tasks/${st._id}`}
                className={
                  st.status === "done"
                    ? "grow text-sm text-muted-foreground line-through"
                    : "grow text-sm hover:underline"
                }
              >
                {st.title}
              </Link>
              <StatusBadge status={st.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DependenciesSection({ task }: { task: Doc<"tasks"> }) {
  const deps = useQuery(api.tasks.getMany, { ids: task.dependsOn });
  const candidates = useQuery(api.tasks.listByBoard, { boardId: task.boardId });
  const updateTask = useMutation(api.tasks.update);

  const options = (candidates ?? []).filter(
    (t) => t._id !== task._id && !task.dependsOn.includes(t._id),
  );

  function addDep(depId: string) {
    void updateTask({
      id: task._id,
      dependsOn: [...task.dependsOn, depId as Id<"tasks">],
    });
  }
  function removeDep(depId: Id<"tasks">) {
    void updateTask({
      id: task._id,
      dependsOn: task.dependsOn.filter((x) => x !== depId),
    });
  }

  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">
        Depends on
      </h2>
      {deps && deps.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {deps.map((d) => (
            <li key={d._id} className="flex items-center gap-2 text-sm">
              <StatusBadge status={d.status} />
              <Link to={`/tasks/${d._id}`} className="grow hover:underline">
                {d.title}
              </Link>
              <button
                type="button"
                onClick={() => removeDep(d._id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Cross2Icon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-muted-foreground">No dependencies.</p>
      )}
      {options.length > 0 && (
        <Select value="" onValueChange={addDep}>
          <SelectTrigger>
            <SelectValue placeholder="Add dependency…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((t) => (
              <SelectItem key={t._id} value={t._id}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function CommentsSection({ taskId }: { taskId: Id<"tasks"> }) {
  const comments = useQuery(api.tasks.listComments, { taskId });
  const addComment = useMutation(api.tasks.addComment);
  const roster = useRosterMap();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await addComment({ taskId, body: trimmed });
      setBody("");
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
          const name = roster[c.authorId]?.name ?? "Unknown";
          return (
            <div key={c._id} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {initials(name)}
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{name}</span>
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
          placeholder="Add a comment…"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving || !body.trim()}>
            {saving ? "Posting…" : "Comment"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function AttachmentsSection({ taskId }: { taskId: Id<"tasks"> }) {
  const attachments = useQuery(api.tasks.listAttachments, { taskId });
  const generateUploadUrl = useMutation(api.tasks.generateUploadUrl);
  const addAttachment = useMutation(api.tasks.addAttachment);
  const removeAttachment = useMutation(api.tasks.removeAttachment);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await res.json();
      await addAttachment({ taskId, storageId, filename: file.name });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Attachments
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <UploadIcon className="mr-1.5 h-4 w-4" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => void handleFile(e)}
        />
      </div>
      {attachments && attachments.length > 0 ? (
        <ul className="space-y-1">
          {attachments.map((a) => (
            <li key={a._id} className="flex items-center gap-2 text-sm">
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="grow truncate hover:underline"
                >
                  {a.filename}
                </a>
              ) : (
                <span className="grow truncate">{a.filename}</span>
              )}
              <button
                type="button"
                onClick={() => void removeAttachment({ id: a._id })}
                className="text-muted-foreground hover:text-foreground"
              >
                <Cross2Icon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No attachments.</p>
      )}
    </div>
  );
}
