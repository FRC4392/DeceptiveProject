import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PartSearch } from "@/components/tracker/PartSearch";
import { StageBar } from "@/components/tracker/StageStrip";
import { ProblemDialog } from "@/components/tracker/ProblemDialog";
import { QtyCounter } from "@/components/tracker/QtyCounter";
import { FlagChips } from "@/components/tracker/PartChips";
import {
  advanceLabel,
  asStage,
  canAdvance,
  canClaim,
  isClaimableStage,
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
import { errorText } from "@/lib/errors";

/**
 * The shop screen: what someone standing at a machine with a phone needs.
 * Type the number, see the one thing to do, record it, move on.
 */
export function ShopPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("p") as Id<"parts"> | null;

  const actor = useActor();
  const machines = useMachineMap();
  const processes = useProcessMap();
  const subsystems = useSubsystemMap();
  const mine = useQuery(api.parts.listMine, {});
  const part = useQuery(
    api.parts.get,
    selectedId ? { id: selectedId } : "skip",
  );

  const advance = useMutation(api.parts.advance);
  const claim = useMutation(api.parts.claim);
  const [problemOpen, setProblemOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-md space-y-4 pb-28">
      <header className="rounded-lg border bg-card p-4 shadow-sm">
        <p className="font-semibold">
          Hi {actor.name.split(" ")[0] || "there"}
        </p>
        <p className="text-sm text-muted-foreground">
          Type a part number to pick up where it's at.
        </p>
      </header>

      <div>
        <label
          htmlFor="shop-search"
          className="mb-1.5 block text-sm font-medium"
        >
          Part number
        </label>
        <PartSearch autoFocus={false} />
      </div>

      {!selectedId && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">My parts</h2>
          {mine === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing claimed. Find one on the{" "}
              <Link to="/parts" className="text-primary underline">
                board
              </Link>
              .
            </p>
          ) : (
            mine.map((p) => (
              <button
                key={p._id}
                type="button"
                onClick={() => setParams({ p: p._id })}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border bg-card px-3 text-left shadow-sm"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-xs text-muted-foreground">
                    {p.partNumber}
                  </span>
                  <span className="block truncate font-medium">{p.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.stage}. {stageLabel(asStage(p.stage))}
                </span>
              </button>
            ))
          )}
        </section>
      )}

      {part === null && selectedId && (
        <p className="text-sm text-muted-foreground">
          That part number isn't in the tracker.
        </p>
      )}

      {part && (
        <>
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">
              {subsystems.get(part.subsystemId)?.name}
            </p>
            <h2 className="mt-0.5 text-xl font-semibold">{part.name}</h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {part.partNumber}
              {part.revision ? ` · ${part.revision}` : ""}
            </p>
            <StageBar
              part={part}
              process={processes.get(part.processTypeId)}
              className="mt-3"
            />
            <p className="mt-2 text-sm font-semibold text-primary">
              Now: {part.stage}. {stageLabel(asStage(part.stage))}
            </p>
          </section>

          {(() => {
            const process = processes.get(part.processTypeId);
            const shape = toProcessShape(process);
            const stage = asStage(part.stage);
            const machine = process?.machineId
              ? machines.get(process.machineId)
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
            const label = advanceLabel(stage, shape);

            return (
              <>
                <section className="rounded-lg border bg-card p-4 shadow-sm">
                  <h3 className="font-semibold">
                    {stageTask(stage, machine?.name)}
                  </h3>

                  {machine?.requiresMentorPresent && stage === 3 && (
                    <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                      A mentor has to be in the room to run the {machine.name}.
                      Safety glasses on.
                    </p>
                  )}

                  <FlagChips flags={part.flags} className="mt-3" />

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-12" asChild>
                      <Link to={`/parts/${part._id}`}>Full part page</Link>
                    </Button>
                    {!part.claimedByUserId && isClaimableStage(stage) ? (
                      <Button
                        variant="outline"
                        className="h-12"
                        disabled={!claimPermission.allowed}
                        title={
                          claimPermission.allowed
                            ? undefined
                            : claimPermission.reason
                        }
                        onClick={() => {
                          setError(null);
                          claim({ partId: part._id }).catch((err: unknown) =>
                            setError(errorText(err, "No luck.")),
                          );
                        }}
                      >
                        Claim it
                      </Button>
                    ) : (
                      <Button variant="outline" className="h-12" asChild>
                        <Link to={`/subsystems?s=${part.subsystemId}`}>
                          Subsystem
                        </Link>
                      </Button>
                    )}
                  </div>

                  {stage === 3 && (
                    <div className="mt-3">
                      <QtyCounter part={part} />
                    </div>
                  )}

                  {!permission.allowed && label && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {permission.reason}
                    </p>
                  )}
                  {error && <p className="mt-2 text-sm text-danger">{error}</p>}
                </section>

                {/* Pinned to the bottom: the two things to press in the shop. */}
                <div className="fixed inset-x-0 bottom-0 z-20 space-y-2 border-t bg-background p-3">
                  <div className="mx-auto max-w-md space-y-2">
                    {label && (
                      <Button
                        className="h-14 w-full text-base"
                        disabled={!permission.allowed}
                        onClick={() => {
                          setError(null);
                          advance({ partId: part._id }).catch((err: unknown) =>
                            setError(errorText(err, "No luck.")),
                          );
                        }}
                      >
                        {label}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="h-12 w-full text-danger"
                      onClick={() => setProblemOpen(true)}
                    >
                      Something went wrong
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}

          <ProblemDialog
            part={part}
            open={problemOpen}
            onOpenChange={setProblemOpen}
          />
        </>
      )}
    </div>
  );
}
