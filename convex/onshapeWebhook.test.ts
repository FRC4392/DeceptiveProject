// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { encryptToken } from "./lib/tokenCrypto";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";
const SECRET = "a-long-random-webhook-secret";

type Pkg = Record<string, unknown>;

/**
 * Stand in for Onshape. Every call the app makes goes through `onshapeFetch`,
 * so one stub covers the whole path — and the calls it records are also how
 * these tests count what a release costs.
 */
function stubOnshape(pkg: Pkg | { status: number }) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push(new URL(href).pathname);
    if ("status" in pkg && typeof pkg.status === "number") {
      return new Response("nope", { status: pkg.status });
    }
    return new Response(JSON.stringify(pkg), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function setup(t: ReturnType<typeof convexTest>) {
  const mentor = t.withIdentity({
    subject: "mentor_1",
    issuer: ISSUER,
    email: "mentor@example.com",
    role: "mentor" as const,
  });
  await mentor.mutation(api.auth.storeCurrentUser, {});
  await mentor.mutation(api.seasons.seedDefaults, {
    year: "27",
    name: "2027 robot",
  });
  const subsystems = await mentor.query(api.subsystems.list, {});
  const processes = await mentor.query(api.shop.listProcessTypes, {});
  // Onshape is connected: a stored, decryptable token.
  await t.run(async (ctx) => {
    await ctx.db.insert("onshapeAuth", {
      accessToken: await encryptToken("access"),
      refreshToken: await encryptToken("refresh"),
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
  });
  return {
    mentor,
    intake: subsystems.find((s) => s.code === "INT")!,
    router: processes.find((p) => p.name === "CNC router")!,
  };
}

function releasePackage(items: Pkg[], state = "RELEASED"): Pkg {
  return {
    id: "rp_1",
    name: "Intake release 3",
    workflow: { state: { name: state } },
    items,
  };
}

function notification(overrides: Pkg = {}): string {
  return JSON.stringify({
    timestamp: "2026-10-30T12:00:00Z",
    event: "onshape.workflow.transition",
    webhookId: "wh_1",
    messageId: "msg_1",
    objectType: "RELEASE",
    objectId: "rp_1",
    ...overrides,
  });
}

function post(
  t: ReturnType<typeof convexTest>,
  body: string,
  secret: string = SECRET,
) {
  return t.fetch(`/onshape/webhook?secret=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/**
 * Post a notification and let the work it scheduled finish. The receiver
 * answers Onshape before reading anything, so the interesting half always
 * happens on the scheduler.
 */
async function deliver(
  t: ReturnType<typeof convexTest>,
  body: string = notification(),
): Promise<Response> {
  const res = await post(t, body);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return res;
}

beforeEach(() => {
  vi.stubEnv("ONSHAPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("ONSHAPE_TOKEN_ENC_KEY", btoa("0123456789abcdef0123456789abcdef"));
  // The scheduler runs on timers, and only timers created while these are
  // installed can be advanced — so they go in before anything is scheduled.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("answering Onshape", () => {
  test("a wrong secret is turned away without reading anything", async () => {
    const t = convexTest(schema, modules);
    const calls = stubOnshape(releasePackage([]));
    const res = await post(t, notification(), "not-the-secret");
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  test("with no secret set the endpoint is closed, not open", async () => {
    vi.stubEnv("ONSHAPE_WEBHOOK_SECRET", "");
    const t = convexTest(schema, modules);
    const res = await post(t, notification(), "");
    expect(res.status).toBe(503);
  });

  test("a ping is acknowledged and recorded against the registration", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("onshapeWebhooks", {
        webhookId: "wh_1",
        events: ["onshape.workflow.transition"],
        registeredAt: Date.now(),
      });
    });
    const res = await post(t, JSON.stringify({ event: "webhook.ping" }));
    expect(res.status).toBe(200);
    const row = await t.run(async (ctx) =>
      ctx.db.query("onshapeWebhooks").first(),
    );
    expect(row?.lastPingAt).toBeTypeOf("number");
    expect(row?.lastEventAt).toBeUndefined();
  });

  test("a transition of something that isn't a release is ignored", async () => {
    const t = convexTest(schema, modules);
    const calls = stubOnshape(releasePackage([]));
    const res = await deliver(t, notification({ objectType: "DOCUMENT" }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  test("a body that isn't JSON is rejected", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, "not json");
    expect(res.status).toBe(400);
  });
});

describe("taking a release in", () => {
  test("a released part already on the board arrives as a matched line", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const { partNumber } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: intake._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 2,
    });
    const calls = stubOnshape(
      releasePackage([
        {
          documentId: "doc_1",
          elementId: "el_1",
          versionId: "v_1",
          partId: "JHD",
          properties: [
            { name: "Part number", value: partNumber },
            { name: "Revision", value: "B" },
            { name: "Name", value: "Side plate" },
          ],
        },
      ]),
    );

    expect((await deliver(t)).status).toBe(200);

    // One read for the whole release, not one per part.
    expect(calls).toEqual(["/api/releasepackages/rp_1"]);

    const [{ intake: row, lines }] = await mentor.query(api.intake.list, {});
    expect(row.source).toBe("onshape");
    expect(row.onshapeReleasePackageId).toBe("rp_1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      partNumber,
      revision: "B",
      kind: "matched",
    });
    expect(lines[0].partId).toBeDefined();
  });

  test("the release's CAD ids land on the part it matched", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake, router } = await setup(t);
    const { partId, partNumber } = await mentor.mutation(
      api.parts.createWithNumber,
      {
        subsystemId: intake._id,
        name: "Side plate",
        processTypeId: router._id,
        qtyNeeded: 1,
      },
    );
    stubOnshape(
      releasePackage([
        {
          documentId: "doc_1",
          elementId: "el_1",
          versionId: "v_1",
          partId: "JHD",
          properties: [{ name: "Part number", value: partNumber }],
        },
      ]),
    );
    await deliver(t);

    const part = await t.run(async (ctx) => ctx.db.get(partId));
    expect(part).toMatchObject({
      onshapeDocumentId: "doc_1",
      onshapeElementId: "el_1",
      onshapeVersionId: "v_1",
      onshapePartId: "JHD",
    });
  });

  test("a number the tracker never issued is an unknown line, not a part", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    stubOnshape(
      releasePackage([
        { properties: [{ name: "Part number", value: "99-XXX-001" }] },
      ]),
    );
    await deliver(t);

    const [{ lines }] = await mentor.query(api.intake.list, {});
    expect(lines[0].kind).toBe("unknown");
    const parts = await mentor.query(api.parts.list, {});
    expect(parts.some((p) => p.partNumber === "99-XXX-001")).toBe(false);
  });

  test("a package that isn't released yet is left alone", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    stubOnshape(
      releasePackage(
        [{ properties: [{ name: "Part number", value: "27-INT-101" }] }],
        "PENDING",
      ),
    );
    await deliver(t);
    expect(await mentor.query(api.intake.list, {})).toEqual([]);
  });

  test("the same release twice makes one intake and one read", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const calls = stubOnshape(
      releasePackage([
        { properties: [{ name: "Part number", value: "27-INT-101" }] },
      ]),
    );
    await deliver(t);
    await deliver(t);

    expect(await mentor.query(api.intake.list, {})).toHaveLength(1);
    // The second notification is answered without spending a call.
    expect(calls).toEqual(["/api/releasepackages/rp_1"]);
  });

  test("a released assembly matches the sub-assembly holding that number", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const { id, partNumber } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller assembly",
    });
    stubOnshape(
      releasePackage([
        {
          documentId: "doc_1",
          elementId: "el_2",
          versionId: "v_1",
          elementType: "ASSEMBLY",
          properties: [
            { name: "Part number", value: partNumber },
            { name: "Revision", value: "A" },
          ],
        },
      ]),
    );
    await deliver(t);

    const [{ lines }] = await mentor.query(api.intake.list, {});
    expect(lines[0]).toMatchObject({
      target: "subAssembly",
      partNumber,
      kind: "matched",
      subAssemblyId: id,
    });
    const assembly = await t.run(async (ctx) => ctx.db.get(id));
    expect(assembly).toMatchObject({
      onshapeDocumentId: "doc_1",
      onshapeElementId: "el_2",
      onshapeVersionId: "v_1",
    });
  });

  test("an assembly re-released after it was built needs a decision", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const { id, partNumber } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller assembly",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { completedAt: Date.now(), revision: "A" });
    });
    stubOnshape(
      releasePackage([
        {
          elementId: "el_2",
          elementType: "ASSEMBLY",
          properties: [
            { name: "Part number", value: partNumber },
            { name: "Revision", value: "B" },
          ],
        },
      ]),
    );
    await deliver(t);

    const [{ lines }] = await mentor.query(api.intake.list, {});
    expect(lines[0].kind).toBe("changed");
  });

  test("the release lands in the subsystem its document is mapped to", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    await mentor.mutation(api.onshape.mapDocument, {
      onshapeDocumentId: "doc_1",
      name: "Intake CAD",
      subsystemId: intake._id,
    });
    stubOnshape(
      releasePackage([
        {
          documentId: "doc_1",
          properties: [{ name: "Part number", value: "99-XXX-001" }],
        },
      ]),
    );
    await deliver(t);

    const [{ lines }] = await mentor.query(api.intake.list, {});
    expect(lines[0].subsystemId).toBe(intake._id);
  });

  test("a failed read leaves no half-built intake behind", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const calls = stubOnshape({ status: 500 });
    await deliver(t);
    expect(calls).toEqual(["/api/releasepackages/rp_1"]);
    expect(await mentor.query(api.intake.list, {})).toEqual([]);
  });
});

describe("what a lead can do with an assembly line", () => {
  test("it can be waved through, but not turned into a part", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake } = await setup(t);
    const { partNumber } = await mentor.mutation(api.subAssemblies.create, {
      subsystemId: intake._id,
      name: "Roller assembly",
    });
    stubOnshape(
      releasePackage([
        {
          elementId: "el_2",
          elementType: "ASSEMBLY",
          properties: [{ name: "Part number", value: partNumber }],
        },
      ]),
    );
    await deliver(t);
    const [{ lines }] = await mentor.query(api.intake.list, {});

    await expect(
      mentor.mutation(api.intake.applyLine, {
        lineId: lines[0]._id,
        decision: "created",
      }),
    ).rejects.toThrow(/sub-assembly, not a part/i);

    await mentor.mutation(api.intake.applyLine, {
      lineId: lines[0]._id,
      decision: "ignored",
    });
    const [{ lines: after }] = await mentor.query(api.intake.list, {
      includeProcessed: true,
    });
    expect(after[0].decision).toBe("ignored");
  });
});

describe("registering", () => {
  test("a student can't register the team's webhook", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const student = t.withIdentity({
      subject: "student_1",
      issuer: ISSUER,
      email: "student@example.com",
    });
    await student.mutation(api.auth.storeCurrentUser, {});
    await expect(
      student.action(api.onshapeWebhook.register, {}),
    ).rejects.toThrow(/mentors only/i);
  });

  test("it won't register without a secret to check callbacks against", async () => {
    vi.stubEnv("ONSHAPE_WEBHOOK_SECRET", "");
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await expect(
      mentor.action(api.onshapeWebhook.register, {}),
    ).rejects.toThrow(/ONSHAPE_WEBHOOK_SECRET/);
  });

  test("registering stores the id Onshape hands back", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    stubOnshape({ id: "wh_99" });

    const { webhookId } = await mentor.action(api.onshapeWebhook.register, {});
    expect(webhookId).toBe("wh_99");

    const status = await mentor.query(api.onshapeWebhook.status, {});
    expect(status).toMatchObject({
      registered: true,
      webhookId: "wh_99",
      events: ["onshape.workflow.transition"],
      secretConfigured: true,
    });
  });

  test("turning it off forgets the registration even if Onshape errors", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("onshapeWebhooks", {
        webhookId: "wh_99",
        events: ["onshape.workflow.transition"],
        registeredAt: Date.now(),
      });
    });
    stubOnshape({ status: 404 });

    await mentor.action(api.onshapeWebhook.unregister, {});
    const status = await mentor.query(api.onshapeWebhook.status, {});
    expect(status.registered).toBe(false);
  });

  test("a release read is counted against the yearly allowance", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    stubOnshape(
      releasePackage([
        { properties: [{ name: "Part number", value: "27-INT-101" }] },
      ]),
    );
    const before = await mentor.query(api.settings.budget, {});
    await deliver(t);
    const after = await mentor.query(api.settings.budget, {});
    expect(after.used).toBe(before.used + 1);
  });
});

// The internal mutation on its own, without the HTTP layer: a release that
// arrives twice must not build a second intake, whatever brought it in.
describe("receiveRelease", () => {
  test("refuses a package it has already taken in", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const args = {
      releasePackageId: "rp_7",
      label: "Release 7",
      state: "RELEASED",
      items: [{ name: "Side plate", isAssembly: false }],
    };
    expect(
      await t.mutation(internal.onshape.receiveRelease, args),
    ).not.toBeNull();
    expect(await t.mutation(internal.onshape.receiveRelease, args)).toBeNull();
  });
});
