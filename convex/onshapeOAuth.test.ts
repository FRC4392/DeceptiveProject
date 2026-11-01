// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { encryptToken } from "./lib/tokenCrypto";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";

/** A test handle scoped to one signed-in person. */
type AsUser = ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;

beforeEach(() => {
  vi.stubEnv("ONSHAPE_TOKEN_ENC_KEY", btoa("0123456789abcdef0123456789abcdef"));
  vi.stubEnv("ONSHAPE_OAUTH_CLIENT_ID", "client-id");
  vi.stubEnv("ONSHAPE_OAUTH_CLIENT_SECRET", "client-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function mentorNamed(t: ReturnType<typeof convexTest>, name: string) {
  const who = t.withIdentity({
    subject: `mentor_${name}`,
    issuer: ISSUER,
    email: `${name}@example.com`,
    name,
    role: "mentor" as const,
  });
  await who.mutation(api.auth.storeCurrentUser, {});
  return who;
}

/** Onshape handing back a token, for the callback leg. */
function stubTokenEndpoint(ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ok
        ? new Response(
            JSON.stringify({
              access_token: "access",
              refresh_token: "refresh",
              expires_in: 3600,
            }),
            { status: 200 },
          )
        : new Response("no", { status: 400 }),
    ),
  );
}

/** Walk the whole authorize round-trip as that mentor. */
async function connectAs(t: ReturnType<typeof convexTest>, who: AsUser) {
  const state = await who.mutation(api.onshapeOAuth.beginConnect, {});
  stubTokenEndpoint();
  const res = await t.fetch(`/onshape/oauth/callback?code=c&state=${state}`);
  expect(res.status).toBe(200);
}

describe("starting a connection", () => {
  test("a student can't begin one", async () => {
    const t = convexTest(schema, modules);
    const student = t.withIdentity({
      subject: "student_1",
      issuer: ISSUER,
      email: "s@example.com",
    });
    await student.mutation(api.auth.storeCurrentUser, {});
    await expect(
      student.mutation(api.onshapeOAuth.beginConnect, {}),
    ).rejects.toThrow(/mentor/i);
  });

  test("the public start endpoint won't redirect without one", async () => {
    // Otherwise anyone who knew the URL could point the team's connection at
    // their own Onshape account.
    const t = convexTest(schema, modules);
    const res = await t.fetch("/onshape/oauth/start");
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Settings/);
  });

  test("a made-up state is no better than none", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/onshape/oauth/start?state=guessed");
    expect(res.status).toBe(400);
  });

  test("a mentor's state sends them to Onshape", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorNamed(t, "sam");
    const state = await mentor.mutation(api.onshapeOAuth.beginConnect, {});

    const res = await t.fetch(`/onshape/oauth/start?state=${state}`);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("oauth.onshape.com");
    expect(location).toContain(`state=${state}`);
  });

  test("an expired state is refused", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorNamed(t, "sam");
    const state = await mentor.mutation(api.onshapeOAuth.beginConnect, {});
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("onshapeOAuthState").collect()) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });

    expect((await t.fetch(`/onshape/oauth/start?state=${state}`)).status).toBe(
      400,
    );
    stubTokenEndpoint();
    const res = await t.fetch(`/onshape/oauth/callback?code=c&state=${state}`);
    expect(res.status).toBe(400);
  });

  test("a state is good for one connection only", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorNamed(t, "sam");
    const state = await mentor.mutation(api.onshapeOAuth.beginConnect, {});
    stubTokenEndpoint();

    expect(
      (await t.fetch(`/onshape/oauth/callback?code=c&state=${state}`)).status,
    ).toBe(200);
    expect(
      (await t.fetch(`/onshape/oauth/callback?code=c&state=${state}`)).status,
    ).toBe(400);
  });
});

describe("whose connection it is", () => {
  test("the connection remembers who authorized it", async () => {
    const t = convexTest(schema, modules);
    const sam = await mentorNamed(t, "sam");
    await connectAs(t, sam);

    const status = await sam.query(api.onshapeOAuth.connectionStatus, {});
    expect(status.connected).toBe(true);
    expect(status.connectedBy).toBe("sam");
    expect(status.connectedAt).toBeTypeOf("number");
  });

  test("another mentor reconnecting takes it over", async () => {
    // The handover path: one row, overwritten, nothing to migrate.
    const t = convexTest(schema, modules);
    const sam = await mentorNamed(t, "sam");
    const alex = await mentorNamed(t, "alex");
    await connectAs(t, sam);
    await connectAs(t, alex);

    expect(
      (await sam.query(api.onshapeOAuth.connectionStatus, {})).connectedBy,
    ).toBe("alex");
    const rows = await t.run(async (ctx) =>
      ctx.db.query("onshapeAuth").collect(),
    );
    expect(rows).toHaveLength(1);
  });

  test("a refresh doesn't change whose connection it is", async () => {
    const t = convexTest(schema, modules);
    const sam = await mentorNamed(t, "sam");
    await connectAs(t, sam);
    await t.mutation(internal.onshapeOAuth.storeTokens, {
      accessToken: "a2",
      refreshToken: "r2",
      expiresAt: Date.now() + 3_600_000,
      reason: "refresh",
    });
    expect(
      (await sam.query(api.onshapeOAuth.connectionStatus, {})).connectedBy,
    ).toBe("sam");
  });
});

describe("noticing the connection has died", () => {
  async function connectedButExpired(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("onshapeAuth", {
        accessToken: await encryptToken("access"),
        refreshToken: await encryptToken("refresh"),
        // Already past, so the next call must refresh first.
        expiresAt: Date.now() - 1000,
      });
    });
  }

  test("a refused refresh is written down, not just thrown", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorNamed(t, "sam");
    await connectedButExpired(t);
    stubTokenEndpoint(false);

    await expect(
      t.action(internal.onshapeOAuth.syncElement, {
        documentId: "d",
        wv: "w",
        wvid: "w1",
        elementId: "e",
      }),
    ).rejects.toThrow(/token refresh failed/i);

    // This is what an owner leaving the Classroom looks like: the row is
    // still there and still decrypts, so only the note tells the truth.
    const status = await mentor.query(api.onshapeOAuth.connectionStatus, {});
    expect(status.connected).toBe(true);
    expect(status.lastError).toMatch(/token refresh failed/i);
    expect(status.lastErrorAt).toBeTypeOf("number");
  });

  test("reconnecting clears the note", async () => {
    const t = convexTest(schema, modules);
    const mentor = await mentorNamed(t, "sam");
    await connectedButExpired(t);
    stubTokenEndpoint(false);
    await t
      .action(internal.onshapeOAuth.syncElement, {
        documentId: "d",
        wv: "w",
        wvid: "w1",
        elementId: "e",
      })
      .catch(() => {});
    expect(
      (await mentor.query(api.onshapeOAuth.connectionStatus, {})).lastError,
    ).not.toBeNull();

    await connectAs(t, mentor);
    expect(
      (await mentor.query(api.onshapeOAuth.connectionStatus, {})).lastError,
    ).toBeNull();
  });
});

describe("the webhook after a reconnect", () => {
  async function registerWebhook(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("onshapeWebhooks", {
        webhookId: "wh_1",
        events: ["onshape.workflow.transition"],
        registeredAt: Date.now(),
      });
    });
  }

  test("reconnecting marks it as needing re-registering", async () => {
    // It was registered under the old authorization and Onshape doesn't say
    // whether it survived — so stop claiming it did.
    const t = convexTest(schema, modules);
    const sam = await mentorNamed(t, "sam");
    await registerWebhook(t);
    expect((await sam.query(api.onshapeWebhook.status, {})).stale).toBe(false);

    await connectAs(t, sam);

    expect((await sam.query(api.onshapeWebhook.status, {})).stale).toBe(true);
  });

  test("an ordinary token refresh doesn't", async () => {
    const t = convexTest(schema, modules);
    const sam = await mentorNamed(t, "sam");
    await registerWebhook(t);
    await t.mutation(internal.onshapeOAuth.storeTokens, {
      accessToken: "a2",
      refreshToken: "r2",
      expiresAt: Date.now() + 3_600_000,
      reason: "refresh",
    });
    expect((await sam.query(api.onshapeWebhook.status, {})).stale).toBe(false);
  });

  test("registering again clears it", async () => {
    vi.stubEnv("ONSHAPE_WEBHOOK_SECRET", "a-long-random-webhook-secret");
    const t = convexTest(schema, modules);
    const sam = await mentorNamed(t, "sam");
    await registerWebhook(t);
    await connectAs(t, sam);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "wh_2" }))),
    );
    await sam.action(api.onshapeWebhook.register, {});

    const status = await sam.query(api.onshapeWebhook.status, {});
    expect(status.stale).toBe(false);
    expect(status.webhookId).toBe("wh_2");
  });
});
