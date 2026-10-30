import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/tracker/PartCard";
import { Chip } from "@/components/tracker/PartChips";
import { onshapeElementUrl } from "../../convex/lib/onshapeLinks";
import { STAGE_LIST, asStage, stageLabel } from "@/lib/stages";
import { useProcessMap } from "@/lib/tracker";
import { useRosterMap } from "@/lib/users";
import { cn } from "@/lib/utils";

/** Everything this person has picked up — sub-assemblies first, then parts. */
export function MyPartsPage() {
  const mine = useQuery(api.parts.listMine, {});
  const myAssemblies = useQuery(api.subAssemblies.listMine, {});
  const processes = useProcessMap();
  const roster = useRosterMap();

  const nothing =
    mine !== undefined &&
    myAssemblies !== undefined &&
    mine.length === 0 &&
    myAssemblies.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">My parts</h1>
          <p className="text-sm text-muted-foreground">
            The parts and sub-assemblies you've claimed. Finish one before you
            take another.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/parts">Find more work</Link>
        </Button>
      </header>

      {mine === undefined || myAssemblies === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : nothing ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">Nothing claimed yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The board shows what's up for grabs.
          </p>
          <Button className="mt-4" asChild>
            <Link to="/parts">Open the board</Link>
          </Button>
        </div>
      ) : (
        <>
          {myAssemblies.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Sub-assemblies</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {myAssemblies.map(
                  ({ assembly, subsystemName, ready, summary }) => {
                    const done = assembly.completedAt !== undefined;
                    const cadUrl = onshapeElementUrl(assembly);
                    return (
                      <div
                        key={assembly._id}
                        className={cn(
                          "rounded-lg border bg-card p-3 shadow-sm",
                          done
                            ? "border-success bg-success/10"
                            : ready && "border-success/40 bg-success/5",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="whitespace-nowrap font-mono text-sm font-medium">
                            {assembly.partNumber}
                          </span>
                          <Chip
                            className={
                              done || ready
                                ? "bg-success/10 text-success"
                                : "bg-muted text-muted-foreground"
                            }
                          >
                            {done ? "Done" : ready ? "Go" : "Waiting"}
                          </Chip>
                        </div>
                        <p className="mt-1 text-sm font-semibold leading-snug">
                          {assembly.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {summary}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-2">
                          <Link
                            to={`/subsystems?s=${assembly.subsystemId}`}
                            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {subsystemName || "Open subsystem"} →
                          </Link>
                          {cadUrl && (
                            <a
                              href={cadUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                            >
                              CAD
                              <ExternalLinkIcon className="h-3 w-3" />
                            </a>
                          )}
                          {assembly.drawingUrl && (
                            <a
                              href={assembly.drawingUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                            >
                              Drawing
                              <ExternalLinkIcon className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </section>
          )}

          {STAGE_LIST.map(({ stage }) => {
            const items = mine.filter((p) => asStage(p.stage) === stage);
            if (items.length === 0) return null;
            return (
              <section key={stage} className="space-y-3">
                <h2 className="text-sm font-semibold">
                  {stage}. {stageLabel(stage)}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((part) => (
                    <PartCard
                      key={part._id}
                      part={part}
                      processName={processes.get(part.processTypeId)?.name}
                      claimantName={
                        part.claimedByUserId
                          ? roster[part.claimedByUserId]?.name
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
