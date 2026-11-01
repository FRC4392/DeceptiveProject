import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  cotsAdvanceLabel,
  cotsChipClass,
  cotsStatusLabel,
  cotsTask,
  nextCotsStatus,
  previousCotsStatus,
  type CotsStatus,
} from "@/lib/cots";
import { errorText } from "@/lib/errors";

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
 * The dates on a bought item. Each one is already filled in by the time it's
 * shown — the move stamped it — so this is for correcting a date, not for
 * supplying one.
 */
function DateFields({ item }: { item: Doc<"cotsItems"> }) {
  const setStatus = useMutation(api.cots.setStatus);

  function set(field: "eta" | "orderedAt" | "arrivedAt", value: string) {
    void setStatus({
      id: item._id,
      status: item.status,
      [field]: fromDateInput(value),
    });
  }

  return (
    <div className="flex flex-wrap gap-4">
      {item.orderedAt !== undefined && (
        <DateField
          label="Ordered on"
          value={item.orderedAt}
          name={`When ${item.name} was ordered`}
          onChange={(next) => set("orderedAt", next)}
        />
      )}
      {item.status === "ordered" && (
        <DateField
          label="Expected"
          value={item.eta}
          name={`When ${item.name} is expected`}
          onChange={(next) => set("eta", next)}
        />
      )}
      {item.arrivedAt !== undefined && (
        <DateField
          label="Arrived on"
          value={item.arrivedAt}
          name={`When ${item.name} arrived`}
          onChange={(next) => set("arrivedAt", next)}
        />
      )}
    </div>
  );
}

function DateField({
  label,
  value,
  name,
  onChange,
}: {
  label: string;
  value?: number;
  name: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <Input
        type="date"
        // Controlled, not defaultValue: the move writes the date, and an
        // uncontrolled input would keep showing the blank it mounted with.
        value={toDateInput(value)}
        aria-label={name}
        className="h-9 w-40"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * One bought item, opened from the ordering board. The same shape as a part's
 * page: what it is, where it's up to, and one big button that moves it on.
 *
 * It replaced three buttons sitting on the card. Those were quicker, but they
 * were a control that appeared nowhere else in the app, and quicker isn't
 * worth a second thing to learn.
 */
export function BoughtItemDetail({
  item,
  subsystemName,
  open,
  onOpenChange,
  canEdit,
}: {
  item: Doc<"cotsItems">;
  subsystemName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Leads can move one back and delete it. */
  canEdit: boolean;
}) {
  const setStatus = useMutation(api.cots.setStatus);
  const remove = useMutation(api.cots.remove);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = nextCotsStatus(item.status);
  const back = previousCotsStatus(item.status);
  const advance = cotsAdvanceLabel(item.status);

  function move(status: CotsStatus) {
    setError(null);
    // The dates follow from the move, so the server stamps and clears them.
    void setStatus({ id: item._id, status }).catch((err: unknown) =>
      setError(errorText(err, "That didn't work.")),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>{cotsTask(item.status)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                cotsChipClass(item.status),
              )}
            >
              {cotsStatusLabel(item)}
            </span>
            {subsystemName && (
              <span className="text-xs text-muted-foreground">
                {subsystemName}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Detail label="How many">
              {item.qtyNeeded}
              {item.unit ? ` ${item.unit}` : ""}
            </Detail>
            <Detail label="Vendor">{item.vendor ?? "—"}</Detail>
            <Detail label="Their part number">
              {item.vendorPartNumber ? (
                <span className="font-mono text-xs">
                  {item.vendorPartNumber}
                </span>
              ) : (
                "—"
              )}
            </Detail>
            <Detail label="Cost">
              {item.cost === undefined
                ? "—"
                : `${item.cost.toFixed(2)} each · ${(
                    item.cost * item.qtyNeeded
                  ).toFixed(2)} total`}
            </Detail>
          </dl>

          <DateFields item={item} />
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-start">
          {advance && next && (
            <Button size="lg" onClick={() => move(next)}>
              {advance}
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {canEdit && back && (
            <Button variant="ghost" onClick={() => move(back)}>
              Move it back
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                void remove({ id: item._id });
                onOpenChange(false);
              }}
            >
              Delete
            </Button>
          )}
        </DialogFooter>

        <BoughtItemDialog
          open={editing}
          onOpenChange={setEditing}
          subsystemId={item.subsystemId}
          item={item}
        />
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
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
  /** Fixed when adding from one subsystem; absent means ask. */
  subsystemId?: Id<"subsystems">;
  /** Editing an existing one, rather than adding. */
  item?: Doc<"cotsItems">;
}) {
  const create = useMutation(api.cots.create);
  const update = useMutation(api.cots.update);
  const subsystems = useQuery(api.subsystems.list, {});

  const [name, setName] = useState("");
  const [qtyNeeded, setQtyNeeded] = useState("1");
  const [unit, setUnit] = useState("");
  const [vendor, setVendor] = useState("");
  const [vendorPartNumber, setVendorPartNumber] = useState("");
  const [cost, setCost] = useState("");
  const [subsystem, setSubsystem] = useState<string>("");
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
    setSubsystem(item?.subsystemId ?? subsystemId ?? "");
    setError(null);
  }, [open, item, subsystemId]);

  const target = (subsystemId ?? subsystem) as Id<"subsystems"> | "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || (!item && !target)) return;
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
          subsystemId: target as Id<"subsystems">,
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
      setError(errorText(err, "That didn't save."));
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
            {!subsystemId && !item && (
              <div className="space-y-1.5">
                <Label>Subsystem</Label>
                <Select value={subsystem} onValueChange={setSubsystem}>
                  <SelectTrigger aria-label="Subsystem">
                    <SelectValue placeholder="Which subsystem is it for?" />
                  </SelectTrigger>
                  <SelectContent>
                    {(subsystems ?? []).map((sub) => (
                      <SelectItem key={sub._id} value={sub._id}>
                        {sub.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
            <Button
              type="submit"
              disabled={saving || !name.trim() || (!item && !target)}
            >
              {item ? "Save" : "Add it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
