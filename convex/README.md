# Convex Backend

This directory contains the Deceptive Project backend: schema, database
functions, HTTP endpoints, and integration sync code.

Before changing Convex code, read `convex/_generated/ai/guidelines.md`. Those
local rules override generic Convex knowledge and include the current API,
query, auth, and testing patterns for this repo.

## Shape

- `schema.ts` defines the app tables: synced WorkOS `users`, projects, boards,
  tasks/comments/attachments, competitions, parts/QC/inventory, Onshape state,
  and GitHub issues/comments/repo mappings.
- `auth.ts`, `authActions.ts`, and `auth.config.ts` wire WorkOS AuthKit into
  Convex and sync local user roles.
- `tasks.ts`, `boards.ts`, `projects.ts`, `parts.ts`, `inventory.ts`, and
  `dashboard.ts` are the main app APIs used by the React routes.
- `onshape.ts`, `onshapeOAuth.ts`, and `lib/onshape*` handle CAD OAuth,
  right-panel sync, part numbering, and token encryption.
- `github.ts` and `lib/github*` handle issue/PR import, webhook sync, and
  write-back.
- `http.ts` registers the public HTTP endpoints for WorkOS, Onshape, and GitHub
  webhooks/OAuth/panel requests.

## Auth Model

This app intentionally stores WorkOS user ids, not Convex `tokenIdentifier`, in
local user-facing references such as `users.authId`, task assignees, designers,
and comment authors. Deceptive apps share one WorkOS team directory, and this
matches the sibling DeceptiveHours implementation.

WorkOS Roles are the source of truth for permissions:

- `mentor` maps to mentor access.
- Any other role, missing role, or unsynced role maps to student access.
- WorkOS membership events update local roles immediately.
- `authActions.syncRoleFromWorkOS` remains as a scheduled reconciliation path
  after user create/update events.

Do not accept client-provided user ids for authorization. Protected functions
must derive the caller server-side with `ctx.auth.getUserIdentity()` and the
helpers in `lib/auth.ts`.

## Environment

Backend secrets live in Convex deployment env, set with `npx convex env set`.
See the top-level `README.md` and `.env.local.example` for the complete list.
The common groups are:

- WorkOS: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`,
  `WORKOS_WEBHOOK_SECRET`.
- Onshape: `ONSHAPE_OAUTH_CLIENT_ID`, `ONSHAPE_OAUTH_CLIENT_SECRET`,
  `ONSHAPE_SYNC_SECRET`, `ONSHAPE_TOKEN_ENC_KEY`, and optional
  `ONSHAPE_BASE_URL`.
- GitHub: `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`.

Convex provides `CONVEX_SITE_URL` for the deployment HTTP endpoint; keep the
frontend `VITE_CONVEX_SITE_URL` copy pointed at the same URL for setup links.

Frontend-safe variables belong in `.env.local`, including
`VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_WORKOS_CLIENT_ID`, and
`VITE_WORKOS_REDIRECT_URI`.

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
