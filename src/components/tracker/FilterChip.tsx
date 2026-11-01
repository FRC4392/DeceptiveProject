import { cn } from "@/lib/utils";

/**
 * The pill filter the board, the to-do list and the issue list all use. Big
 * enough to hit with a glove on (44px) before the layout tightens up.
 */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-full border px-4 text-sm transition-colors sm:min-h-9",
        active
          ? "border-transparent bg-foreground text-background"
          : "bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** The thin divider between one group of filters and the next. */
export function FilterDivider() {
  return <span className="mx-1 hidden h-6 w-px bg-border sm:block" />;
}
