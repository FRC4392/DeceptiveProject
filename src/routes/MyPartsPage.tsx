import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/tracker/PartCard";
import { STAGE_LIST, asStage, stageLabel } from "@/lib/stages";
import { useProcessMap } from "@/lib/tracker";
import { useRosterMap } from "@/lib/users";

/** Everything this person has claimed, in the order they'd work through it. */
export function MyPartsPage() {
  const mine = useQuery(api.parts.listMine, {});
  const processes = useProcessMap();
  const roster = useRosterMap();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">My parts</h1>
          <p className="text-sm text-muted-foreground">
            The parts you've claimed. Finish one before you take another.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/parts">Find more work</Link>
        </Button>
      </header>

      {mine === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mine.length === 0 ? (
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
        STAGE_LIST.map(({ stage }) => {
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
        })
      )}
    </div>
  );
}
