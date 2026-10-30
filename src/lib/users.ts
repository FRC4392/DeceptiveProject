import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

import type { Role } from "@/lib/roles";

export type RosterEntry = {
  authId: string;
  name: string;
  email: string;
  /** The role the app acts on: a mentor-assigned one wins over Clerk's. */
  role: Role;
};

/** The full team roster (bounded, small set). */
export function useRoster(): RosterEntry[] | undefined {
  const users = useQuery(api.users.list);
  return users?.map((u) => ({
    authId: u.authId,
    name: u.name || u.email,
    email: u.email,
    role: u.appRole ?? (u.role === "mentor" ? "mentor" : "student"),
  }));
}

/** Map of Clerk user id -> roster entry, for resolving assignees/authors. */
export function useRosterMap(): Record<string, RosterEntry> {
  const roster = useRoster();
  return useMemo(() => {
    const map: Record<string, RosterEntry> = {};
    for (const entry of roster ?? []) map[entry.authId] = entry;
    return map;
  }, [roster]);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}
