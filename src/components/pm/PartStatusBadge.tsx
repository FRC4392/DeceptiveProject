import { cn } from "@/lib/utils";
import { partStatusMeta, type PartStatus } from "@/lib/parts";

export function PartStatusBadge({ status }: { status: PartStatus }) {
  const meta = partStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        meta.badgeClass,
      )}
    >
      {meta.label}
    </span>
  );
}
