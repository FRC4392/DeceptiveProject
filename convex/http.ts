import { httpRouter } from "convex/server";
import { clerkWebhook } from "./auth";
import {
  oauthStart,
  oauthCallback,
  ext,
  panel,
  syncSelected,
} from "./onshapeOAuth";
import { githubWebhook } from "./github";

const http = httpRouter();

http.route({ path: "/clerk/webhook", method: "POST", handler: clerkWebhook });

// Onshape OAuth (one-time team authorization) + the on-demand sync button.
http.route({
  path: "/onshape/oauth/start",
  method: "GET",
  handler: oauthStart,
});
http.route({
  path: "/onshape/oauth/callback",
  method: "GET",
  handler: oauthCallback,
});
http.route({ path: "/onshape/ext", method: "GET", handler: ext });
// Right-panel app: GET renders the part picker, POST /sync-selected sends the
// selected parts to the tracker's "New from Onshape" queue.
http.route({ path: "/onshape/panel", method: "GET", handler: panel });
http.route({
  path: "/onshape/sync-selected",
  method: "POST",
  handler: syncSelected,
});

// GitHub issue/PR sync webhook — verified via the HMAC signature GitHub sends
// in `x-hub-signature-256` (secret = GITHUB_WEBHOOK_SECRET), not app auth.
http.route({ path: "/github/webhook", method: "POST", handler: githubWebhook });

export default http;
