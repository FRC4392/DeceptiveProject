export type PartStatus =
  | "needs_design"
  | "in_design"
  | "designed"
  | "queued"
  | "in_progress"
  | "manufactured"
  | "qc"
  | "installed"
  | "scrapped";

export type Method =
  | "mill"
  | "lathe"
  | "3d_print"
  | "waterjet"
  | "laser_cut"
  | "cots";

// Pipeline order + badge colors. On-brand: a disciplined neutral -> blue ->
// semantic ramp built from role/status tokens (Deceiver Blue, one blue + neutrals),
// mirroring src/lib/pm.ts. Tokens swap automatically in dark mode — no dark: variants.
export const PART_STATUSES: {
  value: PartStatus;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: "needs_design",
    label: "Needs design",
    badgeClass: "bg-muted text-muted-foreground",
  },
  {
    value: "in_design",
    label: "In design",
    badgeClass: "bg-secondary text-secondary-foreground",
  },
  {
    value: "designed",
    label: "Designed",
    badgeClass: "bg-secondary text-secondary-foreground",
  },
  {
    value: "queued",
    label: "Queued",
    badgeClass: "bg-muted text-muted-foreground",
  },
  {
    value: "in_progress",
    label: "In progress",
    badgeClass: "bg-primary/10 text-primary",
  },
  {
    value: "manufactured",
    label: "Manufactured",
    badgeClass: "bg-info/10 text-info",
  },
  {
    value: "qc",
    label: "QC",
    badgeClass: "bg-warning/10 text-warning",
  },
  {
    value: "installed",
    label: "Installed",
    badgeClass: "bg-success/10 text-success",
  },
  {
    value: "scrapped",
    label: "Scrapped",
    badgeClass: "bg-danger/10 text-danger",
  },
];

export const METHODS: { value: Method; label: string }[] = [
  { value: "mill", label: "Mill" },
  { value: "lathe", label: "Lathe" },
  { value: "3d_print", label: "3D Print" },
  { value: "waterjet", label: "Waterjet" },
  { value: "laser_cut", label: "Laser Cut" },
  { value: "cots", label: "COTS" },
];

export function partStatusMeta(status: PartStatus) {
  return PART_STATUSES.find((s) => s.value === status) ?? PART_STATUSES[0];
}

export function partStatusLabel(status: PartStatus): string {
  return partStatusMeta(status).label;
}

export function methodLabel(method: Method): string {
  return METHODS.find((m) => m.value === method)?.label ?? method;
}

export function formatCost(cost?: number | null): string {
  if (cost == null) return "—";
  return `$${cost.toFixed(2)}`;
}
