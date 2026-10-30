/**
 * Onshape release webhooks: registration, the receiver, and the one API call
 * a notification is worth.
 *
 * Onshape tells us a release package transitioned and nothing else — no part
 * numbers, no revisions, not even which state it moved to. So the receiver's
 * whole job is to acknowledge fast and hand off; the read that turns an id
 * into something the board can use happens off the request, in `ingestRelease`.
 *
 * Notifications themselves are free — Onshape excludes them from the yearly
 * allowance — and the one read each release costs replaces the per-part
 * metadata walk the right-panel sync does.
 */
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireLead, requireMentor } from "./lib/auth";
import { blockedReason, isCallAllowed } from "./lib/budget";
import { onshapeFetch } from "./lib/onshapeAuth";
import { fetchReleasePackage } from "./lib/onshapeSync";
import {
  RELEASE_TRANSITION_EVENT,
  isLifecycleEvent,
  isReleasedState,
  parseWebhookEvent,
  releaseLabel,
  releaseLines,
  releasePackageId,
  releaseState,
  secretsMatch,
  trimRawPackage,
} from "./lib/onshapeRelease";

const API_BASE = process.env.ONSHAPE_BASE_URL ?? "https://cad.onshape.com";
const WEBHOOK_PATH = "/onshape/webhook";

/** The callback Onshape is told to call, secret and all. */
function callbackUrl(secret: string): string {
  const site = process.env.CONVEX_SITE_URL ?? "";
  return `${site}${WEBHOOK_PATH}?secret=${encodeURIComponent(secret)}`;
}

// ---- Registration bookkeeping (internal) ----

export const getRegistration = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      webhookId: v.string(),
      companyId: v.optional(v.string()),
      events: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("onshapeWebhooks").take(1);
    const row = rows[0];
    if (!row) return null;
    return {
      webhookId: row.webhookId,
      companyId: row.companyId,
      events: row.events,
    };
  },
});

export const recordRegistration = internalMutation({
  args: {
    webhookId: v.string(),
    companyId: v.optional(v.string()),
    events: v.array(v.string()),
    registeredBy: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // One registration for the team: replace whatever was there rather than
    // accumulating rows nobody can tell apart.
    for (const row of await ctx.db.query("onshapeWebhooks").collect()) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.insert("onshapeWebhooks", {
      ...args,
      registeredAt: Date.now(),
    });
    return null;
  },
});

export const clearRegistration = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const row of await ctx.db.query("onshapeWebhooks").collect()) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

/**
 * Note that Onshape called. Which timestamp moves apart says something worth
 * knowing: pings without events means the callback works but nothing is being
 * released; neither means the registration is dead.
 */
export const touch = internalMutation({
  args: { kind: v.union(v.literal("ping"), v.literal("event")) },
  returns: v.null(),
  handler: async (ctx, { kind }) => {
    const rows = await ctx.db.query("onshapeWebhooks").take(1);
    const row = rows[0];
    if (!row) return null;
    await ctx.db.patch(
      row._id,
      kind === "ping"
        ? { lastPingAt: Date.now() }
        : { lastEventAt: Date.now() },
    );
    return null;
  },
});

/**
 * Have we already dealt with this release? Checked before spending a call.
 *
 * A *queued* row doesn't count: that's a release we were told about but
 * couldn't afford to read, and reading it is exactly what Reconcile is for.
 */
export const releaseHandled = internalQuery({
  args: { releasePackageId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { releasePackageId: id }) => {
    const row = await ctx.db
      .query("releaseIntakes")
      .withIndex("by_package", (q) => q.eq("onshapeReleasePackageId", id))
      .first();
    return row !== null && row.status !== "queued";
  },
});

/** Releases parked by Manual mode, oldest first. */
export const queuedReleases = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("releaseIntakes")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(100);
    return rows
      .map((r) => r.onshapeReleasePackageId)
      .filter((id): id is string => id !== undefined);
  },
});

export const callerIsLead = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    try {
      await requireLead(ctx);
      return true;
    } catch {
      return false;
    }
  },
});

export const callerIsMentor = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    try {
      await requireMentor(ctx);
      return true;
    } catch {
      return false;
    }
  },
});

// ---- Status, for the admin page ----

export const status = query({
  args: {},
  returns: v.object({
    registered: v.boolean(),
    webhookId: v.union(v.string(), v.null()),
    companyId: v.union(v.string(), v.null()),
    events: v.array(v.string()),
    registeredAt: v.union(v.number(), v.null()),
    lastPingAt: v.union(v.number(), v.null()),
    lastEventAt: v.union(v.number(), v.null()),
    /**
     * The Onshape connection has been re-authorized since this was
     * registered, so it may no longer be live. Onshape doesn't say either
     * way, and a webhook that silently stopped looks exactly like a season
     * with no releases in it.
     */
    stale: v.boolean(),
    /** Whether ONSHAPE_WEBHOOK_SECRET is set on the deployment. */
    secretConfigured: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireMentor(ctx);
    const rows = await ctx.db.query("onshapeWebhooks").take(1);
    const row = rows[0];
    return {
      registered: row !== undefined,
      webhookId: row?.webhookId ?? null,
      companyId: row?.companyId ?? null,
      events: row?.events ?? [],
      registeredAt: row?.registeredAt ?? null,
      lastPingAt: row?.lastPingAt ?? null,
      lastEventAt: row?.lastEventAt ?? null,
      stale: row?.staleSince !== undefined,
      secretConfigured: Boolean(process.env.ONSHAPE_WEBHOOK_SECRET),
    };
  },
});

// ---- Register / unregister with Onshape ----

export const register = action({
  args: { companyId: v.optional(v.string()) },
  returns: v.object({ webhookId: v.string() }),
  handler: async (ctx, { companyId }) => {
    if (!(await ctx.runQuery(internal.onshapeWebhook.callerIsMentor, {}))) {
      throw new Error("Mentors only.");
    }
    const secret = process.env.ONSHAPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error(
        "Set ONSHAPE_WEBHOOK_SECRET first: npx convex env set ONSHAPE_WEBHOOK_SECRET <a long random string>",
      );
    }
    if (!process.env.CONVEX_SITE_URL) {
      throw new Error("CONVEX_SITE_URL is not set on this deployment.");
    }

    // Replace an existing registration rather than stacking a second one that
    // would deliver every release twice.
    const existing = await ctx.runQuery(
      internal.onshapeWebhook.getRegistration,
      {},
    );
    if (existing) {
      await unregisterWithOnshape(ctx, existing.webhookId);
      await ctx.runMutation(internal.onshapeWebhook.clearRegistration, {});
    }

    const events = [RELEASE_TRANSITION_EVENT];
    const res = await onshapeFetch(
      ctx,
      `${API_BASE}/api/webhooks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events,
          url: callbackUrl(secret),
          // Each transition on its own: collapsing them would hide the move
          // into RELEASED behind an earlier one we'd then ignore.
          options: { collapseEvents: false },
          ...(companyId ? { companyId } : {}),
        }),
      },
      "admin",
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const hint =
        res.status === 403
          ? " — registering a release webhook needs a company admin account."
          : "";
      throw new Error(
        `Onshape refused the webhook: ${res.status}${body ? ` ${body.slice(0, 200)}` : ""}${hint}`,
      );
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("Onshape returned no webhook id.");

    await ctx.runMutation(internal.onshapeWebhook.recordRegistration, {
      webhookId: json.id,
      companyId,
      events,
    });
    return { webhookId: json.id };
  },
});

export const unregister = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!(await ctx.runQuery(internal.onshapeWebhook.callerIsMentor, {}))) {
      throw new Error("Mentors only.");
    }
    const existing = await ctx.runQuery(
      internal.onshapeWebhook.getRegistration,
      {},
    );
    if (existing) await unregisterWithOnshape(ctx, existing.webhookId);
    // Forget it locally either way: a registration Onshape no longer has is
    // worse than none, because the admin page would claim it's live.
    await ctx.runMutation(internal.onshapeWebhook.clearRegistration, {});
    return null;
  },
});

async function unregisterWithOnshape(
  ctx: Parameters<typeof onshapeFetch>[0],
  webhookId: string,
): Promise<void> {
  try {
    await onshapeFetch(
      ctx,
      `${API_BASE}/api/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "DELETE" },
      "admin",
    );
  } catch (err) {
    // An already-gone webhook, or an expired token, shouldn't block the local
    // cleanup — the registration is being thrown away either way.
    console.error(`Could not unregister Onshape webhook ${webhookId}:`, err);
  }
}

// ---- The receiver ----

export const onshapeWebhook = httpAction(async (ctx, req) => {
  const expected = process.env.ONSHAPE_WEBHOOK_SECRET;
  if (!expected) {
    return new Response("Webhook not configured", { status: 503 });
  }
  const provided = new URL(req.url).searchParams.get("secret") ?? "";
  if (!secretsMatch(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event = parseWebhookEvent(body);
  if (!event) return new Response("Ignored", { status: 200 });

  // register/unregister/ping: Onshape sends these itself to check we're here.
  if (isLifecycleEvent(event.event)) {
    await ctx.runMutation(internal.onshapeWebhook.touch, { kind: "ping" });
    return new Response("OK", { status: 200 });
  }

  const rpid = releasePackageId(event);
  if (!rpid) return new Response("Ignored", { status: 200 });

  await ctx.runMutation(internal.onshapeWebhook.touch, { kind: "event" });
  // Hand off and answer: Onshape retries anything it doesn't see acknowledged
  // quickly, and the release read can take a moment.
  await ctx.scheduler.runAfter(0, internal.onshapeWebhook.ingestRelease, {
    releasePackageId: rpid,
    messageId: event.messageId,
  });
  return new Response("Accepted", { status: 200 });
});

/**
 * Turn a release package id into an intake. One API call, and only when the
 * package is one we haven't already taken in — a retried notification and a
 * second transition on the same package both land here.
 */
export const ingestRelease = internalAction({
  args: {
    releasePackageId: v.string(),
    messageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ingestOne(ctx, args.releasePackageId, args.messageId);
    return null;
  },
});

/**
 * Read one release and take it in. Returns false when it couldn't be done —
 * the budget said no, or Onshape did — in which case the release is left
 * queued rather than lost. The notification only comes once.
 */
async function ingestOne(
  ctx: ActionCtx,
  releasePackageId: string,
  messageId?: string,
): Promise<boolean> {
  const handled = await ctx.runQuery(internal.onshapeWebhook.releaseHandled, {
    releasePackageId,
  });
  if (handled) return true;

  const mode = await ctx.runQuery(internal.settings.currentMode, {});
  if (!isCallAllowed(mode, "release")) {
    await ctx.runMutation(internal.onshape.queueRelease, {
      releasePackageId,
      reason: blockedReason(mode, "release") ?? "Onshape calls are paused.",
    });
    return false;
  }

  let pkg;
  try {
    pkg = await fetchReleasePackage(ctx, releasePackageId);
  } catch (err) {
    // Rate limited, 402, Onshape down: keep the id so Reconcile can try again.
    await ctx.runMutation(internal.onshape.queueRelease, {
      releasePackageId,
      reason: err instanceof Error ? err.message : "The read failed.",
    });
    console.error(
      `Onshape release ${releasePackageId} could not be read:`,
      err,
    );
    return false;
  }

  const state = releaseState(pkg);
  if (!isReleasedState(state)) {
    // Submitted, rejected, or a custom workflow state we don't know. Either
    // way the parts aren't real yet, and the next transition will tell us.
    console.log(
      `Onshape release ${releasePackageId} is "${state || "(no state)"}" — not taking it in.`,
    );
    return true;
  }

  const lines = releaseLines(pkg);
  if (lines.length === 0) {
    console.warn(
      `Onshape release ${releasePackageId} is released but lists no items.`,
    );
    return true;
  }

  await ctx.runMutation(internal.onshape.receiveRelease, {
    releasePackageId,
    label: releaseLabel(pkg),
    state,
    messageId,
    raw: trimRawPackage(pkg),
    items: lines,
  });
  return true;
}

/**
 * Read the releases Manual mode parked, now that there's allowance again.
 *
 * One call each, oldest first, and it stops at the first one that can't be
 * read — if the budget ran out again there's no sense walking the rest of the
 * queue to find that out ten more times.
 */
export const reconcile = action({
  args: {},
  returns: v.object({ processed: v.number(), remaining: v.number() }),
  handler: async (ctx) => {
    if (!(await ctx.runQuery(internal.onshapeWebhook.callerIsLead, {}))) {
      throw new Error("Design leads and mentors only.");
    }
    const queued: string[] = await ctx.runQuery(
      internal.onshapeWebhook.queuedReleases,
      {},
    );
    let processed = 0;
    for (const releasePackageId of queued) {
      if (!(await ingestOne(ctx, releasePackageId))) break;
      processed++;
    }
    return { processed, remaining: queued.length - processed };
  },
});
