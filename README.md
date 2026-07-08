# Deceptive Project

A Vite + React + TypeScript app with Convex as the backend (database,
server functions, real-time sync) and WorkOS AuthKit for auth — reusing
an **existing** WorkOS team so users/sessions are shared across apps.

Stack:

- [React](https://react.dev/) + TypeScript, built with [Vite](https://vitejs.dev/)
- [React Router](https://reactrouter.com/) for client-side routing
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [Convex](https://convex.dev/) for the database, queries/mutations, and real-time sync
- [WorkOS AuthKit](https://workos.com/docs/authkit) via the official
  [`@convex-dev/workos-authkit`](https://github.com/get-convex/workos-authkit) Convex component
- [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/react) for component tests

## Running locally

Two dev processes run side by side:

```sh
npx convex dev   # watches convex/ and pushes functions to your deployment
npm run dev      # `npx convex dev` + vite, in one command (see package.json)
```

In practice `npm run dev` does both for you (it runs `convex dev --start
'vite --open'`), so you usually only need that one command once your
environment variables are set up (below).

## Environment variables

Frontend/Convex-client vars go in `.env.local` (see
[`.env.local.example`](.env.local.example)); this file is created and kept
in sync automatically the first time you run `npx convex dev`:

- `CONVEX_DEPLOYMENT` — which Convex deployment your CLI targets
- `VITE_CONVEX_URL` — the Convex client URL the frontend connects to
- `VITE_CONVEX_SITE_URL` — the Convex HTTP/site URL used for OAuth callback,
  panel, and webhook setup links, e.g. `https://<deployment>.convex.site`
- `VITE_WORKOS_CLIENT_ID` — your existing WorkOS Client ID
- `VITE_WORKOS_REDIRECT_URI` — where WorkOS redirects back to after sign-in (defaults to `http://localhost:5173`)

Backend secrets are **not** stored in any `.env` file — they live only in
the Convex deployment's environment:

```sh
npx convex env set WORKOS_CLIENT_ID <your existing client id>
npx convex env set WORKOS_API_KEY <your existing api key>
npx convex env set WORKOS_WEBHOOK_SECRET <secret from the webhook you create below>
npx convex env set ONSHAPE_OAUTH_CLIENT_ID <your Onshape OAuth app client id>
npx convex env set ONSHAPE_OAUTH_CLIENT_SECRET <your Onshape OAuth app client secret>
npx convex env set ONSHAPE_SYNC_SECRET <random string>
npx convex env set ONSHAPE_TOKEN_ENC_KEY <output of `openssl rand -base64 32`>
npx convex env set ONSHAPE_BASE_URL <optional alternate Onshape base URL>
npx convex env set GITHUB_WEBHOOK_SECRET <random string>
npx convex env set GITHUB_TOKEN <github-PAT>
```

`CONVEX_SITE_URL` is read by backend OAuth helpers and is normally provided by
Convex for the deployment's HTTP endpoint. `VITE_CONVEX_SITE_URL` is the
frontend-safe copy used only to render setup links in the admin UI.

Reuse the `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` from your **existing**
WorkOS team/dashboard (the one shared with your other apps). Nothing in
this project provisions a new WorkOS team — the AuthKit component is
wired up using the "existing app" flow, not the managed/auto-provisioned
onboarding flow.

This app intentionally stores WorkOS user IDs (`ctx.auth.getUserIdentity()`
`subject`) in local records such as `users.authId`, task assignees, designers,
and comment authors. Generic Convex guidance recommends `tokenIdentifier` as
the canonical identity key, but Deceptive apps share one WorkOS directory and
need the WorkOS user ID as the stable cross-app roster key. This matches the
DeceptiveHours implementation.

If your WorkOS environment hosts more than one app, keep all Deceptive apps on
the same WorkOS team/environment and confirm valid tokens are accepted by
`convex/auth.config.ts`. DeceptiveHours documents an additional
`WORKOS_ENVIRONMENT_CLIENT_ID` setting for its multi-app issuer case; add the
same pattern here only if this deployment starts rejecting otherwise-valid
shared-environment tokens.

> **Note on `WORKOS_COOKIE_PASSWORD`:** that variable is used by
> server-rendered AuthKit integrations (e.g. `@workos-inc/authkit-nextjs`)
> that seal session state into an encrypted cookie. This app is a
> client-side SPA using `@workos-inc/authkit-react` together with Convex's
> `customJwt` auth provider (see `convex/auth.config.ts`), which validates
> WorkOS-issued JWTs directly and never creates a sealed cookie session —
> so `WORKOS_COOKIE_PASSWORD` isn't used here and doesn't need to be set.

## Configuring the existing WorkOS team's dashboard

This app was added to the existing WorkOS team at
`https://dashboard.workos.com`. Two things had to be added there:

1. **Redirect URI** (Redirects page): add this app's origin, e.g.
   `http://localhost:5173` for local dev (and your production origin once
   deployed). Also add the origin to the allowed origins list on the
   Authentication page.
2. **Sign-in endpoint** (Redirects page, optional but wired up here):
   `http://localhost:5173/login` — this app has a dedicated `/login` route
   (`src/routes/LoginRoute.tsx`) that starts the OAuth flow, for flows that
   begin outside the app (dashboard impersonation, another app's sign-in
   link, etc).
3. **Webhook** (Webhooks page): create a webhook pointing at

   ```
   https://<your-convex-deployment>.convex.site/workos/webhook
   ```

   for this project's dev deployment that's:

   ```
   https://acoustic-lobster-21.convex.site/workos/webhook
   ```

   Select events `user.created`, `user.updated`, `user.deleted`. Copy the
   signing secret WorkOS shows you and set it as `WORKOS_WEBHOOK_SECRET`
   (command above). This is what lets user create/update/delete events in
   WorkOS sync into this app's Convex `users` table (`convex/auth.ts`).
   Also include `organization_membership.created`,
   `organization_membership.updated`, and `organization_membership.deleted`
   when available; those events sync mentor/student role changes immediately.
   User create/update events still schedule a WorkOS API role reconciliation
   action, so missed membership events are corrected.

### Backfilling users that already exist in the team

A user created by another app on the same WorkOS team won't trigger a
`user.created` webhook event just by logging into _this_ app (they're not
new in WorkOS). To sync existing team members into this app's database,
run the backfill once after the webhook is configured:

```sh
npx convex run auth:backfillUsers
```

This is idempotent — safe to re-run, and it fires the same `user.created`
handler used by the live webhook, so it also populates this app's own
`users` table.

## Project structure

This started as a single-team task tracker and has grown into a full
FRC/FTC team management suite: project/board/task tracking, a parts &
inventory tracker, Onshape CAD sync, and GitHub issue/PR sync — all backed
by one Convex deployment with WorkOS auth in front of it.

```
convex/
  schema.ts          users, projects, boards, tasks (+ comments/attachments),
                     competitions, parts (+ comments/QC checks),
                     inventoryItems, partNumberCounters, onshapeDocuments/
                     onshapeAuth/onshapeOAuthState/onshapePanelTokens,
                     issues/issueComments/githubRepos
  auth.ts            AuthKit client, event syncing, getCurrentUser query
  auth.config.ts     Convex auth providers (WorkOS JWT validation)
  authActions.ts     WorkOS role sync (syncRoleFromWorkOS)
  convex.config.ts   registers the workOSAuthKit component
  http.ts            registers all httpAction routes (WorkOS webhook,
                     Onshape OAuth + panel, GitHub webhook)
  users.ts           user queries
  projects.ts        project CRUD (mentor-managed groupings of Onshape docs)
  boards.ts          subsystem-scoped task buckets
  tasks.ts           the canonical task list (queries/mutations scoped to
                     the logged-in user; parts/issues mirror into it)
  dashboard.ts       aggregate stats for the dashboard/countdown views
  competitions.ts    competition dates for the dashboard countdown
  parts.ts           part tracker (fabrication status, part numbers, QC)
  inventory.ts       stocked-inventory items linked to parts
  onshape.ts         part-number generation/reconciliation, document CRUD
  onshapeOAuth.ts    Onshape OAuth flow + right-panel sync httpActions
  github.ts          GitHub issue/PR queries, mutations, repo mapping
  lib/               shared helpers: auth guards (auth.ts), task mirroring
                     (taskSync.ts), Onshape/GitHub parsing and sync logic
src/
  main.tsx           AuthKitProvider + ConvexProviderWithAuthKit + router
  Layout.tsx         authenticated shell (Sidebar + top bar)
  routes/            DashboardPage, BoardsPage/BoardPage, MyTasksPage,
                     TimelinePage, CalendarPage, PartsPage/PartDetailPage,
                     InventoryPage, IssuesPage/IssueDetailPage, AdminPage,
                     GitHubAdminPage, OnshapeAdminPage, MobilePage,
                     LoginRoute, ComingSoonPage
  components/        Sidebar, ProjectSwitcher, UserMenu, ThemeToggle
  components/pm/     TaskCard, TaskFormDialog, PartFormDialog,
                     IssueFormDialog, ProjectsAdmin, TaskMeta,
                     PartStatusBadge
  components/ui/     shadcn/ui primitives (Button, Card, Input, Dialog, ...)
```

## Testing & tooling

```sh
npm run test          # vitest run
npm run test:e2e      # smoke tests for shell/navigation/setup states
npm run test:watch    # vitest watch mode
npm run lint           # tsc + eslint
npm run format         # prettier --write .
```
