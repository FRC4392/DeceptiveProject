import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/tracker/PartChips";
import { ClaimLine } from "@/components/tracker/ClaimLine";
import {
  AssemblyMembers,
  BuiltCounter,
  type AssemblyRow,
} from "@/components/tracker/SubAssemblies";
import { useActor, useSubsystemMap } from "@/lib/tracker";
import { useCurrentUserId, useIsLead } from "@/lib/roles";
import { initials, useRosterMap } from "@/lib/users";
import { isMentorOrAbove } from "../../convex/lib/stages";
import {
  blockingSummary,
  computeAssemblyStatuses,
  READY_STAGE,
  type AssemblyInput,
} from "../../convex/lib/assembly";
import { onshapeElementUrl } from "../../convex/lib/onshapeLinks";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";

/**
 * One sub-assembly, the way a part has a page of its own: what it is, whether
 * it can go together yet, what it's made of, and who is on it.
 */
export function AssemblyPage() {
  const { assemblyId } = useParams<{ assemblyId: string }>();
  const id = assemblyId as Id<"subAssemblies">;
  const navigate = useNavigate();

  const assembly = useQuery(api.subAssemblies.get, { id });
  const notes = useQuery(api.subAssemblies.notes, { subAssemblyId: id });
  const history = useQuery(api.subAssemblies.history, { subAssemblyId: id });

  const subsystemId = assembly?.subsystemId;
  const rows = useQuery(
    api.subAssemblies.list,
    subsystemId ? { subsystemId } : "skip",
  );
  const parts = useQuery(
    api.parts.list,
    subsystemId ? { subsystemId } : "skip",
  );
  const cots = useQuery(api.cots.list, subsystemId ? { subsystemId } : "skip");
  const demand = useQuery(
    api.subAssemblies.demand,
    subsystemId ? { subsystemId } : "skip",
  );

  const subsystems = useSubsystemMap();
  const roster = useRosterMap();
  const currentUserId = useCurrentUserId();
  const actor = useActor();
  const isLead = useIsLead();

  const rename = useMutation(api.subAssemblies.rename);
  const remove = useMutation(api.subAssemblies.remove);
  const setDrawing = useMutation(api.subAssemblies.setDrawing);
  const setUnits = useMutation(api.subAssemblies.setUnits);
  const setQtyBuilt = useMutation(api.subAssemblies.setQtyBuilt);
  const claim = useMutation(api.subAssemblies.claim);
  const unclaim = useMutation(api.subAssemblies.unclaim);
  const complete = useMutation(api.subAssemblies.complete);
  const reopen = useMutation(api.subAssemblies.reopen);
  const addNote = useMutation(api.subAssemblies.addNote);

  const [noteBody, setNoteBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, "That didn't work."));
    }
  }

  if (assembly === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (assembly === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          That sub-assembly isn't in the tracker.
        </p>
        <Button asChild variant="outline">
          <Link to="/subsystems">Back to subsystems</Link>
        </Button>
      </div>
    );
  }

  const subsystem = subsystems.get(assembly.subsystemId);
  const personName = (userId?: string) =>
    userId ? (roster[userId]?.name ?? "Someone") : undefined;

  // The same readiness the subsystem page computes, for this one assembly.
  const inputs: AssemblyInput[] = (rows ?? []).map((row) => ({
    id: row.assembly._id,
    number: row.assembly.partNumber,
    name: row.assembly.name,
    order: row.assembly.order,
    completed: row.assembly.completedAt !== undefined,
    members: [
      ...row.partIds.flatMap((partId) => {
        const part = (parts ?? []).find((p) => p._id === partId);
        return part
          ? [
              {
                kind: "part" as const,
                label: part.partNumber,
                stageLabel: `at stage ${part.stage}`,
                ready: part.stage >= READY_STAGE,
              },
            ]
          : [];
      }),
      ...row.cotsItemIds.flatMap((cotsId) => {
        const item = (cots ?? []).find((c) => c._id === cotsId);
        return item
          ? [
              {
                kind: "cots" as const,
                label: item.name,
                stageLabel: item.status,
                ready: item.status === "arrived",
              },
            ]
          : [];
      }),
    ],
    childIds: row.childIds as string[],
  }));
  const status = computeAssemblyStatuses(inputs).find((s) => s.id === id) ?? {
    id: id as string,
    ready: false,
    done: false,
    blocking: [],
  };

  const row = (rows ?? []).find((r) => r.assembly._id === id);
  // Where it goes: every assembly that holds this one, and how many it takes.
  const parents = (rows ?? []).filter((r) =>
    r.childIds.some((childId) => childId === id),
  );
  const units = demand?.units.find((u) => u.id === id)?.units;
  const canComplete =
    isMentorOrAbove(actor.role) ||
    actor.ledSubsystemIds.includes(assembly.subsystemId as string);
  const cadUrl = onshapeElementUrl(assembly);
  const mine = assembly.claimedByUserId === currentUserId;

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/subsystems" className="hover:underline">
          Subsystems
        </Link>
        {subsystem && (
          <>
            <span>/</span>
            <Link
              to={`/subsystems?s=${subsystem._id}`}
              className="hover:underline"
            >
              {subsystem.name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="font-mono">{assembly.partNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">{assembly.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip className="font-mono">{assembly.partNumber}</Chip>
            {assembly.isDefault && <Chip>The whole subsystem</Chip>}
            {units !== undefined && units > 1 && (
              <Chip className="bg-primary/10 text-primary">build {units}</Chip>
            )}
            {(assembly.qtySpares ?? 0) > 0 && (
              <Chip>{assembly.qtySpares} spare</Chip>
            )}
          </div>
        </div>
        {cadUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={cadUrl} target="_blank" rel="noreferrer noopener">
              Open in Onshape
              <ExternalLinkIcon className="ml-1.5 h-3 w-3" />
            </a>
          </Button>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {/* Where it's up to, and the one button that moves it on. */}
          <section
            className={cn(
              "rounded-lg border-2 bg-card p-4 shadow-sm",
              status.done
                ? "border-success"
                : status.ready
                  ? "border-success/60"
                  : "border-primary",
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Right now
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {status.done
                ? "Built and on the robot"
                : status.ready
                  ? "Everything's in the bin — it can go together"
                  : "Waiting on what it's made of"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {blockingSummary(status)}
            </p>

            <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
              <BuiltCounter
                assembly={assembly}
                onStep={(delta) => void run(() => setQtyBuilt({ id, delta }))}
              />
            </div>

            <ClaimLine
              className="mt-4"
              claimantName={
                assembly.claimedByUserId
                  ? (personName(assembly.claimedByUserId) ?? "Someone")
                  : undefined
              }
              mine={mine}
              closed={status.done}
              claimedVerb={
                status.done
                  ? `${personName(assembly.completedByUserId) ?? "Someone"} built it`
                  : undefined
              }
              onClaim={() => claim({ id })}
              onRelease={() => unclaim({ id })}
            >
              {!status.done && status.ready && (
                <Button
                  size="sm"
                  disabled={!canComplete}
                  title={
                    canComplete
                      ? undefined
                      : "The subsystem lead or a mentor marks it installed."
                  }
                  onClick={() => void run(() => complete({ id }))}
                >
                  Done — it's on the robot
                </Button>
              )}
              {status.done && isLead && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void run(() => reopen({ id }))}
                >
                  Reopen
                </Button>
              )}
            </ClaimLine>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </section>

          {isLead && (
            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="font-semibold">Details</h2>

              <div className="mt-3 grid gap-3 sm:max-w-lg">
                <label className="space-y-1 text-sm">
                  <span className="block text-muted-foreground">Name</span>
                  <Input
                    defaultValue={assembly.name}
                    aria-label="Sub-assembly name"
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next.length > 0 && next !== assembly.name) {
                        void run(() => rename({ id, name: next }));
                      }
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-muted-foreground">
                    Assembly drawing
                  </span>
                  <Input
                    defaultValue={assembly.drawingUrl ?? ""}
                    placeholder="https://… a link whoever builds it can open"
                    aria-label="Assembly drawing link"
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next !== (assembly.drawingUrl ?? "")) {
                        void run(() =>
                          setDrawing({
                            id,
                            url: next.length > 0 ? next : null,
                          }),
                        );
                      }
                    }}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
                <label className="space-y-1">
                  <span className="block text-muted-foreground">
                    On the robot
                  </span>
                  <Input
                    type="number"
                    min={1}
                    defaultValue={assembly.qtyNeeded ?? 1}
                    aria-label="How many go on the robot"
                    className="h-9 w-20"
                    onBlur={(e) => {
                      const next = Math.max(
                        1,
                        Math.round(Number(e.target.value)),
                      );
                      if (
                        Number.isFinite(next) &&
                        next !== (assembly.qtyNeeded ?? 1)
                      ) {
                        void run(() => setUnits({ id, qtyNeeded: next }));
                      }
                    }}
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-muted-foreground">Spares</span>
                  <Input
                    type="number"
                    min={0}
                    defaultValue={assembly.qtySpares ?? 0}
                    aria-label="Spare units to build"
                    className="h-9 w-20"
                    onBlur={(e) => {
                      const next = Math.max(
                        0,
                        Math.round(Number(e.target.value)),
                      );
                      if (
                        Number.isFinite(next) &&
                        next !== (assembly.qtySpares ?? 0)
                      ) {
                        void run(() => setUnits({ id, qtySpares: next }));
                      }
                    }}
                  />
                </label>
              </div>

              {!assembly.isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-4 text-danger"
                  onClick={() =>
                    void run(async () => {
                      await remove({ id });
                      void navigate(`/subsystems?s=${assembly.subsystemId}`);
                    })
                  }
                >
                  Delete this sub-assembly
                </Button>
              )}
            </section>
          )}

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">What it's made of</h2>
            <div className="mt-3">
              {row && rows && parts && cots ? (
                isLead ? (
                  <AssemblyMembers
                    selected={row as AssemblyRow}
                    rows={rows as AssemblyRow[]}
                    parts={parts}
                    cots={cots}
                  />
                ) : (
                  <MemberReadout
                    row={row as AssemblyRow}
                    rows={rows as AssemblyRow[]}
                    parts={parts}
                    cots={cots}
                  />
                )
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Notes</h2>
            <div className="mt-3 space-y-4">
              {(notes ?? []).map((note) => (
                <div key={note._id} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
                    {initials(personName(note.userId) ?? "?")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {personName(note.userId) ?? "Someone"} ·{" "}
                      {formatDay(note._creationTime)}
                    </p>
                    <p className="text-sm">{note.body}</p>
                  </div>
                </div>
              ))}
              {notes?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No notes yet. Why it was reopened, what to watch for, which
                  bolts — they go here.
                </p>
              )}
            </div>

            <div className="mt-4 space-y-2">
              <Textarea
                value={noteBody}
                rows={2}
                placeholder="Questions, tips, problems…"
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <Button
                size="sm"
                disabled={noteBody.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    await addNote({ subAssemblyId: id, body: noteBody });
                    setNoteBody("");
                  })
                }
              >
                Add a note
              </Button>
            </div>
          </section>

          <section className="rounded-lg border bg-card shadow-sm">
            <h2 className="border-b px-4 py-3 font-semibold">History</h2>
            <ul className="divide-y">
              {(history ?? []).map((event) => (
                <li key={event._id} className="flex gap-4 px-4 py-3 text-sm">
                  <span className="w-20 shrink-0 text-muted-foreground">
                    {formatDay(event._creationTime)}
                  </span>
                  <span className="min-w-0">
                    {personName(event.userId) ?? "Someone"}{" "}
                    {eventLine(event.kind, event.from, event.to)}
                  </span>
                </li>
              ))}
              {history?.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  Nothing has happened yet.
                </li>
              )}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Files</h2>
            <div className="mt-2 space-y-2 text-sm">
              {cadUrl ? (
                <a
                  href={cadUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                >
                  Assembly CAD
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              ) : (
                <p className="text-muted-foreground">
                  No CAD linked yet — a sync from Onshape fills this in.
                </p>
              )}
              {assembly.drawingUrl && (
                <a
                  href={assembly.drawingUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                >
                  Assembly drawing
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Where it goes</h2>
            <div className="mt-2 space-y-1 text-sm">
              {assembly.isDefault ? (
                <p className="text-muted-foreground">
                  This is the whole subsystem — everything else goes inside it.
                </p>
              ) : parents.length === 0 ? (
                <p className="text-warning">
                  Not in any sub-assembly, so nothing is waiting on it.
                </p>
              ) : (
                parents.map((parent) => {
                  const takes =
                    parent.quantities.find((q) => q.refId === id)?.quantity ??
                    1;
                  return (
                    <Link
                      key={parent.assembly._id}
                      to={`/assemblies/${parent.assembly._id}`}
                      className="flex items-baseline justify-between gap-2 hover:underline"
                    >
                      <span className="truncate">{parent.assembly.name}</span>
                      {takes > 1 && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          × {takes}
                        </span>
                      )}
                    </Link>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">People</h2>
            <dl className="mt-2 space-y-1 text-sm">
              <Row
                label="Picked up by"
                value={personName(assembly.claimedByUserId)}
              />
              <Row
                label="Built by"
                value={personName(assembly.completedByUserId)}
              />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** What it's made of, for someone who can't change it. */
function MemberReadout({
  row,
  rows,
  parts,
  cots,
}: {
  row: AssemblyRow;
  rows: AssemblyRow[];
  parts: { _id: Id<"parts">; partNumber: string; name: string }[];
  cots: { _id: Id<"cotsItems">; name: string }[];
}) {
  const takes = (refId: string) =>
    row.quantities.find((q) => q.refId === refId)?.quantity;

  const lines = [
    ...row.partIds.flatMap((id) => {
      const part = parts.find((p) => p._id === id);
      return part
        ? [{ id: id as string, label: `${part.partNumber} ${part.name}` }]
        : [];
    }),
    ...row.cotsItemIds.flatMap((id) => {
      const item = cots.find((c) => c._id === id);
      return item ? [{ id: id as string, label: item.name }] : [];
    }),
    ...row.childIds.flatMap((id) => {
      const child = rows.find((r) => r.assembly._id === id);
      return child
        ? [
            {
              id: id as string,
              label: `${child.assembly.partNumber} ${child.assembly.name}`,
            },
          ]
        : [];
    }),
  ];

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing in it yet.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((line) => (
        <li key={line.id} className="flex items-baseline justify-between gap-2">
          <span className="truncate">{line.label}</span>
          {(takes(line.id) ?? 1) > 1 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              × {takes(line.id)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function eventLine(
  kind: "built" | "reopened" | "qty_built",
  from?: number,
  to?: number,
): string {
  if (kind === "built") return "marked it built and on the robot";
  if (kind === "reopened") return "reopened it";
  return `set built to ${to ?? 0}${from !== undefined ? ` (was ${from})` : ""}`;
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right", !value && "text-muted-foreground")}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
