import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Cross2Icon, ExternalLinkIcon } from "@radix-ui/react-icons";
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
  const setDrawing = useMutation(api.subAssemblies.setDrawing);
  const unassigned = useQuery(api.subAssemblies.unassigned, { subsystemId });

  const [selectedId, setSelectedId] = useState<Id<"subAssemblies"> | null>(
    rows[0]?.assembly._id ?? null,
  );
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = rows.find((r) => r.assembly._id === selectedId) ?? rows[0];

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "That didn't work."),
    );
  }

  // Where everything currently sits, so nothing is offered in two places.
  const ownerOf = new Map<string, AssemblyRow>();
  for (const row of rows) {
    for (const id of row.partIds) ownerOf.set(id, row);
    for (const id of row.cotsItemIds) ownerOf.set(id, row);
    for (const id of row.childIds) ownerOf.set(id, row);
  }
  const edges = new Map<string, string[]>(
    rows.map((r) => [r.assembly._id as string, r.childIds as string[]]),
  );

  function heldElsewhere(memberId: string): AssemblyRow | undefined {
    const owner = ownerOf.get(memberId);
    return owner && owner.assembly._id !== selected?.assembly._id
      ? owner
      : undefined;
  }

  function save(next: Partial<Omit<AssemblyRow, "assembly">>) {
    if (!selected) return;
    run(
      setMembers({
        id: selected.assembly._id,
        partIds: next.partIds ?? selected.partIds,
        cotsItemIds: next.cotsItemIds ?? selected.cotsItemIds,
        childIds: next.childIds ?? selected.childIds,
      }),
    );
  }

  function toggle<T extends string>(list: T[], id: T): T[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  const availableParts = parts.filter((p) => !heldElsewhere(p._id));
  const availableCots = cots.filter((c) => !heldElsewhere(c._id));
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
              onCheckedChange={() =>
                save({
                  partIds: allChosen ? [] : availableParts.map((p) => p._id),
                  cotsItemIds: allChosen ? [] : availableCots.map((c) => c._id),
                })
              }
            />
            <span className="font-medium">Select all</span>
            <span className="text-xs text-muted-foreground">
              {chosen} of {totalPickable}
            </span>
          </label>

          <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {parts.map((part) => {
              const owner = heldElsewhere(part._id);
              return (
                <label
                  key={part._id}
                  className={cn(
                    "flex min-h-9 items-center gap-2 text-sm",
                    owner && "text-muted-foreground",
                  )}
                >
                  <Checkbox
                    checked={selected.partIds.includes(part._id)}
                    disabled={owner !== undefined}
                    onCheckedChange={() =>
                      save({ partIds: toggle(selected.partIds, part._id) })
                    }
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {part.partNumber}
                  </span>
                  <span className="truncate">{part.name}</span>
                  {owner && (
                    <span className="shrink-0 text-xs">
                      in {owner.assembly.name}
                    </span>
                  )}
                </label>
              );
            })}
            {cots.map((item) => {
              const owner = heldElsewhere(item._id);
              return (
                <label
                  key={item._id}
                  className={cn(
                    "flex min-h-9 items-center gap-2 text-sm",
                    owner && "text-muted-foreground",
                  )}
                >
                  <Checkbox
                    checked={selected.cotsItemIds.includes(item._id)}
                    disabled={owner !== undefined}
                    onCheckedChange={() =>
                      save({
                        cotsItemIds: toggle(selected.cotsItemIds, item._id),
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">bought</span>
                  <span className="truncate">{item.name}</span>
                  {owner && (
                    <span className="shrink-0 text-xs">
                      in {owner.assembly.name}
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
                const owner = heldElsewhere(row.assembly._id);
                const loops = wouldCycle(
                  selected.assembly._id,
                  row.assembly._id,
                  edges,
                );
                const locked = owner !== undefined || loops;
                return (
                  <label
                    key={row.assembly._id}
                    className={cn(
                      "flex min-h-9 items-center gap-2 text-sm",
                      locked && "text-muted-foreground",
                    )}
                  >
                    <Checkbox
                      checked={selected.childIds.includes(row.assembly._id)}
                      disabled={locked}
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
                    {owner && (
                      <span className="shrink-0 text-xs">
                        in {owner.assembly.name}
                      </span>
                    )}
                    {!owner && loops && (
                      <span className="shrink-0 text-xs">holds this one</span>
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
