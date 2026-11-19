import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";
import {
  daysBetween,
  daysIn,
  dragResult,
  formatDay,
  formatSpan,
  overlaps,
  startOfDay,
  STATUS_LABEL,
  taskStatus,
  type DayRange,
  type DragMode,
  type TaskStatus,
} from "@/lib/schedule";

export type GanttPhase = { _id: string; name: string };
export type GanttTask = {
  _id: string;
  phaseId: string;
  name: string;
  start: number;
  end: number;
  doneAt?: number;
};
export type GanttMilestone = { _id: string; name: string; date: number };

const BAR_COLOURS: Record<TaskStatus, string> = {
  done: "bg-success/70 text-white",
  overdue: "bg-danger text-white",
  active: "bg-primary text-primary-foreground",
  // Brighter in the dark theme: a third of the dark primary vanished
  // against the dark card.
  upcoming: "bg-primary/35 text-foreground dark:bg-brand-light/45",
};

/** How long after the last arrow key a nudged bar is saved. */
const NUDGE_SAVE_MS = 600;

type Drag = {
  id: string;
  mode: DragMode;
  originX: number;
  delta: number;
};

/**
 * The season's schedule as a Gantt chart: one row per task under its phase,
 * a line for today, and a dashed line for each event.
 *
 * It scrolls sideways inside its own box, so a long season never makes the
 * page itself scroll. With `onChangeDates`, bars can be dragged (a mouse or
 * pen; a finger still scrolls) or nudged with the arrow keys.
 */
export function GanttChart({
  phases,
  tasks,
  milestones,
  range,
  today,
  dayWidth = 28,
  onChangeDates,
  compact = false,
}: {
  phases: GanttPhase[];
  tasks: GanttTask[];
  milestones: GanttMilestone[];
  range: DayRange;
  today: number;
  dayWidth?: number;
  /** Leave out for a read-only chart. */
  onChangeDates?: (id: string, start: number, end: number) => Promise<unknown>;
  /** Tighter rows and no phase rows' span bars, for the dashboard. */
  compact?: boolean;
}) {
  const editable = onChangeDates !== undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Dates shown ahead of the server while a change is being saved.
  const [pending, setPending] = useState<
    Record<string, { start: number; end: number }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>();
  const nudged = useRef<{ id: string; start: number; end: number } | null>(
    null,
  );

  const day0 = startOfDay(today);
  const days = useMemo(() => daysIn(range), [range]);
  const width = days.length * dayWidth;
  const xOf = (day: number) => daysBetween(range.from, day) * dayWidth;

  /** A task's dates as they should be drawn right now. */
  function shown(task: GanttTask): { start: number; end: number } {
    if (drag && drag.id === task._id && drag.delta !== 0) {
      return dragResult(task, drag.mode, drag.delta);
    }
    return pending[task._id] ?? task;
  }

  async function save(id: string, start: number, end: number) {
    if (!onChangeDates) return;
    setError(null);
    setPending((p) => ({ ...p, [id]: { start, end } }));
    try {
      await onChangeDates(id, start, end);
    } catch (err) {
      setError(errorText(err, "Couldn't move that task."));
    } finally {
      // The query has the saved dates by the time the mutation resolves, so
      // dropping the override here doesn't flicker; on a failure it puts the
      // bar back where the server has it.
      setPending((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }

  function flushNudge() {
    clearTimeout(nudgeTimer.current);
    const n = nudged.current;
    nudged.current = null;
    if (n) void save(n.id, n.start, n.end);
  }

  useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  // Open with today in view: a quarter of the way in, so what's just gone
  // and what's coming both show.
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box || scrolled.current) return;
    scrolled.current = true;
    const label = labelRef.current?.offsetWidth ?? 0;
    const visible = box.clientWidth - label;
    const target = xOf(day0) - visible / 4;
    box.scrollLeft = Math.max(0, target);
    // Only on first draw: re-centring on every update would yank the chart
    // away from wherever someone had scrolled to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byPhase = useMemo(() => {
    const map = new Map<string, GanttTask[]>();
    for (const t of tasks) {
      const list = map.get(t.phaseId) ?? [];
      list.push(t);
      map.set(t.phaseId, list);
    }
    return map;
  }, [tasks]);

  const visibleMilestones = milestones.filter((m) => {
    const d = startOfDay(m.date);
    return d >= range.from && d <= range.to;
  });
  const todayInRange = day0 >= range.from && day0 <= range.to;

  // Light vertical lines at the start of each week (Monday).
  const firstMonday = days.findIndex((d) => new Date(d).getDay() === 1);
  // One tile per week with its line at the left edge, shifted to the first
  // Monday. (A single gradient the width of the row wrapped round when
  // shifted, and drew a stray line where it met itself.)
  const gridStyle: React.CSSProperties = {
    width,
    backgroundImage:
      "linear-gradient(to right, hsl(var(--border)) 0 1px, transparent 1px)",
    backgroundSize: `${7 * dayWidth}px 100%`,
    backgroundRepeat: "repeat-x",
    backgroundPositionX: `${Math.max(0, firstMonday) * dayWidth}px`,
  };

  /** Today and the events, drawn down every row so they line up. */
  function lines() {
    return (
      <>
        {visibleMilestones.map((m) => (
          <div
            key={m._id}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-warning"
            style={{ left: xOf(startOfDay(m.date)) + dayWidth / 2 }}
          />
        ))}
        {todayInRange && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger"
            style={{ left: xOf(day0) + dayWidth / 2 - 1 }}
          />
        )}
      </>
    );
  }

  function onPointerDown(e: React.PointerEvent, task: GanttTask) {
    if (!editable || e.button !== 0) return;
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    const mode =
      ((e.target as HTMLElement).dataset.mode as DragMode | undefined) ??
      "move";
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    flushNudge();
    setDrag({ id: task._id, mode, originX: e.clientX, delta: 0 });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.originX) / dayWidth);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  }

  function onPointerUp(task: GanttTask) {
    if (!drag) return;
    const { mode, delta } = drag;
    setDrag(null);
    if (delta === 0) return;
    const result = dragResult(pending[task._id] ?? task, mode, delta);
    void save(task._id, result.start, result.end);
  }

  function onKeyDown(e: React.KeyboardEvent, task: GanttTask) {
    if (!editable) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    const from = nudged.current?.id === task._id ? nudged.current : shown(task);
    if (nudged.current && nudged.current.id !== task._id) flushNudge();
    const result = dragResult(from, e.shiftKey ? "end" : "move", step);
    nudged.current = { id: task._id, ...result };
    setPending((p) => ({ ...p, [task._id]: result }));
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(flushNudge, NUDGE_SAVE_MS);
  }

  const rowH = compact ? "h-8" : "h-9";
  const labelW = compact ? "w-28 sm:w-40" : "w-32 sm:w-48";

  function bar(task: GanttTask) {
    const { start, end } = shown(task);
    if (!overlaps({ start, end }, range)) return null;
    const status = taskStatus({ start, end, doneAt: task.doneAt }, today);
    const clippedStart = start < range.from;
    const clippedEnd = end > range.to;
    const left = xOf(clippedStart ? range.from : start);
    const right = xOf(clippedEnd ? range.to : end) + dayWidth;
    const label = `${task.name}: ${formatSpan(start, end)}, ${STATUS_LABEL[status]}`;
    const dragging = drag?.id === task._id;

    const className = cn(
      "absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md px-1.5 text-left text-[11px] font-medium leading-none shadow-sm",
      BAR_COLOURS[status],
      clippedStart && "rounded-l-none",
      clippedEnd && "rounded-r-none",
      editable &&
        "cursor-grab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      dragging && "cursor-grabbing ring-2 ring-ring",
    );
    const style = { left: left + 1, width: Math.max(right - left - 2, 6) };
    const text = <span className="truncate">{task.name}</span>;

    if (!editable) {
      return (
        <div className={className} style={style} title={label}>
          {text}
          <span className="sr-only">{label}</span>
        </div>
      );
    }
    return (
      <button
        type="button"
        className={className}
        style={style}
        title={label}
        aria-label={label}
        aria-describedby="gantt-keys"
        onPointerDown={(e) => onPointerDown(e, task)}
        onPointerMove={onPointerMove}
        onPointerUp={() => onPointerUp(task)}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => onKeyDown(e, task)}
        onBlur={flushNudge}
      >
        {!clippedStart && (
          <span
            data-mode="start"
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-black/20"
          />
        )}
        {text}
        {!clippedEnd && (
          <span
            data-mode="end"
            aria-hidden="true"
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-black/20"
          />
        )}
      </button>
    );
  }

  // Month names along the top, at each first-of-the-month (and the start).
  const monthMarks = days
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => i === 0 || new Date(d).getDate() === 1);
  const mondays = days
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => new Date(d).getDay() === 1);

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        className="relative overflow-x-auto rounded-lg border bg-card"
        role="group"
        aria-label="Schedule chart"
      >
        <div className="relative" style={{ width: "max-content" }}>
          {/* Header: months, then the date of each Monday. */}
          <div className="flex border-b">
            <div
              ref={labelRef}
              className={cn(
                "sticky left-0 z-20 shrink-0 border-r bg-card",
                labelW,
              )}
            />
            <div className="relative h-10" style={{ width }}>
              {monthMarks.map(({ d, i }) => (
                <span
                  key={d}
                  className="absolute top-1 whitespace-nowrap pl-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  style={{ left: i * dayWidth }}
                >
                  {new Date(d).toLocaleDateString(undefined, {
                    month: "short",
                  })}
                </span>
              ))}
              {mondays.map(({ d, i }) => (
                <span
                  key={d}
                  className="absolute bottom-1 border-l pl-1 text-[11px] text-muted-foreground"
                  style={{ left: i * dayWidth }}
                >
                  {new Date(d).getDate()}
                </span>
              ))}
              {todayInRange && (
                <span
                  className="absolute top-1 z-10 -translate-x-1/2 rounded bg-danger px-1 text-[10px] font-semibold uppercase leading-4 text-white"
                  style={{ left: xOf(day0) + dayWidth / 2 }}
                >
                  Today
                </span>
              )}
            </div>
          </div>

          {visibleMilestones.length > 0 && (
            <div className="flex border-b">
              <div
                className={cn(
                  "sticky left-0 z-20 flex shrink-0 items-center border-r bg-card px-3 text-xs font-semibold text-muted-foreground",
                  labelW,
                  rowH,
                )}
              >
                Events
              </div>
              <div className={cn("relative", rowH)} style={gridStyle}>
                {lines()}
                {visibleMilestones.map((m) => {
                  const x = xOf(startOfDay(m.date)) + dayWidth / 2;
                  // Near the right-hand end the name goes on the left of
                  // its marker, or it would run off the chart.
                  const flip = x > width * 0.75;
                  return (
                    <span
                      key={m._id}
                      className={cn(
                        "absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap text-[11px] font-medium",
                        flip && "-translate-x-full flex-row-reverse",
                      )}
                      style={{ left: flip ? x + 5 : x - 5 }}
                      title={`${m.name} · ${formatDay(m.date)}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 rotate-45 bg-warning"
                      />
                      {m.name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {phases.map((phase) => {
            const list = byPhase.get(phase._id) ?? [];
            const spans = list.map(shown);
            const phaseStart = spans.length
              ? Math.min(...spans.map((s) => s.start))
              : undefined;
            const phaseEnd = spans.length
              ? Math.max(...spans.map((s) => s.end))
              : undefined;
            return (
              <div key={phase._id}>
                <div className="flex border-b bg-muted/40">
                  <div
                    className={cn(
                      "sticky left-0 z-20 flex shrink-0 items-center border-r bg-muted px-3 text-xs font-semibold uppercase tracking-wide",
                      labelW,
                      rowH,
                    )}
                  >
                    <span className="truncate">{phase.name}</span>
                  </div>
                  <div className={cn("relative", rowH)} style={gridStyle}>
                    {lines()}
                    {!compact &&
                      phaseStart !== undefined &&
                      phaseEnd !== undefined &&
                      overlaps({ start: phaseStart, end: phaseEnd }, range) && (
                        <div
                          aria-hidden="true"
                          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/25"
                          style={{
                            left: xOf(Math.max(phaseStart, range.from)),
                            width:
                              xOf(Math.min(phaseEnd, range.to)) -
                              xOf(Math.max(phaseStart, range.from)) +
                              dayWidth,
                          }}
                        />
                      )}
                  </div>
                </div>
                {list.map((task) => (
                  <div key={task._id} className="flex border-b last:border-b-0">
                    <div
                      className={cn(
                        "sticky left-0 z-20 flex shrink-0 items-center border-r bg-card px-3 text-sm",
                        labelW,
                        rowH,
                      )}
                    >
                      <span
                        className={cn(
                          "truncate",
                          task.doneAt !== undefined &&
                            "text-muted-foreground line-through",
                        )}
                      >
                        {task.name}
                      </span>
                    </div>
                    <div className={cn("relative", rowH)} style={gridStyle}>
                      {lines()}
                      {bar(task)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legend className={BAR_COLOURS.active} label="In progress" />
        <Legend className={BAR_COLOURS.upcoming} label="Upcoming" />
        <Legend className={BAR_COLOURS.overdue} label="Overdue" />
        <Legend className={BAR_COLOURS.done} label="Done" />
        {editable && (
          <span id="gantt-keys" className="basis-full sm:basis-auto sm:ml-auto">
            Drag a bar or its ends to change dates. Focused bar: ←/→ moves a
            day, Shift+←/→ changes the end.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn("h-2.5 w-4 rounded-sm", className)}
      />
      {label}
    </span>
  );
}
