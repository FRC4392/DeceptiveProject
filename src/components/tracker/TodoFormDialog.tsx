import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/errors";

type Priority = Doc<"todos">["priority"];

/** Add a to-do, or edit one. Anyone can; it's a shared list. */
export function TodoFormDialog({
  open,
  onOpenChange,
  todo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing one, rather than adding. */
  todo?: Doc<"todos">;
}) {
  const tags = useQuery(api.todos.listTags, {});
  const create = useMutation(api.todos.create);
  const update = useMutation(api.todos.update);

  const [title, setTitle] = useState(todo?.title ?? "");
  const [description, setDescription] = useState(todo?.description ?? "");
  const [priority, setPriority] = useState<Priority>(
    todo?.priority ?? "medium",
  );
  const [tagIds, setTagIds] = useState<Id<"todoTags">[]>(todo?.tagIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(todo?.title ?? "");
    setDescription(todo?.description ?? "");
    setPriority(todo?.priority ?? "medium");
    setTagIds(todo?.tagIds ?? []);
    setError(null);
  }, [open, todo]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (todo) {
        await update({
          id: todo._id,
          title,
          description: description.trim() || null,
          priority,
          tagIds,
        });
      } else {
        await create({
          title,
          description: description.trim() || undefined,
          priority,
          tagIds,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err, "That didn't work."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{todo ? "Edit this to-do" : "Add a to-do"}</DialogTitle>
          <DialogDescription>
            Anything that isn't a part — pit setup, driver practice, a form
            somebody has to fill in.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="td-title">What needs doing?</Label>
            <Input
              id="td-title"
              value={title}
              placeholder="Cut new bumper fabric"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="td-desc">Any detail? (optional)</Label>
            <Textarea
              id="td-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="td-priority">Priority</Label>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as Priority)}
            >
              <SelectTrigger id="td-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tags !== undefined && tags.length > 0 && (
            <div className="grid gap-2">
              <Label>Tags</Label>
              <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {tags.map((tag) => (
                  <label
                    key={tag._id}
                    className="flex min-h-9 items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={tagIds.includes(tag._id)}
                      onCheckedChange={() =>
                        setTagIds((current) =>
                          current.includes(tag._id)
                            ? current.filter((t) => t !== tag._id)
                            : [...current, tag._id],
                        )
                      }
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || title.trim().length === 0}
          >
            {saving ? "Saving…" : todo ? "Save" : "Add it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
