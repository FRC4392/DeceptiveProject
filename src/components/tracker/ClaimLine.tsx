import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/stages";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";

/**
 * The words for picking work up. One copy of them, because a part saying "Up
 * for grabs" while a to-do said "Nobody on it" and a sub-assembly offered
 * "I'll do it" made four lists feel like four apps.
 *
 * "Up for grabs" is the handoff's own wording for an unclaimed card (§6.1),
 * so that's the one everything else was changed to match.
 */
export const CLAIM_COPY = {
  nobody: "Up for grabs",
  claim: "I'll do it",
  release: "Put it back",
} as const;

/**
 * The bottom row of every card that can be picked up: who has it, or that
 * nobody does, and the one button that settles it.
 *
 * Deliberately dumb — it holds no mutation of its own, because the four
 * things that use it claim through four different tables. It takes handlers
 * and reports what went wrong.
 */
export function ClaimLine({
  claimantName,
  mine = false,
  onClaim,
  onRelease,
  closed = false,
  claimedVerb,
  children,
  className,
}: {
  /** Whoever has it. Undefined means nobody does. */
  claimantName?: string;
  /** Whether the person looking at it is the one who has it. */
  mine?: boolean;
  /** Omit to show the state without offering to change it. */
  onClaim?: () => Promise<unknown> | void;
  onRelease?: () => Promise<unknown> | void;
  /**
   * Finished, closed, or past the point of being someone's job. A closed card
   * still says who did it, but stops asking for a volunteer.
   */
  closed?: boolean;
  /** Overrides the name, e.g. "built it" once a sub-assembly is done. */
  claimedVerb?: string;
  /** Anything else belonging on this row, placed after the claim buttons. */
  children?: React.ReactNode;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function run(action: (() => Promise<unknown> | void) | undefined) {
    return (event: React.MouseEvent) => {
      // These rows sit inside cards whose body is a link. Without this, "I'll
      // do it" would also navigate away from the list you're triaging.
      event.preventDefault();
      event.stopPropagation();
      if (!action) return;
      setError(null);
      setBusy(true);
      void Promise.resolve(action())
        .catch((err: unknown) => setError(errorText(err, "That didn't work.")))
        .finally(() => setBusy(false));
    };
  }

  const claimed = claimantName !== undefined;
  // Nothing to say and nothing to offer: don't draw an empty bordered row.
  // `children` is often a list of conditionals that all came out false, which
  // is still a truthy array — so look for something that would actually
  // render rather than just at whether the prop was passed.
  const hasExtras = Array.isArray(children)
    ? children.some(Boolean)
    : Boolean(children);
  if (!claimed && closed && !hasExtras) return null;

  return (
    <div className={cn("mt-3 border-t pt-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {claimed ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar className="h-6 w-6 shrink-0">
              <AvatarFallback className="bg-foreground text-[10px] text-background">
                {initials(claimantName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-xs text-muted-foreground">
              {claimedVerb ?? claimantName}
            </span>
          </span>
        ) : (
          !closed && (
            <span className="text-xs font-semibold text-primary">
              {CLAIM_COPY.nobody}
            </span>
          )
        )}

        <span className="ml-auto flex shrink-0 gap-1.5">
          {!closed && !claimed && onClaim && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={run(onClaim)}
            >
              {CLAIM_COPY.claim}
            </Button>
          )}
          {!closed && mine && onRelease && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={run(onRelease)}
            >
              {CLAIM_COPY.release}
            </Button>
          )}
          {children}
        </span>
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
