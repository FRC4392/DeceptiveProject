import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Chip, FlagChips } from "@/components/tracker/PartChips";
import { StageStrip } from "@/components/tracker/StageStrip";
import { ProblemDialog } from "@/components/tracker/ProblemDialog";
import { AssigneePicker } from "@/components/tracker/AssigneePicker";
import { QtyCounter } from "@/components/tracker/QtyCounter";
import {
  STAGE_LIST,
  advanceLabel,
  asStage,
  canAdvance,
  canClaim,
  isClaimableStage,
  initials,
  madeLabel,
  problemLabel,
  qtyLabel,
  stageLabel,
  stageTask,
  toProcessShape,
} from "@/lib/stages";
import {
  useActor,
  useMachineMap,
  useProcessMap,
  useSubsystemMap,
} from "@/lib/tracker";
import { useIsLead, useIsMentor } from "@/lib/roles";
import { useRosterMap } from "@/lib/users";
import { onshapeElementUrl } from "../../convex/lib/onshapeLinks";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";

export function PartPage() {
  const { partId } = useParams<{ partId: string }>();
  const id = partId as Id<"parts">;
  const part = useQuery(api.parts.get, { id });
  const history = useQuery(api.parts.history, { partId: id });
  const notes = useQuery(api.parts.notes, { partId: id });
  const problems = useQuery(api.parts.problems, { partId: id });

  const processes = useProcessMap();
  const machines = useMachineMap();
  const subsystems = useSubsystemMap();
  const roster = useRosterMap();
  const actor = useActor();
  const isLead = useIsLead();
  const isMentor = useIsMentor();

  const advancePart = useMutation(api.parts.advance);
  const moveTo = useMutation(api.parts.moveTo);
  const claim = useMutation(api.parts.claim);
  const unclaim = useMutation(api.parts.unclaim);
  const assign = useMutation(api.parts.assign);
  const addNote = useMutation(api.parts.addNote);
  const resolveProblem = useMutation(api.parts.resolveProblem);

  const [noteBody, setNoteBody] = useState("");
  const [problemOpen, setProblemOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (part === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (part === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          That part number isn't in the tracker.
        </p>
        <Button asChild variant="outline">
          <Link to="/parts">Back to the board</Link>
        </Button>
      </div>
    );
  }

  const process = processes.get(part.processTypeId);
  const shape = toProcessShape(process);
  const machine = process?.machineId
    ? machines.get(process.machineId)
    : undefined;
  const subsystem = subsystems.get(part.subsystemId);
  const stage = asStage(part.stage);
  const claimant = part.claimedByUserId
    ? roster[part.claimedByUserId]
    : undefined;

  const permission = canAdvance(
    stage,
    shape,
    {
      subsystemId: part.subsystemId as string,
      qtyMade: part.qtyMade,
      qtyNeeded: part.qtyNeeded,
    },
    actor,
  );
  const claimPermission = canClaim(stage);
  const nextLabel = advanceLabel(stage, shape);
  const openProblems = (problems ?? []).filter(
    (p) => p.resolvedAt === undefined,
  );

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, "That didn't work."));
    }
  }

  function personName(userId?: string): string | undefined {
    return userId ? roster[userId]?.name : undefined;
  }

  /** The caption under each step of the strip: who did it, and when. */
  function stageDetail(target: number): string | undefined {
    const event = (history ?? [])
      .slice()
      .reverse()
      .find((e) => e.toStage === target);
    if (!event) return undefined;
    const who = personName(event.userId);
    return `${new Date(event._creationTime).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}${who ? ` · ${initials(who)}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/parts" className="hover:text-foreground hover:underline">
          Parts board
        </Link>
        <span>/</span>
        {subsystem && (
          <>
            <Link
              to={`/subsystems?s=${subsystem._id}`}
              className="hover:text-foreground hover:underline"
            >
              {subsystem.name}
            </Link>
            <span>/</span>
          </>
        )}
        <span className="font-mono text-foreground">{part.partNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="brand-title text-3xl">{part.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{part.partNumber}</span>
            {process && (
              <Chip className="bg-muted text-muted-foreground">
                {process.name}
              </Chip>
            )}
            {part.material && (
              <Chip className="bg-muted text-muted-foreground">
                {part.material}
              </Chip>
            )}
            <Chip className="bg-muted text-muted-foreground">
              Make {qtyLabel(part)}
            </Chip>
          </div>
        </div>
        {part.onshapeDocumentId && (
          <Button variant="outline" asChild>
            <a
              href={onshapeElementUrl(part) ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="gap-2"
            >
              Open in Onshape
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          </Button>
        )}
      </header>

      <StageStrip
        part={part}
        process={process}
        detail={stageDetail}
        className="rounded-lg border bg-card p-4 shadow-sm"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {/* What to do, right now. */}
          <section className="rounded-lg border-2 border-primary bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Right now
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {stageTask(stage, machine?.name)}
                </h2>
              </div>
              {isMentor && isClaimableStage(stage) ? (
                <AssigneePicker
                  value={part.claimedByUserId}
                  label="Who's on this part"
                  onChange={(userId) =>
                    void run(() => assign({ partId: part._id, userId }))
                  }
                />
              ) : claimant ? (
                <p className="text-sm text-muted-foreground">
                  {claimant.name} claimed this
                </p>
              ) : (
                isClaimableStage(stage) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!claimPermission.allowed}
                    title={
                      claimPermission.allowed
                        ? undefined
                        : claimPermission.reason
                    }
                    onClick={() => void run(() => claim({ partId: part._id }))}
                  >
                    Claim it
                  </Button>
                )
              )}
            </div>

            {machine?.requiresMentorPresent && stage === 3 && (
              <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                A mentor has to be in the room to run the {machine.name}. Safety
                glasses on.
              </p>
            )}

            {part.notesForMaker && (
              <p className="mt-3 text-sm text-muted-foreground">
                {part.notesForMaker}
              </p>
            )}

            <FlagChips flags={part.flags} className="mt-3" />

            {stage === 3 && (
              <div className="mt-4">
                <QtyCounter part={part} />
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {nextLabel && (
                <Button
                  size="lg"
                  disabled={!permission.allowed}
                  title={permission.allowed ? undefined : permission.reason}
                  onClick={() =>
                    void run(() => advancePart({ partId: part._id }))
                  }
                >
                  {nextLabel}
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                className="text-danger"
                onClick={() => setProblemOpen(true)}
              >
                Something went wrong
              </Button>
              {claimant?.authId === actor.userId && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => void run(() => unclaim({ partId: part._id }))}
                >
                  Put it back
                </Button>
              )}
            </div>

            {!permission.allowed && nextLabel && (
              <p className="mt-2 text-sm text-muted-foreground">
                {permission.reason}
              </p>
            )}
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </section>

          {isLead && (
            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="font-semibold">Lead controls</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Move this part anywhere, including back a stage.
              </p>
              <div className="mt-3 max-w-xs">
                <Select
                  value={String(stage)}
                  onValueChange={(value) =>
                    void run(() =>
                      moveTo({ partId: part._id, stage: Number(value) }),
                    )
                  }
                >
                  <SelectTrigger aria-label="Move to stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_LIST.map((s) => (
                      <SelectItem key={s.stage} value={String(s.stage)}>
                        {s.stage}. {stageLabel(s.stage)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>
          )}

          {openProblems.length > 0 && (
            <section className="rounded-lg border border-danger/40 bg-card p-4 shadow-sm">
              <h2 className="font-semibold text-danger">Open problems</h2>
              <ul className="mt-3 space-y-3">
                {openProblems.map((problem) => (
                  <li
                    key={problem._id}
                    className="flex flex-wrap gap-2 text-sm"
                  >
                    <span className="grow">
                      <span className="font-medium">
                        {problemLabel(problem.reason)}
                      </span>
                      {problem.qtyAffected > 0 && ` · ${problem.qtyAffected}`}
                      {problem.note && (
                        <span className="block text-muted-foreground">
                          {problem.note}
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {personName(problem.openedByUserId) ?? "Someone"} ·{" "}
                        {formatDay(problem._creationTime)}
                      </span>
                    </span>
                    {isLead && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void run(() =>
                            resolveProblem({ problemId: problem._id }),
                          )
                        }
                      >
                        Sorted
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Notes</h2>
            <div className="mt-3 space-y-4">
              {(notes ?? []).map((note) => (
                <div key={note._id} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
                    {initials(personName(note.userId))}
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
                  No notes yet. Questions, tips and problems go here.
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
                    await addNote({ partId: part._id, body: noteBody });
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
                    {event.note ??
                      `moved it to ${stageLabel(asStage(event.toStage))}`}
                    {event.fromStage !== event.toStage && !event.note && ""}
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

        {/* Right rail */}
        <aside className="space-y-4">
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">Files</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Drawings, DXFs and STLs come straight from Onshape — open the part
              there and export what you need.
            </p>
            {part.onshapeDocumentId ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-2"
                asChild
              >
                <a
                  href={onshapeElementUrl(part) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the CAD
                  <ExternalLinkIcon className="h-4 w-4" />
                </a>
              </Button>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No CAD linked yet.
              </p>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">From Onshape</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Subsystem" value={subsystem?.name} />
              <Row label="Revision" value={part.revision} />
              <Row
                label="Last synced"
                value={
                  part.lastSyncedAt ? formatDay(part.lastSyncedAt) : undefined
                }
              />
              <Row label="Material" value={part.material} />
              <Row label="On robot" value={qtyLabel(part)} />
              <Row label="Made" value={madeLabel(part)} />
            </dl>
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="font-semibold">People</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Designed" value={personName(part.designerUserId)} />
              <Row
                label="Drawing checked"
                value={personName(part.drawingCheckedByUserId)}
              />
              <Row label="Made" value={personName(part.makerUserId)} />
              <Row label="Assembled" value={personName(part.assemblerUserId)} />
              <Row
                label="Goes into"
                value={
                  subsystem
                    ? `${subsystem.name}${
                        subsystem.leadUserId
                          ? ` (lead: ${initials(personName(subsystem.leadUserId))})`
                          : ""
                      }`
                    : undefined
                }
              />
            </dl>
          </section>
        </aside>
      </div>

      <ProblemDialog
        part={part}
        open={problemOpen}
        onOpenChange={setProblemOpen}
      />
    </div>
  );
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
