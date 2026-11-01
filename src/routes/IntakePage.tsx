import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
 * "New from Onshape": releases waiting for a design lead, plus the manual
 * ways in that cost the team no API calls at all.
 */
export function IntakePage() {
  const intakes = useQuery(api.intake.list, {});
  const budget = useQuery(api.settings.budget, {});
  const [tool, setTool] = useState<"none" | "manual" | "csv">("none");

  const queued = (intakes ?? []).filter(
    ({ intake }) => intake.status === "queued",
  ).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">New from Onshape</h1>
          <p className="text-sm text-muted-foreground">
            Released parts waiting to go on the board. Design leads set up each
            part once, then it's on the board for good.
          </p>
        </div>
      </header>

      {budget && budget.mode !== "normal" && (
        <BudgetBanner budget={budget} queued={queued} />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          {intakes === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : intakes.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="font-medium">Nothing waiting.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Releases show up here on their own. You can also type numbers in
                or upload a BOM below — both cost nothing.
              </p>
            </div>
          ) : (
            intakes.map(({ intake, lines }) => (
              <IntakeCard key={intake._id} intake={intake} lines={lines} />
            ))
          )}

          {/* Manual tools: always available, zero API calls. */}
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Add a release by hand</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Works with no Onshape connection at all, and costs nothing.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant={tool === "manual" ? "default" : "outline"}
                size="sm"
                onClick={() => setTool(tool === "manual" ? "none" : "manual")}
              >
                Type part numbers
              </Button>
              <Button
                variant={tool === "csv" ? "default" : "outline"}
                size="sm"
                onClick={() => setTool(tool === "csv" ? "none" : "csv")}
              >
                Import a BOM CSV
              </Button>
            </div>
            {tool === "manual" && (
              <ManualEntry onDone={() => setTool("none")} />
            )}
            {tool === "csv" && <CsvImport onDone={() => setTool("none")} />}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">How parts get here</h2>
            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                1. Press <strong>Get a part number</strong> in the tracker.
              </li>
              <li>
                2. Paste it into the part's <strong>Part number</strong> field
                in Onshape.
              </li>
              <li>3. Release the Part Studio when the design is done.</li>
              <li>4. It shows up here for a lead to wave through.</li>
            </ol>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">What "Needs drawing" means</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <ProcessLegend />
            </dl>
          </section>

          {budget && (
            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="font-semibold">Onshape API budget</h2>
              <p className="mt-2 text-3xl font-semibold">{budget.used}</p>
              <p className="text-sm text-muted-foreground">
                of {budget.limit} calls this year
              </p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                <div
                  className={cn(
                    "h-1.5 rounded-full",
                    budget.mode === "manual"
                      ? "bg-danger"
                      : budget.mode === "lean"
                        ? "bg-warning"
                        : "bg-primary",
                  )}
                  style={{
                    width: `${Math.min(100, Math.round((budget.used / Math.max(1, budget.limit)) * 100))}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Mode: <strong className="capitalize">{budget.mode}</strong>
                {budget.forced &&
                  (budget.forcedReason ? " (forced)" : " (set by a mentor)")}
                . Change notifications from Onshape are free; only reads and
                writes count.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * Says the app has stopped spending, why, and what still works — because the
 * modes only help if the lead can tell the difference between "Onshape is
 * broken" and "we are being careful on purpose".
 */
function BudgetBanner({
  budget,
  queued,
}: {
  budget: {
    mode: "normal" | "lean" | "manual";
    forced: boolean;
    forcedReason: string | null;
    remaining: number;
  };
  queued: number;
}) {
  const reconcile = useAction(api.onshapeWebhook.reconcile);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const manual = budget.mode === "manual";
  return (
    <section
      className={cn(
        "rounded-lg border p-4",
        manual
          ? "border-danger/40 bg-danger/5"
          : "border-warning/40 bg-warning/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-semibold">
            {manual
              ? "Onshape calls are paused"
              : "Going easy on the Onshape budget"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {manual
              ? "Nothing is read from Onshape. Releases are still being told to us for free and parked below; typing numbers in and uploading a BOM both still work."
              : "Releases still come in on their own. Syncing a whole element from the Onshape panel is off — it costs a call per part."}{" "}
            {budget.remaining} calls left
            {budget.forced && budget.forcedReason
              ? ` · ${budget.forcedReason}`
              : budget.forced
                ? " · set by a mentor"
                : ""}
          </p>
          {note && <p className="text-sm">{note}</p>}
        </div>
        {queued > 0 && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setNote(null);
              reconcile({})
                .then((r) =>
                  setNote(
                    r.processed === 0
                      ? "Still no budget for it — nothing was read."
                      : `Read ${r.processed} release${r.processed === 1 ? "" : "s"}${r.remaining > 0 ? `, ${r.remaining} still waiting` : ""}.`,
                  ),
                )
                .catch((err: unknown) => setNote(errorText(err, "No luck.")))
                .finally(() => setBusy(false));
            }}
          >
            Reconcile {queued}
          </Button>
        )}
      </div>
    </section>
  );
}

function ProcessLegend() {
  const processes = useProcessTypes();
  return (
    <>
      {(processes ?? []).map((p) => (
        <div key={p._id} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{p.name}</dt>
          <dd className="text-right">
            {p.isBought
              ? "Straight to the bin when it arrives"
              : p.needsDrawing
                ? "Drawing or toolpath first"
                : "Skips the drawing step"}
          </dd>
        </div>
      ))}
    </>
  );
}

function IntakeCard({
  intake,
  lines,
}: {
  intake: Doc<"releaseIntakes">;
  lines: Line[];
}) {
  const applyMatched = useMutation(api.intake.applyMatched);
  const finish = useMutation(api.intake.finish);
  const removeIntake = useMutation(api.intake.removeIntake);
  const [error, setError] = useState<string | null>(null);

  const undecided = lines.filter((l) => !l.decision);
  // Assemblies come out first: the four buckets below are all about parts,
  // and none of their actions would mean anything applied to an assembly.
  const assemblies = undecided.filter((l) => l.target === "subAssembly");
  const parts = undecided.filter((l) => l.target !== "subAssembly");
  const matched = parts.filter((l) => l.kind === "matched");
  const changed = parts.filter((l) => l.kind === "changed");
  const unknown = parts.filter((l) => l.kind === "unknown");
  const removed = parts.filter((l) => l.kind === "removed");

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold">{intake.label}</h2>
          <p className="text-xs text-muted-foreground">
            {new Date(intake.receivedAt).toLocaleString()} ·{" "}
            {intake.source === "onshape"
              ? "from Onshape"
              : intake.source === "csv"
                ? "BOM import"
                : "typed in"}{" "}
            · {lines.length} line{lines.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          {matched.length > 0 && (
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                applyMatched({ intakeId: intake._id }).catch((err: unknown) =>
                  setError(errorText(err, "No luck.")),
                );
              }}
            >
              Move {matched.length} along
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void finish({ intakeId: intake._id })}
          >
            Done with this
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void removeIntake({ intakeId: intake._id })}
          >
            Discard
          </Button>
        </div>
      </header>

      {error && <p className="text-sm text-danger">{error}</p>}

      {intake.status === "queued" && (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Onshape told us about this one, but it hasn't been read yet
          {queuedBecause(intake) ? ` — ${queuedBecause(intake)}` : ""}. Press
          Reconcile at the top when there's budget again.
        </p>
      )}

      {unknown.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">
            New parts · {unknown.length}
          </h3>
          <p className="text-xs text-muted-foreground">
            Numbers the tracker hasn't issued. Set each one up once.
          </p>
          <div className="mt-2 space-y-2">
            {unknown.map((line) => (
              <UnknownLine key={line._id} line={line} />
            ))}
          </div>
        </div>
      )}

      {changed.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <h3 className="text-sm font-semibold">
            Changed parts · {changed.length} need a decision
          </h3>
          <div className="mt-2 space-y-3">
            {changed.map((line) => (
              <ChangedLine key={line._id} line={line} />
            ))}
          </div>
        </div>
      )}

      {matched.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Matched · {matched.length}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {matched.map((line) => (
              <li key={line._id} className="flex flex-wrap gap-2">
                <span className="font-mono">{line.partNumber}</span>
                <span className="text-muted-foreground">{line.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {removed.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Removed · {removed.length}</h3>
          <div className="mt-2 space-y-2">
            {removed.map((line) => (
              <RemovedLine key={line._id} line={line} />
            ))}
          </div>
        </div>
      )}

      {assemblies.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">
            Assemblies · {assemblies.length}
          </h3>
          <p className="text-xs text-muted-foreground">
            What the CAD says about the assembly itself. One the board doesn't
            know yet can be added here, keeping its number and its CAD link.
          </p>
          <div className="mt-2 space-y-2">
            {assemblies.map((line) => (
              <AssemblyLine key={line._id} line={line} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Why a release is still sitting unread, if the queueing said. */
function queuedBecause(intake: Doc<"releaseIntakes">): string | null {
  const payload = intake.payload as { queuedBecause?: unknown } | undefined;
  return typeof payload?.queuedBecause === "string"
    ? payload.queuedBecause
    : null;
}

function AssemblyLine({ line }: { line: Line }) {
  const applyLine = useMutation(api.intake.applyLine);
  const createSubAssembly = useMutation(api.intake.createSubAssemblyFromLine);
  const subsystems = useSubsystems();
  const [subsystemId, setSubsystemId] = useState<string>(
    (line.subsystemId as string | undefined) ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  // A known assembly needs no setting up; an unknown one is the whole reason
  // this line couldn't be resolved before.
  const addable = line.kind === "unknown";

  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {line.partNumber && (
            <span className="mr-1.5 font-mono text-xs">{line.partNumber}</span>
          )}
          <span className="font-medium">{line.name}</span>
          {line.revision && (
            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
              · {line.revision}
            </span>
          )}
          <span className="block text-xs text-muted-foreground">
            {line.note}
          </span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void applyLine({ lineId: line._id, decision: "ignored" })
          }
        >
          Got it
        </Button>
      </div>

      {addable && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Select value={subsystemId} onValueChange={setSubsystemId}>
            <SelectTrigger aria-label="Subsystem" className="w-56">
              <SelectValue placeholder="Subsystem" />
            </SelectTrigger>
            <SelectContent>
              {(subsystems ?? []).map((sub) => (
                <SelectItem key={sub._id} value={sub._id}>
                  {sub.code} · {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              createSubAssembly({
                lineId: line._id,
                subsystemId: subsystemId as Id<"subsystems">,
              }).catch((err: unknown) => setError(errorText(err, "No luck.")));
            }}
          >
            Add as a sub-assembly
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function UnknownLine({ line }: { line: Line }) {
  const subsystems = useSubsystems();
  const processes = useProcessTypes();
  const applyLine = useMutation(api.intake.applyLine);
  const [subsystemId, setSubsystemId] = useState<string>(
    (line.subsystemId as string | undefined) ?? "",
  );
  const [processTypeId, setProcessTypeId] = useState("");
  const [qtyNeeded, setQtyNeeded] = useState(String(line.quantity ?? 1));
  const [qtySpares, setQtySpares] = useState("0");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{line.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {line.partNumber ?? "no number"}
        </span>
      </div>

      <div className="mt-3 grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
        <Select value={processTypeId} onValueChange={setProcessTypeId}>
          <SelectTrigger aria-label="Made on">
            <SelectValue placeholder="Made on" />
          </SelectTrigger>
          <SelectContent>
            {(processes ?? []).map((p) => (
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
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function ChangedLine({ line }: { line: Line }) {
  const applyLine = useMutation(api.intake.applyLine);
  const options = [
    {
      value: "rework" as const,
      title: "Fix them",
      detail: "Adds a rework note; the part stays where it is.",
    },
    {
      value: "remake_all" as const,
      title: "Remake all of them",
      detail:
        "Count goes back to zero; the old ones are scrap or practice bot.",
    },
    {
      value: "keep" as const,
      title: "They're fine as-is",
      detail: "The designer confirms the ones already made still work.",
    },
  ];

  return (
    <div>
      <p className="text-sm">
        <span className="font-medium">{line.name}</span>{" "}
        <span className="font-mono text-xs">{line.partNumber}</span>
        {line.revision && (
          <span className="text-xs text-muted-foreground">
            {" "}
            · {line.revision}
          </span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">{line.note}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() =>
              void applyLine({ lineId: line._id, decision: option.value })
            }
            className="rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary"
          >
            <span className="block text-sm font-medium">{option.title}</span>
            <span className="block text-xs text-muted-foreground">
              {option.detail}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RemovedLine({ line }: { line: Line }) {
  const applyLine = useMutation(api.intake.applyLine);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <span>
        <span className="font-mono">{line.partNumber}</span> {line.name}
        <span className="block text-xs text-muted-foreground">{line.note}</span>
      </span>
      <span className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void applyLine({ lineId: line._id, decision: "archived" })
          }
        >
          Archive it
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void applyLine({ lineId: line._id, decision: "ignored" })
          }
        >
          Leave it
        </Button>
      </span>
    </div>
  );
}

function ManualEntry({ onDone }: { onDone: () => void }) {
  const addManual = useMutation(api.intake.addManual);
  const subsystems = useSubsystems();
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [subsystemId, setSubsystemId] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4 space-y-3 rounded-lg border p-3">
      <div className="grid gap-2">
        <Label htmlFor="me-label">What is this?</Label>
        <Input
          id="me-label"
          value={label}
          placeholder="Intake release, Jan 26"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="me-text">Part numbers, one per line</Label>
        <Textarea
          id="me-text"
          rows={5}
          value={text}
          placeholder={"27-INT-104 B\n27-INT-110 A"}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="me-sub">Subsystem (optional)</Label>
        <Select value={subsystemId} onValueChange={setSubsystemId}>
          <SelectTrigger id="me-sub">
            <SelectValue placeholder="All subsystems" />
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
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button
        onClick={() => {
          setError(null);
          addManual({
            label,
            text,
            subsystemId: subsystemId
              ? (subsystemId as Id<"subsystems">)
              : undefined,
          })
            .then(onDone)
            .catch((err: unknown) => setError(errorText(err, "No luck.")));
        }}
      >
        Match these up
      </Button>
    </div>
  );
}

function CsvImport({ onDone }: { onDone: () => void }) {
  const importCsv = useMutation(api.intake.importCsv);
  const [label, setLabel] = useState("");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4 space-y-3 rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">
        Export the BOM to CSV from Onshape in your browser, then drop the file
        here. The tracker matches rows by part number.
      </p>
      <Input
        value={label}
        placeholder="Intake BOM, Jan 26"
        aria-label="What is this?"
        onChange={(e) => setLabel(e.target.value)}
      />
      <Input
        type="file"
        accept=".csv,text/csv"
        aria-label="BOM CSV file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          void file.text().then(setCsv);
          if (!label) setLabel(file.name);
        }}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button
        disabled={csv.length === 0}
        onClick={() => {
          setError(null);
          importCsv({ label, csv })
            .then(onDone)
            .catch((err: unknown) => setError(errorText(err, "No luck.")));
        }}
      >
        Import it
      </Button>
    </div>
  );
}
