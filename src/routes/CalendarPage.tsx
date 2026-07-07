import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { statusMeta } from "@/lib/pm";
import { useProjectArg } from "@/lib/project";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarPage() {
  const tasks = useQuery(api.tasks.listAll, useProjectArg());
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Doc<"tasks">[]>();
    for (const t of tasks ?? []) {
      if (t.dueDate === undefined) continue;
      const key = format(new Date(t.dueDate), "yyyy-MM-dd");
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="brand-title text-3xl">Calendar</h1>
          <p className="text-sm text-muted-foreground">Tasks by due date.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMonth((m) => subMonths(m, 1))}
          >
            ←
          </Button>
          <span className="min-w-32 text-center text-sm font-medium">
            {format(month, "MMMM yyyy")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            →
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-sm">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayTasks = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, month);
          const today = isSameDay(day, new Date());
          return (
            <div
              key={key}
              className={cn(
                "min-h-24 bg-background p-1.5 align-top",
                !inMonth && "bg-muted/40 text-muted-foreground",
              )}
            >
              <div
                className={cn(
                  "mb-1 flex h-5 w-5 items-center justify-center rounded-full text-xs",
                  today && "bg-primary text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-1">
                {dayTasks.map((t) => (
                  <Link
                    key={t._id}
                    to={`/tasks/${t._id}`}
                    className={cn(
                      "block truncate rounded px-1 py-0.5 text-[11px]",
                      statusMeta(t.status).badgeClass,
                    )}
                    title={t.title}
                  >
                    {t.title}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
