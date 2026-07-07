import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PartStatusBadge } from "@/components/pm/PartStatusBadge";
import { PartFormDialog } from "@/components/pm/PartFormDialog";
import {
  METHODS,
  PART_STATUSES,
  formatCost,
  methodLabel,
  type Method,
  type PartStatus,
} from "@/lib/parts";
import { useRosterMap } from "@/lib/users";
import { useActiveProject } from "@/lib/project";
import { cn } from "@/lib/utils";
import { DownloadIcon } from "@radix-ui/react-icons";
import { useState } from "react";

type CotsFilter = "all" | "cots" | "fabricated";

function downloadBOM(
  rows: {
    partNumber: string;
    name: string;
    material: string;
    quantityNeeded: number;
    manufacturingMethod: string;
    status: string;
    isCOTS: boolean;
    vendor: string;
    vendorPartNumber: string;
    cost: number | null;
    leadTime: string;
    orderStatus: string;
  }[],
) {
  const headers = [
    "Part #",
    "Name",
    "Material",
    "Qty",
    "Method",
    "Status",
    "COTS",
    "Vendor",
    "Vendor Part #",
    "Cost",
    "Lead Time",
    "Order Status",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.partNumber,
        r.name,
        r.material,
        r.quantityNeeded,
        r.manufacturingMethod,
        r.status,
        r.isCOTS ? "yes" : "no",
        r.vendor,
        r.vendorPartNumber,
        r.cost ?? "",
        r.leadTime,
        r.orderStatus,
      ]
        .map(esc)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deceivers-bom-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PartsPage() {
  const [statusFilter, setStatusFilter] = useState<PartStatus | "all">("all");
  const [methodFilter, setMethodFilter] = useState<Method | "all">("all");
  const [cotsFilter, setCotsFilter] = useState<CotsFilter>("all");

  const { activeProjectId } = useActiveProject();
  const projectId = activeProjectId ?? undefined;
  const parts = useQuery(api.parts.list, {
    status: statusFilter === "all" ? undefined : statusFilter,
    manufacturingMethod: methodFilter === "all" ? undefined : methodFilter,
    isCOTS:
      cotsFilter === "all" ? undefined : cotsFilter === "cots" ? true : false,
    projectId,
  });
  const bom = useQuery(api.parts.exportBOM, { projectId });
  const roster = useRosterMap();
  const updateStatus = useMutation(api.parts.updateStatus);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">Parts</h1>
          <p className="text-sm text-muted-foreground">
            Every fabricated and COTS part, from design to installed.{" "}
            <Link to="/inventory" className="underline hover:text-foreground">
              Inventory →
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!bom || bom.length === 0}
            onClick={() => bom && downloadBOM(bom)}
          >
            <DownloadIcon className="mr-1.5 h-4 w-4" /> Export BOM
          </Button>
          <PartFormDialog trigger={<Button>New part</Button>} />
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as PartStatus | "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PART_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={methodFilter}
          onValueChange={(v) => setMethodFilter(v as Method | "all")}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex rounded-md border p-0.5">
          {(["all", "fabricated", "cots"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setCotsFilter(f)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
                cotsFilter === f
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "all" ? "All" : f === "cots" ? "COTS" : "Fabricated"}
            </button>
          ))}
        </div>
      </div>

      <Tabs defaultValue="table">
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="kanban">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="table">
          {parts === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : parts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parts match.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part #</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parts.map((part) => (
                    <TableRow key={part._id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {part.partNumber ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/parts/${part._id}`}
                          className="font-medium hover:underline"
                        >
                          {part.name}
                        </Link>
                        {part.blocked && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-[10px] text-danger"
                          >
                            Blocked
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {methodLabel(part.manufacturingMethod)}
                      </TableCell>
                      <TableCell>
                        <PartStatusBadge status={part.status} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {part.quantityNeeded}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {part.assigneeId
                          ? (roster[part.assigneeId]?.name ?? "—")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatCost(part.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="kanban">
          {parts === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {PART_STATUSES.map((col) => {
                const colParts = parts.filter((p) => p.status === col.value);
                return (
                  <div
                    key={col.value}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (id)
                        void updateStatus({
                          id: id as Id<"parts">,
                          status: col.value,
                        });
                    }}
                    className="flex w-56 shrink-0 flex-col gap-2 rounded-lg bg-muted/30 p-2"
                  >
                    <div className="flex items-center justify-between px-1 py-1">
                      <PartStatusBadge status={col.value} />
                      <span className="text-xs text-muted-foreground">
                        {colParts.length}
                      </span>
                    </div>
                    {colParts.map((part) => (
                      <PartKanbanCard key={part._id} part={part} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PartKanbanCard({ part }: { part: Doc<"parts"> }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", part._id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <Link
        to={`/parts/${part._id}`}
        draggable={false}
        className="block rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:border-primary/50"
      >
        <p className="text-sm font-medium leading-snug">{part.name}</p>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {methodLabel(part.manufacturingMethod)}
          </span>
          {part.blocked && (
            <span className="text-[10px] font-medium text-danger">Blocked</span>
          )}
        </div>
      </Link>
    </div>
  );
}
