import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useIsMentor } from "@/lib/roles";
import { useRoster } from "@/lib/users";
import { formatDate, fromDateInputValue } from "@/lib/dates";
import { TrashIcon } from "@radix-ui/react-icons";

export function AdminPage() {
  const isMentor = useIsMentor();

  if (!isMentor) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <h1 className="brand-title text-2xl">Mentors only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to mentors.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="brand-title text-3xl">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Mentor-only settings. Roles and roster are synced from Clerk.
        </p>
      </div>

      <CompetitionsCard />
      <RosterCard />
      <IntegrationsCard />
    </div>
  );
}

function CompetitionsCard() {
  const competitions = useQuery(api.competitions.list);
  const createCompetition = useMutation(api.competitions.create);
  const removeCompetition = useMutation(api.competitions.remove);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ts = fromDateInputValue(date);
    if (!name.trim() || ts === undefined) return;
    setSaving(true);
    try {
      await createCompetition({ name: name.trim(), date: ts });
      setName("");
      setDate("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Competitions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => void add(e)}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="comp-name">Name</Label>
            <Input
              id="comp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. District Championship"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comp-date">Date</Label>
            <Input
              id="comp-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving}>
            Add
          </Button>
        </form>

        <Separator />

        {competitions === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : competitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No competitions scheduled.
          </p>
        ) : (
          <ul className="divide-y">
            {competitions.map((c) => (
              <li
                key={c._id}
                className="flex items-center justify-between py-2"
              >
                <div>
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatDate(c.date)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void removeCompetition({ id: c._id })}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RosterCard() {
  const roster = useRoster();
  const syncUsers = useAction(api.auth.syncUsersFromClerk);
  const [syncing, setSyncing] = useState(false);

  async function syncRoster() {
    setSyncing(true);
    try {
      await syncUsers();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Roster</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void syncRoster()}
          disabled={syncing}
        >
          {syncing ? "Syncing..." : "Sync Clerk"}
        </Button>
      </CardHeader>
      <CardContent>
        {roster === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users synced yet.</p>
        ) : (
          <ul className="divide-y">
            {roster.map((p) => (
              <li
                key={p.authId}
                className="flex items-center justify-between py-2"
              >
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.email}
                  </span>
                </div>
                <Badge
                  variant={p.role === "mentor" ? "default" : "secondary"}
                  className="capitalize"
                >
                  {p.role ?? "student"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Integrations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <Link
          to="/admin/tracker"
          className="flex items-center justify-between transition-colors hover:text-foreground"
        >
          <span>Part tracker — season, subsystems, machines, people</span>
          <Badge variant="secondary">Configure →</Badge>
        </Link>
        <Link
          to="/admin/onshape"
          className="flex items-center justify-between transition-colors hover:text-foreground"
        >
          <span>Onshape part sync</span>
          <Badge variant="secondary">Configure →</Badge>
        </Link>
        <Link
          to="/admin/github"
          className="flex items-center justify-between transition-colors hover:text-foreground"
        >
          <span>GitHub issue sync</span>
          <Badge variant="secondary">Configure →</Badge>
        </Link>
      </CardContent>
    </Card>
  );
}
