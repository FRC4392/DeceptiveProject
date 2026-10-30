import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
import { useProcessTypes, useSubsystems } from "@/lib/tracker";

/**
 * "Get a part number" — the student's way in. The app issues the number; the
 * student pastes it into Onshape's Part number field, which costs the team
 * nothing and works whether or not Onshape is connected.
 */
export function GetNumberDialog({
  open,
  onOpenChange,
  defaultSubsystemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSubsystemId?: Id<"subsystems">;
}) {
  const subsystems = useSubsystems();
  const processes = useProcessTypes();
  const createPart = useMutation(api.parts.createWithNumber);
  const navigate = useNavigate();

  const [subsystemId, setSubsystemId] = useState<string>(
    defaultSubsystemId ?? "",
  );
  const [name, setName] = useState("");
  const [processTypeId, setProcessTypeId] = useState("");
  const [qtyNeeded, setQtyNeeded] = useState("1");
  const [qtySpares, setQtySpares] = useState("0");
  const [material, setMaterial] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [issuedId, setIssuedId] = useState<Id<"parts"> | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setMaterial("");
    setQtyNeeded("1");
    setQtySpares("0");
    setIssued(null);
    setIssuedId(null);
    setCopied(false);
    setError(null);
  }

  async function submit() {
    if (!subsystemId || !processTypeId || name.trim().length === 0) {
      setError("A subsystem, a name and how it gets made.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createPart({
        subsystemId: subsystemId as Id<"subsystems">,
        name,
        processTypeId: processTypeId as Id<"processTypes">,
        qtyNeeded: Number(qtyNeeded) || 1,
        qtySpares: Number(qtySpares) || 0,
        material: material.trim() || undefined,
      });
      setIssued(result.partNumber);
      setIssuedId(result.partId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {issued === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Get a part number</DialogTitle>
              <DialogDescription>
                The tracker hands out the number. Paste it into the part's Part
                number field in Onshape.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="gn-subsystem">Subsystem</Label>
                <Select value={subsystemId} onValueChange={setSubsystemId}>
                  <SelectTrigger id="gn-subsystem">
                    <SelectValue placeholder="Which subsystem?" />
                  </SelectTrigger>
                  <SelectContent>
                    {(subsystems ?? []).map((s) => (
                      <SelectItem key={s._id} value={s._id}>
                        {s.code} · {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="gn-name">What is it?</Label>
                <Input
                  id="gn-name"
                  value={name}
                  placeholder="Intake side plate"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="gn-process">How does it get made?</Label>
                <Select value={processTypeId} onValueChange={setProcessTypeId}>
                  <SelectTrigger id="gn-process">
                    <SelectValue placeholder="Pick a machine or process" />
                  </SelectTrigger>
                  <SelectContent>
                    {(processes ?? []).map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="gn-qty">How many on the robot?</Label>
                  <Input
                    id="gn-qty"
                    type="number"
                    min={1}
                    value={qtyNeeded}
                    onChange={(e) => setQtyNeeded(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="gn-spares">Spares</Label>
                  <Input
                    id="gn-spares"
                    type="number"
                    min={0}
                    value={qtySpares}
                    onChange={(e) => setQtySpares(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="gn-material">Material (optional)</Label>
                <Input
                  id="gn-material"
                  value={material}
                  placeholder='¼" 6061 aluminum'
                  onChange={(e) => setMaterial(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                type="button"
              >
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={saving}>
                {saving ? "Getting one…" : "Get the number"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Here's your number</DialogTitle>
              <DialogDescription>
                Paste it into the part's <strong>Part number</strong> property
                in Onshape, then release the Part Studio when the design is
                done.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-4">
              <p className="font-mono text-3xl font-semibold tracking-tight sm:text-4xl">
                {issued}
              </p>
              <Button
                variant="outline"
                onClick={() => void copy()}
                className="gap-2"
              >
                {copied ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  <CopyIcon className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={reset} type="button">
                Get another
              </Button>
              <Button
                onClick={() => {
                  if (issuedId) void navigate(`/parts/${issuedId}`);
                  onOpenChange(false);
                  reset();
                }}
              >
                Open the part
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
