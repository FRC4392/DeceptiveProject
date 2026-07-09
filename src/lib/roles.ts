import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export type Role = "mentor" | "student";

/** The current authenticated user's Clerk profile + synced role. */
export function useCurrentUser() {
  return useQuery(api.auth.currentUser);
}

/** Role of the current user, defaulting to "student" while loading/unknown. */
export function useRole(): Role {
  const user = useCurrentUser();
  return user?.role ?? "student";
}

export function useIsMentor(): boolean {
  return useRole() === "mentor";
}
