import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
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
import { formatDate, fromDateInputValue } from "@/lib/dates";
import { errorText } from "@/lib/errors";

/** Everything a mentor sets up: the season, the shop, the people, the links. */
export function SettingsPage() {
  const isMentor = useIsMentor();
  const season = useQuery(api.seasons.active, {});

  if (!isMentor) {
    return (
      <p className="text-sm text-muted-foreground">
        Settings are mentors only.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="brand-title text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground">
          The season, the subsystems that make up part numbers, the shop, the
          people, and what the app is connected to.
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
            <TabsTrigger value="shop">Shop</TabsTrigger>
            <TabsTrigger value="todos">To-dos</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="season">Season</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
          </TabsList>
          <TabsContent value="subsystems" className="space-y-4 pt-4">
            <SubsystemSettings />
          </TabsContent>
          <TabsContent value="shop" className="space-y-4 pt-4">
            <ProcessSettings />
            <MachineSettings />
          </TabsContent>
          <TabsContent value="todos" className="space-y-4 pt-4">
            <TagSettings />
          </TabsContent>
          <TabsContent value="people" className="space-y-4 pt-4">
            <PeopleSettings />
          </TabsContent>
          <TabsContent value="season" className="space-y-4 pt-4">
            <SeasonSettings season={season} />
          </TabsContent>
          <TabsContent value="events" className="space-y-4 pt-4">
            <CompetitionSettings />
          </TabsContent>
          <TabsContent value="connections" className="space-y-4 pt-4">
            <ConnectionSettings />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/**
 * One settings block. Same bordered card the parts and to-do screens use for
 * their sections, so settings doesn't look like a different app.
 */
function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  /** A control that belongs with the heading rather than the body. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Next season's year and name, the way a mentor would most likely type them. */
function nextSeasonDefaults() {
  const year = String(new Date().getFullYear() + 1).slice(-2);
  return { year, name: `20${year} robot` };
}

function SeasonSetup() {
  const seed = useMutation(api.seasons.seedDefaults);
  const defaults = nextSeasonDefaults();
  const [year, setYear] = useState(defaults.year);
  const [name, setName] = useState(defaults.name);
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
              setError(errorText(err, "No luck.")),
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
  return (
    <>
      <ThisSeasonPanel season={season} />
      <SeasonsPanel season={season} />
    </>
  );
}

function ThisSeasonPanel({ season }: { season: Doc<"seasons"> }) {
  const update = useMutation(api.seasons.update);
  const [year, setYear] = useState(season.year);
  const [name, setName] = useState(season.name);
  const [pad, setPad] = useState(String(season.numberPad ?? 3));
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel
      title="This season"
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
        <div className="grid gap-2">
          <Label htmlFor="se-pad">Digits in the number</Label>
          <Input
            id="se-pad"
            type="number"
            min={1}
            max={6}
            className="w-20"
            value={pad}
            onChange={(e) => setPad(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Parts read{" "}
            <span className="font-mono">
              {year || "27"}-INT-
              {"1".padStart(Math.min(6, Math.max(1, Number(pad) || 3)), "0")}
            </span>
            . Fixed once this season has handed a number out, because widening
            it would stop a search for 104 finding 0104.
          </p>
        </div>
        <Button
          className="justify-self-start"
          onClick={() => {
            setError(null);
            update({
              id: season._id,
              year,
              name,
              numberPad: Number(pad) || undefined,
            }).catch((err: unknown) => setError(errorText(err, "No luck.")));
          }}
        >
          Save
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Changing the year doesn't renumber parts that already have numbers — a
          number is never reused.
        </p>
      </div>
    </Panel>
  );
}

/**
 * Every year the team has tracked, and the way between them. Switching is
 * team-wide, so it asks twice rather than acting on one press.
 */
function SeasonsPanel({ season }: { season: Doc<"seasons"> }) {
  const seasons = useQuery(api.seasons.list, {});
  const create = useMutation(api.seasons.create);
  const setActive = useMutation(api.seasons.setActive);
  const defaults = nextSeasonDefaults();
  const [year, setYear] = useState(defaults.year);
  const [name, setName] = useState(defaults.name);
  const [confirmId, setConfirmId] = useState<Id<"seasons"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) => setError(errorText(err, "No luck.")));
  }

  return (
    <Panel
      title="Seasons"
      description="Switching moves every screen, for everyone. New part numbers get the year of whichever season is current, so switching back to an old year and adding a part will number it into that year."
    >
      <div className="space-y-3">
        {seasons === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          seasons.map((s) => (
            <div
              key={s._id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <span className="font-mono text-sm font-semibold">{s.year}</span>
              <span className="grow font-medium">{s.name}</span>
              {s._id === season._id ? (
                <span className="text-sm text-muted-foreground">Current</span>
              ) : confirmId === s._id ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirmId(null);
                      run(setActive({ id: s._id }));
                    }}
                  >
                    Yes, switch to {s.year}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmId(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmId(s._id)}
                >
                  Make this the current season
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(create({ year, name, makeActive: false }));
        }}
        className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4"
      >
        <div className="grid gap-2">
          <Label htmlFor="ns-year">Year</Label>
          <Input
            id="ns-year"
            value={year}
            maxLength={2}
            className="w-24 font-mono"
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div className="grid grow gap-2">
          <Label htmlFor="ns-name">Name</Label>
          <Input
            id="ns-name"
            value={name}
            placeholder="2028 robot"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          disabled={year.trim().length === 0 || name.trim().length === 0}
        >
          Add season
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        A new season starts with one subsystem, Drivetrain, and its{" "}
        <span className="font-mono">{year || "28"}-DRV-000</span> assembly — add
        the rest on the Subsystems tab once you've switched to it. Adding a
        season doesn't switch the team onto it.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

function SubsystemSettings() {
  const subsystems = useSubsystems();
  const roster = useRoster();
  const nextNumbers = useQuery(api.subsystems.nextNumbers, {});
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
            <NextNumberBox
              subsystemId={s._id}
              next={
                nextNumbers?.find((n) => n.subsystemId === s._id)?.next ?? 1
              }
              onError={setError}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                remove({ id: s._id }).catch((err: unknown) =>
                  setError(errorText(err, "No luck.")),
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
              .catch((err: unknown) => setError(errorText(err, "No luck.")));
          }}
        >
          Add subsystem
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

/**
 * The number this subsystem hands out next. Editable because a team picking
 * the tracker up mid-season needs to start where their spreadsheet stopped,
 * and it only moves forward — the server refuses the rest.
 */
function NextNumberBox({
  subsystemId,
  next,
  onError,
}: {
  subsystemId: Id<"subsystems">;
  next: number;
  onError: (message: string | null) => void;
}) {
  const setNextNumber = useMutation(api.subsystems.setNextNumber);
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      Next
      <Input
        type="number"
        min={next}
        defaultValue={next}
        key={`${subsystemId}-${next}`}
        aria-label="Next part number"
        className="h-9 w-20"
        onBlur={(e) => {
          const wanted = Math.round(Number(e.target.value));
          if (!Number.isFinite(wanted) || wanted === next) return;
          onError(null);
          setNextNumber({ subsystemId, next: wanted }).catch((err: unknown) =>
            onError(errorText(err, "No luck.")),
          );
        }}
      />
    </label>
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
                  setError(errorText(err, "No luck.")),
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
              .catch((err: unknown) => setError(errorText(err, "No luck.")));
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
                  setError(errorText(err, "No luck.")),
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
              .catch((err: unknown) => setError(errorText(err, "No luck.")));
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
      setError(errorText(err, "That didn't work.")),
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
  const syncUsers = useAction(api.auth.syncUsersFromClerk);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      await syncUsers();
    } catch (err) {
      setError(errorText(err, "That didn't work."));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Panel
      title="People"
      description="Everyone who has signed in. Roles decide who can check a drawing, move a part back, or mark a sub-assembly installed."
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={syncing}
          onClick={() => void sync()}
        >
          {syncing ? "Syncing…" : "Sync from Clerk"}
        </Button>
      }
    >
      <div className="space-y-3">
        {roster === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has signed in yet. Sync from Clerk to pull the roster in.
          </p>
        ) : (
          roster.map((person) => (
            <div
              key={person.authId}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <span className="min-w-0 grow">
                <span className="block font-medium">{person.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {person.email || "no email yet"}
                </span>
              </span>
              <Select
                value={person.role}
                onValueChange={(value) => {
                  setError(null);
                  setRole({ userId: person.authId, role: value as Role }).catch(
                    (err: unknown) => setError(errorText(err, "No luck.")),
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
          ))
        )}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

function CompetitionSettings() {
  const competitions = useQuery(api.competitions.list);
  const create = useMutation(api.competitions.create);
  const remove = useMutation(api.competitions.remove);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ts = fromDateInputValue(date);
    if (!name.trim() || ts === undefined) return;
    setSaving(true);
    try {
      await create({ name: name.trim(), date: ts });
      setName("");
      setDate("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Events"
      description="The next one ahead shows in the sidebar and on the dashboard, counting down."
    >
      <div className="space-y-3">
        {competitions === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : competitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on the calendar yet.
          </p>
        ) : (
          competitions.map((competition) => (
            <div
              key={competition._id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <span className="grow font-medium">{competition.name}</span>
              <span className="text-sm text-muted-foreground">
                {formatDate(competition.date)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void remove({ id: competition._id })}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => void add(e)}
        className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4"
      >
        <div className="grid grow gap-2">
          <Label htmlFor="comp-name">Name</Label>
          <Input
            id="comp-name"
            value={name}
            placeholder="District Championship"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="comp-date">Date</Label>
          <Input
            id="comp-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={saving}>
          Add event
        </Button>
      </form>
    </Panel>
  );
}

function ConnectionSettings() {
  return (
    <Panel
      title="Connections"
      description="The two outside services the app talks to. Everything else here is the app's own."
    >
      <div className="space-y-2">
        <Link
          to="/admin/onshape"
          className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
        >
          <span>
            <span className="block font-medium">Onshape</span>
            <span className="block text-sm text-muted-foreground">
              The CAD connection, which documents hold which subsystem, and the
              API budget.
            </span>
          </span>
          <span className="shrink-0 text-sm text-primary">Set up →</span>
        </Link>
        <Link
          to="/admin/github"
          className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
        >
          <span>
            <span className="block font-medium">GitHub</span>
            <span className="block text-sm text-muted-foreground">
              Issue and pull request sync, and importing a repository.
            </span>
          </span>
          <span className="shrink-0 text-sm text-primary">Set up →</span>
        </Link>
      </div>
    </Panel>
  );
}
