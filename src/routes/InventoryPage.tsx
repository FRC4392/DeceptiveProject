import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMentor } from "@/lib/roles";
import { formatCost } from "@/lib/stages";
import { MinusIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";

export function InventoryPage() {
  const items = useQuery(api.inventory.list);
  const createItem = useMutation(api.inventory.create);
  const updateItem = useMutation(api.inventory.update);
  const removeItem = useMutation(api.inventory.remove);
  const isMentor = useIsMentor();

  const [name, setName] = useState("");
  const [qty, setQty] = useState("0");
  const [unitCost, setUnitCost] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createItem({
      name: name.trim(),
      onHandQty: parseInt(qty, 10) || 0,
      unitCost: unitCost.trim() === "" ? undefined : parseFloat(unitCost),
    });
    setName("");
    setQty("0");
    setUnitCost("");
  }

  // A step, not the new count: the server applies it to the count as it
  // stands, so two people pressing − at once both take one off.
  function adjust(id: Id<"inventoryItems">, delta: number) {
    void updateItem({ id, onHandQtyDelta: delta });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="brand-title text-3xl">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          On-hand stock and consumables.{" "}
          <Link to="/parts" className="underline hover:text-foreground">
            Parts →
          </Link>
        </p>
      </div>

      <form
        onSubmit={(e) => void add(e)}
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="grow space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Item
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. M3×10 socket cap screws"
          />
        </div>
        <div className="w-24 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            On hand
          </label>
          <Input
            type="number"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className="w-28 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Unit cost
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <Button type="submit" disabled={!name.trim()}>
          Add item
        </Button>
      </form>

      {items === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No inventory items yet.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>On hand</TableHead>
                <TableHead>Unit cost</TableHead>
                <TableHead>Total</TableHead>
                {isMentor && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item._id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => adjust(item._id, -1)}
                      >
                        <MinusIcon className="h-3.5 w-3.5" />
                      </Button>
                      <span className="w-8 text-center text-sm">
                        {item.onHandQty}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => adjust(item._id, 1)}
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatCost(item.unitCost)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.unitCost != null
                      ? formatCost(item.unitCost * item.onHandQty)
                      : "—"}
                  </TableCell>
                  {isMentor && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void removeItem({ id: item._id })}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
