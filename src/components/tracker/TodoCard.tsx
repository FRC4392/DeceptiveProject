import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, PersonChip } from "@/components/tracker/PartChips";
import { cn } from "@/lib/utils";

const PRIORITY: Record<Doc<"todos">["priority"], string> = {
  high: "bg-danger/10 text-danger",
  medium: "bg-muted text-muted-foreground",
  low: "bg-muted text-muted-foreground",
};

/** One to-do on the list. Reads like a part card on the board. */
export function TodoCard({
  todo,
  tags,
  claimantName,
}: {
  todo: Doc<"todos">;
  tags: Doc<"todoTags">[];
  claimantName?: string;
}) {
  const setDone = useMutation(api.todos.setDone);
  const done = todo.doneAt !== undefined;
  const tagNames = todo.tagIds
    .map((id) => tags.find((t) => t._id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm transition-colors",
        done && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={done}
          className="mt-1"
          aria-label={done ? `Reopen ${todo.title}` : `Finish ${todo.title}`}
          onCheckedChange={(next) =>
            void setDone({ id: todo._id, done: next === true })
          }
        />
        <div className="min-w-0 grow">
          <Link
            to={`/todos/${todo._id}`}
            className="block text-sm font-semibold leading-snug hover:underline"
          >
            <span className={cn(done && "line-through")}>{todo.title}</span>
          </Link>

          {(tagNames.length > 0 || todo.priority === "high") && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {todo.priority === "high" && (
                <Chip className={PRIORITY.high}>High priority</Chip>
              )}
              {tagNames.map((name) => (
                <Chip
                  key={name}
                  className="bg-secondary text-secondary-foreground"
                >
                  {name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 border-t pt-2">
        <PersonChip
          name={claimantName}
          emptyLabel={done ? null : "Nobody on it"}
        />
      </div>
    </div>
  );
}
