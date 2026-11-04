import type { UserIdentity } from "convex/server";
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

/** Clerk's mentor flag, read as a role: anything but "mentor" is a student. */
export function roleFromValue(value: unknown): "mentor" | "student" {
  return value === "mentor" ? "mentor" : "student";
}

/**
 * The role the session token claims, or undefined when it carries no `role`
 * claim at all — which is what a Clerk JWT template that hasn't been given the
 * claim looks like. The two cases are not the same: "no claim" must not be
 * read as "not a mentor", or every page load would quietly demote people.
 */
export function roleFromIdentity(
  identity: UserIdentity,
): "mentor" | "student" | undefined {
  return identity.role === undefined ? undefined : roleFromValue(identity.role);
}

/**
 * The role someone *reads* with, or null when nobody is signed in.
 *
 * Every query that isn't for the whole world asks this first. It is the same
 * answer `auth.currentUser` gives the screens, on purpose: when the server and
 * the screens disagree about who you are, a page renders as if you may see it
 * and then comes back empty with nothing to say why.
 *
 * Unlike `requireLead` and `requireMentor` it doesn't need the `users` row.
 * Sign-in writes that row from the browser, and if that write fails the
 * person should be treated as whatever their session says — not locked out of
 * every page with no explanation.
 */
export async function readerRole(ctx: Ctx): Promise<Role | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("authId", (q) => q.eq("authId", identity.subject))
    .unique();
  return roleOf(user, identity);
}

/**
 * The one decision `readerRole` and `auth.currentUser` both make, for a caller
 * that already has the row in hand: the row's role when there is a row, and
 * the session's claim when there isn't one yet.
 */
export function roleOf(
  user: Doc<"users"> | null,
  identity: UserIdentity,
): Role {
  return user ? effectiveRole(user) : (roleFromIdentity(identity) ?? "student");
}

/**
 * Signed in at all. For the reads every member of the team can see. Only asks
 * the session, never the `users` table — there's nothing about the row it
 * needs to know.
 */
export async function canRead(ctx: Ctx): Promise<boolean> {
  return (await ctx.auth.getUserIdentity()) !== null;
}

/** For the reads a lead acts on — the intake queue, the heads-up list. */
export async function canReadAsLead(ctx: Ctx): Promise<boolean> {
  const role = await readerRole(ctx);
  return role !== null && isLeadOrAbove(role);
}

/** For the reads behind the mentor-only admin pages. */
export async function canReadAsMentor(ctx: Ctx): Promise<boolean> {
  const role = await readerRole(ctx);
  return role !== null && isMentorOrAbove(role);
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
