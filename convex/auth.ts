import { query, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit";
import type { DataModel } from "./_generated/dataModel";
import { v } from "convex/values";

// Shape of the WorkOS profile returned by authKit.getAuthUser, mirroring
// the component's own `users` table (see the workOSAuthKit component schema).
const vAuthUser = v.object({
  id: v.string(),
  email: v.string(),
  name: v.optional(v.union(v.null(), v.string())),
  firstName: v.optional(v.union(v.null(), v.string())),
  lastName: v.optional(v.union(v.null(), v.string())),
  emailVerified: v.boolean(),
  profilePictureUrl: v.optional(v.union(v.null(), v.string())),
  lastSignInAt: v.optional(v.union(v.null(), v.string())),
  externalId: v.optional(v.union(v.null(), v.string())),
  metadata: v.record(v.string(), v.any()),
  locale: v.optional(v.union(v.null(), v.string())),
  createdAt: v.string(),
  updatedAt: v.string(),
  // Merged in from our local `users` row (WorkOS is the source of truth,
  // synced via syncRoleFromWorkOS). Defaults to "student" when unknown.
  role: v.union(v.literal("mentor"), v.literal("student")),
});

const authFunctions: AuthFunctions = internal.auth;

// AuthKit client, wired to the workOSAuthKit component installed in
// convex/convex.config.ts. WORKOS_CLIENT_ID, WORKOS_API_KEY and
// WORKOS_WEBHOOK_SECRET are read from the Convex deployment environment
// (set via `npx convex env set`, not a local .env file).
export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
});

// Sync WorkOS user create/update/delete events (delivered via the
// /workos/webhook route registered in convex/http.ts) into our own
// `users` table, so app code can query users without depending on the
// component's internal storage.
export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    await ctx.db.insert("users", {
      authId: event.data.id,
      email: event.data.email,
      name: `${event.data.firstName ?? ""} ${event.data.lastName ?? ""}`.trim(),
    });
    // Roles live in WorkOS. The webhook handler runs as a mutation and
    // can't call external APIs, so fetch the role in a scheduled action.
    await ctx.scheduler.runAfter(0, internal.authActions.syncRoleFromWorkOS, {
      authId: event.data.id,
    });
  },
  "user.updated": async (ctx, event) => {
    const user = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", event.data.id))
      .unique();
    if (!user) {
      console.warn(`User not found: ${event.data.id}`);
      return;
    }
    await ctx.db.patch(user._id, {
      email: event.data.email,
      name: `${event.data.firstName ?? ""} ${event.data.lastName ?? ""}`.trim(),
    });
    await ctx.scheduler.runAfter(0, internal.authActions.syncRoleFromWorkOS, {
      authId: event.data.id,
    });
  },
  "user.deleted": async (ctx, event) => {
    const user = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", event.data.id))
      .unique();
    if (!user) {
      console.warn(`User not found: ${event.data.id}`);
      return;
    }
    await ctx.db.delete(user._id);
  },
});

// Backfill users who already exist in the WorkOS team (e.g. created by
// another app on the same team) into the component's user table, firing
// the user.created handler above so our own `users` table gets populated
// too. Run once via `npx convex run auth:backfillUsers`.
export const { backfillUsers } = authKit.utils();

// Exposes the current authenticated user, including WorkOS profile data,
// to the frontend.
export const currentUser = query({
  args: {},
  returns: v.union(vAuthUser, v.null()),
  handler: async (ctx) => {
    const profile = await authKit.getAuthUser(ctx);
    if (!profile) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", profile.id))
      .unique();
    return { ...profile, role: user?.role ?? ("student" as const) };
  },
});

// Patches the WorkOS-derived role onto the local `users` row. Called only
// by the syncRoleFromWorkOS action.
export const setRole = internalMutation({
  args: {
    authId: v.string(),
    role: v.union(v.literal("mentor"), v.literal("student")),
  },
  returns: v.null(),
  handler: async (ctx, { authId, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", authId))
      .unique();
    if (user) {
      await ctx.db.patch(user._id, { role });
    }
    return null;
  },
});
