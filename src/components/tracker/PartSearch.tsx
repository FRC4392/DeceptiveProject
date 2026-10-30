import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Typing the number is how people find a part — there are no codes to scan.
 * "27-INT-104", "int-104" and plain "104" all get there, and anything
 * ambiguous shows a pick list instead of guessing.
 */
export function PartSearch({
  className,
  placeholder = "27-INT-104 or just 104",
  autoFocus,
}: {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const navigate = useNavigate();
  const results = useQuery(
    api.parts.search,
    term.trim().length > 0 ? { query: term, limit: 8 } : "skip",
  );

  function go() {
    if (results && results.length > 0) {
      void navigate(`/parts/${results[0]._id}`);
      setTerm("");
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div className="flex gap-2">
        <Input
          value={term}
          autoFocus={autoFocus}
          inputMode="text"
          // 16px keeps iOS from zooming the page when the field takes focus.
          className="h-12 text-base"
          placeholder={placeholder}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
          aria-label="Part number"
        />
        <Button type="button" className="h-12 px-5" onClick={go}>
          Find
        </Button>
      </div>

      {term.trim().length > 0 && results !== undefined && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No part with that number.
            </p>
          ) : (
            results.map((part) => (
              <button
                key={part._id}
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent"
                onClick={() => {
                  void navigate(`/parts/${part._id}`);
                  setTerm("");
                }}
              >
                <span className="font-mono text-sm">{part.partNumber}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {part.name}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
