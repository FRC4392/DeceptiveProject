import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { htmlResponse, TOKEN_URL } from "./lib/onshapeAuth";
import {
  fetchPartNumberProperty,
  fetchPartPreview,
  fetchShadedViewBase64,
  partKey,
  resolveSyncParts,
  writePartNumber,
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
  returns: v.object({ connected: v.boolean(), expiresAt: v.union(v.number(), v.null()) }),
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
    return htmlResponse(`Token exchange failed: ${res.status} ${await res.text()}`, 502);
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
export const trackedElementIds = internalQuery({
  args: { onshapeElementIds: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { onshapeElementIds }) => {
    const tracked: string[] = [];
    for (const eid of onshapeElementIds) {
      const p = await ctx.db
        .query("parts")
        .withIndex("by_onshapeElementId", (q) => q.eq("onshapeElementId", eid))
        .unique();
      if (p) tracked.push(eid);
    }
    return tracked;
  },
});

// List the parts in an element for the right-panel checklist, flagging which
// are already tracked and their assembly quantity. No writes — purely for
// rendering the picker. Works for both Part Studios and Assemblies.
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
      tracked: v.boolean(),
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
    const keys = parts.map((p) => partKey(p.sourceElementId, p.partId));
    const tracked: string[] = await ctx.runQuery(
      internal.onshapeOAuth.trackedElementIds,
      { onshapeElementIds: keys },
    );
    const trackedSet = new Set(tracked);
    return parts.map((p) => {
      const key = partKey(p.sourceElementId, p.partId);
      return {
        key,
        name: p.name,
        material: p.material,
        tracked: trackedSet.has(key),
        quantity: p.quantity,
        sameDocument: p.sameDocument,
      };
    });
  },
});

// Read-only preview for the panel's confirm step: for each selected part,
// fetch its rendered image and the part number it would get on sync. Makes NO
// changes to the tracker or Onshape (the counter is only projected, not
// advanced), so the user can review before committing. `keys` are the composite
// `sourceElementId:partId` ids from the picker.
export const buildPreview = internalAction({
  args: {
    documentId: v.string(),
    wv: v.string(),
    wvid: v.string(),
    elementId: v.string(),
    keys: v.array(v.string()),
  },
  returns: v.object({
    wv: v.string(),
    parts: v.array(
      v.object({
        name: v.string(),
        material: v.union(v.string(), v.null()),
        image: v.union(v.string(), v.null()), // data URL, or null if unavailable
        partNumber: v.union(v.string(), v.null()),
        tracked: v.boolean(),
        willWriteBack: v.boolean(),
        quantity: v.number(),
        sameDocument: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { parts: all } = await resolveSyncParts(
      ctx,
      args.documentId,
      args.wv,
      args.wvid,
      args.elementId,
    );
    const wanted = new Set(args.keys);
    const parts = all.filter((p) =>
      wanted.has(partKey(p.sourceElementId, p.partId)),
    );

    const meta: Array<{
      part: (typeof parts)[number];
      onshapePartNumber?: string;
      image: string | null;
    }> = [];
    for (const p of parts) {
      let onshapePartNumber: string | undefined;
      let image: string | null = null;
      // Metadata + thumbnail only exist for same-document (enrichable) parts.
      if (p.enrichable) {
        try {
          const prop = await fetchPartNumberProperty(
            ctx,
            p.sourceDocumentId,
            args.wv,
            args.wvid,
            p.sourceElementId,
            p.partId,
          );
          onshapePartNumber = prop?.value ? prop.value : undefined;
        } catch (err) {
          console.error(`Preview part-number read failed for ${p.partId}:`, err);
        }
        try {
          const b64 = await fetchShadedViewBase64(
            ctx,
            p.sourceDocumentId,
            args.wv,
            args.wvid,
            p.sourceElementId,
            p.partId,
          );
          if (b64) image = `data:image/png;base64,${b64}`;
        } catch (err) {
          console.error(`Preview image fetch failed for ${p.partId}:`, err);
        }
      }
      meta.push({ part: p, onshapePartNumber, image });
    }

    const numbers: Array<{
      partNumber: string | null;
      tracked: boolean;
      willWriteBack: boolean;
    }> = await ctx.runQuery(internal.onshape.previewNumbers, {
      items: meta.map((m) => ({
        onshapeElementId: partKey(m.part.sourceElementId, m.part.partId),
        onshapeDocumentId: m.part.sourceDocumentId,
        onshapePartNumber: m.onshapePartNumber,
      })),
    });

    return {
      wv: args.wv,
      parts: meta.map((m, i) => ({
        name: m.part.name,
        material: m.part.material,
        image: m.image,
        partNumber: numbers[i].partNumber,
        tracked: numbers[i].tracked,
        willWriteBack:
          numbers[i].willWriteBack && m.part.enrichable && args.wv === "w",
        quantity: m.part.quantity,
        sameDocument: m.part.sameDocument,
      })),
    };
  },
});

// Sync an element's parts (on demand) into the tracker. With `keys`, only those
// parts are synced. For an Assembly, quantities are instance counts; for a Part
// Studio, 1 each. Per part: reconcile the part number bidirectionally, write
// generated numbers back into Onshape (same-document workspace only), and store
// a shaded-view preview as the thumbnail.
export const syncElement = internalAction({
  args: {
    documentId: v.string(),
    wv: v.string(), // "w" (workspace) or "v" (version)
    wvid: v.string(),
    elementId: v.string(),
    keys: v.optional(v.array(v.string())),
  },
  returns: v.object({
    upserted: v.number(),
    numbersWritten: v.number(),
    previews: v.number(),
  }),
  handler: async (ctx, args) => {
    const { parts: all } = await resolveSyncParts(
      ctx,
      args.documentId,
      args.wv,
      args.wvid,
      args.elementId,
    );
    let parts = all;
    if (args.keys) {
      const wanted = new Set(args.keys);
      parts = all.filter((p) => wanted.has(partKey(p.sourceElementId, p.partId)));
    }

    let upserted = 0;
    let numbersWritten = 0;
    let previews = 0;

    for (const p of parts) {
      // 1. Read Onshape's current part number (same-document parts only).
      let pnProp: { propertyId: string; value: string } | null = null;
      if (p.enrichable) {
        try {
          pnProp = await fetchPartNumberProperty(
            ctx,
            p.sourceDocumentId,
            args.wv,
            args.wvid,
            p.sourceElementId,
            p.partId,
          );
        } catch (err) {
          console.error(`Part number read failed for ${p.partId}:`, err);
        }
      }

      // 2. Upsert, feeding the tracker Onshape's number and the assembly qty.
      const result = await ctx.runMutation(
        internal.onshape.upsertPartFromOnshape,
        {
          onshapeElementId: partKey(p.sourceElementId, p.partId),
          onshapeDocumentId: p.sourceDocumentId,
          name: p.name,
          material: p.material ?? undefined,
          quantityNeeded: p.quantity,
          onshapePartNumber: pnProp?.value ? pnProp.value : undefined,
          lastModifiedInOnshape: Date.now(),
        },
      );
      upserted++;

      // 3. Push a generated/kept number back into Onshape. Same-document
      //    workspace only, and only when we found the property id to target.
      if (
        result.writeBackPartNumber &&
        p.enrichable &&
        args.wv === "w" &&
        pnProp?.propertyId
      ) {
        try {
          const ok = await writePartNumber(
            ctx,
            p.sourceDocumentId,
            args.wvid,
            p.sourceElementId,
            p.partId,
            pnProp.propertyId,
            result.writeBackPartNumber,
          );
          if (ok) numbersWritten++;
        } catch (err) {
          console.error(`Part number write-back failed for ${p.partId}:`, err);
        }
      }

      // 4. Store a shaded-view preview as the part thumbnail (same-document).
      if (p.enrichable) {
        try {
          const blob = await fetchPartPreview(
            ctx,
            p.sourceDocumentId,
            args.wv,
            args.wvid,
            p.sourceElementId,
            p.partId,
          );
          if (blob) {
            const storageId = await ctx.storage.store(blob);
            await ctx.runMutation(internal.parts.setThumbnailInternal, {
              id: result.partId,
              storageId,
            });
            previews++;
          }
        } catch (err) {
          console.error(`Preview fetch failed for ${p.partId}:`, err);
        }
      }
    }

    return { upserted, numbersWritten, previews };
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
    const result: {
      upserted: number;
      numbersWritten: number;
      previews: number;
    } = await ctx.runAction(internal.onshapeOAuth.syncElement, context);
    return htmlResponse(
      `✅ Synced ${result.upserted} part${result.upserted === 1 ? "" : "s"} to the Deceivers tracker` +
        ` (${result.numbersWritten} number${result.numbersWritten === 1 ? "" : "s"} written, ` +
        `${result.previews} preview${result.previews === 1 ? "" : "s"}).`,
    );
  } catch (err) {
    return htmlResponse(`⚠️ Sync failed: ${errMessage(err)}`);
  }
});

// ---- Right-panel app (select parts, then sync only those) ----
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
export const peekPanelToken = internalQuery({
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
    if (!row || row.expiresAt < Date.now()) return null;
    return {
      documentId: row.documentId,
      wv: row.wv,
      wvid: row.wvid,
      elementId: row.elementId,
    };
  },
});

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
    tracked: boolean;
    quantity: number;
    sameDocument: boolean;
  }>;
  try {
    parts = await ctx.runAction(internal.onshapeOAuth.listElementParts, context);
  } catch (err) {
    return htmlResponse(`⚠️ Could not load parts: ${errMessage(err)}`);
  }
  const token: string = await ctx.runMutation(
    internal.onshapeOAuth.createPanelToken,
    context,
  );
  return panelHtml(parts, token, context.wv);
});

// Read-only preview for the panel: does NOT consume the token (the user may
// still go back and re-pick before confirming the sync).
export const previewSelected = httpAction(async (ctx, req) => {
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
  } | null = await ctx.runQuery(internal.onshapeOAuth.peekPanelToken, {
    token: body.token,
  });
  if (!context) {
    return Response.json(
      { error: "Session expired — reopen the panel." },
      { status: 401 },
    );
  }
  try {
    const result: {
      wv: string;
      parts: Array<{
        name: string;
        material: string | null;
        image: string | null;
        partNumber: string | null;
        tracked: boolean;
        willWriteBack: boolean;
        quantity: number;
        sameDocument: boolean;
      }>;
    } = await ctx.runAction(internal.onshapeOAuth.buildPreview, {
      ...context,
      keys,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 502 });
  }
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
    const result: {
      upserted: number;
      numbersWritten: number;
      previews: number;
    } = await ctx.runAction(internal.onshapeOAuth.syncElement, {
      ...context,
      keys,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: errMessage(err) }, { status: 502 });
  }
});
