import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export type Role = "student" | "lead" | "mentor" | "admin";

/** The current authenticated user's Clerk profile + synced role. */
export function useCurrentUser() {
  return useQuery(api.auth.currentUser);
}

/** Role of the current user, defaulting to "student" while loading/unknown. */
export function useRole(): Role {
  const user = useCurrentUser();
  return user?.role ?? "student";
}

/** Mentors and admins: settings, role changes, deletes. */
export function useIsMentor(): boolean {
  const role = useRole();
  return role === "mentor" || role === "admin";
}

/** Leads and above: drawing checks, moving parts back, resolving problems. */
export function useIsLead(): boolean {
  const role = useRole();
  return role === "lead" || role === "mentor" || role === "admin";
}
