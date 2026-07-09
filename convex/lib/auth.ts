import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * The current authenticated user's Clerk id, or null. This is the value stored
 * in `users.authId`, `assigneeIds`, `taskComments.authorId`, etc.
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
 * Guard for mentor-only mutations (deletes, board management, integration
 * settings, doc-number assignment). Throws if the current user isn't a
 * mentor. Roles come from Clerk public metadata, cached on the local `users`
 * row by sign-in storage, Clerk webhooks, and Clerk backfill sync.
 */
export async function requireMentor(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (user.role !== "mentor") {
    throw new Error("This action requires the mentor role.");
  }
  return user;
}
