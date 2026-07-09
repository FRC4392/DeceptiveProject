# Deceptive Project

A Vite + React + TypeScript app with Convex as the backend for database,
server functions, real-time sync, and Clerk for authentication.

Stack:

- [React](https://react.dev/) + TypeScript, built with [Vite](https://vitejs.dev/)
- [React Router](https://reactrouter.com/) for client-side routing
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [Convex](https://convex.dev/) for database, queries/mutations, HTTP actions, and real-time sync
- [Clerk](https://clerk.com/) via Convex's [`ConvexProviderWithClerk`](https://docs.convex.dev/auth/clerk)
- [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/react)

## Running locally

Two dev processes run side by side:

```sh
npx convex dev   # watches convex/ and pushes functions to your deployment
npm run dev      # `npx convex dev` + vite, in one command
```

In practice `npm run dev` does both once your environment variables are set.

## Environment variables

Frontend/Convex-client vars go in `.env.local` (see
[`.env.local.example`](.env.local.example)):

- `CONVEX_DEPLOYMENT` - which Convex deployment your CLI targets
- `VITE_CONVEX_URL` - the Convex client URL the frontend connects to
- `VITE_CONVEX_SITE_URL` - the Convex HTTP/site URL used for OAuth callback,
  panel, and webhook setup links, e.g. `https://<deployment>.convex.site`
- `VITE_CLERK_PUBLISHABLE_KEY` - Clerk publishable key for the matching Clerk
  development or production instance

Backend secrets are not stored in `.env.local`; they live in the Convex
deployment environment:

```sh
npx convex env set CLERK_JWT_ISSUER_DOMAIN <your Clerk Frontend API URL>
npx convex env set CLERK_SECRET_KEY <your Clerk secret key>
npx convex env set CLERK_WEBHOOK_SECRET <secret from the Clerk webhook>
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

## Clerk setup

Use the same Clerk instance that should own this app's users.

1. Activate Clerk's Convex integration in the Clerk dashboard.
2. Copy the Clerk Frontend API URL from the Convex integration page and set it
   as `CLERK_JWT_ISSUER_DOMAIN` in the Convex deployment.
3. Copy the Clerk publishable key into `.env.local` as
   `VITE_CLERK_PUBLISHABLE_KEY`.
4. Set `CLERK_SECRET_KEY` in Convex env so mentor users can sync the current
   Clerk roster from the Admin page.
5. Configure the Clerk session token used by the Convex integration to include
   a top-level `role` claim sourced from `user.public_metadata.role`.
6. Add a Clerk webhook for `user.created`, `user.updated`, and `user.deleted`
   pointing at:

```txt
https://<your-convex-deployment>.convex.site/clerk/webhook
```

Then copy its signing secret into Convex env as `CLERK_WEBHOOK_SECRET`.

Use separate Clerk development and production values for publishable key,
secret key, webhook secret, and issuer domain. Development issuer domains
usually look like `https://verb-noun-00.clerk.accounts.dev`; production issuer
domains usually look like `https://clerk.<your-domain>.com`.

## Auth model

The app stores Clerk user IDs in local user-facing references:
`users.authId`, task assignees, part designers, and comment authors. Existing
records that still reference old provider IDs are not remapped automatically
and may show as unknown until reassigned.

Roles are sourced from Clerk public metadata:

- `user.public_metadata.role === "mentor"` grants mentor access.
- Any missing or non-mentor value maps to student access.
- Sign-in storage, Clerk webhooks, and the Admin page's "Sync Clerk" action
  keep Convex's local `users` table current.

## Project structure

This started as a single-team task tracker and has grown into a full FRC/FTC
team management suite: project/board/task tracking, a parts and inventory
tracker, Onshape CAD sync, and GitHub issue/PR sync.

```txt
convex/
  schema.ts          users, projects, boards, tasks (+ comments/attachments),
                     competitions, parts (+ comments/QC checks),
                     inventoryItems, partNumberCounters, onshapeDocuments/
                     onshapeAuth/onshapeOAuthState/onshapePanelTokens,
                     issues/issueComments/githubRepos
  auth.ts            Clerk current-user query, local user sync, webhook,
                     and mentor-only Clerk roster backfill
  auth.config.ts     Convex auth provider config for Clerk JWT validation
  http.ts            registers Clerk webhook, Onshape OAuth + panel,
                     and GitHub webhook routes
  users.ts           user roster queries
  projects.ts        project CRUD
  boards.ts          subsystem-scoped task buckets
  tasks.ts           canonical task list
  dashboard.ts       aggregate dashboard/countdown stats
  competitions.ts    competition dates
  parts.ts           part tracker
  inventory.ts       stocked-inventory items linked to parts
  onshape.ts         part-number generation/reconciliation, document CRUD
  onshapeOAuth.ts    Onshape OAuth flow + right-panel sync httpActions
  github.ts          GitHub issue/PR queries, mutations, repo mapping
  lib/               shared auth guards, task mirroring, parsing and sync logic
src/
  main.tsx           ClerkProvider + ConvexProviderWithClerk + router
  Layout.tsx         authenticated shell
  routes/            DashboardPage, BoardsPage/BoardPage, MyTasksPage,
                     TimelinePage, CalendarPage, PartsPage/PartDetailPage,
                     InventoryPage, IssuesPage/IssueDetailPage, AdminPage,
                     GitHubAdminPage, OnshapeAdminPage, MobilePage
  components/        Sidebar, ProjectSwitcher, ThemeToggle
  components/pm/     TaskCard, TaskFormDialog, PartFormDialog,
                     IssueFormDialog, ProjectsAdmin, TaskMeta,
                     PartStatusBadge
  components/ui/     shadcn/ui primitives
```

## Testing and tooling

```sh
npm run test          # vitest run
npm run test:e2e      # smoke tests for shell/navigation/setup states
npm run test:watch    # vitest watch mode
npm run lint           # tsc + eslint
npm run format         # prettier --write .
```
