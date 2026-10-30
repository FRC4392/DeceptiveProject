import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { htmlResponse, TOKEN_URL } from "./lib/onshapeAuth";
import {
  fetchElementPartNumberProperty,
  fetchPartNumberProperty,
  partKey,
  resolveSyncParts,
} from "./lib/onshapeSync";
import { esc, panelHtml } from "./lib/onshapePanelHtml";
import { encryptToken, decryptToken } from "./lib/tokenCrypto";

const AUTHORIZE_URL = "https://oauth.onshape.com/oauth/authorize";
const CALLBACK_PATH = "/onshape/oauth/callback";

function siteUrl(): string {
  return process.env.CONVEX_SITE_URL ?? "";
}

// ---- Token + state storage (internal) ----
export const createState = internalMutation({
  args: { state: v.string() },
  returns: v.null(),
  handler: async (ctx, { state }) => {
    await ctx.db.insert("onshapeOAuthState", { state });
    return null;
  },
});

export const consumeState = internalMutation({
  args: { state: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("onshapeOAuthState")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!row) return false;
    await ctx.db.delete(row._id);
    return true;
  },
});

// accessToken/refreshToken are encrypted at rest (AES-GCM, see
// lib/tokenCrypto.ts) — callers always pass/receive plaintext; only the
// stored row is ciphertext. `onshapeAuth` is a single-row table, so a
// reconnect (Admin → Onshape → Connect) naturally re-encrypts under the
// current key; there's no separate migration path for existing rows.
export const storeTokens = internalMutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const encrypted = {
      accessToken: await encryptToken(args.accessToken),
      refreshToken: await encryptToken(args.refreshToken),
      expiresAt: args.expiresAt,
    };
    const existing = await ctx.db.query("onshapeAuth").take(1);
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, encrypted);
    } else {
      await ctx.db.insert("onshapeAuth", encrypted);
    }
    return null;
  },
});

export const getAuthInternal = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      accessToken: v.string(),
      refreshToken: v.string(),
      expiresAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("onshapeAuth").take(1);
    const a = rows[0];
    if (!a) return null;
    try {
      return {
        accessToken: await decryptToken(a.accessToken),
        refreshToken: await decryptToken(a.refreshToken),
        expiresAt: a.expiresAt,
      };
    } catch (err) {
      // A row written before encryption was added (or under a since-rotated
      // key) won't decrypt. Treat it the same as "not connected" so callers
      // get the existing clear "reconnect in Admin → Onshape" error instead
      // of a raw crypto exception.
      console.error("Onshape token decrypt failed — reconnect required:", err);
      return null;
    }
  },
});

// Public: connection status for the admin UI (no tokens exposed). Verifies
// the stored tokens actually decrypt (not just that a row exists) so a
// pre-encryption or stale-key row shows as disconnected rather than a false
// "Connected" the UI can't act on.
export const connectionStatus = query({
  args: {},
  returns: v.object({
    connected: v.boolean(),
    expiresAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("onshapeAuth").take(1);
    const a = rows[0];
    if (!a) return { connected: false, expiresAt: null };
    try {
      await decryptToken(a.accessToken);
      return { connected: true, expiresAt: a.expiresAt };
    } catch {
      return { connected: false, expiresAt: null };
    }
  },
});

// ---- OAuth authorization-code flow ----
export const oauthStart = httpAction(async (ctx) => {
  const clientId = process.env.ONSHAPE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return htmlResponse("ONSHAPE_OAUTH_CLIENT_ID is not set.", 500);
  }
  const state = crypto.randomUUID();
  await ctx.runMutation(internal.onshapeOAuth.createState, { state });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `${siteUrl()}${CALLBACK_PATH}`,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: `${AUTHORIZE_URL}?${params.toString()}` },
  });
});

export const oauthCallback = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return htmlResponse("Missing code or state.", 400);

  const validState = await ctx.runMutation(internal.onshapeOAuth.consumeState, {
    state,
  });
  if (!validState) return htmlResponse("Invalid or expired state.", 400);

  const clientId = process.env.ONSHAPE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ONSHAPE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return htmlResponse("Onshape OAuth client env vars are not set.", 500);
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${siteUrl()}${CALLBACK_PATH}`,
    }),
  });
  if (!res.ok) {
    return htmlResponse(
      `Token exchange failed: ${res.status} ${await res.text()}`,
      502,
    );
  }
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };
  await ctx.runMutation(internal.onshapeOAuth.storeTokens, {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
  });
  return htmlResponse("✅ Onshape connected. You can close this tab.");
});

// Which of the given `elementId:partId` keys already exist in the tracker.
// List the parts in an element for the right-panel checklist. No writes —
// purely for rendering the picker. Works for Part Studios and Assemblies.
export const listElementParts = internalAction({
  args: {
    documentId: v.string(),
    wv: v.string(),
    wvid: v.string(),
    elementId: v.string(),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      name: v.string(),
      material: v.union(v.string(), v.null()),
      quantity: v.number(),
      sameDocument: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const { parts } = await resolveSyncParts(
      ctx,
      args.documentId,
      args.wv,
      args.wvid,
      args.elementId,
    );
    return parts.map((p) => ({
      key: partKey(p.sourceElementId, p.partId),
      name: p.name,
      material: p.material,
      quantity: p.quantity,
      sameDocument: p.sameDocument,
    }));
  },
});

/**
 * Read an element's parts and hand them to the tracker as a release intake.
 *
 * This writes nothing to the board on its own: a design lead reviews what came
 * back on "New from Onshape" and decides. It also writes nothing back into
 * Onshape — students paste their own numbers, which costs the team nothing.
 */
export const syncElement = internalAction({
  args: {
    documentId: v.string(),
    wv: v.string(), // "w" (workspace) or "v" (version)
    wvid: v.string(),
    elementId: v.string(),
    keys: v.optional(v.array(v.string())),
  },
  returns: v.object({
    found: v.number(),
    lines: v.number(),
    intakeId: v.id("releaseIntakes"),
  }),
  handler: async (ctx, args) => {
    const {
      parts: all,
      elementType,
      elementName,
      children,
    } = await resolveSyncParts(
      ctx,
      args.documentId,
      args.wv,
      args.wvid,
      args.elementId,
    );
    let parts = all;
    if (args.keys) {
      const wanted = new Set(args.keys);
      parts = all.filter((p) =>
        wanted.has(partKey(p.sourceElementId, p.partId)),
      );
    }

    // The part number Onshape holds is how a release is matched to a part, so
    // it's worth a read each — but only for parts in this document, which are
    // the only ones whose metadata we can reach.
    const lines = [];
    for (const part of parts) {
      const property = part.sameDocument
        ? await fetchPartNumberProperty(
            ctx,
            args.documentId,
            args.wv,
            args.wvid,
            part.sourceElementId,
            part.partId,
          )
        : null;
      lines.push({
        name: part.name,
        partNumber: property?.value || undefined,
        quantity: part.quantity,
        onshapePartId: part.partId,
        material: part.material ?? undefined,
      });
    }

    // An assembly carries a Part number of its own; that plus its element id
    // is how the tracker recognises which sub-assembly it just looked at.
    const assembly =
      elementType === "ASSEMBLY"
        ? {
            name: elementName || "Assembly",
            partNumber:
              (await fetchElementPartNumberProperty(
                ctx,
                args.documentId,
                args.wv,
                args.wvid,
                args.elementId,
              )) ?? undefined,
            children,
          }
        : undefined;

    const result: { intakeId: Id<"releaseIntakes">; lines: number } =
      await ctx.runMutation(internal.onshape.receiveSync, {
        onshapeDocumentId: args.documentId,
        onshapeElementId: args.elementId,
        elementName: elementName || undefined,
        versionId: args.wv === "v" ? args.wvid : undefined,
        assembly,
        parts: lines,
      });

    return {
      found: parts.length,
      lines: result.lines,
      intakeId: result.intakeId,
    };
  },
});

// ---- Shared helpers for the extension endpoints ----
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

// Resolve the Onshape document/element context from the iframe/button URL.
// Onshape substitutes {$documentId}, {$workspaceOrVersion} ("w"/"v"),
// {$workspaceOrVersionId} and {$elementId} into the registered extension URL.
// We also accept our own wv/wvid and workspaceId/versionId as fallbacks.
function parseContext(
  url: URL,
): { documentId: string; wv: string; wvid: string; elementId: string } | null {
  const q = url.searchParams;
  const documentId = q.get("documentId");
  const elementId = q.get("elementId");
  let wv = q.get("wv") ?? q.get("workspaceOrVersion");
  let wvid = q.get("wvid") ?? q.get("workspaceOrVersionId");
  if (!wv || !wvid) {
    const workspaceId = q.get("workspaceId");
    const versionId = q.get("versionId");
    if (workspaceId) {
      wv = "w";
      wvid = workspaceId;
    } else if (versionId) {
      wv = "v";
      wvid = versionId;
    }
  }
  if (!documentId || !elementId || !wv || !wvid) return null;
  return { documentId, wv, wvid, elementId };
}

// ---- Extension target (the "Sync to tracker" button — syncs the whole element) ----
export const ext = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== process.env.ONSHAPE_SYNC_SECRET) {
    return htmlResponse("Unauthorized.", 401);
  }
  const context = parseContext(url);
  if (!context) {
    return htmlResponse("Missing document/element parameters.", 400);
  }
  // Always 200 so the message renders in the popup (Cloudflare masks 5xx).
  try {
    const result: { found: number; lines: number } = await ctx.runAction(
      internal.onshapeOAuth.syncElement,
      context,
    );
    return htmlResponse(
      `✅ Sent ${result.found} part${result.found === 1 ? "" : "s"} to the Deceivers tracker.` +
        ` A design lead reviews them under "New from Onshape".`,
    );
  } catch (err) {
    return htmlResponse(`⚠️ Sync failed: ${errMessage(err)}`);
  }
});

// ---- Right-panel app (pick the parts, then send those) ----
// Short-lived, single-use tokens bind the panel's "Sync selected" POST to the
// document/element context server-side so the client never carries the secret.
export const createPanelToken = internalMutation({
  args: {
    documentId: v.string(),
    wv: v.string(),
    wvid: v.string(),
    elementId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const token = crypto.randomUUID();
    await ctx.db.insert("onshapePanelTokens", {
      token,
      documentId: args.documentId,
      wv: args.wv,
      wvid: args.wvid,
      elementId: args.elementId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return token;
  },
});

export const consumePanelToken = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      documentId: v.string(),
      wv: v.string(),
      wvid: v.string(),
      elementId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("onshapePanelTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) return null;
    return {
      documentId: row.documentId,
      wv: row.wv,
      wvid: row.wvid,
      elementId: row.elementId,
    };
  },
});

// Read the panel context WITHOUT consuming the token — used by the preview
// step, which is read-only and may run before the user confirms the sync.
export const panel = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== process.env.ONSHAPE_SYNC_SECRET) {
    return htmlResponse("Unauthorized.", 401);
  }
  const context = parseContext(url);
  if (!context) {
    const got =
      Array.from(url.searchParams.keys())
        .filter((k) => k !== "secret")
        .join(", ") || "none";
    return htmlResponse(
      `Missing document/element parameters. The registered extension URL must include Onshape's placeholders (documentId={$documentId}&wv={$workspaceOrVersion}&wvid={$workspaceOrVersionId}&elementId={$elementId}). Received: ${esc(got)}.`,
      400,
    );
  }
  let parts: Array<{
    key: string;
    name: string;
    material: string | null;
    quantity: number;
    sameDocument: boolean;
  }>;
  try {
    parts = await ctx.runAction(
      internal.onshapeOAuth.listElementParts,
      context,
    );
  } catch (err) {
    return htmlResponse(`⚠️ Could not load parts: ${errMessage(err)}`);
  }
  const token: string = await ctx.runMutation(
    internal.onshapeOAuth.createPanelToken,
    context,
  );
  return panelHtml(parts, token, context.wv);
});

export const syncSelected = httpAction(async (ctx, req) => {
  let body: { token?: unknown; keys?: unknown };
  try {
    body = (await req.json()) as { token?: unknown; keys?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.token !== "string") {
    return Response.json({ error: "token required" }, { status: 400 });
  }
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((x): x is string => typeof x === "string")
    : [];
  if (keys.length === 0) {
    return Response.json({ error: "No parts selected" }, { status: 400 });
  }
  const context: {
    documentId: string;
    wv: string;
    wvid: string;
    elementId: string;
  } | null = await ctx.runMutation(internal.onshapeOAuth.consumePanelToken, {
    token: body.token,
  });
  if (!context) {
    return Response.json(
      { error: "Session expired — reopen the panel." },
      { status: 401 },
    );
  }
  try {
    const result: { found: number; lines: number } = await ctx.runAction(
      internal.onshapeOAuth.syncElement,
      { ...context, keys },
    );
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 502 });
  }
});
