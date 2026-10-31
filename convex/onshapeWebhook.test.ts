// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { encryptToken } from "./lib/tokenCrypto";
import { RETRY_DELAYS_MS } from "./lib/budget";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://example.clerk.accounts.dev";
const SECRET = "a-long-random-webhook-secret";

type Pkg = Record<string, unknown>;

/**
 * Stand in for Onshape. Every call the app makes goes through `onshapeFetch`,
 * so one stub covers the whole path — and the calls it records are also how
 * these tests count what a release costs.
 */
function stubOnshape(...replies: Array<Pkg | { status: number }>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push(new URL(href).pathname);
    // The last reply repeats, so one argument means "always this".
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if ("status" in reply && typeof reply.status === "number") {
      return new Response("nope", { status: reply.status });
    }
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** Pin the budget mode the way a mentor's forced-mode switch would. */
async function forceMode(
  t: ReturnType<typeof convexTest>,
  mode: "normal" | "lean" | "manual",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("appSettings", { key: "forcedMode", value: mode });
  });
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

  test("a failed read leaves the release queued, not lost", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const calls = stubOnshape({ status: 500 });
    await deliver(t);
    expect(calls).toEqual(["/api/releasepackages/rp_1"]);
    // The notification only comes once, so the id has to survive the failure.
    const [{ intake, lines }] = await mentor.query(api.intake.list, {});
    expect(intake.status).toBe("queued");
    expect(intake.onshapeReleasePackageId).toBe("rp_1");
    expect(lines).toEqual([]);
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

describe("the budget mode as a brake", () => {
  test("manual mode queues the release and reads nothing", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await forceMode(t, "manual");
    const calls = stubOnshape(
      releasePackage([
        { properties: [{ name: "Part number", value: "27-INT-101" }] },
      ]),
    );

    await deliver(t);

    expect(calls).toEqual([]);
    const [{ intake, lines }] = await mentor.query(api.intake.list, {});
    expect(intake.status).toBe("queued");
    expect(intake.onshapeReleasePackageId).toBe("rp_1");
    expect(lines).toEqual([]);
  });

  test("lean mode still takes releases in — that's the cheap path", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await forceMode(t, "lean");
    const calls = stubOnshape(
      releasePackage([
        { properties: [{ name: "Part number", value: "27-INT-101" }] },
      ]),
    );

    await deliver(t);

    expect(calls).toEqual(["/api/releasepackages/rp_1"]);
    const [{ intake }] = await mentor.query(api.intake.list, {});
    expect(intake.status).toBe("read");
  });

  test("lean mode refuses the panel sync — that's a call per part", async () => {
    const t = convexTest(schema, modules);
    const { intake } = await setup(t);
    await forceMode(t, "lean");
    const calls = stubOnshape({});

    await expect(
      t.action(internal.onshapeOAuth.syncElement, {
        documentId: "doc_1",
        wv: "w",
        wvid: "ws_1",
        elementId: "el_1",
      }),
    ).rejects.toThrow(/lean mode/i);
    expect(calls).toEqual([]);
    expect(intake).toBeDefined();
  });

  test("a refused call is not a spent call", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await forceMode(t, "manual");
    stubOnshape(releasePackage([]));
    await deliver(t);
    expect((await mentor.query(api.settings.budget, {})).used).toBe(0);
  });

  test("turning the webhook off still works in manual mode", async () => {
    // Otherwise a mentor can't stop the thing that spent the budget.
    vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await forceMode(t, "manual");
    await t.run(async (ctx) => {
      await ctx.db.insert("onshapeWebhooks", {
        webhookId: "wh_99",
        events: ["onshape.workflow.transition"],
        registeredAt: Date.now(),
      });
    });
    stubOnshape({});

    await mentor.action(api.onshapeWebhook.unregister, {});
    expect((await mentor.query(api.onshapeWebhook.status, {})).registered).toBe(
      false,
    );
  });
});

describe("reconciling what manual mode parked", () => {
  async function queueOne(t: ReturnType<typeof convexTest>) {
    await forceMode(t, "manual");
    stubOnshape(releasePackage([]));
    await deliver(t);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("appSettings").collect()) {
        if (row.key === "forcedMode") await ctx.db.delete(row._id);
      }
    });
  }

  test("reads the queued release and fills the same intake", async () => {
    const t = convexTest(schema, modules);
    const { mentor, intake: subsystem, router } = await setup(t);
    const { partNumber } = await mentor.mutation(api.parts.createWithNumber, {
      subsystemId: subsystem._id,
      name: "Side plate",
      processTypeId: router._id,
      qtyNeeded: 1,
    });
    await queueOne(t);

    const calls = stubOnshape(
      releasePackage([
        {
          properties: [
            { name: "Part number", value: partNumber },
            { name: "Revision", value: "B" },
          ],
        },
      ]),
    );
    const result = await mentor.action(api.onshapeWebhook.reconcile, {});

    expect(result).toEqual({ processed: 1, remaining: 0 });
    expect(calls).toEqual(["/api/releasepackages/rp_1"]);
    // Still one intake — the queued row was filled, not duplicated.
    const list = await mentor.query(api.intake.list, {});
    expect(list).toHaveLength(1);
    expect(list[0].intake.status).toBe("read");
    expect(list[0].lines[0]).toMatchObject({ partNumber, kind: "matched" });
  });

  test("stops at the first one it still can't read", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await queueOne(t);
    await forceMode(t, "manual");
    const calls = stubOnshape(releasePackage([]));

    expect(await mentor.action(api.onshapeWebhook.reconcile, {})).toEqual({
      processed: 0,
      remaining: 1,
    });
    expect(calls).toEqual([]);
  });

  test("a student can't reconcile", async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const student = t.withIdentity({
      subject: "student_2",
      issuer: ISSUER,
      email: "student2@example.com",
    });
    await student.mutation(api.auth.storeCurrentUser, {});
    await expect(
      student.action(api.onshapeWebhook.reconcile, {}),
    ).rejects.toThrow(/leads and mentors/i);
  });
});

describe("what Onshape says back", () => {
  test("a 402 drops the app into manual mode with the reason recorded", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    stubOnshape({ status: 402 });

    await expect(
      mentor.action(api.onshapeWebhook.register, {}),
    ).rejects.toThrow(/402/);

    const budget = await mentor.query(api.settings.budget, {});
    expect(budget.mode).toBe("manual");
    expect(budget.forced).toBe(true);
    expect(budget.forcedReason).toMatch(/402/);
    expect(budget.forcedAt).toBeTypeOf("number");
  });

  test("a 402 doesn't count against the meter", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    stubOnshape({ status: 402 });
    await mentor.action(api.onshapeWebhook.register, {}).catch(() => {});
    expect((await mentor.query(api.settings.budget, {})).used).toBe(0);
  });

  // Real timers: the backoff really waits, and the first retry is a second.
  // Worth the second to prove the loop retries and doesn't double-charge.
  test("a 429 is waited out and retried", async () => {
    vi.useRealTimers();
    vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const calls = stubOnshape({ status: 429 }, { id: "wh_99" });

    expect(await mentor.action(api.onshapeWebhook.register, {})).toEqual({
      webhookId: "wh_99",
    });
    expect(calls).toHaveLength(2);
    // Onshape doesn't charge for the 429, and neither does the meter.
    expect((await mentor.query(api.settings.budget, {})).used).toBe(1);
  });

  test("the backoff is bounded, so a stuck limit doesn't hammer", () => {
    // Three retries, doubling. The integration test above covers the loop;
    // this is the cap, which would otherwise take seven seconds to prove.
    expect(RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000]);
  });
});

describe("reading what a released assembly contains", () => {
  /** A release carrying one assembly, plus the BOM reply for it. */
  const assemblyItem = {
    elementType: "ASSEMBLY",
    documentId: "doc1",
    elementId: "el1",
    versionId: "v1",
    properties: [
      { name: "Part number", value: "27-INT-040" },
      { name: "Name", value: "Roller assembly" },
    ],
  };
  const bomReply = {
    rootAssembly: {
      instances: [
        {
          id: "i1",
          type: "Assembly",
          documentId: "doc1",
          elementId: "child1",
          name: "End cap assembly <1>",
        },
        {
          id: "i2",
          type: "Assembly",
          documentId: "doc1",
          elementId: "child1",
          name: "End cap assembly <2>",
        },
      ],
      occurrences: [],
    },
    subAssemblies: [],
  };

  test("costs one extra call and lands the contents as lines", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const calls = stubOnshape(releasePackage([assemblyItem]), bomReply);

    await deliver(t);

    // The release, then the assembly's own BOM.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("/api/assemblies/");

    const [listed] = await mentor.query(api.intake.list, {});
    const child = listed.lines.find((l) => l.name.startsWith("End cap"));
    // Placed twice in the CAD, and the count comes across with it.
    expect(child?.quantity).toBe(2);
    expect(child?.kind).toBe("unknown");
  });

  test("lean mode takes the release in anyway and says what it skipped", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    await forceMode(t, "lean");
    const calls = stubOnshape(releasePackage([assemblyItem]));

    await deliver(t);

    // The release still came in; only the extra read was refused.
    expect(calls).toHaveLength(1);
    const [listed] = await mentor.query(api.intake.list, {});
    expect(listed.lines.length).toBeGreaterThan(0);
    const assembly = listed.lines.find((l) => l.target === "subAssembly");
    expect(assembly?.note).toMatch(/wasn't read/);
  });

  test("a BOM that can't be read doesn't lose the release", async () => {
    const t = convexTest(schema, modules);
    const { mentor } = await setup(t);
    const calls = stubOnshape(releasePackage([assemblyItem]), { status: 500 });

    await deliver(t);

    expect(calls).toHaveLength(2);
    const [listed] = await mentor.query(api.intake.list, {});
    const assembly = listed.lines.find((l) => l.target === "subAssembly");
    expect(assembly?.partNumber).toBe("27-INT-040");
    expect(assembly?.note).toMatch(/wasn't read/);
  });
});
