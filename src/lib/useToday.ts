import { useEffect, useState } from "react";
import { addDays, startOfDay } from "@/lib/schedule";

/** Today's local midnight, moved on when the date rolls over. */
export function useToday(): number {
  const [today, setToday] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    const untilTomorrow = addDays(today, 1) - Date.now();
    const timer = setTimeout(
      () => setToday(startOfDay(Date.now())),
      Math.max(untilTomorrow, 1000),
    );
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}
