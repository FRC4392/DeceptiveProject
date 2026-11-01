import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProcessTypes, useSubsystems } from "@/lib/tracker";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";

type Line = Doc<"releaseIntakeLines">;

/**
 * A number the tracker hasn't issued, and the one question worth asking about
 * it: does the team make this or buy it?
 *
 * The two answers go to different boards and need different things said about
 * them — a process and spares for something made, a vendor and a count for
 * something bought — so the row swaps its fields rather than showing both and
 * letting the lead work out which half to ignore.
 */
export function UnknownLine({ line }: { line: Line }) {
  const subsystems = useSubsystems();
  const processes = useProcessTypes();
  const applyLine = useMutation(api.intake.applyLine);
  const createCotsItem = useMutation(api.intake.createCotsItemFromLine);

  // A row that named a vendor, or came out of Onshape's standard content
  // library, is almost certainly something bought — so that is the answer
  // already filled in. Overridable either way: a vendor column sometimes
  // names who supplies the stock a part is cut from.
  const [mode, setMode] = useState<"make" | "buy">(
    line.vendor || line.standardContent ? "buy" : "make",
  );
  const [subsystemId, setSubsystemId] = useState<string>(
    (line.subsystemId as string | undefined) ?? "",
  );
  const [processTypeId, setProcessTypeId] = useState("");
  const [qtyNeeded, setQtyNeeded] = useState(String(line.quantity ?? 1));
  const [qtySpares, setQtySpares] = useState("0");
  const [vendor, setVendor] = useState(line.vendor ?? "");
  const [vendorPartNumber, setVendorPartNumber] = useState(
    line.partNumber ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  // Bought processes are left out on purpose. Picking one here used to make a
  // part at "Ready to assemble" — in the bin, as far as the tracker was
  // concerned, before anybody had ordered it. That is what Buy it is for now.
  const makeable = (processes ?? []).filter((p) => !p.isBought);

  const subsystemSelect = (
    <Select value={subsystemId} onValueChange={setSubsystemId}>
      <SelectTrigger aria-label="Subsystem">
        <SelectValue placeholder="Subsystem" />
      </SelectTrigger>
      <SelectContent>
        {(subsystems ?? []).map((s) => (
          <SelectItem key={s._id} value={s._id}>
            {s.code} · {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{line.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {line.partNumber ?? "no number"}
        </span>
      </div>

      <div
        className="mt-2 flex gap-1"
        role="group"
        aria-label="Make it or buy it"
      >
        {(["make", "buy"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              mode === value
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground",
            )}
          >
            {value === "make" ? "We make it" : "We buy it"}
          </button>
        ))}
      </div>

      {mode === "make" ? (
        <div className="mt-3 grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {subsystemSelect}
          <Select value={processTypeId} onValueChange={setProcessTypeId}>
            <SelectTrigger aria-label="Made on">
              <SelectValue placeholder="Made on" />
            </SelectTrigger>
            <SelectContent>
              {makeable.map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <label className="grow text-xs text-muted-foreground">
              On robot
              <Input
                type="number"
                min={1}
                className="mt-1"
                value={qtyNeeded}
                onChange={(e) => setQtyNeeded(e.target.value)}
              />
            </label>
            <label className="grow text-xs text-muted-foreground">
              Spares
              <Input
                type="number"
                min={0}
                className="mt-1"
                value={qtySpares}
                onChange={(e) => setQtySpares(e.target.value)}
              />
            </label>
          </div>
          <Button
            onClick={() => {
              setError(null);
              applyLine({
                lineId: line._id,
                decision: "created",
                subsystemId: subsystemId as Id<"subsystems">,
                processTypeId: processTypeId as Id<"processTypes">,
                qtyNeeded: Number(qtyNeeded) || 1,
                qtySpares: Number(qtySpares) || 0,
              }).catch((err: unknown) => setError(errorText(err, "No luck.")));
            }}
          >
            Add to the board
          </Button>
        </div>
      ) : (
        <div className="mt-3 grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {subsystemSelect}
          <label className="text-xs text-muted-foreground">
            Vendor
            <Input
              className="mt-1"
              placeholder="AndyMark, REV…"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <label className="grow text-xs text-muted-foreground">
              Their part number
              <Input
                className="mt-1"
                value={vendorPartNumber}
                onChange={(e) => setVendorPartNumber(e.target.value)}
              />
            </label>
            <label className="w-20 shrink-0 text-xs text-muted-foreground">
              How many
              <Input
                type="number"
                min={1}
                className="mt-1"
                value={qtyNeeded}
                onChange={(e) => setQtyNeeded(e.target.value)}
              />
            </label>
          </div>
          <Button
            onClick={() => {
              setError(null);
              createCotsItem({
                lineId: line._id,
                subsystemId: subsystemId as Id<"subsystems">,
                qtyNeeded: Number(qtyNeeded) || 1,
                vendor: vendor.trim() || undefined,
                vendorPartNumber: vendorPartNumber.trim() || undefined,
              }).catch((err: unknown) => setError(errorText(err, "No luck.")));
            }}
          >
            Add to Ordering
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
