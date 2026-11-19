import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/errors";
import {
  dateOfMonth,
  dayOf,
  daysBetween,
  daysIn,
  dragResult,
  formatDay,
  formatMonth,
  formatSpan,
  overlaps,
  STATUS_LABEL,
  taskStatus,
  weekday,
  type DayRange,
  type DragMode,
  type TaskStatus,
} from "@/lib/schedule";
import {
  cascade,
  clashes,
  type DepTask,
  type Span,
} from "../../../convex/lib/scheduleDeps";

export type GanttPhase = { _id: string; name: string };
export type GanttTask = {
  _id: string;
  phaseId: string;
  name: string;
  start: number;
  end: number;
  doneAt?: number;
  dependsOn?: string[];
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

/** Row heights in px, matching `h-8` / `h-9`, plus each row's 1px border. */
const HEADER_PX = 40 + 1;

type Drag = {
  id: string;
  mode: DragMode;
  originX: number;
  delta: number;
};

/**
 * The season's schedule as a Gantt chart: one row per task under its phase,
 * a line for today, a dashed line for each event, and an arrow from each
 * task to the ones waiting for it.
 *
 * It scrolls sideways inside its own box, so a long season never makes the
 * page itself scroll. With `onChangeDates`, bars can be dragged (a mouse or
 * pen; a finger still scrolls) or nudged with the arrow keys, and whatever
 * waits on the bar is shown following it before the save lands.
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
  /** Today, as a schedule day (see `dayOf`). */
  today: number;
  dayWidth?: number;
  /** Leave out for a read-only chart. */
  onChangeDates?: (id: string, start: number, end: number) => Promise<unknown>;
  /** Tighter rows and no phase span bars, for the dashboard. */
  compact?: boolean;
}) {
  const editable = onChangeDates !== undefined;
  const markerId = useId().replace(/:/g, "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Dates shown ahead of the server while a change is being saved: the task
  // that moved and everything that follows it.
  const [pending, setPending] = useState<Record<string, Span>>({});
  const [nudge, setNudge] = useState<{ id: string; span: Span } | null>(null);
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => daysIn(range), [range]);
  const width = days.length * dayWidth;
  const xOf = (day: number) => daysBetween(range.from, day) * dayWidth;

  // ---- Where every bar is right now ----

  /** Saved dates, with anything still being saved laid over them. */
  const base: DepTask[] = tasks.map((t) => ({
    id: t._id,
    start: pending[t._id]?.start ?? t.start,
    end: pending[t._id]?.end ?? t.end,
    dependsOn: t.dependsOn ?? [],
    done: t.doneAt !== undefined,
  }));
  const baseById = new Map(base.map((t) => [t.id, t]));

  /** The bar being dragged or nudged, at the dates it's been moved to. */
  const live: { id: string; span: Span } | null =
    drag && drag.delta !== 0 && baseById.has(drag.id)
      ? {
          id: drag.id,
          span: dragResult(baseById.get(drag.id)!, drag.mode, drag.delta),
        }
      : nudge;

  /** `base` with `edit` applied, and everything downstream pushed along. */
  function withMove(edit: { id: string; span: Span }): Map<string, Span> {
    const moved = base.map((t) =>
      t.id === edit.id ? { ...t, ...edit.span } : t,
    );
    const changes = cascade(moved, [edit.id]);
    changes.set(edit.id, edit.span);
    return changes;
  }

  const preview = live ? withMove(live) : new Map<string, Span>();
  const shownById = new Map<string, DepTask>(
    base.map((t) => [t.id, { ...t, ...preview.get(t.id) }]),
  );
  const shown = (id: string) => shownById.get(id)!;

  async function save(edit: { id: string; span: Span }) {
    if (!onChangeDates) return;
    setError(null);
    const changes = withMove(edit);
    setPending((p) => ({ ...p, ...Object.fromEntries(changes) }));
    try {
      await onChangeDates(edit.id, edit.span.start, edit.span.end);
    } catch (err) {
      setError(errorText(err, "Couldn't move that task."));
    } finally {
      // The query has the saved dates by the time the mutation resolves, so
      // dropping the override here doesn't flicker; on a failure it puts the
      // bars back where the server has them.
      setPending((p) => {
        const next = { ...p };
        for (const id of changes.keys()) delete next[id];
        return next;
      });
    }
  }

  function flushNudge() {
    clearTimeout(nudgeTimer.current);
    const n = nudgeRef.current;
    if (!n) return;
    nudgeRef.current = null;
    setNudge(null);
    void save(n);
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
    box.scrollLeft = Math.max(0, Math.round(xOf(today) - visible / 4));
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

  const visibleMilestones = milestones
    .map((m) => ({ ...m, day: dayOf(m.date) }))
    .filter((m) => m.day >= range.from && m.day <= range.to);
  const todayInRange = today >= range.from && today <= range.to;

  // ---- Rows, and where each task's row sits (for the arrows) ----

  const rowPx = compact ? 32 : 36;
  const rowH = compact ? "h-8" : "h-9";
  const labelW = compact ? "w-28 sm:w-40" : "w-32 sm:w-48";
  const arrowsLeft = compact ? "left-28 sm:left-40" : "left-32 sm:left-48";

  const rowMid = new Map<string, number>();
  let y = HEADER_PX + (visibleMilestones.length > 0 ? rowPx + 1 : 0);
  for (const phase of phases) {
    y += rowPx + 1;
    for (const task of byPhase.get(phase._id) ?? []) {
      rowMid.set(task._id, y + rowPx / 2);
      y += rowPx + 1;
    }
  }
  const totalHeight = y;

  // Light vertical lines at the start of each week (Monday). One tile per
  // week with its line at the left edge, shifted to the first Monday.
  const firstMonday = days.findIndex((d) => weekday(d) === 1);
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
            style={{ left: xOf(m.day) + dayWidth / 2 }}
          />
        ))}
        {todayInRange && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger"
            style={{ left: xOf(today) + dayWidth / 2 - 1 }}
          />
        )}
      </>
    );
  }

  /** An elbowed arrow from the end of each prerequisite to its dependant. */
  function arrows() {
    const paths: { key: string; d: string; clash: boolean }[] = [];
    for (const task of tasks) {
      const to = shown(task._id);
      const y2 = rowMid.get(task._id);
      if (y2 === undefined || !overlaps(to, range)) continue;
      for (const prereqId of to.dependsOn) {
        const from = shownById.get(prereqId);
        const y1 = rowMid.get(prereqId);
        if (!from || y1 === undefined || !overlaps(from, range)) continue;
        const x1 = xOf(from.end) + dayWidth;
        const x2 = xOf(to.start);
        const clash = !to.done && from.end >= to.start;
        let d: string;
        if (x2 - x1 >= 12) {
          d = `M${x1} ${y1} H${x1 + 6} V${y2} H${x2 - 2}`;
        } else {
          // No room to go straight across: step down between the rows and
          // come back in from the left.
          const between = y2 + (y2 > y1 ? -rowPx / 2 : rowPx / 2);
          d = `M${x1} ${y1} H${x1 + 6} V${between} H${x2 - 8} V${y2} H${x2 - 2}`;
        }
        paths.push({ key: `${prereqId}>${task._id}`, d, clash });
      }
    }
    if (paths.length === 0) return null;
    return (
      <svg
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0 z-10 overflow-visible",
          arrowsLeft,
        )}
        width={width}
        height={totalHeight}
      >
        <defs>
          {(["ok", "clash"] as const).map((kind) => (
            <marker
              key={kind}
              id={`${markerId}-${kind}`}
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path
                d="M0 0 L6 3 L0 6 z"
                className={
                  kind === "clash" ? "fill-danger" : "fill-muted-foreground"
                }
              />
            </marker>
          ))}
        </defs>
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            strokeWidth={1.5}
            className={p.clash ? "stroke-danger" : "stroke-muted-foreground"}
            strokeDasharray={p.clash ? "3 2" : undefined}
            markerEnd={`url(#${markerId}-${p.clash ? "clash" : "ok"})`}
          />
        ))}
      </svg>
    );
  }

  // ---- Panning: grab the chart anywhere but a bar and drag it ----

  const pan = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    page: HTMLElement | null;
    moved: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);

  /** The nearest box above the chart that scrolls up and down: the page. */
  function pageScroller(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const { overflowY } = getComputedStyle(p);
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        p.scrollHeight > p.clientHeight
      ) {
        return p;
      }
    }
    return (document.scrollingElement as HTMLElement | null) ?? null;
  }

  function onPanDown(e: React.PointerEvent<HTMLDivElement>) {
    // A finger already scrolls the box natively; a bar has its own drag.
    if (e.pointerType === "touch" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-bar]")) return;
    const box = e.currentTarget;
    pan.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: box.scrollLeft,
      top: 0,
      page: null,
      moved: false,
    };
  }

  function onPanMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pan.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved) {
      // A few pixels of slack, so a plain click is still a click.
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      p.moved = true;
      p.page = pageScroller(e.currentTarget);
      p.top = p.page?.scrollTop ?? 0;
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
    }
    e.preventDefault();
    e.currentTarget.scrollLeft = p.left - dx;
    if (p.page) p.page.scrollTop = p.top - dy;
  }

  function onPanEnd(e: React.PointerEvent<HTMLDivElement>) {
    const p = pan.current;
    if (!p || p.pointerId !== e.pointerId) return;
    pan.current = null;
    if (p.moved) setPanning(false);
  }

  // ---- Moving bars ----

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

  function onPointerUp() {
    if (!drag) return;
    const edit = live;
    setDrag(null);
    if (edit && drag.delta !== 0) void save(edit);
  }

  function onKeyDown(e: React.KeyboardEvent, task: GanttTask) {
    if (!editable) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    if (nudgeRef.current && nudgeRef.current.id !== task._id) flushNudge();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    const from = nudgeRef.current?.span ?? baseById.get(task._id)!;
    const next = {
      id: task._id,
      span: dragResult(from, e.shiftKey ? "end" : "move", step),
    };
    nudgeRef.current = next;
    setNudge(next);
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(flushNudge, NUDGE_SAVE_MS);
  }

  function bar(task: GanttTask) {
    const now = shown(task._id);
    const { start, end } = now;
    if (!overlaps(now, range)) return null;
    const status = taskStatus({ start, end, doneAt: task.doneAt }, today);
    const clashing = clashes(now, shownById);
    const clippedStart = start < range.from;
    const clippedEnd = end > range.to;
    const left = xOf(clippedStart ? range.from : start);
    const right = xOf(clippedEnd ? range.to : end) + dayWidth;
    const names = (ids: { id: string }[]) =>
      ids
        .map((c) => tasks.find((t) => t._id === c.id)?.name)
        .filter(Boolean)
        .join(", ");
    const label =
      `${task.name}: ${formatSpan(start, end)}, ${STATUS_LABEL[status]}` +
      (clashing.length > 0
        ? `. Starts before ${names(clashing)} finishes`
        : "");
    const dragging = drag?.id === task._id;
    const following = !dragging && preview.has(task._id);

    const className = cn(
      "absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-hidden rounded-md px-1.5 text-left text-[11px] font-medium leading-none shadow-sm",
      BAR_COLOURS[status],
      clippedStart && "rounded-l-none",
      clippedEnd && "rounded-r-none",
      clashing.length > 0 && "ring-2 ring-inset ring-danger",
      editable &&
        "cursor-move focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      dragging && "ring-2 ring-ring",
      following && "opacity-80 ring-1 ring-ring",
    );
    const style = { left: left + 1, width: Math.max(right - left - 2, 6) };
    const text = (
      <>
        {clashing.length > 0 && (
          <ExclamationTriangleIcon
            aria-hidden="true"
            className="h-3 w-3 shrink-0"
          />
        )}
        <span className="truncate">{task.name}</span>
      </>
    );

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
        data-bar=""
        className={className}
        style={style}
        title={label}
        aria-label={label}
        aria-describedby="gantt-keys"
        onPointerDown={(e) => onPointerDown(e, task)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
    .filter(({ d, i }) => i === 0 || dateOfMonth(d) === 1);
  const mondays = days
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => weekday(d) === 1);
  const anyLinks = tasks.some((t) => (t.dependsOn ?? []).length > 0);

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        className={cn(
          // No text selection at all: it would start on the first pixel of
          // a drag, before the pan takes over.
          "relative select-none overflow-x-auto rounded-lg border bg-card",
          panning ? "cursor-grabbing" : "cursor-grab",
        )}
        role="group"
        aria-label="Schedule chart"
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
        // Stops the browser starting a text selection or an image drag
        // instead of the pan.
        onDragStart={(e) => e.preventDefault()}
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
                  {formatMonth(d)}
                </span>
              ))}
              {mondays.map(({ d, i }) => (
                <span
                  key={d}
                  className="absolute bottom-1 border-l pl-1 text-[11px] text-muted-foreground"
                  style={{ left: i * dayWidth }}
                >
                  {dateOfMonth(d)}
                </span>
              ))}
              {todayInRange && (
                <span
                  className="absolute top-1 z-10 -translate-x-1/2 rounded bg-danger px-1 text-[10px] font-semibold uppercase leading-4 text-white"
                  style={{ left: xOf(today) + dayWidth / 2 }}
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
                  const x = xOf(m.day) + dayWidth / 2;
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
                      title={`${m.name} · ${formatDay(m.day)}`}
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
            const spans = list.map((t) => shown(t._id));
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
                  <div key={task._id} className="flex border-b">
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

          {arrows()}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legend className={BAR_COLOURS.active} label="In progress" />
        <Legend className={BAR_COLOURS.upcoming} label="Upcoming" />
        <Legend className={BAR_COLOURS.overdue} label="Overdue" />
        <Legend className={BAR_COLOURS.done} label="Done" />
        {anyLinks && (
          <span className="flex items-center gap-1.5">
            <ExclamationTriangleIcon aria-hidden="true" className="h-3 w-3" />
            Starts before what it waits for
          </span>
        )}
        {editable && (
          <span id="gantt-keys" className="basis-full sm:ml-auto sm:basis-auto">
            Drag a bar or its ends to change dates; what waits on it follows.
            Drag anywhere else to scroll. Focused bar: ←/→ moves a day,
            Shift+←/→ changes the end.
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
