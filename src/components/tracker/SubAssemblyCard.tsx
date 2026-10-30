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
import { initials } from "@/lib/stages";
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
  currentUserId,
}: {
  assembly: Doc<"subAssemblies">;
  status: AssemblyStatus;
  claimantName?: string;
  /** Installing is the subsystem lead's or a mentor's call. */
  canComplete: boolean;
  completeReason?: string;
  isLead: boolean;
  currentUserId: string | null;
}) {
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
      <p className="mt-1 font-medium">{assembly.name}</p>
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

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2">
        {assembly.claimedByUserId ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[9px] font-semibold text-background">
              {initials(claimantName)}
            </span>
            {status.done ? "built it" : "on it"}
          </span>
        ) : (
          !status.done && (
            <span className="text-xs font-semibold text-primary">
              Nobody on it
            </span>
          )
        )}

        <span className="ml-auto flex gap-1.5">
          {!status.done && !assembly.claimedByUserId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(claim({ id: assembly._id }))}
            >
              I'll do it
            </Button>
          )}
          {!status.done && mine && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(unclaim({ id: assembly._id }))}
            >
              Put back
            </Button>
          )}
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
        </span>
      </div>

      {!canComplete && status.ready && !status.done && completeReason && (
        <p className="mt-2 text-xs text-muted-foreground">{completeReason}</p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
