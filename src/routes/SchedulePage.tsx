import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { GanttChart } from "@/components/schedule/GanttChart";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorText } from "@/lib/errors";
import { useIsLead } from "@/lib/roles";
import {
  addDays,
  chartRange,
  DAY_MS,
  dayFromInputValue,
  formatDay,
  formatSpan,
  STATUS_LABEL,
  taskStatus,
  toDateInputValue,
} from "@/lib/schedule";
import { wouldCycle, type DepTask } from "../../convex/lib/scheduleDeps";
import { useToday } from "@/lib/useToday";
import { cn } from "@/lib/utils";

type Phase = Doc<"schedulePhases">;
type Task = Doc<"scheduleTasks">;

/**
 * The season's plan as a Gantt chart. Everyone sees it; leads and mentors
 * change it here — in the list under the chart, or by dragging the bars.
 */
export function SchedulePage() {
  const data = useQuery(api.schedule.get, {});
  const isLead = useIsLead();
  const today = useToday();
  const updateTask = useMutation(api.schedule.updateTask);

  const phases = data?.phases ?? [];
  const tasks = data?.tasks ?? [];
  const milestones = data?.milestones ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="brand-title text-3xl">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          The season's plan, phase by phase. Events from Settings show as dashed
          lines.
        </p>
      </header>

      {data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : phases.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm shadow-sm">
          <p className="font-medium">No schedule yet.</p>
          {isLead && (
            <p className="mt-1 text-muted-foreground">
              Add a phase (Design, Build, Test…) below to start.
            </p>
          )}
        </div>
      ) : (
        <GanttChart
          phases={phases}
          tasks={tasks}
          milestones={milestones}
          range={chartRange(tasks, milestones, today)}
          today={today}
          onChangeDates={
            isLead
              ? (id, start, end) =>
                  updateTask({ id: id as Id<"scheduleTasks">, start, end })
              : undefined
          }
        />
      )}

      {data !== undefined &&
        (isLead ? (
          <section className="space-y-4">
            <h2 className="font-semibold">Edit the schedule</h2>
            {phases.map((phase, i) => (
              <PhaseEditor
                key={phase._id}
                phase={phase}
                phases={phases}
                tasks={tasks.filter((t) => t.phaseId === phase._id)}
                allTasks={tasks}
                first={i === 0}
                last={i === phases.length - 1}
                today={today}
              />
            ))}
            <AddPhaseForm />
          </section>
        ) : (
          phases.length > 0 && (
            <ReadOnlyList phases={phases} tasks={tasks} today={today} />
          )
        ))}
    </div>
  );
}

/**
 * Draft state for a field that saves on blur: it follows the saved value
 * whenever that changes (a drag on the chart, someone else's edit), and
 * holds whatever's being typed in between.
 */
function useDraft(value: string): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  if (value !== saved) {
    setSaved(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

function PhaseEditor({
  phase,
  phases,
  tasks,
  allTasks,
  first,
  last,
  today,
}: {
  phase: Phase;
  phases: Phase[];
  tasks: Task[];
  allTasks: Task[];
  first: boolean;
  last: boolean;
  today: number;
}) {
  const renamePhase = useMutation(api.schedule.renamePhase);
  const movePhase = useMutation(api.schedule.movePhase);
  const removePhase = useMutation(api.schedule.removePhase);
  const [name, setName] = useDraft(phase.name);
  const [error, setError] = useState<string | null>(null);

  /** Run a save, and say so if it doesn't go through. */
  function run(p: Promise<unknown>, onFail?: () => void) {
    setError(null);
    p.catch((err: unknown) => {
      onFail?.();
      setError(errorText(err, "No luck."));
    });
  }

  function saveName() {
    if (name.trim() === phase.name) return;
    run(renamePhase({ id: phase._id, name }), () => setName(phase.name));
  }

  function remove() {
    const what =
      tasks.length === 0
        ? `Remove the "${phase.name}" phase?`
        : `Remove the "${phase.name}" phase and its ${tasks.length} task${
            tasks.length === 1 ? "" : "s"
          }?`;
    if (!confirm(what)) return;
    run(removePhase({ id: phase._id }));
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Phase name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={blurOnEnter}
          className="min-w-0 flex-1 basis-48 font-semibold"
        />
        <MoveButtons
          what={`the ${phase.name} phase`}
          first={first}
          last={last}
          onMove={(direction) => run(movePhase({ id: phase._id, direction }))}
        />
        <Button variant="ghost" size="sm" onClick={remove}>
          <TrashIcon className="mr-1 h-4 w-4" />
          Remove phase
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        )}
        {tasks.map((task, i) => (
          <TaskRow
            key={task._id}
            task={task}
            phases={phases}
            allTasks={allTasks}
            first={i === 0}
            last={i === tasks.length - 1}
            run={run}
          />
        ))}
      </div>

      <AddTaskForm phaseId={phase._id} today={today} />
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function TaskRow({
  task,
  phases,
  allTasks,
  first,
  last,
  run,
}: {
  task: Task;
  phases: Phase[];
  allTasks: Task[];
  first: boolean;
  last: boolean;
  run: (p: Promise<unknown>, onFail?: () => void) => void;
}) {
  const updateTask = useMutation(api.schedule.updateTask);
  const moveTask = useMutation(api.schedule.moveTask);
  const removeTask = useMutation(api.schedule.removeTask);
  const [name, setName] = useDraft(task.name);
  const [start, setStart] = useDraft(toDateInputValue(task.start));
  const [end, setEnd] = useDraft(toDateInputValue(task.end));
  const done = task.doneAt !== undefined;

  function saveName() {
    if (name.trim() === task.name) return;
    run(updateTask({ id: task._id, name }), () => setName(task.name));
  }

  function saveDates() {
    const s = dayFromInputValue(start);
    const e = dayFromInputValue(end);
    const reset = () => {
      setStart(toDateInputValue(task.start));
      setEnd(toDateInputValue(task.end));
    };
    if (s === undefined || e === undefined) return reset();
    if (s === task.start && e === task.end) return;
    run(updateTask({ id: task._id, start: s, end: e }), reset);
  }

  // What it waits for that hasn't finished by the time it starts.
  const waitsFor = (task.dependsOn ?? [])
    .map((id) => allTasks.find((t) => t._id === id))
    .filter((t): t is Task => t !== undefined);
  const clashing = done ? [] : waitsFor.filter((p) => p.end >= task.start);

  /** Slide the task, keeping its length, to the day after what it waits for. */
  function lineUp() {
    const start = Math.max(...waitsFor.map((p) => p.end)) + DAY_MS;
    run(
      updateTask({
        id: task._id,
        start,
        end: task.end + (start - task.start),
      }),
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <Input
        aria-label="Task name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={blurOnEnter}
        className={cn(
          "min-w-0 flex-1 basis-48",
          done && "text-muted-foreground line-through",
        )}
      />
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label={`${task.name} starts`}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={saveDates}
          onKeyDown={blurOnEnter}
          className="w-[9.5rem]"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          aria-label={`${task.name} ends`}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={saveDates}
          onKeyDown={blurOnEnter}
          className="w-[9.5rem]"
        />
      </div>
      <div className="flex items-center gap-1.5 px-1">
        <Checkbox
          id={`done-${task._id}`}
          checked={done}
          onCheckedChange={(checked) =>
            run(updateTask({ id: task._id, done: checked === true }))
          }
        />
        <Label htmlFor={`done-${task._id}`}>Done</Label>
      </div>
      {phases.length > 1 && (
        <Select
          value={task.phaseId}
          onValueChange={(phaseId) =>
            run(
              updateTask({
                id: task._id,
                phaseId: phaseId as Id<"schedulePhases">,
              }),
            )
          }
        >
          <SelectTrigger className="w-36" aria-label={`${task.name}'s phase`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {phases.map((p) => (
              <SelectItem key={p._id} value={p._id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <WaitsForPicker
        task={task}
        allTasks={allTasks}
        phases={phases}
        run={run}
      />
      <div className="ml-auto flex items-center">
        <MoveButtons
          what={task.name}
          first={first}
          last={last}
          onMove={(direction) => run(moveTask({ id: task._id, direction }))}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (confirm(`Remove "${task.name}"?`)) {
              run(removeTask({ id: task._id }));
            }
          }}
        >
          <TrashIcon className="h-4 w-4" />
          <span className="sr-only">Remove {task.name}</span>
        </Button>
      </div>
      {clashing.length > 0 && (
        <p className="flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-sm text-danger">
          <ExclamationTriangleIcon aria-hidden="true" className="h-4 w-4" />
          <span>
            Starts before{" "}
            {clashing
              .map((p) => `${p.name} finishes (${formatDay(p.end)})`)
              .join(", ")}
            .
          </span>
          <Button variant="outline" size="sm" onClick={lineUp}>
            Line it up after
          </Button>
        </p>
      )}
    </div>
  );
}

/**
 * Choose what a task waits for. Ticking one lines the task up the day after
 * it finishes; anything that already waits on this task is greyed out, since
 * picking it would make the two wait for each other.
 */
function WaitsForPicker({
  task,
  allTasks,
  phases,
  run,
}: {
  task: Task;
  allTasks: Task[];
  phases: Phase[];
  run: (p: Promise<unknown>, onFail?: () => void) => void;
}) {
  const updateTask = useMutation(api.schedule.updateTask);
  const current = task.dependsOn ?? [];
  const graph: DepTask[] = allTasks.map((t) => ({
    id: t._id,
    start: t.start,
    end: t.end,
    dependsOn: t.dependsOn ?? [],
    done: t.doneAt !== undefined,
  }));
  const names = current
    .map((id) => allTasks.find((t) => t._id === id)?.name)
    .filter(Boolean);
  const others = allTasks.filter((t) => t._id !== task._id);

  function toggle(id: Id<"scheduleTasks">, on: boolean) {
    const next = on ? [...current, id] : current.filter((d) => d !== id);
    run(updateTask({ id: task._id, dependsOn: next }));
  }

  const summary =
    names.length === 0
      ? "Waits for nothing"
      : names.length === 1
        ? `After ${names[0]}`
        : `After ${names[0]} +${names.length - 1}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-48"
          aria-label={`What ${task.name} waits for: ${
            names.length === 0 ? "nothing" : names.join(", ")
          }`}
        >
          <span className="truncate">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">{task.name} waits for</p>
          <p className="text-xs text-muted-foreground">
            It starts the day after the last of these finishes, and moves when
            they do.
          </p>
        </div>
        {others.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            Add another task first.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1">
            {phases.map((phase) => {
              const list = others.filter((t) => t.phaseId === phase._id);
              if (list.length === 0) return null;
              return (
                <div key={phase._id} className="py-1">
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {phase.name}
                  </p>
                  {list.map((other) => {
                    const checked = current.includes(other._id);
                    const loop =
                      !checked && wouldCycle(graph, task._id, other._id);
                    const id = `dep-${task._id}-${other._id}`;
                    return (
                      <div
                        key={other._id}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1",
                          loop && "opacity-50",
                        )}
                        title={
                          loop
                            ? `${other.name} already waits for ${task.name}`
                            : undefined
                        }
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={loop}
                          onCheckedChange={(on) =>
                            toggle(other._id, on === true)
                          }
                        />
                        <Label
                          htmlFor={id}
                          className="flex min-w-0 grow justify-between gap-2 font-normal"
                        >
                          <span className="truncate">{other.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            ends {formatDay(other.end)}
                          </span>
                        </Label>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MoveButtons({
  what,
  first,
  last,
  onMove,
}: {
  what: string;
  first: boolean;
  last: boolean;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        disabled={first}
        onClick={() => onMove("up")}
      >
        <ArrowUpIcon className="h-4 w-4" />
        <span className="sr-only">Move {what} up</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={last}
        onClick={() => onMove("down")}
      >
        <ArrowDownIcon className="h-4 w-4" />
        <span className="sr-only">Move {what} down</span>
      </Button>
    </div>
  );
}

function AddTaskForm({
  phaseId,
  today,
}: {
  phaseId: Id<"schedulePhases">;
  today: number;
}) {
  const createTask = useMutation(api.schedule.createTask);
  const [name, setName] = useState("");
  const [start, setStart] = useState(() => toDateInputValue(today));
  const [end, setEnd] = useState(() => toDateInputValue(addDays(today, 6)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const s = dayFromInputValue(start);
    const en = dayFromInputValue(end);
    if (!name.trim()) return;
    if (s === undefined || en === undefined) {
      setError("Pick a start and an end date.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createTask({ phaseId, name, start: s, end: en });
      setName("");
      // Lined up after the one just added: the usual next step.
      setStart(toDateInputValue(addDays(en, 1)));
      setEnd(toDateInputValue(addDays(en, 7)));
    } catch (err) {
      setError(errorText(err, "No luck."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void add(e)}
      className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
    >
      <Input
        aria-label="New task name"
        placeholder="New task"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1 basis-48"
      />
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="New task starts"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="w-[9.5rem]"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          aria-label="New task ends"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="w-[9.5rem]"
        />
      </div>
      <Button type="submit" disabled={saving || !name.trim()}>
        Add task
      </Button>
      {error && (
        <p role="alert" className="basis-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function AddPhaseForm() {
  const createPhase = useMutation(api.schedule.createPhase);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await createPhase({ name });
      setName("");
    } catch (err) {
      setError(errorText(err, "No luck."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed p-4">
      <form
        onSubmit={(e) => void add(e)}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="grid min-w-0 flex-1 basis-48 gap-2">
          <Label htmlFor="new-phase">New phase</Label>
          <Input
            id="new-phase"
            placeholder="Design, Build, Test…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={saving || !name.trim()}>
          Add phase
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function ReadOnlyList({
  phases,
  tasks,
  today,
}: {
  phases: Phase[];
  tasks: Task[];
  today: number;
}) {
  return (
    <section className="space-y-4">
      {phases.map((phase) => {
        const list = tasks.filter((t) => t.phaseId === phase._id);
        return (
          <div key={phase._id} className="rounded-lg border bg-card p-4">
            <h2 className="font-semibold">{phase.name}</h2>
            {list.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No tasks.</p>
            ) : (
              <ul className="mt-2 divide-y text-sm">
                {list.map((task) => {
                  const status = taskStatus(task, today);
                  return (
                    <li
                      key={task._id}
                      className="flex flex-wrap justify-between gap-2 py-1.5"
                    >
                      <span
                        className={cn(
                          status === "done" &&
                            "text-muted-foreground line-through",
                        )}
                      >
                        {task.name}
                        {(task.dependsOn ?? []).length > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            after{" "}
                            {(task.dependsOn ?? [])
                              .map(
                                (id) => tasks.find((t) => t._id === id)?.name,
                              )
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground">
                        {formatSpan(task.start, task.end)} ·{" "}
                        <span
                          className={cn(
                            status === "overdue" && "font-medium text-danger",
                            status === "active" && "font-medium text-primary",
                          )}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
