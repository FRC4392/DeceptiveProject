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
5. Configure the Clerk session token used by the Convex integration. In the
   Clerk dashboard, open **Configure → Sessions → Customize session token**
   (or the `convex` JWT template, depending on your Clerk version) and add:

   ```json
   {
     "email": "{{user.primary_email_address}}",
     "name": "{{user.full_name}}",
     "role": "{{user.public_metadata.role}}"
   }
   ```

   Without these the token carries no claims, so the app sees no name, no
   email and no role — everyone looks like a student called `user_abc123`.
   Clerk caches session tokens for about a minute, so sign out and back in
   after changing this.

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

Roles are sourced from Clerk public metadata, and the tracker layers its own
on top:

- `user.public_metadata.role === "mentor"` grants mentor access.
- Any missing or non-mentor value maps to student access.
- Sign-in storage, Clerk webhooks, and the Admin page's "Sync Clerk" action
  keep Convex's local `users` table current, overwriting `users.role` each
  time.
- A mentor can set someone's tracker role (`student` / `lead` / `mentor` /
  `admin`) in Tracker settings → People. That's stored as `users.appRole` and
  wins over the Clerk value, so promoting a design lead doesn't mean editing
  Clerk metadata — and a Clerk re-sync won't undo it.

Signing in only fills in the fields the session token actually carries, so a
token missing a claim leaves what's already stored alone rather than blanking
it. The Clerk webhook and the "Sync Clerk" backfill read the Clerk API
directly, and those _are_ authoritative — they overwrite.

### Making the first mentor

Settings → People is mentor-only, so the first one is made from the command
line, after they have signed in at least once:

```sh
npx convex run shop:grantRole '{"email":"you@example.com","role":"mentor"}'
```

Pass `authId` instead of `email` if the roster has no email for them yet (which
is what a session token with no `email` claim looks like). This sets `appRole`,
so it holds regardless of what Clerk's token says.

## The part tracker

The main thing this app does is follow every robot part from Onshape CAD to
the robot. Six stages, left to right:

| #   | Stage             | Moves on when                              | Who can move it        |
| --- | ----------------- | ------------------------------------------ | ---------------------- |
| 1   | In design         | It's released in Onshape                   | Lead, mentor           |
| 2   | Needs drawing     | A lead checks the drawing / DXF / toolpath | Lead, mentor           |
| 3   | Ready to make     | The maker has recorded them all made       | Anyone                 |
| 4   | Ready to finish   | Deburr, tap, countersink, coat is done     | Anyone                 |
| 5   | Ready to assemble | It goes on the robot                       | Subsystem lead, mentor |
| 6   | Assembled         | —                                          | —                      |

A part's **process** decides which stages it skips: a 3D print needs no
drawing, and a part with no finishing goes from the machine straight to the
bin. Bought (COTS) items get no part number at all — they're tracked per
subsystem as _Needed → Ordered → Arrived_, and _Arrived_ counts as ready to
assemble.

**The app issues part numbers**, `{YY}-{SUB}-{NNN}` (e.g. `27-INT-104`), from a
counter per season and subsystem. Convex runs each mutation as a transaction,
so two students pressing "Get a part number" at the same moment can't be given
the same one, and a number is never reused. `{YY}-{SUB}-000` is reserved for a
subsystem's top-level assembly. Searching for a part forgives how it's typed:
`27-INT-104`, `int-104`, `INT104` and `104` all find it.

A part can be claimed from **In design through Ready to finish** — designing
it, drawing it, making it and finishing it are all somebody's job to pick up.
An unclaimed one in those stages reads "Up for grabs". Past that it's in the
bin and goes on the robot with its sub-assembly rather than being claimed on
its own. Moving a part to the next stage releases the claim, since the next
stage is different work.

Students find parts by **typing the number** — there is no QR code or scanner
anywhere in the app.

Moving a part backwards, and flagging a problem, are always allowed for leads
and mentors. **Anyone** can press "Something went wrong" (broke, scrapped, ran
out of material, unsure); that opens a problem, puts the count back and sends
the part to the machine again.

The rules live in one place, [`convex/lib/stages.ts`](convex/lib/stages.ts),
which both the server functions and the React screens import — so a button is
disabled for exactly the reason the server would refuse it.

### Onshape, and the API budget

The team's Onshape Classroom allows roughly **2,500 successful API calls a year
for everyone**, so the tracker is built to need almost none of them:

- Getting a number and pasting it into Onshape costs **nothing**.
- Nothing is written back into Onshape.
- Thumbnails and file exports (DXF/STL/PDF) are never fetched; the app builds
  free deep links and students export from Onshape themselves.
- A sync reads an element's parts and parks them under **New from Onshape**
  for a design lead to review. Nothing lands on the board unasked.
- Every call goes through one wrapper (`convex/lib/onshapeAuth.ts`) that logs
  it to `apiCalls`, and only 2xx/3xx responses count — which is what the budget
  meter shows.

**The tracker works with no Onshape connection at all.** A lead can type part
numbers in by hand or upload a BOM CSV, and the same matching logic runs
against them.

## Project structure

This started as a single-team task tracker and has grown into a full FRC/FTC
team management suite: the part tracker above, plus a season to-do list,
inventory, and GitHub issue/PR sync.

```txt
convex/
  schema.ts          users, seasons, subsystems, parts (+ stage events, notes,
                     problems), partNumberCounters, machines, processTypes,
                     training, cotsItems, assembly steps, release intakes,
                     apiCalls, appSettings, onshape*, todos/todoTags/
                     todoNotes, issues/issueComments, inventoryItems
  lib/stages.ts      the stage model: what comes next and who may move it.
                     Imported by the React screens too
  lib/numbering.ts   {YY}-{SUB}-{NNN}, taken inside the mutation transaction
  lib/intake.ts      release matching (matched / changed / unknown / removed)
                     and BOM CSV parsing
  parts.ts           the tracker: numbers, stage moves, claiming, problems
  subsystems.ts      subsystems, progress tiles, assembly steps
  shop.ts            machines, process types, roles
  seasons.ts         seasons + first-run setup
  cots.ts            bought items
  intake.ts          the "New from Onshape" queue and the manual ways in
  settings.ts        app settings and the API budget meter
  onshape.ts         document to subsystem mapping, sync intake, call logging
  onshapeOAuth.ts    Onshape OAuth flow + right-panel httpActions
  auth.ts            Clerk current-user query, local user sync, webhook,
                     and mentor-only Clerk roster backfill
  auth.config.ts     Convex auth provider config for Clerk JWT validation
  http.ts            registers Clerk webhook, Onshape OAuth + panel,
                     and GitHub webhook routes
  users.ts           user roster queries
  todos.ts           the season to-do list and its tags
  dashboard.ts       aggregate dashboard/countdown stats
  competitions.ts    competition dates
  inventory.ts       stocked-inventory items
  github.ts          GitHub issue/PR queries, mutations, repo mapping
src/
  main.tsx           ClerkProvider + ConvexProviderWithClerk + router
  Layout.tsx         authenticated shell
  routes/            PartsBoardPage, PartPage, ShopPage, MyPartsPage,
                     SubsystemsPage, IntakePage, TrackerSettingsPage,
                     DashboardPage, TodoBoardPage/TodoPage/MyTodosPage,
                     InventoryPage,
                     IssuesPage/IssueDetailPage, AdminPage, GitHubAdminPage,
                     OnshapeAdminPage
  lib/stages.ts      chip colours and labels on top of convex/lib/stages.ts
  lib/tracker.ts     the season / subsystem / process / actor lookups
  components/tracker/ PartCard, StageStrip, PartSearch, QtyCounter,
                     GetNumberDialog, ProblemDialog, PartChips,
                     SubAssemblies, SubAssemblyCard, TodoCard,
                     TodoFormDialog
  components/pm/     IssueFormDialog, PriorityBadge
  components/ui/     shadcn/ui primitives
```

## First run

A mentor opens **Tracker settings** and presses _Set it up_. That lays down the
season, the usual five subsystems (DRV, INT, ELV, SHT, CLB), the machines most
teams have, and the processes that decide which stages a part skips —
all editable afterwards. Then, on the **People** tab, give the design leads the
`lead` role.

The app doesn't track who is approved to run which machine; a machine marked
"a mentor has to be in the room" still shows that warning on the part, but
tool approval itself is handled outside the tracker.

## Sub-assemblies

"Can we build it yet?" on the Subsystems screen is driven by **sub-assemblies**:
named, numbered things that go together, mirroring the CAD. One holds parts,
bought items **and other sub-assemblies**, so an intake can be a frame assembly
plus a roller assembly rather than one flat list.

Every subsystem has exactly one **default** sub-assembly, numbered
`{YY}-{SUB}-000` and created with the subsystem. Marking that one built is what
"the subsystem is on the robot" means — the Subsystems screen then reads _On the
robot_ instead of a ready/total count. Nothing is stored for that; it is derived
from the default being done.

Sub-assemblies take their numbers from the **same per-subsystem counter as
parts**, so a number identifies exactly one thing and a released assembly is
matched the same way a released part is.

A lead presses **Edit sub-assemblies** and works on one at a time: tick the
parts and bought items it needs, and tick any sub-assemblies that go inside it.

Three rules keep the picture honest:

- **A part belongs to one sub-assembly**, and so does a sub-assembly — ticking
  it somewhere else moves it. Anything another one holds is shown locked, with
  where it went.
- **Nothing can go inside itself**, directly or round a chain. Candidates that
  would loop are locked with "holds this one", and the server refuses it too.
- **A sub-assembly inside another has to be _built_, not merely ready.** A pile
  of parts in the bin is not a sub-assembly, so a parent reads _Waiting_ until
  its children are done.

Each one also carries:

- **An assembly CAD link**, built from the Onshape ids a sync fills in. It is
  derived rather than stored, so it can't go stale.
- **An assembly drawing link** you paste in, for a drawing that isn't in
  Onshape. http(s) only — it's rendered as a link.
- **Someone to do it.** Anyone can press _I'll do it_, the same way they'd
  claim a part.
- **Done — it's on the robot**, which moves its **direct** parts to _Assembled_
  and credits whoever picked it up. A child's parts moved when the child was
  built, so nothing moves twice. It refuses rather than lying: an unbuilt child,
  a part not in the bin or a bought item still on order all stop it, and nothing
  moves when it stops. Installing is the subsystem lead's or a mentor's call,
  the same rule a single part follows going from stage 5 to 6. A lead can
  _Reopen_ one marked done too early; the parts stay where they are.

Sequencing between siblings — "left plate, then right plate" inside one
sub-assembly — isn't expressible. Containment orders children before their
parent and nothing else. Nest them if the order matters.

### What a sync can and can't do

Syncing an assembly from the Onshape panel **recognises** which sub-assembly it
is: by element id first, then by the Part number in the assembly's own metadata.
A match has its CAD ids refreshed, which is what keeps the deep link working.
The sub-assemblies placed directly inside it come back as lines too.

Nothing lands on the board unasked — an assembly the tracker doesn't know
becomes an _unknown_ line in **New from Onshape** for a lead to confirm, and a
sync never rearranges a tree someone built by hand.

Two things genuinely aren't reachable yet:

- **Reacting to a release as it happens.** The sync runs when someone presses
  the button in the Onshape panel. Noticing a release by itself needs the
  `onshape.workflow.transition` webhook from §8 of the handoff, which is Phase 2.
- **Revisions.** Nothing on this path reads a release package, and a workspace
  sync carries no version at all, so a sub-assembly's revision only fills in
  when the panel was opened on a version.

## The to-do list

Everything that isn't a part. One list for the season — no boards, no
sub-lists — built to read like the parts board:

- **A to-do is done or it isn't.** No in-progress, no blocked. Tick the box on
  the card or press the button on its page.
- **Anyone can pick one up**, and the person who did (or a lead) can put it
  back — the same claiming the parts side uses.
- **Tags** sort the list. The set of tags is team-wide and mentor-managed in
  Tracker settings → To-do tags; removing one takes it off every to-do that
  had it.
- **Priority** is low, medium or high; high shows as a chip on the card.
- **Notes** work like a part's notes — a thread anyone can add to.

Only a lead or mentor can delete a to-do; anyone can add, edit, claim and
finish one.

## Sample data

To fill the board for a demo or a dry run (Drivetrain and Intake, spread across
all six stages, with claims, flags, a problem and some bought items):

```sh
npx convex run seed:sampleParts
npx convex run seed:sampleParts '{"codes":["DRV"]}'   # one subsystem
```

Re-running tops up rather than duplicating — a sample already on the board is
left alone. If a sample names a process the team doesn't have, it falls back to
one that exists and says so in the result.

To clear it again:

```sh
npx convex run seed:wipeParts '{"includeCots":true}'
```

The sample also lays down a small nested tree per subsystem, so the readout has
something to answer.

Add `"resetNumbers": true` to start numbering at 001 again. That is only ever
right for throwaway data: in a real season a part number is never reused.

## Testing and tooling

```sh
npm run test          # vitest run
npm run test:e2e      # smoke tests for shell/navigation/setup states
npm run test:watch    # vitest watch mode
npm run lint           # tsc + eslint
npm run format         # prettier --write .
```
