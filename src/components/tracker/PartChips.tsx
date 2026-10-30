import type { Doc } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { flagChip, initials } from "@/lib/stages";
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

/** Someone's initials, or "Up for grabs" when nobody has claimed the part. */
export function PersonChip({
  name,
  role,
  emptyLabel = "Up for grabs",
}: {
  name?: string;
  role?: string;
  emptyLabel?: string | null;
}) {
  if (!name) {
    return emptyLabel ? (
      <span className="text-xs font-semibold text-primary">{emptyLabel}</span>
    ) : null;
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="bg-foreground text-[10px] text-background">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-xs text-muted-foreground">
        {role ?? name}
      </span>
    </span>
  );
}
