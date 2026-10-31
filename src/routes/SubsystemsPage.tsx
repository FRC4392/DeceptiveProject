import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Chip } from "@/components/tracker/PartChips";
import { SubAssemblyEditor } from "@/components/tracker/SubAssemblies";
import { SubAssemblyCard } from "@/components/tracker/SubAssemblyCard";
import { CLAIM_COPY } from "@/components/tracker/ClaimLine";
import {
  BoughtItemActions,
  BoughtItemDialog,
  BoughtItemStatus,
} from "@/components/tracker/BoughtItem";
import { Button } from "@/components/ui/button";
import { useIsLead } from "@/lib/roles";
import { useActor } from "@/lib/tracker";
import { isMentorOrAbove } from "@/lib/stages";
import {
  STAGE_UI,
  asStage,
  isClaimableStage,
  madeLabel,
  stageLabel,
} from "@/lib/stages";
import {
  READY_STAGE,
  computeAssemblyStatuses,
  type AssemblyInput,
} from "../../convex/lib/assembly";
import { useProcessMap, useSubsystems } from "@/lib/tracker";
import { useRosterMap } from "@/lib/users";
import { cn } from "@/lib/utils";

type RowFilter = "all" | "coming";

/** "Can we build it yet?" — the question a subsystem lead actually asks. */
export function SubsystemsPage() {
  const [params, setParams] = useSearchParams();
  const subsystems = useSubsystems();
  const progress = useQuery(api.subsystems.progress, {});
  const roster = useRosterMap();
  const processes = useProcessMap();
  const [filter, setFilter] = useState<RowFilter>("all");
  const [editing, setEditing] = useState(false);
  const [addingBought, setAddingBought] = useState(false);
  const isLead = useIsLead();
  const actor = useActor();

  const selectedId = (params.get("s") ??
    subsystems?.[0]?._id ??
    null) as Id<"subsystems"> | null;

  useEffect(() => {
    if (!params.get("s") && subsystems?.[0]) {
      setParams({ s: subsystems[0]._id }, { replace: true });
    }
  }, [params, subsystems, setParams]);

  const parts = useQuery(
    api.parts.list,
    selectedId ? { subsystemId: selectedId } : "skip",
  );
  const cots = useQuery(
    api.cots.list,
    selectedId ? { subsystemId: selectedId } : "skip",
  );
  const demand = useQuery(
    api.subAssemblies.demand,
    selectedId ? { subsystemId: selectedId } : "skip",
  );
  const rows = useQuery(
    api.subAssemblies.list,
    selectedId ? { subsystemId: selectedId } : "skip",
  );

  const selected = subsystems?.find((s) => s._id === selectedId);
  const myProgress = progress?.find((p) => p.subsystemId === selectedId);

  const partById = useMemo(
    () => new Map((parts ?? []).map((p) => [p._id, p])),
    [parts],
  );
  const cotsById = useMemo(
    () => new Map((cots ?? []).map((c) => [c._id, c])),
    [cots],
  );

  if (subsystems !== undefined && subsystems.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No subsystems yet — a mentor sets them up in tracker settings.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Subsystem picker, scrollable on a phone. */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {(subsystems ?? []).map((s) => {
            const row = progress?.find((p) => p.subsystemId === s._id);
            return (
              <button
                key={s._id}
                type="button"
                onClick={() => setParams({ s: s._id })}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-4 text-sm transition-colors",
                  s._id === selectedId
                    ? "border-transparent bg-foreground text-background"
                    : "bg-card hover:bg-accent",
                )}
              >
                {s.name}
                {row && ` · ${row.ready}/${row.total}`}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <header>
          <h1 className="brand-title text-3xl">{selected.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected.leadUserId && roster[selected.leadUserId]
              ? `Lead: ${roster[selected.leadUserId].name} · `
              : ""}
            {myProgress
              ? myProgress.installed
                ? "On the robot"
                : `${myProgress.ready} of ${myProgress.total} ready`
              : ""}
          </p>
        </header>
      )}

      {demand && demand.underbuilt.length > 0 && (
        <section className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <h2 className="font-semibold">
            Not building enough · {demand.underbuilt.length}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These are placed more often than they're set to be built. Raise "on
            the robot" on each, or place fewer of them.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {demand.underbuilt.map((under) => (
              <li key={under.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{under.label}</span>
                <span className="text-muted-foreground">
                  placed {under.placed}, building {under.building}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {demand && demand.shortfalls.length > 0 && (
        <section className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <h2 className="font-semibold">
            Not enough planned · {demand.shortfalls.length}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Once the tree is multiplied out, the robot needs more of these than
            anyone has set out to make.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {demand.shortfalls.map((short) => (
              <li key={short.label} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{short.label}</span>
                <span className="text-muted-foreground">
                  needs {short.needed}, set to {short.planned}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Can we build it yet?</h2>
          {isLead && selectedId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing((open) => !open)}
            >
              {editing ? "Done editing" : "Edit sub-assemblies"}
            </Button>
          )}
        </div>

        {editing && selectedId ? (
          <SubAssemblyEditor
            subsystemId={selectedId}
            rows={rows ?? []}
            parts={parts ?? []}
            cots={cots ?? []}
            onDone={() => setEditing(false)}
          />
        ) : rows === undefined || rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing set up yet.
          </p>
        ) : (
          (() => {
            const inputs: AssemblyInput[] = rows.map(
              ({ assembly, partIds, cotsItemIds, childIds }) => ({
                id: assembly._id,
                number: assembly.partNumber,
                name: assembly.name,
                order: assembly.order,
                completed: assembly.completedAt !== undefined,
                childIds,
                members: [
                  ...partIds
                    .map((id) => partById.get(id))
                    .filter((p): p is Doc<"parts"> => Boolean(p))
                    .map((part) => ({
                      kind: "part" as const,
                      label: part.partNumber,
                      stageLabel: stageLabel(asStage(part.stage)).toLowerCase(),
                      ready: part.stage >= READY_STAGE,
                    })),
                  ...cotsItemIds
                    .map((id) => cotsById.get(id))
                    .filter((c): c is Doc<"cotsItems"> => Boolean(c))
                    .map((item) => ({
                      kind: "cots" as const,
                      label: item.name,
                      stageLabel: item.status,
                      ready: item.status === "arrived",
                    })),
                ],
              }),
            );
            const statuses = computeAssemblyStatuses(inputs);
            const statusById = new Map(statuses.map((s) => [s.id, s]));

            // Installing is the subsystem lead's or a mentor's call, the same
            // rule a single part follows going from stage 5 to 6.
            const canComplete =
              isMentorOrAbove(actor.role) ||
              (selectedId !== null &&
                actor.ledSubsystemIds.includes(selectedId));

            // Draw the tree from the default down; anything orphaned still
            // shows rather than vanishing.
            const childOf = new Set<string>();
            for (const row of rows) {
              for (const id of row.childIds) childOf.add(id);
            }
            const roots = rows.filter((r) => !childOf.has(r.assembly._id));
            const byId = new Map(
              rows.map((r) => [r.assembly._id as string, r]),
            );

            const rendered: { row: (typeof rows)[number]; depth: number }[] =
              [];
            const walk = (
              row: (typeof rows)[number],
              depth: number,
              seen: Set<string>,
            ) => {
              if (seen.has(row.assembly._id)) return;
              seen.add(row.assembly._id);
              rendered.push({ row, depth });
              for (const childId of row.childIds) {
                const child = byId.get(childId);
                if (child) walk(child, depth + 1, seen);
              }
            };
            const seen = new Set<string>();
            for (const root of roots) walk(root, 0, seen);
            for (const row of rows) walk(row, 0, seen);

            return (
              <div className="mt-3 space-y-2">
                {rendered.map(({ row, depth }) => (
                  <div
                    key={row.assembly._id}
                    // Indent stops at three levels; deeper nesting stays
                    // readable on a phone rather than marching off the edge.
                    style={{ marginLeft: `${Math.min(depth, 3) * 1.25}rem` }}
                  >
                    <SubAssemblyCard
                      assembly={row.assembly}
                      status={
                        statusById.get(row.assembly._id) ?? {
                          id: row.assembly._id,
                          ready: false,
                          done: false,
                          blocking: [],
                        }
                      }
                      claimantName={
                        row.assembly.claimedByUserId
                          ? roster[row.assembly.claimedByUserId]?.name
                          : undefined
                      }
                      canComplete={canComplete}
                      completeReason="The subsystem lead or a mentor marks it installed."
                      isLead={isLead}
                      units={
                        demand?.units.find((u) => u.id === row.assembly._id)
                          ?.units
                      }
                    />
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="font-semibold">Parts list</h2>
          <div className="flex flex-wrap items-center gap-2">
            {selectedId && (
              <Button size="sm" onClick={() => setAddingBought(true)}>
                Add a bought item
              </Button>
            )}
            <div className="flex gap-1 rounded-md border p-1">
              {(["all", "coming"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded px-3 py-1 text-sm",
                    filter === value
                      ? "bg-foreground text-background"
                      : "hover:bg-accent",
                  )}
                >
                  {value === "all" ? "All parts" : "Still coming"}
                </button>
              ))}
            </div>
          </div>
        </header>

        {selectedId && (
          <BoughtItemDialog
            open={addingBought}
            onOpenChange={setAddingBought}
            subsystemId={selectedId}
          />
        )}

        {/* A table on a laptop; stacked cards on a phone. */}
        <div className="hidden sm:block">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Part</th>
                <th className="px-4 py-2 text-right font-medium">Need</th>
                <th className="px-4 py-2 font-medium">Made on</th>
                <th className="px-4 py-2 font-medium">Where it is</th>
                <th className="px-4 py-2 font-medium">Who</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(parts ?? [])
                .filter((p) => (filter === "coming" ? p.stage < 5 : true))
                .map((part) => {
                  const stage = asStage(part.stage);
                  return (
                    <tr key={part._id}>
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/parts/${part._id}`}
                          className="font-medium hover:underline"
                        >
                          {part.name}
                        </Link>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {part.partNumber}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {part.qtyNeeded}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {processes.get(part.processTypeId)?.name ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip className={STAGE_UI[stage].chip}>
                          {stage}. {stageLabel(stage)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {part.claimedByUserId
                          ? (roster[part.claimedByUserId]?.name ?? "—")
                          : isClaimableStage(stage)
                            ? CLAIM_COPY.nobody
                            : "—"}
                      </td>
                    </tr>
                  );
                })}
              {(cots ?? [])
                .filter((c) =>
                  filter === "coming" ? c.status !== "arrived" : true,
                )
                .map((item) => (
                  <tr key={item._id}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Bought
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {item.qtyNeeded}
                      {item.unit ? ` ${item.unit}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {item.vendor ?? "Bought"}
                    </td>
                    <td className="px-4 py-2.5">
                      <BoughtItemStatus item={item} />
                    </td>
                    <td className="px-4 py-2.5">
                      <BoughtItemActions item={item} canRemove={isLead} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y sm:hidden">
          {(parts ?? [])
            .filter((p) => (filter === "coming" ? p.stage < 5 : true))
            .map((part) => {
              const stage = asStage(part.stage);
              return (
                <Link
                  key={part._id}
                  to={`/parts/${part._id}`}
                  className="block px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{part.name}</span>
                    <Chip className={STAGE_UI[stage].chip}>
                      {stage}. {stageLabel(stage)}
                    </Chip>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {part.partNumber} · need {part.qtyNeeded} ·{" "}
                    {madeLabel(part)} made
                  </p>
                </Link>
              );
            })}
          {(cots ?? [])
            .filter((c) =>
              filter === "coming" ? c.status !== "arrived" : true,
            )
            .map((item) => (
              <div key={item._id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{item.name}</span>
                  <BoughtItemActions item={item} canRemove={isLead} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Bought · need {item.qtyNeeded}
                  {item.unit ? ` ${item.unit}` : ""}
                  {item.vendor ? ` · ${item.vendor}` : ""}
                </p>
                <div className="mt-2">
                  <BoughtItemStatus item={item} />
                </div>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
