import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
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
import { Textarea } from "@/components/ui/textarea";
import { PROBLEM_REASONS } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";

type Reason = Doc<"problems">["reason"];

/**
 * "Something went wrong" — open to everyone, on purpose. Saying a part broke
 * shouldn't need a lead, and the count of what's actually been made is only
 * honest if anyone can correct it.
 */
export function ProblemDialog({
  part,
  open,
  onOpenChange,
}: {
  part: Doc<"parts">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const report = useMutation(api.parts.reportProblem);
  const [reason, setReason] = useState<Reason>("broke");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [remake, setRemake] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await report({
        partId: part._id,
        reason,
        qtyAffected: Number(qty) || 0,
        note: note.trim() || undefined,
        remake,
      });
      onOpenChange(false);
      setNote("");
      setQty("1");
      setReason("broke");
      setRemake(true);
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
          <DialogTitle>Something went wrong</DialogTitle>
          <DialogDescription>
            Say what happened. A lead will see it, and the count goes back so
            the part gets made again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>What happened?</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROBLEM_REASONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReason(option.value as Reason)}
                  className={cn(
                    "min-h-11 rounded-md border px-3 text-left text-sm transition-colors",
                    reason === option.value
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "hover:bg-accent",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pd-qty">How many?</Label>
            <Input
              id="pd-qty"
              type="number"
              min={0}
              max={part.qtyNeeded + part.qtySpares}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              checked={remake}
              onCheckedChange={(v) => setRemake(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Take them off the made count so they get made again
              <span className="block text-xs text-muted-foreground">
                Leave this off if they're fine and you're just flagging it.
              </span>
            </span>
          </label>

          <div className="grid gap-2">
            <Label htmlFor="pd-note">Anything else? (optional)</Label>
            <Textarea
              id="pd-note"
              value={note}
              rows={3}
              placeholder="Cracked on the press fit"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

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
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Tell a lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
