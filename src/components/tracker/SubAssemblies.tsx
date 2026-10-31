import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Cross2Icon,
  ExternalLinkIcon,
  MinusIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { onshapeElementUrl } from "../../../convex/lib/onshapeLinks";
import { wouldCycle } from "../../../convex/lib/assembly";
import { cn } from "@/lib/utils";

export type AssemblyRow = {
  assembly: Doc<"subAssemblies">;
  partIds: Id<"parts">[];
  cotsItemIds: Id<"cotsItems">[];
  childIds: Id<"subAssemblies">[];
  /** How many of each member, for anything used more than once. */
  quantities: { refId: string; quantity: number }[];
};

/**
 * Setting up what a subsystem goes together from.
 *
 * One sub-assembly is edited at a time — listing every part against every
 * sub-assembly at once was unreadable the moment nesting arrived.
 */
export function SubAssemblyEditor({
  subsystemId,
  rows,
  parts,
  cots,
  onDone,
}: {
  subsystemId: Id<"subsystems">;
  rows: AssemblyRow[];
  parts: Doc<"parts">[];
  cots: Doc<"cotsItems">[];
  onDone: () => void;
}) {
  const create = useMutation(api.subAssemblies.create);
  const rename = useMutation(api.subAssemblies.rename);
  const remove = useMutation(api.subAssemblies.remove);
  const setMembers = useMutation(api.subAssemblies.setMembers);
  const setUnits = useMutation(api.subAssemblies.setUnits);
  const setQtyBuilt = useMutation(api.subAssemblies.setQtyBuilt);
  const setDrawing = useMutation(api.subAssemblies.setDrawing);
  const unassigned = useQuery(api.subAssemblies.unassigned, { subsystemId });

  const [selectedId, setSelectedId] = useState<Id<"subAssemblies"> | null>(
    rows[0]?.assembly._id ?? null,
  );
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const allowance = useQuery(
    api.subAssemblies.demand,
    selectedId ? { subsystemId, forAssemblyId: selectedId } : "skip",
  );

  const selected = rows.find((r) => r.assembly._id === selectedId) ?? rows[0];

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "That didn't work."),
    );
  }

  // Who else uses each thing. Shown, not enforced: two roller assemblies
  // sharing an end cap is how robots are built, and the tracker's job is to
  // add that up rather than make someone pick one.
  const usersOf = new Map<string, AssemblyRow[]>();
  for (const row of rows) {
    for (const id of [...row.partIds, ...row.cotsItemIds, ...row.childIds]) {
      usersOf.set(id, [...(usersOf.get(id) ?? []), row]);
    }
  }
  const edges = new Map<string, string[]>(
    rows.map((r) => [r.assembly._id as string, r.childIds as string[]]),
  );

  function alsoIn(memberId: string): string | undefined {
    const others = (usersOf.get(memberId) ?? []).filter(
      (row) => row.assembly._id !== selected?.assembly._id,
    );
    if (others.length === 0) return undefined;
    return others.length === 1
      ? `also in ${others[0].assembly.name}`
      : `also in ${others.length} others`;
  }

  /** How many of a member this assembly uses. */
  /**
   * Take everything going, as much of each as the plan allows. Selecting all
   * and then setting twenty quantities by hand was the actual job, so this
   * does the part people were going to do anyway.
   */
  function takeAll() {
    const refs = [
      ...availableParts.map((p) => p._id as string),
      ...availableCots.map((c) => c._id as string),
    ];
    const quantities = refs.flatMap((refId) => {
      const most = maxOf(refId);
      return Number.isFinite(most) && most > 1
        ? [{ refId, quantity: most }]
        : [];
    });
    save({
      partIds: availableParts.map((p) => p._id),
      cotsItemIds: availableCots.map((c) => c._id),
      quantities,
    });
  }

  function clearAll() {
    save({ partIds: [], cotsItemIds: [], quantities: [] });
  }

  /** The most of one member a single unit of this assembly may take. */
  function maxOf(memberId: string): number {
    return (
      allowance?.allowance.find((a) => a.refId === memberId)?.max ?? Infinity
    );
  }

  function qtyOf(memberId: string): number {
    return (
      selected?.quantities.find((q) => q.refId === memberId)?.quantity ?? 1
    );
  }

  function save(
    next: Partial<Omit<AssemblyRow, "assembly">> & {
      quantities?: { refId: string; quantity: number }[];
    },
  ) {
    if (!selected) return;
    run(
      setMembers({
        id: selected.assembly._id,
        partIds: next.partIds ?? selected.partIds,
        cotsItemIds: next.cotsItemIds ?? selected.cotsItemIds,
        childIds: next.childIds ?? selected.childIds,
        quantities: next.quantities ?? selected.quantities,
      }),
    );
  }

  function setQty(memberId: string, quantity: number) {
    const rest = (selected?.quantities ?? []).filter(
      (q) => q.refId !== memberId,
    );
    save({
      quantities:
        quantity > 1 ? [...rest, { refId: memberId, quantity }] : rest,
    });
  }

  function toggle<T extends string>(list: T[], id: T): T[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  const availableParts = parts;
  const availableCots = cots;
  const totalPickable = availableParts.length + availableCots.length;
  const chosen =
    (selected?.partIds.length ?? 0) + (selected?.cotsItemIds.length ?? 0);
  const allChosen = totalPickable > 0 && chosen === totalPickable;

  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Which one you're editing */}
      <div className="space-y-1">
        {rows.map((row) => (
          <button
            key={row.assembly._id}
            type="button"
            onClick={() => setSelectedId(row.assembly._id)}
            className={cn(
              "flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-sm",
              row.assembly._id === selected?.assembly._id
                ? "border-primary bg-primary/10"
                : "hover:bg-accent",
            )}
          >
            <span className="font-mono text-xs text-muted-foreground">
              {row.assembly.partNumber}
            </span>
            <span className="truncate">{row.assembly.name}</span>
            {row.assembly.isDefault && (
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                whole thing
              </span>
            )}
          </button>
        ))}

        <div className="flex gap-2 pt-2">
          <Input
            value={name}
            placeholder="Frame assembly"
            aria-label="New sub-assembly"
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            disabled={name.trim().length === 0}
            onClick={() =>
              run(
                create({ subsystemId, name }).then((made) => {
                  setName("");
                  setSelectedId(made.id);
                }),
              )
            }
          >
            Add
          </Button>
        </div>
      </div>

      {/* What's in it */}
      {selected && (
        <div className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {selected.assembly.partNumber}
            </span>
            <Input
              defaultValue={selected.assembly.name}
              key={selected.assembly._id}
              aria-label="Sub-assembly name"
              className="max-w-xs"
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next.length > 0 && next !== selected.assembly.name) {
                  run(rename({ id: selected.assembly._id, name: next }));
                }
              }}
            />
            {!selected.assembly.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${selected.assembly.name}`}
                onClick={() =>
                  run(
                    remove({ id: selected.assembly._id }).then(() =>
                      setSelectedId(rows[0]?.assembly._id ?? null),
                    ),
                  )
                }
              >
                <Cross2Icon className="h-4 w-4" />
              </Button>
            )}
          </div>

          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">
              Assembly drawing
            </span>
            <Input
              defaultValue={selected.assembly.drawingUrl ?? ""}
              key={`${selected.assembly._id}-drawing`}
              className="w-full sm:w-96"
              placeholder="https://… a link whoever builds it can open"
              aria-label="Assembly drawing link"
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== (selected.assembly.drawingUrl ?? "")) {
                  run(
                    setDrawing({
                      id: selected.assembly._id,
                      url: next.length > 0 ? next : null,
                    }),
                  );
                }
              }}
            />
          </label>

          <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
            <label className="space-y-1">
              <span className="block text-muted-foreground">On the robot</span>
              <Input
                type="number"
                min={1}
                key={`needed-${selected.assembly._id}`}
                defaultValue={selected.assembly.qtyNeeded ?? 1}
                aria-label="How many go on the robot"
                className="h-9 w-20"
                onBlur={(e) => {
                  const next = Math.max(1, Math.round(Number(e.target.value)));
                  if (
                    Number.isFinite(next) &&
                    next !== (selected.assembly.qtyNeeded ?? 1)
                  ) {
                    run(
                      setUnits({
                        id: selected.assembly._id,
                        qtyNeeded: next,
                      }),
                    );
                  }
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="block text-muted-foreground">Spares</span>
              <Input
                type="number"
                min={0}
                key={`spares-${selected.assembly._id}`}
                defaultValue={selected.assembly.qtySpares ?? 0}
                aria-label="Spare units to build"
                className="h-9 w-20"
                onBlur={(e) => {
                  const next = Math.max(0, Math.round(Number(e.target.value)));
                  if (
                    Number.isFinite(next) &&
                    next !== (selected.assembly.qtySpares ?? 0)
                  ) {
                    run(
                      setUnits({
                        id: selected.assembly._id,
                        qtySpares: next,
                      }),
                    );
                  }
                }}
              />
            </label>
            <BuiltCounter
              assembly={selected.assembly}
              onChange={(qtyBuilt) =>
                run(setQtyBuilt({ id: selected.assembly._id, qtyBuilt }))
              }
            />
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            {onshapeElementUrl(selected.assembly) ? (
              <a
                href={onshapeElementUrl(selected.assembly)!}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
              >
                Assembly CAD
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            ) : (
              "No CAD linked yet — a sync from Onshape fills this in."
            )}
          </p>

          <label className="mt-4 flex min-h-9 items-center gap-2 border-b pb-2 text-sm">
            <Checkbox
              checked={allChosen}
              disabled={totalPickable === 0}
              aria-label="Select every part"
              onCheckedChange={() => (allChosen ? clearAll() : takeAll())}
            />
            <span className="font-medium">Select all</span>
            <span className="text-xs text-muted-foreground">
              {chosen} of {totalPickable}
            </span>
          </label>

          <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {parts.map((part) => {
              const elsewhere = alsoIn(part._id);
              const chosen = selected.partIds.includes(part._id);
              return (
                <label
                  key={part._id}
                  className="flex min-h-9 items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={chosen}
                    onCheckedChange={() =>
                      save({ partIds: toggle(selected.partIds, part._id) })
                    }
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {part.partNumber}
                  </span>
                  <span className="truncate">{part.name}</span>
                  {chosen && (
                    <QtyBox
                      value={qtyOf(part._id)}
                      max={maxOf(part._id)}
                      onChange={(n) => setQty(part._id, n)}
                      label={`How many ${part.partNumber}`}
                    />
                  )}
                  {elsewhere && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {elsewhere}
                    </span>
                  )}
                </label>
              );
            })}
            {cots.map((item) => {
              const elsewhere = alsoIn(item._id);
              return (
                <label
                  key={item._id}
                  className="flex min-h-9 items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={selected.cotsItemIds.includes(item._id)}
                    onCheckedChange={() =>
                      save({
                        cotsItemIds: toggle(selected.cotsItemIds, item._id),
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">bought</span>
                  <span className="truncate">{item.name}</span>
                  {selected.cotsItemIds.includes(item._id) && (
                    <QtyBox
                      value={qtyOf(item._id)}
                      max={maxOf(item._id)}
                      onChange={(n) => setQty(item._id, n)}
                      label={`How many ${item.name}`}
                    />
                  )}
                  {elsewhere && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {elsewhere}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Other sub-assemblies that can go inside this one */}
          <p className="mt-4 border-b pb-2 text-sm font-medium">
            Sub-assemblies inside it
          </p>
          <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {rows
              .filter((row) => row.assembly._id !== selected.assembly._id)
              .map((row) => {
                const elsewhere = alsoIn(row.assembly._id);
                const loops = wouldCycle(
                  selected.assembly._id,
                  row.assembly._id,
                  edges,
                );
                const chosen = selected.childIds.includes(row.assembly._id);
                return (
                  <label
                    key={row.assembly._id}
                    className={cn(
                      "flex min-h-9 items-center gap-2 text-sm",
                      loops && "text-muted-foreground",
                    )}
                  >
                    <Checkbox
                      checked={chosen}
                      disabled={loops}
                      onCheckedChange={() =>
                        save({
                          childIds: toggle(selected.childIds, row.assembly._id),
                        })
                      }
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.assembly.partNumber}
                    </span>
                    <span className="truncate">{row.assembly.name}</span>
                    {chosen && (
                      <QtyBox
                        value={qtyOf(row.assembly._id)}
                        onChange={(n) => setQty(row.assembly._id, n)}
                        label={`How many ${row.assembly.name}`}
                      />
                    )}
                    {loops ? (
                      <span className="shrink-0 text-xs">holds this one</span>
                    ) : (
                      elsewhere && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {elsewhere}
                        </span>
                      )
                    )}
                  </label>
                );
              })}
            {rows.length === 1 && (
              <p className="text-sm text-muted-foreground">
                Add another sub-assembly to put one inside this.
              </p>
            )}
          </div>

          {unassigned && unassigned.partIds.length > 0 && (
            <p className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              {unassigned.partIds.length} part
              {unassigned.partIds.length === 1 ? " isn't" : "s aren't"} in any
              sub-assembly yet, so nothing is waiting on
              {unassigned.partIds.length === 1 ? " it" : " them"}.
            </p>
          )}

          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}

      <div className="lg:col-span-2">
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * How many of one member an assembly uses. Hidden until it's picked, because
 * the answer is one almost every time and a column of 1s is noise.
 */
function QtyBox({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  /** The most the plan leaves for this assembly. */
  max?: number;
  onChange: (value: number) => void;
  label: string;
}) {
  // Held as text while it's being typed. A controlled number that refuses
  // anything below 1 can't be cleared, so "2" lands after the old digit and
  // you get 12 — which is exactly the sort of thing nobody reports.
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  // Never offer more than the plan leaves, and never less than what's set —
  // an already-saved quantity shouldn't become unenterable.
  const ceiling = Math.max(value, max ?? Infinity);

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      <span className="text-xs text-muted-foreground">×</span>
      <Input
        type="number"
        min={1}
        max={Number.isFinite(ceiling) ? ceiling : undefined}
        value={editing ? draft : String(value)}
        aria-label={label}
        className="h-7 w-14 px-2 py-0 text-xs"
        onClick={(e) => e.preventDefault()}
        onFocus={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(next) && next >= 1) {
            onChange(Math.min(ceiling, Math.round(next)));
          }
        }}
      />
      {Number.isFinite(ceiling) && (
        <span className="text-[11px] text-muted-foreground">/{ceiling}</span>
      )}
    </span>
  );
}

/**
 * How many are built so far, the way a part counts what's been made. Reads
 * "2/3" rather than done-or-not, because a sub-assembly needed twice with
 * one built is neither.
 */
function BuiltCounter({
  assembly,
  onChange,
}: {
  assembly: Doc<"subAssemblies">;
  onChange: (qtyBuilt: number) => void;
}) {
  const target = (assembly.qtyNeeded ?? 1) + (assembly.qtySpares ?? 0);
  const built = assembly.qtyBuilt ?? 0;
  return (
    <div className="space-y-1">
      <span className="block text-muted-foreground">Built</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          disabled={built <= 0}
          onClick={() => onChange(built - 1)}
          aria-label="One fewer built"
        >
          <MinusIcon className="h-4 w-4" />
        </Button>
        <span className="min-w-12 text-center font-mono text-sm font-semibold">
          {built}/{target}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          disabled={built >= target}
          onClick={() => onChange(built + 1)}
          aria-label="One more built"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
