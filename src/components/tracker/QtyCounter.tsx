import { useMutation } from "convex/react";
import { MinusIcon, PlusIcon } from "@radix-ui/react-icons";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { qtyLabel } from "@/lib/stages";

/**
 * How many have actually been made. Big targets: this gets pressed with shop
 * gloves on, next to a running machine.
 */
export function QtyCounter({ part }: { part: Doc<"parts"> }) {
  const setQtyMade = useMutation(api.parts.setQtyMade);
  const target = part.qtyNeeded + part.qtySpares;

  // A step, not the new count: the server applies it to the count as it
  // stands, so two people pressing + at once both get counted.
  function step(delta: number) {
    void setQtyMade({ partId: part._id, delta });
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div>
        <p className="font-semibold">Made so far</p>
        <p className="text-xs text-muted-foreground">Need {qtyLabel(part)}</p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11"
          disabled={part.qtyMade <= 0}
          onClick={() => step(-1)}
          aria-label="One fewer made"
        >
          <MinusIcon className="h-5 w-5" />
        </Button>
        <span className="min-w-16 text-center font-mono text-2xl font-semibold">
          {part.qtyMade}/{target}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11"
          disabled={part.qtyMade >= target}
          onClick={() => step(1)}
          aria-label="One more made"
        >
          <PlusIcon className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
