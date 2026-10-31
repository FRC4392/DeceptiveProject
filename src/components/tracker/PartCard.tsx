import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Chip, FlagChips } from "@/components/tracker/PartChips";
import { ClaimLine } from "@/components/tracker/ClaimLine";
import { asStage, isClaimableStage, madeLabel, qtyLabel } from "@/lib/stages";
import { useCurrentUserId } from "@/lib/roles";

/**
 * One part on the board. Reads top-down the way someone scanning for work
 * does: number, what it is, how it's made, then who has it.
 *
 * The body is the link and the claim row isn't, so picking a part up doesn't
 * navigate away from the column you're working through — and so the button
 * isn't a control nested inside a link.
 */
export function PartCard({
  part,
  processName,
  claimantName,
}: {
  part: Doc<"parts">;
  processName?: string;
  claimantName?: string;
}) {
  const currentUserId = useCurrentUserId();
  const claim = useMutation(api.parts.claim);
  const unclaim = useMutation(api.parts.unclaim);
  const showMade = part.stage >= 3;
  const claimable = isClaimableStage(asStage(part.stage));

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/40">
      <Link to={`/parts/${part._id}`} className="block">
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
            <Chip className="bg-muted text-muted-foreground">
              {processName}
            </Chip>
          </div>
        )}

        <FlagChips flags={part.flags} className="mt-2" />
      </Link>

      <ClaimLine
        claimantName={
          part.claimedByUserId ? (claimantName ?? "Someone") : undefined
        }
        mine={part.claimedByUserId === currentUserId}
        closed={!claimable}
        onClaim={() => claim({ partId: part._id })}
        onRelease={() => unclaim({ partId: part._id })}
      />
    </div>
  );
}
