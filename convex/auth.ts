import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { GenericMutationCtx, UserIdentity } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { createClerkClient, type User } from "@clerk/backend";
import {
  readerRole,
  roleFromIdentity,
  roleFromValue,
  roleOf,
} from "./lib/auth";
import type { UserJSON, WebhookEvent } from "@clerk/backend";
import { Webhook } from "svix";

type Role = "mentor" | "student";
type MutationCtx = GenericMutationCtx<DataModel>;

const USER_SYNC_PAGE_SIZE = 100;

const roleValidator = v.union(v.literal("mentor"), v.literal("student"));

// What the app acts on: Clerk's mentor/student flag, unless a mentor has given
// this person a tracker role of their own (see convex/lib/auth.ts).
const appRoleValidator = v.union(
  v.literal("student"),
  v.literal("lead"),
  v.literal("mentor"),
  v.literal("admin"),
);

const vCurrentUser = v.object({
  id: v.string(),
  email: v.string(),
  name: v.string(),
  role: appRoleValidator,
});

/** The best name the session token offers, or "" when it offers none. */
function nameFromIdentity(identity: UserIdentity): string {
  const fullName = identity.name?.trim();
  if (fullName) return fullName;
  const parts = [identity.givenName, identity.familyName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (parts.length > 0) return parts.join(" ");
  return identity.email?.trim() ?? "";
}

/**
 * Write what we know about a Clerk user.
 *
 * `authoritative` marks data read from the Clerk API itself (the webhook and
 * the roster backfill), which may legitimately clear a field. Everything else
 * comes from the session token, which only carries the claims the JWT template
 * was configured to include — so a missing name, email or role there means
 * "the token didn't say", not "it's empty now", and must leave what we have
 * alone.
 */
async function upsertUser(
  ctx: MutationCtx,
  user: {
    authId: string;
    email?: string;
    name?: string;
    role?: Role;
  },
  options: { authoritative?: boolean } = {},
) {
  const existing = await ctx.db
    .query("users")
    .withIndex("authId", (q) => q.eq("authId", user.authId))
    .unique();

  if (!existing) {
    await ctx.db.insert("users", {
      authId: user.authId,
      email: user.email ?? "",
      name: user.name || user.authId,
      role: user.role ?? "student",
    });
    return;
  }

  const authoritative = options.authoritative ?? false;
  const patch: Partial<Doc<"users">> = {};
  if (authoritative || (user.email ?? "").length > 0) {
    patch.email = user.email ?? "";
  }
  if (authoritative || (user.name ?? "").length > 0) {
    patch.name = user.name || user.authId;
  }
  if (authoritative || user.role !== undefined) {
    patch.role = user.role ?? "student";
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
}

function primaryEmailFromUserJSON(user: UserJSON): string {
  const primary = user.email_addresses.find(
    (email) => email.id === user.primary_email_address_id,
  );
  return primary?.email_address ?? user.email_addresses[0]?.email_address ?? "";
}

function nameFromUserJSON(user: UserJSON): string {
  const parts = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return (
    parts.join(" ") ||
    user.username ||
    primaryEmailFromUserJSON(user) ||
    user.id
  );
}

function clerkUserArgs(user: UserJSON) {
  return {
    authId: user.id,
    email: primaryEmailFromUserJSON(user),
    name: nameFromUserJSON(user),
    role: roleFromValue(user.public_metadata?.role),
  };
}

function clerkBackendUserArgs(user: User) {
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  return {
    authId: user.id,
    email,
    name: user.fullName ?? user.username ?? email ?? user.id,
    role: roleFromValue(user.publicMetadata.role),
  };
}

export const currentUser = query({
  args: {},
  returns: v.union(vCurrentUser, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", identity.subject))
      .unique();

    return {
      id: identity.subject,
      email: user?.email ?? identity.email ?? "",
      name: user?.name ?? nameFromIdentity(identity),
      // The same answer the server's read guards act on, so a page can't
      // render for someone the queries behind it will refuse.
      role: roleOf(user, identity),
    };
  },
});

export const storeCurrentUser = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await upsertUser(ctx, {
      authId: identity.subject,
      email: identity.email,
      name: nameFromIdentity(identity),
      role: roleFromIdentity(identity),
    });
    return null;
  },
});

export const callerRole = internalQuery({
  args: {},
  returns: v.union(appRoleValidator, v.null()),
  handler: (ctx) => readerRole(ctx),
});

export const upsertUserFromClerk = internalMutation({
  args: {
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    role: roleValidator,
  },
  returns: v.null(),
  handler: async (ctx, user) => {
    await upsertUser(ctx, user, { authoritative: true });
    return null;
  },
});

export const deleteUserFromClerk = internalMutation({
  args: { authId: v.string() },
  returns: v.null(),
  handler: async (ctx, { authId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("authId", (q) => q.eq("authId", authId))
      .unique();
    if (user) await ctx.db.delete(user._id);
    return null;
  },
});

export const syncUsersFromClerk = action({
  args: {},
  returns: v.object({ synced: v.number() }),
  handler: async (ctx) => {
    const role = await ctx.runQuery(internal.auth.callerRole, {});
    if (role !== "mentor" && role !== "admin")
      throw new Error("This action requires the mentor role.");

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new Error("Set CLERK_SECRET_KEY in Convex env.");

    const clerk = createClerkClient({ secretKey });
    let offset = 0;
    let synced = 0;
    let hasMore = true;

    while (hasMore) {
      const page = await clerk.users.getUserList({
        limit: USER_SYNC_PAGE_SIZE,
        offset,
      });
      for (const user of page.data) {
        await ctx.runMutation(internal.auth.upsertUserFromClerk, {
          ...clerkBackendUserArgs(user),
        });
        synced += 1;
      }
      offset += page.data.length;
      if (page.data.length < USER_SYNC_PAGE_SIZE || offset >= page.totalCount) {
        hasMore = false;
      }
    }

    return { synced };
  },
});

export const clerkWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("CLERK_WEBHOOK_SECRET is not configured", {
      status: 500,
    });
  }

  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: WebhookEvent;
  try {
    event = new Webhook(secret).verify(payload, headers) as WebhookEvent;
  } catch (err) {
    console.error("Clerk webhook verification failed:", err);
    return new Response("Invalid webhook signature", { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated":
      await ctx.runMutation(internal.auth.upsertUserFromClerk, {
        ...clerkUserArgs(event.data),
      });
      break;
    case "user.deleted":
      if (event.data.id) {
        await ctx.runMutation(internal.auth.deleteUserFromClerk, {
          authId: event.data.id,
        });
      }
      break;
    default:
      break;
  }

  return new Response("ok", { status: 200 });
});
