import { useEffect, useState } from "react";
import { dayOf } from "@/lib/schedule";

/** Today, as a schedule day (see `dayOf`), moved on when the date rolls over. */
export function useToday(): number {
  const [today, setToday] = useState(() => dayOf(Date.now()));
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    const timer = setTimeout(
      () => setToday(dayOf(Date.now())),
      Math.max(midnight - now.getTime(), 1000),
    );
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}
