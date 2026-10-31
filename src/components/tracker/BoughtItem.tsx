import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Pencil1Icon, TrashIcon } from "@radix-ui/react-icons";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
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
import { cn } from "@/lib/utils";

type Status = Doc<"cotsItems">["status"];

/** In the order the thing actually happens. */
const STATUSES: { value: Status; label: string }[] = [
  { value: "needed", label: "Needed" },
  { value: "ordered", label: "Ordered" },
  { value: "arrived", label: "Arrived" },
];

function statusChipClass(status: Status): string {
  if (status === "arrived") return "bg-success/10 text-success";
  if (status === "ordered") return "bg-info/10 text-info";
  return "bg-muted text-muted-foreground";
}

/** Dates go in and out of the input as yyyy-mm-dd in local time. */
function toDateInput(at?: number): string {
  if (!at) return "";
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): number | null {
  if (!value) return null;
  const at = new Date(`${value}T12:00:00`).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * Where a bought item is up to: needed, ordered, arrived. Three buttons
 * rather than a menu, because the whole point is that someone standing at the
 * bench can say "that turned up" in one press.
 */
export function BoughtItemStatus({ item }: { item: Doc<"cotsItems"> }) {
  const setStatus = useMutation(api.cots.setStatus);
  const [error, setError] = useState<string | null>(null);

  function move(status: Status) {
    setError(null);
    // Dropping back to needed means it isn't on its way any more, so the
    // arrival date goes with it rather than lingering as a date for nothing.
    void setStatus({
      id: item._id,
      status,
      ...(status === "needed" ? { eta: null } : {}),
    }).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "That didn't work."),
    );
  }

  return (
    <div className="space-y-1">
      <div
        className="inline-flex overflow-hidden rounded-md border"
        role="group"
        aria-label={`Where ${item.name} is up to`}
      >
        {STATUSES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={item.status === value}
            onClick={() => move(value)}
            className={cn(
              "min-h-9 px-2.5 text-xs font-medium transition-colors",
              item.status === value
                ? statusChipClass(value)
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {item.status === "ordered" && <EtaField item={item} />}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** When it's expected. Only worth asking once something is actually ordered. */
function EtaField({ item }: { item: Doc<"cotsItems"> }) {
  const setStatus = useMutation(api.cots.setStatus);
  return (
    <Input
      type="date"
      defaultValue={toDateInput(item.eta)}
      aria-label={`When ${item.name} is due`}
      className="h-8 w-36 text-xs"
      onChange={(e) =>
        void setStatus({
          id: item._id,
          status: "ordered",
          eta: fromDateInput(e.target.value),
        })
      }
    />
  );
}

/** Edit and, for a lead, delete. */
export function BoughtItemActions({
  item,
  canRemove,
}: {
  item: Doc<"cotsItems">;
  canRemove: boolean;
}) {
  const remove = useMutation(api.cots.remove);
  const [editing, setEditing] = useState(false);

  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={`Edit ${item.name}`}
        onClick={() => setEditing(true)}
      >
        <Pencil1Icon className="h-4 w-4" />
      </Button>
      {canRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Remove ${item.name}`}
          onClick={() => void remove({ id: item._id })}
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      )}
      <BoughtItemDialog
        open={editing}
        onOpenChange={setEditing}
        subsystemId={item.subsystemId}
        item={item}
      />
    </span>
  );
}

/**
 * Add a bought item, or edit one. Everything except the name is optional —
 * "we need twelve compliant wheels" is a useful thing to write down before
 * anybody has chosen a vendor.
 */
export function BoughtItemDialog({
  open,
  onOpenChange,
  subsystemId,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subsystemId: Id<"subsystems">;
  /** Editing an existing one, rather than adding. */
  item?: Doc<"cotsItems">;
}) {
  const create = useMutation(api.cots.create);
  const update = useMutation(api.cots.update);

  const [name, setName] = useState("");
  const [qtyNeeded, setQtyNeeded] = useState("1");
  const [unit, setUnit] = useState("");
  const [vendor, setVendor] = useState("");
  const [vendorPartNumber, setVendorPartNumber] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setQtyNeeded(String(item?.qtyNeeded ?? 1));
    setUnit(item?.unit ?? "");
    setVendor(item?.vendor ?? "");
    setVendorPartNumber(item?.vendorPartNumber ?? "");
    setCost(item?.cost === undefined ? "" : String(item.cost));
    setError(null);
  }, [open, item]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const fields = {
      name: name.trim(),
      qtyNeeded: Math.max(1, Math.round(Number(qtyNeeded) || 1)),
      unit: unit.trim() || null,
      vendor: vendor.trim() || null,
      vendorPartNumber: vendorPartNumber.trim() || null,
      cost: cost.trim() === "" ? null : Number(cost),
    };
    try {
      if (item) {
        await update({ id: item._id, ...fields });
      } else {
        await create({
          subsystemId,
          name: fields.name,
          qtyNeeded: fields.qtyNeeded,
          unit: fields.unit ?? undefined,
          vendor: fields.vendor ?? undefined,
          vendorPartNumber: fields.vendorPartNumber ?? undefined,
          cost: fields.cost ?? undefined,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>
              {item ? "Edit bought item" : "Add a bought item"}
            </DialogTitle>
            <DialogDescription>
              Things the team buys rather than makes. They get no part number,
              and count as ready once they arrive.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="cots-name">What is it</Label>
              <Input
                id="cots-name"
                value={name}
                autoFocus
                placeholder='e.g. Compliant wheel, 2"'
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="w-24 space-y-1.5">
                <Label htmlFor="cots-qty">How many</Label>
                <Input
                  id="cots-qty"
                  type="number"
                  min={1}
                  value={qtyNeeded}
                  onChange={(e) => setQtyNeeded(e.target.value)}
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor="cots-unit">Unit</Label>
                <Input
                  id="cots-unit"
                  value={unit}
                  placeholder="ft, pack"
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor="cots-cost">Cost each</Label>
                <Input
                  id="cots-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="grow space-y-1.5">
                <Label htmlFor="cots-vendor">Vendor</Label>
                <Input
                  id="cots-vendor"
                  value={vendor}
                  placeholder="AndyMark, REV…"
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>
              <div className="grow space-y-1.5">
                <Label htmlFor="cots-vendor-pn">Their part number</Label>
                <Input
                  id="cots-vendor-pn"
                  value={vendorPartNumber}
                  onChange={(e) => setVendorPartNumber(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {item ? "Save" : "Add it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
