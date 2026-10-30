import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { TodoCard } from "@/components/tracker/TodoCard";
import { useRosterMap } from "@/lib/users";

/** The to-dos this person picked up — the twin of My Parts. */
export function MyTodosPage() {
  const mine = useQuery(api.todos.listMine, {});
  const tags = useQuery(api.todos.listTags, {});
  const roster = useRosterMap();

  const open = (mine ?? []).filter((t) => t.doneAt === undefined);
  const done = (mine ?? []).filter((t) => t.doneAt !== undefined);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">My to-dos</h1>
          <p className="text-sm text-muted-foreground">
            What you've picked up. Finish one before you take another.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/todos">Find more</Link>
        </Button>
      </header>

      {mine === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mine.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">Nothing picked up yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The list shows what nobody's on.
          </p>
          <Button className="mt-4" asChild>
            <Link to="/todos">Open the list</Link>
          </Button>
        </div>
      ) : (
        <>
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
          {done.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Done · {done.length}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {done.map((todo) => (
                  <TodoCard key={todo._id} todo={todo} tags={tags ?? []} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
