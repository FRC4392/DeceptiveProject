import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { FilterChip, FilterDivider } from "@/components/tracker/FilterChip";
import {
  BoughtItemDetail,
  BoughtItemDialog,
} from "@/components/tracker/BoughtItem";
import { COTS_STATUSES, cotsStatusLabel, type CotsStatus } from "@/lib/cots";
import { useIsLead } from "@/lib/roles";
import { useSubsystems } from "@/lib/tracker";
import { cn } from "@/lib/utils";

/** What each column means, and what moves something out of it. */
const BLURB: Record<CotsStatus, string> = {
  needed: "Nobody has bought these yet.",
  ordered: "On their way. Mark them when they turn up.",
  arrived: "In the shop, and ready to go on.",
};

/**
 * Everything the team buys, across every subsystem, laid out like the parts
 * board. Ordering is one person's job for an afternoon, and doing it from the
 * subsystem pages meant opening five of them to find out what to buy.
 */
export function OrderingPage() {
  const items = useQuery(api.cots.list, {});
  const subsystems = useSubsystems();
  const isLead = useIsLead();
  const [subsystemId, setSubsystemId] = useState<Id<"subsystems"> | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<Id<"cotsItems"> | null>(null);
  const [mobileStatus, setMobileStatus] = useState<CotsStatus>("needed");

  const subsystemName = useMemo(
    () => new Map((subsystems ?? []).map((s) => [s._id, s.name])),
    [subsystems],
  );

  const shown = (items ?? []).filter(
    (item) => subsystemId === null || item.subsystemId === subsystemId,
  );
  const byStatus = new Map<CotsStatus, Doc<"cotsItems">[]>();
  for (const { value } of COTS_STATUSES) byStatus.set(value, []);
  for (const item of shown) byStatus.get(item.status)?.push(item);

  // Looked up rather than kept: the modal has to show the move it just made.
  const open = (items ?? []).find((item) => item._id === openId) ?? null;

  const outstanding =
    (byStatus.get("needed")?.length ?? 0) +
    (byStatus.get("ordered")?.length ?? 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">Ordering</h1>
          <p className="text-sm text-muted-foreground">
            Everything the team buys rather than makes.{" "}
            {items === undefined
              ? ""
              : outstanding === 0
                ? "Nothing outstanding."
                : `${outstanding} still to come.`}
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>Add a bought item</Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={subsystemId === null}
          onClick={() => setSubsystemId(null)}
        >
          Everything
        </FilterChip>
        <FilterDivider />
        {(subsystems ?? []).map((sub) => (
          <FilterChip
            key={sub._id}
            active={subsystemId === sub._id}
            onClick={() =>
              setSubsystemId(subsystemId === sub._id ? null : sub._id)
            }
          >
            {sub.name}
          </FilterChip>
        ))}
      </div>

      {/* Under 600px one column at a time, the way the parts board does it. */}
      <div className="-mx-4 overflow-x-auto px-4 py-1 sm:hidden">
        <div className="flex gap-2">
          {COTS_STATUSES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMobileStatus(value)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm",
                mobileStatus === value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card",
              )}
            >
              <span>{label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  mobileStatus === value
                    ? "bg-primary-foreground/20"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {byStatus.get(value)?.length ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {items === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">Nothing bought yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Bought items get no part number — they're tracked by name, and count
            as ready once they arrive.
          </p>
          <Button className="mt-4" onClick={() => setAdding(true)}>
            Add a bought item
          </Button>
        </div>
      ) : (
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
          {COTS_STATUSES.map(({ value, label }) => {
            const column = byStatus.get(value) ?? [];
            return (
              <section
                key={value}
                className={cn(
                  "w-full shrink-0 snap-start rounded-lg bg-muted/50 p-3 sm:w-auto",
                  mobileStatus === value ? "block" : "hidden sm:block",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{label}</h2>
                  <span className="text-sm text-muted-foreground">
                    {column.length}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {BLURB[value]}
                </p>

                <div className="mt-3 space-y-2">
                  {column.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => setOpenId(item._id)}
                      className="block w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/40"
                    >
                      <span className="block font-medium leading-snug">
                        {item.name}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {subsystemName.get(item.subsystemId) ?? "—"} · need{" "}
                        {item.qtyNeeded}
                        {item.unit ? ` ${item.unit}` : ""}
                        {item.vendor ? ` · ${item.vendor}` : ""}
                      </span>
                      {item.status === "ordered" && item.eta && (
                        <span className="mt-1 block text-xs text-info">
                          {cotsStatusLabel(item)}
                        </span>
                      )}
                    </button>
                  ))}
                  {column.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      Nothing here.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <BoughtItemDialog
        open={adding}
        onOpenChange={setAdding}
        subsystemId={subsystemId ?? undefined}
      />

      {open && (
        <BoughtItemDetail
          item={open}
          subsystemName={subsystemName.get(open.subsystemId)}
          open
          onOpenChange={(next) => !next && setOpenId(null)}
          canEdit={isLead}
        />
      )}
    </div>
  );
}
