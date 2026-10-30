import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/tracker/PartChips";
import { TodoFormDialog } from "@/components/tracker/TodoFormDialog";
import { initials } from "@/lib/stages";
import { useIsLead } from "@/lib/roles";
import { useRosterMap } from "@/lib/users";

/** One to-do, laid out like a part page: what it is, who's on it, notes. */
export function TodoPage() {
  const { todoId } = useParams<{ todoId: string }>();
  const id = todoId as Id<"todos">;
  const todo = useQuery(api.todos.get, { id });
  const tags = useQuery(api.todos.listTags, {});
  const notes = useQuery(api.todos.notes, { todoId: id });
  const me = useQuery(api.auth.currentUser);
  const roster = useRosterMap();
  const isLead = useIsLead();
  const navigate = useNavigate();

  const claim = useMutation(api.todos.claim);
  const unclaim = useMutation(api.todos.unclaim);
  const setDone = useMutation(api.todos.setDone);
  const addNote = useMutation(api.todos.addNote);
  const remove = useMutation(api.todos.remove);

  const [noteBody, setNoteBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (todo === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (todo === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">That to-do is gone.</p>
        <Button asChild variant="outline">
          <Link to="/todos">Back to the list</Link>
        </Button>
      </div>
    );
  }

  const done = todo.doneAt !== undefined;
  const claimant = todo.claimedByUserId
    ? roster[todo.claimedByUserId]
    : undefined;
  const mine = todo.claimedByUserId === me?.id;
  const tagNames = todo.tagIds
    .map((tagId) => (tags ?? []).find((t) => t._id === tagId)?.name)
    .filter((name): name is string => Boolean(name));

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "That didn't work."),
    );
  }

  function personName(userId?: string): string | undefined {
    return userId ? roster[userId]?.name : undefined;
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/todos" className="hover:text-foreground hover:underline">
          To-do list
        </Link>
        <span>/</span>
        <span className="text-foreground">{todo.title}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="brand-title text-3xl">{todo.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {done && <Chip className="bg-success/10 text-success">Done</Chip>}
            {todo.priority === "high" && (
              <Chip className="bg-danger/10 text-danger">High priority</Chip>
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
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {isLead && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() =>
                run(remove({ id: todo._id }).then(() => navigate("/todos")))
              }
            >
              Delete
            </Button>
          )}
        </div>
      </header>

      <section className="rounded-lg border-2 border-primary bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Right now
        </p>
        <h2 className="mt-1 text-lg font-semibold">
          {done
            ? "Finished"
            : claimant
              ? `${claimant.name} is on it`
              : "Nobody's picked this up"}
        </h2>

        {todo.description && (
          <p className="mt-3 text-sm text-muted-foreground">
            {todo.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!done && !todo.claimedByUserId && (
            <Button onClick={() => run(claim({ id: todo._id }))}>
              I'll do it
            </Button>
          )}
          {!done && mine && (
            <Button
              variant="ghost"
              onClick={() => run(unclaim({ id: todo._id }))}
            >
              Put it back
            </Button>
          )}
          <Button
            size="lg"
            variant={done ? "outline" : "default"}
            onClick={() => run(setDone({ id: todo._id, done: !done }))}
          >
            {done ? "Not done after all" : "Mark it done"}
          </Button>
        </div>

        {done && todo.doneByUserId && (
          <p className="mt-2 text-sm text-muted-foreground">
            {personName(todo.doneByUserId) ?? "Someone"} finished it.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Notes</h2>
        <div className="mt-3 space-y-4">
          {(notes ?? []).map((note) => (
            <div key={note._id} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
                {initials(personName(note.userId))}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {personName(note.userId) ?? "Someone"} ·{" "}
                  {new Date(note._creationTime).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <p className="text-sm">{note.body}</p>
              </div>
            </div>
          ))}
          {notes?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No notes yet. Questions and progress go here.
            </p>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <Textarea
            value={noteBody}
            rows={2}
            placeholder="Questions, progress, problems…"
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <Button
            size="sm"
            disabled={noteBody.trim().length === 0}
            onClick={() =>
              run(
                addNote({ todoId: todo._id, body: noteBody }).then(() =>
                  setNoteBody(""),
                ),
              )
            }
          >
            Add a note
          </Button>
        </div>
      </section>

      <TodoFormDialog open={editing} onOpenChange={setEditing} todo={todo} />
    </div>
  );
}
