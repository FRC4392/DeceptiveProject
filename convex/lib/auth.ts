import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * The current authenticated user's WorkOS id, or null. This is the value
 * stored in `assigneeIds`, `taskComments.authorId`, etc. We use
 * `identity.subject` (the WorkOS user id) consistently across the app,
 * matching `users.authId`.
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
 * The synced local `users` row for the current user, including `role`.
 * Returns null if unauthenticated or if the WorkOS webhook hasn't synced
 * the user yet.
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
 * Guard for mentor-only mutations (deletes, board management, integration
 * settings, doc-number assignment). Throws if the current user isn't a
 * mentor. Roles come from WorkOS via `syncRoleFromWorkOS`.
 */
export async function requireMentor(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (user.role !== "mentor") {
    throw new Error("This action requires the mentor role.");
  }
  return user;
}
