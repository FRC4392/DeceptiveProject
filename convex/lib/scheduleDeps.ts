// How tasks on the schedule wait for each other, and what moves when one
// does. Pure, so the server applies it and the chart previews it while a bar
// is being dragged, from the same code.
//
// The rule is "snug": a task that waits for others starts the day after the
// last of them finishes, and keeps its length. Move what it waits for — later
// or earlier — and it follows, and so does everything waiting on it in turn.
// A task that's done stays put; so does anything only it leads to.
//
// Moving a waiting task itself is allowed to break the rule: drag it to
// start before what it waits for has finished and it's saved there and
// flagged as a clash (see `clashes`), rather than refused.
//
// Days are whole UTC days (Date.UTC of the calendar date), so "the day
// after" is exactly one DAY_MS on, in any zone and across clock changes.

export const DAY_MS = 24 * 60 * 60 * 1000;

export type DepTask = {
  id: string;
  start: number;
  end: number;
  dependsOn: string[];
  done: boolean;
};

export type Span = { start: number; end: number };

/** Who waits for each task: the arrows reversed. */
function dependentsOf(tasks: Iterable<DepTask>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tasks) {
    for (const p of t.dependsOn) {
      const list = out.get(p) ?? [];
      list.push(t.id);
      out.set(p, list);
    }
  }
  return out;
}

/**
 * Would making `taskId` wait for `prereqId` close a loop? It would if the
 * prerequisite already waits — directly or further back — for the task.
 */
export function wouldCycle(
  tasks: DepTask[],
  taskId: string,
  prereqId: string,
): boolean {
  if (taskId === prereqId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [prereqId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.dependsOn ?? []));
  }
  return false;
}

/**
 * Where everything downstream of `roots` lands once they've moved.
 *
 * `tasks` already holds the roots at their new dates. A root keeps those
 * dates unless it's in `snapRoots` — the case when it has just been given
 * something new to wait for, and should line up behind it. Returns only the
 * tasks whose dates change, roots included when they snap.
 */
export function cascade(
  tasks: DepTask[],
  roots: string[],
  snapRoots: string[] = [],
): Map<string, Span> {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  const dependents = dependentsOf(byId.values());
  const snap = new Set(snapRoots);

  // Everything reachable from the roots, in an order where each task comes
  // after everything it waits for (depth-first, finished-first, reversed).
  const order: string[] = [];
  const state = new Map<string, "open" | "done">();
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    // A loop shouldn't exist — writes refuse them — but if one did, stop
    // here rather than recurse forever.
    if (state.get(id) === "open") return;
    state.set(id, "open");
    for (const d of dependents.get(id) ?? []) visit(d);
    state.set(id, "done");
    order.push(id);
  };
  for (const r of roots) visit(r);
  order.reverse();

  const moved = new Set<string>(roots.filter((r) => !snap.has(r)));
  const changes = new Map<string, Span>();
  for (const id of order) {
    const task = byId.get(id);
    if (!task || task.done || task.dependsOn.length === 0) continue;
    const isRoot = roots.includes(id);
    if (isRoot && !snap.has(id)) continue;
    // Only re-line a task when something it waits for actually moved: one
    // with a deliberate gap or clash stays as set until then.
    if (!snap.has(id) && !task.dependsOn.some((p) => moved.has(p))) continue;

    const ends = task.dependsOn
      .map((p) => byId.get(p)?.end)
      .filter((e): e is number => e !== undefined);
    if (ends.length === 0) continue;
    const start = Math.max(...ends) + DAY_MS;
    if (start === task.start) continue;
    const shift = start - task.start;
    task.start = start;
    task.end += shift;
    moved.add(id);
    changes.set(id, { start: task.start, end: task.end });
  }
  return changes;
}

/**
 * The tasks a task starts too soon for: what it waits for that hasn't
 * finished by the day before it starts. Empty when it's lined up, or done.
 */
export function clashes(task: DepTask, byId: Map<string, DepTask>): DepTask[] {
  if (task.done) return [];
  return task.dependsOn
    .map((p) => byId.get(p))
    .filter((p): p is DepTask => p !== undefined && p.end >= task.start);
}
