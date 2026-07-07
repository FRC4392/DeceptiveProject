import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { PRIORITIES, type TaskPriority } from "@/lib/pm";
import { useActiveProject } from "@/lib/project";

const NO_PROJECT = "__none__";

/**
 * Create or edit a manual (tracker-only) issue. Synced GitHub issues aren't
 * edited here — their title/body/labels are owned by GitHub.
 */
export function IssueFormDialog({
  trigger,
  issue,
}: {
  trigger: ReactNode;
  issue?: Doc<"issues">;
}) {
  const { projects, activeProjectId } = useActiveProject();
  const createIssue = useMutation(api.github.createManualIssue);
  const updateIssue = useMutation(api.github.update);
  const isEdit = !!issue;

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(issue?.title ?? "");
  const [body, setBody] = useState(issue?.body ?? "");
  const [priority, setPriority] = useState<TaskPriority>(
    issue?.priority ?? "medium",
  );
  const [labels, setLabels] = useState((issue?.labels ?? []).join(", "));
  const [projectId, setProjectId] = useState<string>(
    issue?.projectId ?? activeProjectId ?? NO_PROJECT,
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const labelList = labels
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    const project =
      projectId === NO_PROJECT ? undefined : (projectId as Id<"projects">);
    setSaving(true);
    try {
      if (isEdit && issue) {
        await updateIssue({
          id: issue._id,
          title: title.trim(),
          body: body.trim() || null,
          priority,
          labels: labelList,
          projectId: project ?? null,
        });
      } else {
        await createIssue({
          title: title.trim(),
          body: body.trim() || undefined,
          priority,
          labels: labelList,
          projectId: project,
        });
        setTitle("");
        setBody("");
        setLabels("");
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
          <DialogTitle>{isEdit ? "Edit issue" : "New issue"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-col gap-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="issue-title">Title</Label>
            <Input
              id="issue-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Auton drifts left off the line"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-body">Description</Label>
            <Textarea
              id="issue-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Repro steps, expected vs. actual…"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-labels">Labels</Label>
            <Input
              id="issue-labels"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              placeholder="comma-separated, e.g. software, auton"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
