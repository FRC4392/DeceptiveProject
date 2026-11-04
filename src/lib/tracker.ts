// Shared tracker data hooks. Every screen needs the same handful of lookups —
// the season, the subsystems, the processes, and who the signed-in person is
// allowed to be — so they're resolved once here and joined in the components.
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "@/lib/roles";
import { type Actor } from "@/lib/stages";

export function useActiveSeason() {
  return useQuery(api.seasons.active, {});
}

export function useSubsystems() {
  return useQuery(api.subsystems.list, {});
}

export function useSubsystemMap(): Map<Id<"subsystems">, Doc<"subsystems">> {
  const subsystems = useSubsystems();
  return useMemo(
    () => new Map((subsystems ?? []).map((s) => [s._id, s])),
    [subsystems],
  );
}

export function useProcessTypes() {
  return useQuery(api.shop.listProcessTypes, {});
}

export function useProcessMap(): Map<Id<"processTypes">, Doc<"processTypes">> {
  const processes = useProcessTypes();
  return useMemo(
    () => new Map((processes ?? []).map((p) => [p._id, p])),
    [processes],
  );
}

export function useMachines() {
  return useQuery(api.shop.listMachines, {});
}

export function useMachineMap(): Map<Id<"machines">, Doc<"machines">> {
  const machines = useMachines();
  return useMemo(
    () => new Map((machines ?? []).map((m) => [m._id, m])),
    [machines],
  );
}

/**
 * The signed-in person as the stage rules see them. Used to disable a button
 * with the same reason the server would refuse it, rather than letting someone
 * press it and get an error.
 */
export function useActor(): Actor & { userId: string | null; name: string } {
  const user = useCurrentUser();
  const subsystems = useSubsystems();

  return useMemo(() => {
    const userId = user?.id ?? null;
    return {
      userId,
      name: user?.name ?? "",
      role: user?.role ?? "student",
      ledSubsystemIds: (subsystems ?? [])
        .filter((s) => userId !== null && s.leadUserId === userId)
        .map((s) => s._id as string),
    };
  }, [user, subsystems]);
}
