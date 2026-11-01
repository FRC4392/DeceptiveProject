import type { Doc } from "../../../convex/_generated/dataModel";
import {
  STAGE_LIST,
  STAGE_UI,
  asStage,
  isStageSkipped,
  stageLabel,
  toProcessShape,
} from "@/lib/stages";
import { cn } from "@/lib/utils";

/**
 * The six-step indicator. Stages this part's process skips are drawn faint and
 * struck through rather than hidden, so a 3D print and a milled part still
 * read as the same journey.
 */
export function StageStrip({
  part,
  process,
  detail,
  className,
}: {
  part: Doc<"parts">;
  process: Doc<"processTypes"> | undefined;
  /** Optional caption under each step, e.g. "Jan 25 · checked by MJ". */
  detail?: (stage: number) => string | undefined;
  className?: string;
}) {
  const shape = toProcessShape(process);
  const current = asStage(part.stage);

  return (
    <ol
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6",
        className,
      )}
    >
      {STAGE_LIST.map(({ stage }) => {
        const skipped = isStageSkipped(stage, shape);
        const done = stage < current;
        const active = stage === current;
        return (
          <li key={stage} className="min-w-0">
            <div
              className={cn(
                "h-1.5 w-full rounded-full",
                active
                  ? STAGE_UI[current].bar
                  : done
                    ? "bg-foreground"
                    : "bg-border",
              )}
            />
            <p
              className={cn(
                "mt-2 truncate text-sm font-semibold",
                active && "text-primary",
                skipped && "text-muted-foreground line-through",
              )}
            >
              {stage}. {stageLabel(stage)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {skipped ? "not needed" : (detail?.(stage) ?? "—")}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** The compact bar used on the shop screen and search results. */
export function StageBar({
  part,
  process,
  className,
}: {
  part: Doc<"parts">;
  process: Doc<"processTypes"> | undefined;
  className?: string;
}) {
  const shape = toProcessShape(process);
  const current = asStage(part.stage);
  return (
    <div className={cn("flex gap-1.5", className)} aria-hidden="true">
      {STAGE_LIST.map(({ stage }) => (
        <span
          key={stage}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            stage === current
              ? STAGE_UI[current].bar
              : stage < current
                ? "bg-foreground"
                : isStageSkipped(stage, shape)
                  ? "bg-border/50"
                  : "bg-border",
          )}
        />
      ))}
    </div>
  );
}
