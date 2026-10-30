import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMentor } from "@/lib/roles";
import { useMachines, useProcessTypes, useSubsystems } from "@/lib/tracker";
import { useRoster } from "@/lib/users";
import type { Role } from "@/lib/roles";

/** Everything a mentor sets up once: the season, the shop, and who's who. */
export function TrackerSettingsPage() {
  const isMentor = useIsMentor();
  const season = useQuery(api.seasons.active, {});

  if (!isMentor) {
    return (
      <p className="text-sm text-muted-foreground">
        Tracker settings are mentors only.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="brand-title text-3xl">Tracker settings</h1>
        <p className="text-sm text-muted-foreground">
          The season, the subsystems that make up part numbers, the shop's
          machines, and who's who.
        </p>
      </header>

      {season === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : season === null ? (
        <SeasonSetup />
      ) : (
        <Tabs defaultValue="subsystems">
          <TabsList className="flex-wrap">
            <TabsTrigger value="subsystems">Subsystems</TabsTrigger>
            <TabsTrigger value="processes">Processes</TabsTrigger>
            <TabsTrigger value="machines">Machines</TabsTrigger>
            <TabsTrigger value="tags">To-do tags</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="season">Season</TabsTrigger>
          </TabsList>
          <TabsContent value="subsystems" className="pt-4">
            <SubsystemSettings />
          </TabsContent>
          <TabsContent value="processes" className="pt-4">
            <ProcessSettings />
          </TabsContent>
          <TabsContent value="machines" className="pt-4">
            <MachineSettings />
          </TabsContent>
          <TabsContent value="tags" className="pt-4">
            <TagSettings />
          </TabsContent>
          <TabsContent value="people" className="pt-4">
            <PeopleSettings />
          </TabsContent>
          <TabsContent value="season" className="pt-4">
            <SeasonSettings season={season} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SeasonSetup() {
  const seed = useMutation(api.seasons.seedDefaults);
  const thisYear = String(new Date().getFullYear() + 1).slice(-2);
  const [year, setYear] = useState(thisYear);
  const [name, setName] = useState(`20${thisYear} robot`);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="Set up this season"
      description="Lays down the season, the usual five subsystems, the machines most teams have, and the processes that decide which stages a part skips. All of it is editable afterwards."
    >
      <div className="grid max-w-md gap-4">
        <div className="grid gap-2">
          <Label htmlFor="ss-year">Season year (two digits)</Label>
          <Input
            id="ss-year"
            value={year}
            maxLength={2}
            onChange={(e) => setYear(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Part numbers look like{" "}
            <span className="font-mono">{year || "27"}-INT-104</span>.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ss-name">What's the robot called?</Label>
          <Input
            id="ss-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          onClick={() => {
            setError(null);
            seed({ year, name }).catch((err: unknown) =>
              setError(err instanceof Error ? err.message : "No luck."),
            );
          }}
        >
          Set it up
        </Button>
      </div>
    </Panel>
  );
}

function SeasonSettings({ season }: { season: Doc<"seasons"> }) {
  const update = useMutation(api.seasons.update);
  const [year, setYear] = useState(season.year);
  const [name, setName] = useState(season.name);

  return (
    <Panel
      title="Season"
      description="The two digits that open every part number, and what this robot is called."
    >
      <div className="grid max-w-md gap-4">
        <div className="grid gap-2">
          <Label htmlFor="se-year">Year</Label>
          <Input
            id="se-year"
            value={year}
            maxLength={2}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="se-name">Name</Label>
          <Input
            id="se-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          className="justify-self-start"
          onClick={() => void update({ id: season._id, year, name })}
        >
          Save
        </Button>
        <p className="text-xs text-muted-foreground">
          Changing the year doesn't renumber parts that already have numbers — a
          number is never reused.
        </p>
      </div>
    </Panel>
  );
}

function SubsystemSettings() {
  const subsystems = useSubsystems();
  const roster = useRoster();
  const create = useMutation(api.subsystems.create);
  const update = useMutation(api.subsystems.update);
  const remove = useMutation(api.subsystems.remove);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="Subsystems"
      description="The code is the middle of every part number this subsystem owns, so keep it short: DRV, INT, ELV."
    >
      <div className="space-y-3">
        {(subsystems ?? []).map((s) => (
          <div
            key={s._id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <span className="font-mono text-sm font-semibold">{s.code}</span>
            <span className="grow font-medium">{s.name}</span>
            <Select
              value={s.leadUserId ?? "none"}
              onValueChange={(value) =>
                void update({
                  id: s._id,
                  leadUserId: value === "none" ? null : value,
                })
              }
            >
              <SelectTrigger className="w-48" aria-label={`${s.name} lead`}>
                <SelectValue placeholder="No lead" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No lead</SelectItem>
                {(roster ?? []).map((person) => (
                  <SelectItem key={person.authId} value={person.authId}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                remove({ id: s._id }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "No luck."),
                );
              }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <div className="grid gap-2">
          <Label htmlFor="sub-code">Code</Label>
          <Input
            id="sub-code"
            value={code}
            maxLength={5}
            className="w-24 font-mono"
            placeholder="DRV"
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="grid grow gap-2">
          <Label htmlFor="sub-name">Name</Label>
          <Input
            id="sub-name"
            value={name}
            placeholder="Drivetrain"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          onClick={() => {
            setError(null);
            create({ code, name })
              .then(() => {
                setCode("");
                setName("");
              })
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "No luck."),
              );
          }}
        >
          Add subsystem
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

function ProcessSettings() {
  const processes = useProcessTypes();
  const machines = useMachines();
  const create = useMutation(api.shop.createProcessType);
  const update = useMutation(api.shop.updateProcessType);
  const remove = useMutation(api.shop.removeProcessType);
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState("none");
  const [needsDrawing, setNeedsDrawing] = useState(true);
  const [needsFinishing, setNeedsFinishing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="Processes"
      description="These two flags decide which stages a part skips: no drawing means it goes straight to Ready to make, no finishing means it goes straight to the bin."
    >
      <div className="space-y-3">
        {(processes ?? []).map((p) => (
          <div
            key={p._id}
            className="flex flex-wrap items-center gap-4 rounded-lg border p-3"
          >
            <span className="grow font-medium">{p.name}</span>
            <span className="text-sm text-muted-foreground">
              {p.machineId
                ? (machines?.find((m) => m._id === p.machineId)?.name ??
                  "machine gone")
                : "no machine"}
            </span>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={p.needsDrawing}
                onCheckedChange={(v) =>
                  void update({ id: p._id, needsDrawing: v === true })
                }
              />
              Needs a drawing
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={p.needsFinishing}
                onCheckedChange={(v) =>
                  void update({ id: p._id, needsFinishing: v === true })
                }
              />
              Needs finishing
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                remove({ id: p._id }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "No luck."),
                );
              }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <div className="grid grow gap-2">
          <Label htmlFor="pr-name">Name</Label>
          <Input
            id="pr-name"
            value={name}
            placeholder="Waterjet"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pr-machine">Machine</Label>
          <Select value={machineId} onValueChange={setMachineId}>
            <SelectTrigger id="pr-machine" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No machine</SelectItem>
              {(machines ?? []).map((m) => (
                <SelectItem key={m._id} value={m._id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <Checkbox
            checked={needsDrawing}
            onCheckedChange={(v) => setNeedsDrawing(v === true)}
          />
          Drawing
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <Checkbox
            checked={needsFinishing}
            onCheckedChange={(v) => setNeedsFinishing(v === true)}
          />
          Finishing
        </label>
        <Button
          onClick={() => {
            setError(null);
            create({
              name,
              machineId:
                machineId === "none"
                  ? undefined
                  : (machineId as Id<"machines">),
              needsDrawing,
              needsFinishing,
            })
              .then(() => setName(""))
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "No luck."),
              );
          }}
        >
          Add process
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

function MachineSettings() {
  const machines = useMachines();
  const create = useMutation(api.shop.createMachine);
  const update = useMutation(api.shop.updateMachine);
  const remove = useMutation(api.shop.removeMachine);
  const [name, setName] = useState("");
  const [mentorPresent, setMentorPresent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="Machines"
      description="Students can only claim a part on a machine a mentor has signed them off on."
    >
      <div className="space-y-3">
        {(machines ?? []).map((m) => (
          <div
            key={m._id}
            className="flex flex-wrap items-center gap-4 rounded-lg border p-3"
          >
            <span className="grow font-medium">{m.name}</span>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={m.requiresMentorPresent}
                onCheckedChange={(v) =>
                  void update({ id: m._id, requiresMentorPresent: v === true })
                }
              />
              A mentor has to be in the room
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                remove({ id: m._id }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "No luck."),
                );
              }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <div className="grid grow gap-2">
          <Label htmlFor="ma-name">Name</Label>
          <Input
            id="ma-name"
            value={name}
            placeholder="Waterjet"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <Checkbox
            checked={mentorPresent}
            onCheckedChange={(v) => setMentorPresent(v === true)}
          />
          Mentor present
        </label>
        <Button
          onClick={() => {
            setError(null);
            create({ name, requiresMentorPresent: mentorPresent })
              .then(() => setName(""))
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "No luck."),
              );
          }}
        >
          Add machine
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

function TagSettings() {
  const tags = useQuery(api.todos.listTags, {});
  const create = useMutation(api.todos.createTag);
  const rename = useMutation(api.todos.renameTag);
  const remove = useMutation(api.todos.removeTag);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "That didn't work."),
    );
  }

  return (
    <Panel
      title="To-do tags"
      description="The labels a to-do can carry — the shop areas and kinds of work your team actually sorts by. Removing one takes it off every to-do that had it."
    >
      <div className="space-y-3">
        {(tags ?? []).map((tag) => (
          <div
            key={tag._id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <Input
              defaultValue={tag.name}
              className="max-w-xs"
              aria-label={`${tag.name} name`}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next.length > 0 && next !== tag.name) {
                  run(rename({ id: tag._id, name: next }));
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => run(remove({ id: tag._id }))}
            >
              Remove
            </Button>
          </div>
        ))}
        {tags !== undefined && tags.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No tags yet. Electrical, Pit, Outreach, Drive practice — whatever
            your team sorts by.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <div className="grid grow gap-2">
          <Label htmlFor="tag-name">Name</Label>
          <Input
            id="tag-name"
            value={name}
            placeholder="Electrical"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          disabled={name.trim().length === 0}
          onClick={() => run(create({ name }).then(() => setName("")))}
        >
          Add tag
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

const ROLES: { value: Role; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "lead", label: "Design lead" },
  { value: "mentor", label: "Mentor" },
  { value: "admin", label: "Admin" },
];

function PeopleSettings() {
  const roster = useRoster();
  const setRole = useMutation(api.shop.setUserRole);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="People"
      description="Roles decide who can check a drawing, move a part back, or mark a sub-assembly installed."
    >
      <div className="space-y-4">
        {(roster ?? []).map((person) => (
          <div key={person.authId} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grow font-medium">{person.name}</span>
              <Select
                value={person.role}
                onValueChange={(value) => {
                  setError(null);
                  setRole({ userId: person.authId, role: value as Role }).catch(
                    (err: unknown) =>
                      setError(err instanceof Error ? err.message : "No luck."),
                  );
                }}
              >
                <SelectTrigger
                  className="w-40"
                  aria-label={`${person.name} role`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
