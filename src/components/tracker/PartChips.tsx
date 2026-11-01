import type { Doc } from "../../../convex/_generated/dataModel";
import { flagChip } from "@/lib/stages";
import { cn } from "@/lib/utils";

/** A small labelled chip. Colour never carries meaning on its own. */
export function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function FlagChips({
  flags,
  className,
}: {
  flags: Doc<"parts">["flags"];
  className?: string;
}) {
  if (flags.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {flags.map((flag, i) => {
        const chip = flagChip(flag);
        return (
          <Chip key={`${flag.kind}-${i}`} className={chip.className}>
            {chip.label}
          </Chip>
        );
      })}
    </div>
  );
}
