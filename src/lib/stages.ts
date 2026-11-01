// The UI half of the stage model: labels, chip colours and the small bits of
// formatting the screens share. The rules themselves — what comes next, who
// may move it — come straight from the server's module so the two can't drift.
import type { Doc } from "../../convex/_generated/dataModel";
import {
  STAGES,
  stageLabel,
  type Stage,
  type ProcessShape,
} from "../../convex/lib/stages";

export * from "../../convex/lib/stages";

export type PartDoc = Doc<"parts">;
export type FlagKind = PartDoc["flags"][number]["kind"];

/**
 * Chip colours per stage, built from the brand's semantic tokens so both
 * themes come out right with no `dark:` variants.
 */
export const STAGE_UI: Record<
  Stage,
  { chip: string; bar: string; dot: string }
> = {
  1: {
    chip: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/40",
    dot: "bg-muted-foreground/40",
  },
  2: {
    chip: "bg-info/10 text-info",
    bar: "bg-info",
    dot: "bg-info",
  },
  3: {
    chip: "bg-primary/10 text-primary",
    bar: "bg-primary",
    dot: "bg-primary",
  },
  4: {
    chip: "bg-warning/10 text-warning",
    bar: "bg-warning",
    dot: "bg-warning",
  },
  5: {
    chip: "bg-success/10 text-success",
    bar: "bg-success",
    dot: "bg-success",
  },
  6: {
    chip: "bg-success text-white",
    bar: "bg-success",
    dot: "bg-success",
  },
};

/** Shorter column words for the board, where the number carries the order. */
export const STAGE_SHORT: Record<Stage, string> = {
  1: "In design",
  2: "Needs drawing",
  3: "Ready to make",
  4: "Ready to finish",
  5: "Ready to assemble",
  6: "Assembled",
};

export const STAGE_LIST = STAGES;

export function flagChip(flag: PartDoc["flags"][number]): {
  label: string;
  className: string;
} {
  switch (flag.kind) {
    case "changed_after_made":
      return {
        label: flag.note ?? "CAD changed after it was made",
        className: "bg-warning/10 text-warning",
      };
    case "drawing_out_of_date":
      return {
        label: flag.note ?? "Drawing out of date",
        className: "bg-info/10 text-info",
      };
    case "remake":
      return {
        label: flag.qty
          ? `Remake ${flag.qty}${flag.note ? `: ${flag.note}` : ""}`
          : `Remake${flag.note ? `: ${flag.note}` : ""}`,
        className: "bg-danger/10 text-danger",
      };
    case "waiting":
      return {
        label: flag.note ?? "Waiting",
        className: "bg-info/10 text-info",
      };
  }
}

export const PROBLEM_REASONS: { value: string; label: string }[] = [
  { value: "broke", label: "It broke" },
  { value: "scrapped", label: "I scrapped it" },
  { value: "out_of_material", label: "Ran out of material" },
  { value: "wrong_size", label: "It came out the wrong size" },
  { value: "unsure", label: "I'm not sure what to do" },
  { value: "other", label: "Something else" },
];

export function problemLabel(reason: string): string {
  return (
    PROBLEM_REASONS.find((r) => r.value === reason)?.label ??
    reason.replace(/_/g, " ")
  );
}

/** "AK" — the avatar initials used everywhere a person appears. */
export function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** "2 + 1 spare" / "2" — how many of this part the robot needs. */
export function qtyLabel(
  part: Pick<PartDoc, "qtyNeeded" | "qtySpares">,
): string {
  return part.qtySpares > 0
    ? `${part.qtyNeeded} + ${part.qtySpares} spare`
    : `${part.qtyNeeded}`;
}

/** "4 of 8" — progress against the full target including spares. */
export function madeLabel(
  part: Pick<PartDoc, "qtyMade" | "qtyNeeded" | "qtySpares">,
): string {
  return `${part.qtyMade} of ${part.qtyNeeded + part.qtySpares}`;
}

export function stageChipLabel(stage: Stage): string {
  return `${stage}. ${stageLabel(stage)}`;
}

/** Processes come back as documents; the rules want just the three fields. */
export function toProcessShape(
  process: Doc<"processTypes"> | undefined,
): ProcessShape {
  return {
    needsDrawing: process?.needsDrawing ?? true,
    needsFinishing: process?.needsFinishing ?? true,
    machineId: process?.machineId ?? null,
  };
}

export function formatCost(cost?: number | null): string {
  if (cost == null) return "—";
  return `$${cost.toFixed(2)}`;
}
