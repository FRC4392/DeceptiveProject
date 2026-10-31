import { useState } from "react";
import { useMutation } from "convex/react";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  blockingSummary,
  type AssemblyStatus,
} from "../../../convex/lib/assembly";
import { onshapeElementUrl } from "../../../convex/lib/onshapeLinks";
import { ClaimLine } from "@/components/tracker/ClaimLine";
import { useCurrentUserId } from "@/lib/roles";
import { cn } from "@/lib/utils";

/**
 * One sub-assembly: whether it can go together, what to build it from, who has
 * it, and the button that puts its parts on the robot.
 */
export function SubAssemblyCard({
  assembly,
  status,
  claimantName,
  canComplete,
  completeReason,
  isLead,
  units,
}: {
  assembly: Doc<"subAssemblies">;
  status: AssemblyStatus;
  claimantName?: string;
  /** Installing is the subsystem lead's or a mentor's call. */
  canComplete: boolean;
  completeReason?: string;
  isLead: boolean;
  /** Whole units the robot needs, once placements are multiplied out. */
  units?: number;
}) {
  const currentUserId = useCurrentUserId();
  const claim = useMutation(api.subAssemblies.claim);
  const unclaim = useMutation(api.subAssemblies.unclaim);
  const complete = useMutation(api.subAssemblies.complete);
  const reopen = useMutation(api.subAssemblies.reopen);
  const [error, setError] = useState<string | null>(null);

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "That didn't work."),
    );
  }

  const mine = assembly.claimedByUserId === currentUserId;
  const cadUrl = onshapeElementUrl(assembly);

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        status.done
          ? "border-success bg-success/10"
          : status.ready
            ? "border-success/40 bg-success/5"
            : "bg-background",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {assembly.partNumber}
        </span>
        <span
          className={cn(
            "text-xs font-semibold",
            status.ready ? "text-success" : "text-muted-foreground",
          )}
        >
          {status.done ? "Done" : status.ready ? "Go" : "Waiting"}
        </span>
      </div>
      <p className="mt-1 font-medium">
        {assembly.name}
        {units !== undefined && units > 1 && (
          // Two rollers on the robot is not the same job as one, and the
          // number comes from the CAD rather than from anyone's memory.
          <span className="ml-1.5 text-xs font-semibold text-primary">
            build {units}
            {(assembly.qtySpares ?? 0) > 0 && ` (${assembly.qtySpares} spare)`}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {blockingSummary(status)}
      </p>

      {(cadUrl || assembly.drawingUrl) && (
        <div className="mt-2 flex flex-wrap gap-3">
          {cadUrl && (
            <a
              href={cadUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Assembly CAD
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
          {assembly.drawingUrl && (
            <a
              href={assembly.drawingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Assembly drawing
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      <ClaimLine
        claimantName={
          assembly.claimedByUserId ? (claimantName ?? "Someone") : undefined
        }
        mine={mine}
        closed={status.done}
        claimedVerb={
          status.done ? `${claimantName ?? "Someone"} built it` : undefined
        }
        onClaim={() => claim({ id: assembly._id })}
        onRelease={() => unclaim({ id: assembly._id })}
      >
        {!status.done && status.ready && (
          <Button
            size="sm"
            disabled={!canComplete}
            title={canComplete ? undefined : completeReason}
            onClick={() => run(complete({ id: assembly._id }))}
          >
            Done — it's on the robot
          </Button>
        )}
        {status.done && isLead && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(reopen({ id: assembly._id }))}
          >
            Reopen
          </Button>
        )}
      </ClaimLine>

      {!canComplete && status.ready && !status.done && completeReason && (
        <p className="mt-2 text-xs text-muted-foreground">{completeReason}</p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
