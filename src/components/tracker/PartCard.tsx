import { Link } from "react-router-dom";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Chip, FlagChips, PersonChip } from "@/components/tracker/PartChips";
import { madeLabel, qtyLabel } from "@/lib/stages";

/**
 * One part on the board. Reads top-down the way someone scanning for work
 * does: number, what it is, how it's made, then who has it.
 */
export function PartCard({
  part,
  processName,
  claimantName,
  claimantRole,
}: {
  part: Doc<"parts">;
  processName?: string;
  claimantName?: string;
  claimantRole?: string;
}) {
  const showMade = part.stage >= 3;
  return (
    <Link
      to={`/parts/${part._id}`}
      className="block rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="whitespace-nowrap font-mono text-sm font-medium">
          {part.partNumber}
        </span>
        <span className="text-right text-xs text-muted-foreground">
          {showMade ? madeLabel(part) : `Need ${qtyLabel(part)}`}
        </span>
      </div>

      <p className="mt-1 text-sm font-semibold leading-snug">{part.name}</p>

      {processName && (
        <div className="mt-2">
          <Chip className="bg-muted text-muted-foreground">{processName}</Chip>
        </div>
      )}

      <FlagChips flags={part.flags} className="mt-2" />

      <div className="mt-3 border-t pt-2">
        <PersonChip
          name={claimantName}
          role={claimantRole}
          emptyLabel={
            part.stage === 3 || part.stage === 4 ? "Up for grabs" : null
          }
        />
      </div>
    </Link>
  );
}
