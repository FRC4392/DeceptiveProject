# Convex Backend

This directory contains the Deceptive Project backend: schema, database
functions, HTTP endpoints, and integration sync code.

Before changing Convex code, read `convex/_generated/ai/guidelines.md`. Those
local rules override generic Convex knowledge and include the current API,
query, auth, and testing patterns for this repo.

## Shape

- `schema.ts` defines the tables: synced Clerk `users`; seasons, subsystems
  and their part-number counters; parts with their stage events, notes and
  problems; machines and process types; bought items (`cotsItems`);
  sub-assemblies with their members, notes and events; the Onshape release
  intake queue and its lines; Onshape connection, webhook and API-call state;
  the to-do list and its tags and notes; competitions (per season); GitHub
  issues, comments and the repo registry; app settings; and inventory.
- `parts.ts`, `subAssemblies.ts`, `subsystems.ts`, `cots.ts`, `todos.ts`,
  `inventory.ts`, `dashboard.ts`, `seasons.ts`, `shop.ts` and `intake.ts` are
  the APIs the React routes call.
- `auth.ts` and `auth.config.ts` wire Clerk into Convex, store the current
  Clerk user, verify Clerk webhooks, and sync the Clerk roster into `users`.
- `onshape.ts`, `onshapeOAuth.ts`, `onshapeWebhook.ts` and `lib/onshape*`
  handle the Onshape connection, the right-panel sync, the release webhook and
  token encryption. `settings.ts` and `lib/budget.ts` are the API budget.
- `github.ts` and `lib/github*` handle issue/PR import, webhook sync, the repo
  registry and write-back.
- `http.ts` registers the public HTTP endpoints for the Clerk, Onshape and
  GitHub webhooks and the Onshape OAuth and panel requests.
- `lib/` holds the pure rules shared with the frontend — `stages.ts`,
  `assembly.ts`, `counts.ts` — and the server helpers `auth.ts`, `season.ts`
  and `numbering.ts`.

## Auth Model

This app stores Clerk user IDs in local references such as `users.authId`,
claimants, designers and note authors.

A person's role is their **effective role**, `lib/auth.ts::effectiveRole`:

- `appRole` — student, lead, mentor or admin — set by a mentor in Settings →
  People, or from the command line with `shop:grantRole`. It wins when set,
  and sign-in never overwrites it. This is what makes someone a lead.
- Otherwise Clerk's public metadata: `public_metadata.role === "mentor"` is a
  mentor, anything else a student. The session token used for Convex should
  expose that as a top-level `role` claim.
- `auth.storeCurrentUser`, `/clerk/webhook` and `auth.syncUsersFromClerk`
  keep the local `users` table in sync.

Every function checks who's asking for itself — a Convex query is a public
endpoint, and the sign-in screen only decides what the browser renders:

- **Reads** start with `canRead`, `canReadAsLead` or `canReadAsMentor` from
  `lib/auth.ts`, and return the empty value when they say no, rather than
  throwing. They go by `readerRole`, which falls back to the session's claim
  for someone whose `users` row hasn't been written yet, and gives the same
  answer `auth.currentUser` gives the screens. A read behind a role needs a
  matching gate on its screen, or a refusal looks like an empty page.
- **Writes** use `requireUserId`, `requireLead`, `requireMentor` or
  `getActor`, which throw.

Do not accept client-provided user IDs for authorization. Derive the caller
server-side with `ctx.auth.getUserIdentity()` and the helpers in `lib/auth.ts`.

## Environment

Backend secrets live in Convex deployment env, set with `npx convex env set`.
See the top-level `README.md` and `.env.local.example` for the complete list.
The common groups are:

- Clerk: `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`,
  `CLERK_WEBHOOK_SECRET`.
- Onshape: `ONSHAPE_OAUTH_CLIENT_ID`, `ONSHAPE_OAUTH_CLIENT_SECRET`,
  `ONSHAPE_SYNC_SECRET`, `ONSHAPE_WEBHOOK_SECRET`, `ONSHAPE_TOKEN_ENC_KEY`,
  and optional `ONSHAPE_BASE_URL`.
- GitHub: `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`.

Convex provides `CONVEX_SITE_URL` for the deployment HTTP endpoint; keep the
frontend `VITE_CONVEX_SITE_URL` copy pointed at the same URL for setup links.

Frontend-safe variables belong in `.env.local`, including `VITE_CONVEX_URL`,
`VITE_CONVEX_SITE_URL`, and `VITE_CLERK_PUBLISHABLE_KEY`.

## Testing

Run all checks from the repo root:

```sh
npm run lint
npm run test
npm run test:e2e
```

Convex tests live beside the backend files and use `convex-test`. Test files
that call `import.meta.glob` need the `/// <reference types="vite/client" />`
directive at the top, as described in the generated AI guidelines.
`convex-test` stamps `_creationTime` in order, so a test that dates rows with
fake timers has to set the clock before writing anything — see the budget
renewal tests in `settings.test.ts`.
