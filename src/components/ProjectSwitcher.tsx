import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useActiveProject } from "@/lib/project";
import type { Id } from "../../convex/_generated/dataModel";

const ALL = "__all__";

/** Global project scope selector shown in the app header. */
export function ProjectSwitcher({ className }: { className?: string }) {
  const { activeProjectId, setActiveProjectId, projects } = useActiveProject();

  return (
    <Select
      value={activeProjectId ?? ALL}
      onValueChange={(v) =>
        setActiveProjectId(v === ALL ? null : (v as Id<"projects">))
      }
    >
      <SelectTrigger
        className={cn(
          "h-8 w-28 border-border bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring sm:w-44",
          className,
        )}
        aria-label="Active project"
      >
        <SelectValue placeholder="All projects" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All projects</SelectItem>
        {(projects ?? []).map((p) => (
          <SelectItem key={p._id} value={p._id}>
            {p.name}
            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
              {p.tag}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
