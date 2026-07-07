import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { METHODS, PART_STATUSES, type Method, type PartStatus } from "@/lib/parts";
import { useRoster } from "@/lib/users";
import { useActiveProject } from "@/lib/project";
import type { Id } from "../../../convex/_generated/dataModel";

const UNASSIGNED = "__unassigned__";
const NO_PROJECT = "__none__";

export function PartFormDialog({
  trigger,
  part,
}: {
  trigger: ReactNode;
  part?: Doc<"parts">;
}) {
  const roster = useRoster();
  const { projects, activeProjectId } = useActiveProject();
  const createPart = useMutation(api.parts.create);
  const updatePart = useMutation(api.parts.update);
  const isEdit = !!part;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(part?.name ?? "");
  const [method, setMethod] = useState<Method>(
    part?.manufacturingMethod ?? "mill",
  );
  const [status, setStatus] = useState<PartStatus>(part?.status ?? "needs_design");
  const [quantityNeeded, setQuantityNeeded] = useState(
    String(part?.quantityNeeded ?? 1),
  );
  const [material, setMaterial] = useState(part?.material ?? "");
  const [assigneeId, setAssigneeId] = useState(part?.assigneeId ?? UNASSIGNED);
  const [projectId, setProjectId] = useState<string>(
    part?.projectId ?? activeProjectId ?? NO_PROJECT,
  );
  const [partNumber, setPartNumber] = useState(part?.partNumber ?? "");
  const [cost, setCost] = useState(part?.cost != null ? String(part.cost) : "");
  const [isCOTS, setIsCOTS] = useState(part?.isCOTS ?? false);
  const [vendor, setVendor] = useState(part?.vendor ?? "");
  const [vendorPartNumber, setVendorPartNumber] = useState(
    part?.vendorPartNumber ?? "",
  );
  const [leadTime, setLeadTime] = useState(part?.leadTime ?? "");
  const [orderStatus, setOrderStatus] = useState(part?.orderStatus ?? "");
  const [saving, setSaving] = useState(false);

  const cots = isCOTS || method === "cots";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const qty = parseInt(quantityNeeded, 10);
    const costNum = cost.trim() === "" ? null : parseFloat(cost);
    const assignee = assigneeId === UNASSIGNED ? null : assigneeId;
    setSaving(true);
    try {
      if (isEdit && part) {
        await updatePart({
          id: part._id,
          name: name.trim(),
          manufacturingMethod: method,
          quantityNeeded: Number.isNaN(qty) ? 1 : qty,
          material: material.trim() || null,
          status,
          assigneeId: assignee,
          isCOTS: cots,
          partNumber: partNumber.trim() || null,
          projectId: projectId === NO_PROJECT ? null : (projectId as Id<"projects">),
          cost: costNum,
          vendor: cots ? vendor.trim() || null : null,
          vendorPartNumber: cots ? vendorPartNumber.trim() || null : null,
          leadTime: cots ? leadTime.trim() || null : null,
          orderStatus: cots ? orderStatus.trim() || null : null,
        });
      } else {
        await createPart({
          name: name.trim(),
          manufacturingMethod: method,
          quantityNeeded: Number.isNaN(qty) ? 1 : qty,
          material: material.trim() || undefined,
          status,
          assigneeId: assignee ?? undefined,
          isCOTS: cots,
          partNumber: partNumber.trim() || undefined,
          projectId:
            projectId === NO_PROJECT ? undefined : (projectId as Id<"projects">),
          cost: costNum ?? undefined,
          vendor: cots ? vendor.trim() || undefined : undefined,
          vendorPartNumber: cots
            ? vendorPartNumber.trim() || undefined
            : undefined,
          leadTime: cots ? leadTime.trim() || undefined : undefined,
          orderStatus: cots ? orderStatus.trim() || undefined : undefined,
        });
        setName("");
        setMaterial("");
        setPartNumber("");
        setCost("");
        setQuantityNeeded("1");
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
          <DialogTitle>{isEdit ? "Edit part" : "New part"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-col gap-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="part-name">Name</Label>
            <Input
              id="part-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Drivetrain gearbox plate"
              autoFocus
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="part-qty">Quantity needed</Label>
              <Input
                id="part-qty"
                type="number"
                min="1"
                value={quantityNeeded}
                onChange={(e) => setQuantityNeeded(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as PartStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PART_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {(roster ?? []).map((p) => (
                    <SelectItem key={p.authId} value={p.authId}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="part-material">Material</Label>
              <Input
                id="part-material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="e.g. 6061 Al"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="part-number">Part number</Label>
              <Input
                id="part-number"
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                placeholder="Optional (auto in Phase 3)"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="part-cots"
              checked={cots}
              onCheckedChange={(c) => setIsCOTS(c === true)}
              disabled={method === "cots"}
            />
            <Label htmlFor="part-cots" className="cursor-pointer">
              Commercial off-the-shelf (COTS)
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="part-cost">
                Cost {cots ? "(each)" : "(optional)"}
              </Label>
              <Input
                id="part-cost"
                type="number"
                step="0.01"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0.00"
              />
            </div>
            {cots && (
              <div className="space-y-1.5">
                <Label htmlFor="part-vendor">Vendor</Label>
                <Input
                  id="part-vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. McMaster"
                />
              </div>
            )}
          </div>

          {cots && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="part-vpn">Vendor part #</Label>
                <Input
                  id="part-vpn"
                  value={vendorPartNumber}
                  onChange={(e) => setVendorPartNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="part-lead">Lead time</Label>
                <Input
                  id="part-lead"
                  value={leadTime}
                  onChange={(e) => setLeadTime(e.target.value)}
                  placeholder="e.g. 3–5 days"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="part-order">Order status</Label>
                <Input
                  id="part-order"
                  value={orderStatus}
                  onChange={(e) => setOrderStatus(e.target.value)}
                  placeholder="e.g. Ordered, Received"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create part"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
