// Onshape OAuth token plumbing: HTML response helper, refresh flow, and the
// authenticated fetch wrapper. The actual token storage (storeTokens /
// getAuthInternal, internalMutation/internalQuery) stays in
// ../onshapeOAuth.ts since those must remain addressable via
// `internal.onshapeOAuth.*`.
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  BUDGET_EXHAUSTED_STATUS,
  RATE_LIMITED_STATUS,
  RETRY_DELAYS_MS,
  blockedReason,
  type CallPurpose,
} from "./budget";

/**
 * Thrown instead of calling Onshape, when the budget mode says not to. A
 * distinct class so callers can tell "we chose not to" from "Onshape broke" —
 * the first is a normal state with a manual way round it, the second isn't.
 */
export class BudgetBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BudgetBlockedError";
  }
}

export const TOKEN_URL = "https://oauth.onshape.com/oauth/token";

export function htmlResponse(message: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Deceivers · Onshape</title>
     <style>body{font-family:system-ui,sans-serif;background:#001730;color:#EAF1F9;display:flex;
     align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;max-width:32rem;padding:2rem}</style>
     </head><body><div><h2>${message}</h2></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// Exchange the stored refresh token for a fresh access token and persist it.
export async function refreshOnshapeToken(
  ctx: ActionCtx,
  refreshToken: string,
): Promise<string> {
  const clientId = process.env.ONSHAPE_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.ONSHAPE_OAUTH_CLIENT_SECRET!;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    // The admin page can't discover this for itself, so leave it a note. This
    // is what a connection whose owner has left the Classroom looks like.
    const message = `Onshape token refresh failed: ${res.status}. Reconnect in Settings → Onshape.`;
    await ctx.runMutation(internal.onshapeOAuth.recordAuthFailure, {
      error: message,
    });
    throw new Error(message);
  }
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  await ctx.runMutation(internal.onshapeOAuth.storeTokens, {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
    reason: "refresh",
  });
  return tok.access_token;
}

// Returns a valid access token, refreshing it first if it's near expiry.
export async function getValidAccessToken(ctx: ActionCtx): Promise<string> {
  const auth = await ctx.runQuery(internal.onshapeOAuth.getAuthInternal, {});
  if (!auth) {
    throw new Error("Onshape is not connected. Connect it in Admin → Onshape.");
  }
  if (Date.now() < auth.expiresAt - 60_000) return auth.accessToken;
  return refreshOnshapeToken(ctx, auth.refreshToken);
}

// Force a refresh regardless of the cached expiry — used to recover when
// Onshape rejects a token our clock still considers valid (expiry drift, a
// server-side revocation, or a scope change).
export async function forceRefreshAccessToken(ctx: ActionCtx): Promise<string> {
  const auth = await ctx.runQuery(internal.onshapeOAuth.getAuthInternal, {});
  if (!auth) {
    throw new Error("Onshape is not connected. Connect it in Admin → Onshape.");
  }
  return refreshOnshapeToken(ctx, auth.refreshToken);
}

/**
 * Authenticated Onshape API fetch — and the only way anything in this app is
 * allowed to call Onshape, because this is where calls are counted against the
 * team's yearly allowance. On a 401 (cached token rejected) it forces one
 * refresh and retries, so a stale-but-not-expired token self-heals instead of
 * failing every call until the cached expiry passes.
 */
export async function onshapeFetch(
  ctx: ActionCtx,
  url: string,
  init?: RequestInit,
  purpose: CallPurpose = "sync",
): Promise<Response> {
  // The budget mode decides before anything leaves the building. A refused
  // call is not a failed call: nothing is sent, so nothing is recorded.
  const mode = await ctx.runQuery(internal.settings.currentMode, {});
  const refused = blockedReason(mode, purpose);
  if (refused) throw new BudgetBlockedError(refused);

  const method = init?.method ?? "GET";
  const record = async (res: Response) => {
    // Onshape doesn't charge for failures, and `recordApiCall` applies that
    // rule — so the meter the team sees is what they actually spent.
    await ctx.runMutation(internal.onshape.recordApiCall, {
      method,
      endpoint: new URL(url).pathname,
      status: res.status,
    });
  };
  const send = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await send(await getValidAccessToken(ctx));
  await record(res);

  if (res.status === 401) {
    try {
      res = await send(await forceRefreshAccessToken(ctx));
      await record(res);
    } catch (err) {
      // Refresh itself failed (e.g. the refresh token was invalidated by the
      // scope change) — surface the original 401 to the caller.
      console.error("Onshape token refresh after 401 failed:", err);
    }
  }

  // 429 is a short per-endpoint window, not the yearly allowance, so riding it
  // out is worth a few seconds. Rate-limited responses aren't counted, so the
  // retries are free.
  for (const delay of RETRY_DELAYS_MS) {
    if (res.status !== RATE_LIMITED_STATUS) break;
    await sleep(delay);
    res = await send(await getValidAccessToken(ctx));
    await record(res);
  }

  // 402 is the allowance itself being gone. Stop the app spending before it
  // discovers this one call at a time.
  if (res.status === BUDGET_EXHAUSTED_STATUS) {
    await ctx.runMutation(internal.settings.forceManualMode, {
      reason: `Onshape returned 402 on ${new URL(url).pathname} — the yearly allowance is gone.`,
    });
  }

  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
