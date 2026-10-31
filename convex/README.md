# Convex Backend

This directory contains the Deceptive Project backend: schema, database
functions, HTTP endpoints, and integration sync code.

Before changing Convex code, read `convex/_generated/ai/guidelines.md`. Those
local rules override generic Convex knowledge and include the current API,
query, auth, and testing patterns for this repo.

## Shape

- `schema.ts` defines the app tables: synced Clerk `users`, projects, boards,
  tasks/comments/attachments, competitions (per season), parts/QC/inventory,
  Onshape state,
  and GitHub issues/comments/repo mappings.
- `auth.ts` and `auth.config.ts` wire Clerk into Convex, store the current
  Clerk user, verify Clerk webhooks, and sync the Clerk roster into `users`.
- `tasks.ts`, `boards.ts`, `projects.ts`, `parts.ts`, `inventory.ts`, and
  `dashboard.ts` are the main app APIs used by the React routes.
- `onshape.ts`, `onshapeOAuth.ts`, and `lib/onshape*` handle CAD OAuth,
  right-panel sync, part numbering, and token encryption.
- `github.ts` and `lib/github*` handle issue/PR import, webhook sync, and
  write-back.
- `http.ts` registers the public HTTP endpoints for Clerk, Onshape, and GitHub
  webhooks/OAuth/panel requests.

## Auth Model

This app stores Clerk user IDs in local user-facing references such as
`users.authId`, task assignees, designers, and comment authors.

Roles are sourced from Clerk public metadata:

- `user.public_metadata.role === "mentor"` maps to mentor access.
- Any other value, missing role, or unsynced user maps to student access.
- The Clerk session token used for Convex should expose a top-level `role`
  claim sourced from `user.public_metadata.role`.
- `auth.storeCurrentUser`, `/clerk/webhook`, and `auth.syncUsersFromClerk`
  keep the local `users` table in sync.

Do not accept client-provided user IDs for authorization. Protected functions
must derive the caller server-side with `ctx.auth.getUserIdentity()` and the
helpers in `lib/auth.ts`.

## Environment

Backend secrets live in Convex deployment env, set with `npx convex env set`.
See the top-level `README.md` and `.env.local.example` for the complete list.
The common groups are:

- Clerk: `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`,
  `CLERK_WEBHOOK_SECRET`.
- Onshape: `ONSHAPE_OAUTH_CLIENT_ID`, `ONSHAPE_OAUTH_CLIENT_SECRET`,
  `ONSHAPE_SYNC_SECRET`, `ONSHAPE_TOKEN_ENC_KEY`, and optional
  `ONSHAPE_BASE_URL`.
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
