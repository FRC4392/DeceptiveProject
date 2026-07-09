// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";
const WEBHOOK_SECRET = "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

function asClerkUser(role?: "mentor" | "student") {
  return {
    subject: "user_clerk_1",
    issuer: ISSUER,
    email: "mentor@example.com",
    name: "Mentor One",
    role,
  };
}

async function svixHeaders(payload: string) {
  const msgId = "msg_clerk_test";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const keyBytes = Uint8Array.from(atob(WEBHOOK_SECRET), (char) =>
    char.charCodeAt(0),
  );
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${msgId}.${timestamp}.${payload}`),
  );
  const signatureBytes = new Uint8Array(signature);
  const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));
  return {
    "svix-id": msgId,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signatureBase64}`,
  };
}

function clerkUserEvent(type: "user.created" | "user.updated") {
  return JSON.stringify({
    object: "event",
    type,
    data: {
      id: "user_from_webhook",
      object: "user",
      username: null,
      first_name: "Webhook",
      last_name: "Mentor",
      primary_email_address_id: "email_1",
      email_addresses: [
        { id: "email_1", email_address: "webhook@example.com" },
      ],
      public_metadata: { role: "mentor" },
    },
  });
}

describe("Clerk auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("storeCurrentUser upserts the Clerk user and role from session claims", async () => {
    const t = convexTest(schema, modules);
    const user = t.withIdentity(asClerkUser("mentor"));

    await user.mutation(api.auth.storeCurrentUser);
    const current = await user.query(api.auth.currentUser);
    const rows = await user.query(api.users.list);

    expect(current).toEqual({
      id: "user_clerk_1",
      email: "mentor@example.com",
      name: "Mentor One",
      role: "mentor",
    });
    expect(rows).toMatchObject([
      {
        authId: "user_clerk_1",
        email: "mentor@example.com",
        name: "Mentor One",
        role: "mentor",
      },
    ]);
  });

  test("missing Clerk role defaults to student", async () => {
    const t = convexTest(schema, modules);
    const user = t.withIdentity(asClerkUser());

    await user.mutation(api.auth.storeCurrentUser);
    const current = await user.query(api.auth.currentUser);

    expect(current?.role).toBe("student");
  });

  test("mentor guards use the synced Clerk role", async () => {
    const t = convexTest(schema, modules);
    const mentor = t.withIdentity(asClerkUser("mentor"));

    await mentor.mutation(api.auth.storeCurrentUser);
    await expect(
      mentor.mutation(api.boards.create, {
        name: "Controls",
        subsystem: "software",
      }),
    ).resolves.toBeTruthy();

    const student = t.withIdentity({
      subject: "user_student",
      issuer: ISSUER,
      email: "student@example.com",
      name: "Student One",
      role: "student",
    });
    await student.mutation(api.auth.storeCurrentUser);
    await expect(
      student.mutation(api.boards.create, {
        name: "Drive",
        subsystem: "mechanical",
      }),
    ).rejects.toThrow("mentor role");
  });

  test("My Tasks uses Clerk user ids", async () => {
    const t = convexTest(schema, modules);
    const user = t.withIdentity(asClerkUser("student"));
    const boardId = await t.run((ctx) =>
      ctx.db.insert("boards", {
        name: "Software",
        subsystem: "software",
        order: 0,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("tasks", {
        title: "Assigned",
        boardId,
        assigneeIds: ["user_clerk_1"],
        status: "todo",
        priority: "medium",
        labels: [],
        dependsOn: [],
        source: "manual",
      });
      await ctx.db.insert("tasks", {
        title: "Other",
        boardId,
        assigneeIds: ["another_user"],
        status: "todo",
        priority: "medium",
        labels: [],
        dependsOn: [],
        source: "manual",
      });
    });

    const mine = await user.query(api.tasks.listMine, {});

    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Assigned");
  });

  test("Clerk webhook upserts and deletes local users", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const t = convexTest(schema, modules);
    const createPayload = clerkUserEvent("user.created");

    const createResponse = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: await svixHeaders(createPayload),
      body: createPayload,
    });

    expect(createResponse.status).toBe(200);
    let row = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("authId", (q) => q.eq("authId", "user_from_webhook"))
        .unique(),
    );
    expect(row).toMatchObject({
      authId: "user_from_webhook",
      email: "webhook@example.com",
      name: "Webhook Mentor",
      role: "mentor",
    });

    const deletePayload = JSON.stringify({
      object: "event",
      type: "user.deleted",
      data: { object: "user", id: "user_from_webhook", deleted: true },
    });
    const deleteResponse = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: await svixHeaders(deletePayload),
      body: deletePayload,
    });

    expect(deleteResponse.status).toBe(200);
    row = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("authId", (q) => q.eq("authId", "user_from_webhook"))
        .unique(),
    );
    expect(row).toBeNull();
  });

  test("Clerk webhook rejects invalid signatures", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", WEBHOOK_SECRET);
    const t = convexTest(schema, modules);

    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: {
        "svix-id": "msg_bad",
        "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
        "svix-signature": "v1,bad",
      },
      body: clerkUserEvent("user.created"),
    });

    expect(response.status).toBe(400);
  });

  test("Clerk webhook dispatches through the same internal user sync functions", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.auth.upsertUserFromClerk, {
      authId: "user_internal",
      email: "internal@example.com",
      name: "Internal User",
      role: "student",
    });
    await t.mutation(internal.auth.deleteUserFromClerk, {
      authId: "user_internal",
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("authId", (q) => q.eq("authId", "user_internal"))
        .unique(),
    );
    expect(row).toBeNull();
  });
});
