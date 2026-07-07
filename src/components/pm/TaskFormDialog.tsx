import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRIORITIES,
  STATUSES,
  fromDateInputValue,
  toDateInputValue,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/pm";
import { initials, useRoster } from "@/lib/users";
import { cn } from "@/lib/utils";

type Props = {
  trigger: ReactNode;
  task?: Doc<"tasks">;
  defaultBoardId?: Id<"boards">;
  defaultParentTaskId?: Id<"tasks">;
};

export function TaskFormDialog({
  trigger,
  task,
  defaultBoardId,
  defaultParentTaskId,
}: Props) {
  const boards = useQuery(api.boards.list, {});
  const roster = useRoster();
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const isEdit = !!task;

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [boardId, setBoardId] = useState<string>(
    task?.boardId ?? defaultBoardId ?? "",
  );
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? "medium",
  );
  const [dueDate, setDueDate] = useState<string>(toDateInputValue(task?.dueDate));
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assigneeIds ?? [],
  );
  const [labels, setLabels] = useState<string>(
    (task?.labels ?? []).join(", "),
  );
  const [saving, setSaving] = useState(false);

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !boardId) return;
    const labelList = labels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      if (isEdit && task) {
        await updateTask({
          id: task._id,
          title: trimmed,
          description: description.trim() || null,
          boardId: boardId as Id<"boards">,
          status,
          priority,
          dueDate: dueDate ? fromDateInputValue(dueDate) : null,
          assigneeIds,
          labels: labelList,
        });
      } else {
        await createTask({
          title: trimmed,
          description: description.trim() || undefined,
          boardId: boardId as Id<"boards">,
          status,
          priority,
          dueDate: fromDateInputValue(dueDate),
          assigneeIds,
          labels: labelList,
          parentTaskId: defaultParentTaskId,
        });
        // reset for the next create
        setTitle("");
        setDescription("");
        setDueDate("");
        setAssigneeIds([]);
        setLabels("");
        setStatus("todo");
        setPriority("medium");
      }
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-col gap-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Board</Label>
              <Select value={boardId} onValueChange={setBoardId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select board" />
                </SelectTrigger>
                <SelectContent>
                  {(boards ?? []).map((b) => (
                    <SelectItem key={b._id} value={b._id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as TaskStatus)}
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
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-labels">Labels</Label>
            <Input
              id="task-labels"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="Comma-separated, e.g. urgent, welding"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Assignees</Label>
            <div className="flex flex-wrap gap-2">
              {(roster ?? []).map((person) => {
                const active = assigneeIds.includes(person.authId);
                return (
                  <button
                    key={person.authId}
                    type="button"
                    onClick={() => toggleAssignee(person.authId)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    <span className="font-medium">{initials(person.name)}</span>
                    <span>{person.name}</span>
                  </button>
                );
              })}
              {roster && roster.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No teammates synced yet.
                </span>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving || !title.trim() || !boardId}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
