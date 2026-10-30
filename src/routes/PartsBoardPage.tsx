import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/tracker/PartCard";
import { GetNumberDialog } from "@/components/tracker/GetNumberDialog";
import { FilterChip, FilterDivider } from "@/components/tracker/FilterChip";
import {
  STAGE_LIST,
  asStage,
  isClaimableStage,
  stageLabel,
  type Stage,
} from "@/lib/stages";
import { useProcessMap, useSubsystems } from "@/lib/tracker";
import { useIsLead } from "@/lib/roles";
import { useRosterMap } from "@/lib/users";
import { cn } from "@/lib/utils";

type Filter = "all" | "grabs" | "mine" | "flagged";

export function PartsBoardPage() {
  const season = useQuery(api.seasons.active, {});
  const parts = useQuery(api.parts.list, {});
  const subsystems = useSubsystems();
  const processes = useProcessMap();
  const roster = useRosterMap();
  const isLead = useIsLead();
  const headsUp = useQuery(api.parts.headsUp, isLead ? {} : "skip");
  const me = useQuery(api.auth.currentUser);

  const [subsystemId, setSubsystemId] = useState<Id<"subsystems"> | "all">(
    "all",
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [mobileStage, setMobileStage] = useState<Stage>(3);
  const [numberOpen, setNumberOpen] = useState(false);

  const visible = useMemo(() => {
    return (parts ?? []).filter((part) => {
      if (subsystemId !== "all" && part.subsystemId !== subsystemId)
        return false;
      if (filter === "grabs") {
        return !part.claimedByUserId && isClaimableStage(asStage(part.stage));
      }
      if (filter === "mine") return part.claimedByUserId === me?.id;
      if (filter === "flagged") return part.flags.length > 0;
      return true;
    });
  }, [parts, subsystemId, filter, me?.id]);

  const byStage = useMemo(() => {
    const map = new Map<Stage, typeof visible>();
    for (const { stage } of STAGE_LIST) map.set(stage, []);
    for (const part of visible) map.get(asStage(part.stage))?.push(part);
    return map;
  }, [visible]);

  if (season === null) {
    return <SetupPrompt />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">Robot parts</h1>
          <p className="text-sm text-muted-foreground">
            Every part from Onshape to the robot. Find one that says "Up for
            grabs" and claim it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/manufacturing">Find a part</Link>
          </Button>
          <Button onClick={() => setNumberOpen(true)}>Get a part number</Button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={subsystemId === "all"}
          onClick={() => setSubsystemId("all")}
        >
          All
        </FilterChip>
        {(subsystems ?? []).map((s) => (
          <FilterChip
            key={s._id}
            active={subsystemId === s._id}
            onClick={() => setSubsystemId(s._id)}
          >
            {s.name}
          </FilterChip>
        ))}
        <FilterDivider />
        <FilterChip
          active={filter === "grabs"}
          onClick={() => setFilter(filter === "grabs" ? "all" : "grabs")}
        >
          Up for grabs only
        </FilterChip>
        <FilterChip
          active={filter === "mine"}
          onClick={() => setFilter(filter === "mine" ? "all" : "mine")}
        >
          My parts
        </FilterChip>
        <FilterChip
          active={filter === "flagged"}
          onClick={() => setFilter(filter === "flagged" ? "all" : "flagged")}
        >
          Flagged
        </FilterChip>
      </div>

      {/* Under 600px one column at a time, with a sticky picker. */}
      <div className="sticky top-[6.5rem] z-10 -mx-4 overflow-x-auto bg-background px-4 py-2 sm:hidden">
        <div className="flex gap-2">
          {STAGE_LIST.map(({ stage }) => (
            <button
              key={stage}
              type="button"
              onClick={() => setMobileStage(stage)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm",
                mobileStage === stage
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card",
              )}
            >
              <span>
                {stage}. {stageLabel(stage)}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  mobileStage === stage
                    ? "bg-primary-foreground/20"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {byStage.get(stage)?.length ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-6 xl:overflow-visible">
        {STAGE_LIST.map(({ stage, blurb, movesOn }) => {
          const items = byStage.get(stage) ?? [];
          return (
            <section
              key={stage}
              className={cn(
                "w-full shrink-0 snap-start rounded-lg bg-muted/50 p-3 sm:w-72 xl:w-auto",
                mobileStage === stage ? "block" : "hidden sm:block",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  {stage}. {stageLabel(stage)}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {blurb} {movesOn}
              </p>

              <div className="mt-3 space-y-2">
                {items.map((part) => {
                  const claimant = part.claimedByUserId
                    ? roster[part.claimedByUserId]
                    : undefined;
                  return (
                    <PartCard
                      key={part._id}
                      part={part}
                      processName={processes.get(part.processTypeId)?.name}
                      claimantName={claimant?.name}
                    />
                  );
                })}
                {items.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nothing here.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {isLead && headsUp && headsUp.length > 0 && (
        <section className="rounded-lg border bg-card shadow-sm">
          <header className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-semibold">Heads up</h2>
            <span className="text-xs text-muted-foreground">
              For leads and mentors
            </span>
          </header>
          <ul className="divide-y">
            {headsUp.map((item, i) => (
              <li
                key={`${item.partId}-${item.kind}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-mono">{item.partNumber}</span>{" "}
                  {item.name} {item.detail}
                </span>
                <Link
                  to={`/parts/${item.partId}`}
                  className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
                >
                  {item.kind === "waiting_on_check"
                    ? "Check drawing"
                    : item.kind === "changed_after_made"
                      ? "Decide: keep or remake"
                      : "Open part"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <GetNumberDialog open={numberOpen} onOpenChange={setNumberOpen} />
    </div>
  );
}

/** Nothing works before a season exists, so say so plainly. */
export function SetupPrompt() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="brand-title text-2xl">No season set up yet</h1>
      <p className="text-sm text-muted-foreground">
        A mentor needs to set up this season's subsystems, machines and
        processes before parts can get numbers.
      </p>
      <Button asChild>
        <Link to="/admin">Open settings</Link>
      </Button>
    </div>
  );
}
