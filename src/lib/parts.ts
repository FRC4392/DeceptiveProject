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

// Pipeline order + badge colors. Fabrication stages use blue shades (on-brand);
// QC/installed/scrapped use status colors. All have dark-mode variants.
export const PART_STATUSES: {
  value: PartStatus;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: "needs_design",
    label: "Needs design",
    badgeClass:
      "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
  },
  {
    value: "in_design",
    label: "In design",
    badgeClass:
      "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  },
  {
    value: "designed",
    label: "Designed",
    badgeClass:
      "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  },
  {
    value: "queued",
    label: "Queued",
    badgeClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    value: "in_progress",
    label: "In progress",
    badgeClass:
      "bg-blue-600/15 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
  {
    value: "manufactured",
    label: "Manufactured",
    badgeClass:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  },
  {
    value: "qc",
    label: "QC",
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  {
    value: "installed",
    label: "Installed",
    badgeClass:
      "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  },
  {
    value: "scrapped",
    label: "Scrapped",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
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
