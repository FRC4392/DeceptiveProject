import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  isLeadOrAbove,
  isMentorOrAbove,
  type Actor,
  type Role,
} from "./stages";

type Ctx = QueryCtx | MutationCtx;

/**
 * The current authenticated user's Clerk id, or null. This is the value stored
 * in `users.authId`, `assigneeIds`, `parts.claimedByUserId`, etc.
 */
export async function getUserId(ctx: Ctx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

export async function requireUserId(ctx: Ctx): Promise<string> {
  const id = await getUserId(ctx);
  if (!id) throw new Error("Not authenticated");
  return id;
}

/**
 * The synced local `users` row for the current user.
 * Returns null if unauthenticated or if the Clerk user has not been stored yet.
 */
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const id = await getUserId(ctx);
  if (!id) return null;
  return ctx.db
    .query("users")
    .withIndex("authId", (q) => q.eq("authId", id))
    .unique();
}

/**
 * The role the app acts on. Clerk owns mentor/student and overwrites `role` on
 * every sync, so the tracker's own lead/admin assignments live in `appRole`
 * and win when set.
 */
export function effectiveRole(user: Doc<"users"> | null): Role {
  if (!user) return "student";
  if (user.appRole) return user.appRole;
  return user.role === "mentor" ? "mentor" : "student";
}

export async function currentRole(ctx: Ctx): Promise<Role> {
  return effectiveRole(await getCurrentUser(ctx));
}

/**
 * Everything the stage rules need to decide what this person may do: their
 * role, the machines they're signed off on, and the subsystems they lead.
 */
export async function getActor(ctx: Ctx): Promise<Actor & { userId: string }> {
  const userId = await requireUserId(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("authId", (q) => q.eq("authId", userId))
    .unique();

  const training = await ctx.db
    .query("training")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  // Subsystems are a small, mentor-managed set, so a scan is cheaper than an
  // index that exists only for this lookup.
  const subsystems = await ctx.db.query("subsystems").collect();

  return {
    userId,
    role: effectiveRole(user),
    trainedMachineIds: training.map((t) => t.machineId as string),
    ledSubsystemIds: subsystems
      .filter((s) => s.leadUserId === userId)
      .map((s) => s._id as string),
  };
}

/**
 * Guard for mentor-only mutations (deletes, settings, training sign-offs).
 * Admins count as mentors.
 */
export async function requireMentor(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (!isMentorOrAbove(effectiveRole(user))) {
    throw new Error("This action requires the mentor role.");
  }
  return user;
}

/** Guard for lead-and-above actions (drawing checks, moving parts back). */
export async function requireLead(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (!isLeadOrAbove(effectiveRole(user))) {
    throw new Error("This action requires a design lead or mentor.");
  }
  return user;
}
