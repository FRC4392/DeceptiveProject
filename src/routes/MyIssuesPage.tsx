import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { IssueCard } from "@/components/tracker/IssueCard";
import { useRosterMap } from "@/lib/users";

/** The issues this person picked up — the twin of My Parts and My To-dos. */
export function MyIssuesPage() {
  const mine = useQuery(api.github.listMine, {});
  const roster = useRosterMap();

  const open = (mine ?? []).filter((i) => i.state === "open");
  const closed = (mine ?? []).filter((i) => i.state === "closed");
  const nameFor = (userId?: string) =>
    userId ? roster[userId]?.name : undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="brand-title text-3xl">My issues</h1>
          <p className="text-sm text-muted-foreground">
            What you've picked up. Finish one before you take another.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/issues">Find more</Link>
        </Button>
      </header>

      {mine === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mine.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">Nothing picked up yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The issues list shows what nobody's on.
          </p>
          <Button className="mt-4" asChild>
            <Link to="/issues">Open the list</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((issue) => (
              <IssueCard
                key={issue._id}
                issue={issue}
                claimantName={nameFor(issue.claimedByUserId)}
              />
            ))}
          </div>
          {closed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                Closed · {closed.length}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {closed.map((issue) => (
                  <IssueCard
                    key={issue._id}
                    issue={issue}
                    claimantName={nameFor(issue.claimedByUserId)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
