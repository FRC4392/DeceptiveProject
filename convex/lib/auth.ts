import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  isLeadOrAbove,
  isMentorOrAbove,
  type Actor,
  type Role,
} from "./stages";
import { activeSeason } from "./season";

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
 * What the stage rules need to decide what this person may do: their role and
 * the subsystems they lead.
 */
export async function getActor(ctx: Ctx): Promise<Actor & { userId: string }> {
  const userId = await requireUserId(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("authId", (q) => q.eq("authId", userId))
    .unique();

  // Scoped to the active season on purpose: it keeps this list in step with
  // the frontend's useActor, which builds it from the season-scoped
  // subsystems.list, and it stops subsystems retired with an old season from
  // lingering in it once a team has a few years of history.
  const season = await activeSeason(ctx);
  const subsystems = season
    ? await ctx.db
        .query("subsystems")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect()
    : [];

  return {
    userId,
    role: effectiveRole(user),
    ledSubsystemIds: subsystems
      .filter((s) => s.leadUserId === userId)
      .map((s) => s._id as string),
  };
}

/**
 * Guard for mentor-only mutations (deletes, settings, role changes).
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
