import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { MinusIcon, PlusIcon } from "@radix-ui/react-icons";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { wouldCycle } from "../../../convex/lib/assembly";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";

export type AssemblyRow = {
  assembly: Doc<"subAssemblies">;
  partIds: Id<"parts">[];
  cotsItemIds: Id<"cotsItems">[];
  childIds: Id<"subAssemblies">[];
  /** How many of each member, for anything used more than once. */
  quantities: { refId: string; quantity: number }[];
};

/**
 * What one sub-assembly is made of: the parts and bought items it needs, and
 * the sub-assemblies that go inside it.
 *
 * One at a time, on that assembly's own page — listing every part against
 * every sub-assembly at once was unreadable the moment nesting arrived.
 */
export function AssemblyMembers({
  selected,
  rows,
  parts,
  cots,
}: {
  selected: AssemblyRow;
  /** Every sibling, for the "inside it" picker. */
  rows: AssemblyRow[];
  parts: Doc<"parts">[];
  cots: Doc<"cotsItems">[];
}) {
  const setMembers = useMutation(api.subAssemblies.setMembers);
  const [error, setError] = useState<string | null>(null);
  // One query for both halves: the per-member ceiling, and what the tree
  // still doesn't account for.
  const demand = useQuery(api.subAssemblies.demand, {
    subsystemId: selected.assembly.subsystemId,
    forAssemblyId: selected.assembly._id,
  });

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) =>
      setError(errorText(err, "That didn't work.")),
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
      (row) => row.assembly._id !== selected.assembly._id,
    );
    if (others.length === 0) return undefined;
    return others.length === 1
      ? `also in ${others[0].assembly.name}`
      : `also in ${others.length} others`;
  }

  /** The most of one member a single unit of this assembly may take. */
  function maxOf(memberId: string): number {
    return demand?.allowance.find((a) => a.refId === memberId)?.max ?? Infinity;
  }

  function qtyOf(memberId: string): number {
    return selected.quantities.find((q) => q.refId === memberId)?.quantity ?? 1;
  }

  function save(
    next: Partial<Omit<AssemblyRow, "assembly">> & {
      quantities?: { refId: string; quantity: number }[];
    },
  ) {
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
    const rest = selected.quantities.filter((q) => q.refId !== memberId);
    save({
      quantities:
        quantity > 1 ? [...rest, { refId: memberId, quantity }] : rest,
    });
  }

  function toggle<T extends string>(list: T[], id: T): T[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  /**
   * Take everything there's still room for, as much of each as the plan
   * leaves. Selecting all and then setting twenty quantities by hand was the
   * actual job, so this does the part people were going to do anyway.
   *
   * Anything already spoken for down to the last one is left alone. Taking it
   * regardless is how a part ends up promised to two assemblies at once, and
   * nobody pressing one button means to do that. Ticking such a part by hand
   * still works — sharing is deliberate, and the shortfall list says so out
   * loud — but it isn't something to sweep up in bulk.
   */
  function takeAll() {
    const taken = new Set(takeable);
    save({
      partIds: parts.map((p) => p._id).filter((id) => taken.has(id)),
      cotsItemIds: cots.map((c) => c._id).filter((id) => taken.has(id)),
      quantities: takeable.flatMap((refId) => {
        const most = maxOf(refId);
        return Number.isFinite(most) && most > 1
          ? [{ refId, quantity: most }]
          : [];
      }),
    });
  }

  function clearAll() {
    save({ partIds: [], cotsItemIds: [], quantities: [] });
  }

  const isChosen = (refId: string) =>
    selected.partIds.includes(refId as Id<"parts">) ||
    selected.cotsItemIds.includes(refId as Id<"cotsItems">);
  // What there's still room to take: anything with some of it left, plus
  // whatever this assembly already holds, which you must be able to untick.
  const takeable = [
    ...parts.map((p) => p._id as string),
    ...cots.map((c) => c._id as string),
  ].filter((refId) => maxOf(refId) >= 1 || isChosen(refId));
  const chosenCount = selected.partIds.length + selected.cotsItemIds.length;
  const allChosen = takeable.length > 0 && takeable.every(isChosen);
  const loose = demand?.loose ?? [];

  return (
    <div>
      <label className="flex min-h-9 items-center gap-2 border-b pb-2 text-sm">
        <Checkbox
          checked={allChosen}
          // Until the ceilings arrive every part looks unlimited, and this
          // would take ones the plan has nothing left of.
          disabled={takeable.length === 0 || demand === undefined}
          aria-label="Select every part"
          onCheckedChange={() => (allChosen ? clearAll() : takeAll())}
        />
        <span className="font-medium">Select all</span>
        <span className="text-xs text-muted-foreground">
          {chosenCount} of {takeable.length}
        </span>
      </label>

      <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {parts.map((part) => {
          const elsewhere = alsoIn(part._id);
          const chosen = selected.partIds.includes(part._id);
          const noneLeft = !chosen && maxOf(part._id) < 1;
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
              {noneLeft ? (
                <span className="shrink-0 text-xs text-warning">
                  none left{elsewhere ? ` · ${elsewhere}` : ""}
                </span>
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
        {cots.map((item) => {
          const elsewhere = alsoIn(item._id);
          const chosen = selected.cotsItemIds.includes(item._id);
          const noneLeft = !chosen && maxOf(item._id) < 1;
          return (
            <label
              key={item._id}
              className="flex min-h-9 items-center gap-2 text-sm"
            >
              <Checkbox
                checked={chosen}
                onCheckedChange={() =>
                  save({
                    cotsItemIds: toggle(selected.cotsItemIds, item._id),
                  })
                }
              />
              <span className="text-xs text-muted-foreground">bought</span>
              <span className="truncate">{item.name}</span>
              {chosen && (
                <QtyBox
                  value={qtyOf(item._id)}
                  max={maxOf(item._id)}
                  onChange={(n) => setQty(item._id, n)}
                  label={`How many ${item.name}`}
                />
              )}
              {noneLeft ? (
                <span className="shrink-0 text-xs text-warning">
                  none left{elsewhere ? ` · ${elsewhere}` : ""}
                </span>
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

      {loose.length > 0 && (
        <p className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          {loose.length === 1
            ? "One thing here isn't fully accounted for by any sub-assembly yet."
            : `${loose.length} things here aren't fully accounted for by any sub-assembly yet.`}
        </p>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
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
export function BuiltCounter({
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
