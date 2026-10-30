import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { TodoCard } from "@/components/tracker/TodoCard";
import { TodoFormDialog } from "@/components/tracker/TodoFormDialog";
import { SetupPrompt } from "@/routes/PartsBoardPage";
import { useRosterMap } from "@/lib/users";
import { cn } from "@/lib/utils";

type Filter = "all" | "grabs" | "mine";

/** The season's to-do list — the task-side twin of the parts board. */
export function TodoBoardPage() {
  const season = useQuery(api.seasons.active, {});
  const todos = useQuery(api.todos.list, {});
  const tags = useQuery(api.todos.listTags, {});
  const roster = useRosterMap();
  const me = useQuery(api.auth.currentUser);

  const [tagId, setTagId] = useState<Id<"todoTags"> | "all">("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [showDone, setShowDone] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const visible = useMemo(() => {
    return (todos ?? []).filter((todo) => {
      if (!showDone && todo.doneAt !== undefined) return false;
      if (tagId !== "all" && !todo.tagIds.includes(tagId)) return false;
      if (filter === "grabs") return !todo.claimedByUserId && !todo.doneAt;
      if (filter === "mine") return todo.claimedByUserId === me?.id;
      return true;
    });
  }, [todos, tagId, filter, showDone, me?.id]);

  const open = visible.filter((t) => t.doneAt === undefined);
  const done = visible.filter((t) => t.doneAt !== undefined);

  if (season === null) return <SetupPrompt />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">To-do list</h1>
          <p className="text-sm text-muted-foreground">
            Everything that isn't a part. Find one nobody's on and pick it up.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>Add a to-do</Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={tagId === "all"} onClick={() => setTagId("all")}>
          All
        </FilterChip>
        {(tags ?? []).map((tag) => (
          <FilterChip
            key={tag._id}
            active={tagId === tag._id}
            onClick={() => setTagId(tag._id)}
          >
            {tag.name}
          </FilterChip>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <FilterChip
          active={filter === "grabs"}
          onClick={() => setFilter(filter === "grabs" ? "all" : "grabs")}
        >
          Nobody on it
        </FilterChip>
        <FilterChip
          active={filter === "mine"}
          onClick={() => setFilter(filter === "mine" ? "all" : "mine")}
        >
          Mine
        </FilterChip>
        <FilterChip active={showDone} onClick={() => setShowDone(!showDone)}>
          Show done
        </FilterChip>
      </div>

      {todos === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : open.length === 0 && done.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">Nothing on the list.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the jobs that aren't parts — pit setup, driver practice,
            outreach.
          </p>
          <Button className="mt-4" onClick={() => setNewOpen(true)}>
            Add a to-do
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((todo) => (
            <TodoCard
              key={todo._id}
              todo={todo}
              tags={tags ?? []}
              claimantName={
                todo.claimedByUserId
                  ? roster[todo.claimedByUserId]?.name
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {showDone && done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Done · {done.length}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {done.map((todo) => (
              <TodoCard
                key={todo._id}
                todo={todo}
                tags={tags ?? []}
                claimantName={
                  todo.doneByUserId
                    ? roster[todo.doneByUserId]?.name
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {tags !== undefined && tags.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tags set up yet — a mentor adds them in{" "}
          <Link to="/admin/tracker" className="text-primary underline">
            tracker settings
          </Link>
          .
        </p>
      )}

      <TodoFormDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-full border px-4 text-sm transition-colors sm:min-h-9",
        active
          ? "border-transparent bg-foreground text-background"
          : "bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
