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
npx convex env set ONSHAPE_WEBHOOK_SECRET <random string, for the release webhook>
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
   Clerk roster from Settings → People.
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
- Sign-in storage, Clerk webhooks, and Settings → People's "Sync from Clerk"
  keep Convex's local `users` table current, overwriting `users.role` each
  time.
- A mentor can set someone's tracker role (`student` / `lead` / `mentor` /
  `admin`) in Settings → People. That's stored as `users.appRole` and
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
assemble. They live on their own **Ordering** board, laid out like the parts
board with a column per state — ordering is one person's job for an afternoon,
and doing it from five subsystem pages meant opening five subsystem pages. The
card opens the item, the way a part card opens a part, with one big button
that moves it on — "Placed the order → Ordered", then "It turned up →
Arrived", worded the way a part's advance button is. Ordering one asks when
it's due, and a lead can move one back. Anyone can add one or correct a
vendor, and a lead can delete one. The subsystem's own parts list still shows
where each item is up to, read-only. A sub-assembly won't complete while a
bought item it needs is still on order.

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

**My parts** shows both: the sub-assemblies you've picked up, each saying
whether it can go together yet and what's holding it up, then the parts,
grouped by the stage they're at.

**Mentors can assign.** Claiming is for taking work yourself and refuses to
take something someone else holds; a mentor picking a name on the part page
(or a to-do page) hands it over regardless. Picking "Nobody" puts it back up
for grabs.

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

The team's Onshape Classroom allows **2,500 successful API calls a year for
everyone**, and the app's own OAuth calls come out of that same allowance —
confirmed, not assumed. FIRST teams can't currently get a larger one, so 2,500
is the number to design against. The tracker is built to need almost none of
them:

- Getting a number and pasting it into Onshape costs **nothing**.
- Nothing is written back into Onshape.
- Thumbnails and file exports (DXF/STL/PDF) are never fetched; the app builds
  free deep links and students export from Onshape themselves.
- A sync reads an element's parts and parks them under **New from Onshape**
  for a design lead to review. Nothing lands on the board unasked.
- The release webhook is the cheap way in: the notification is free (Onshape
  excludes them from the allowance) and the release itself is **one** call that
  returns every item with its number and revision. Syncing the same assembly
  from the panel costs one call per part instead.
- A **released assembly costs one more call**, to read what it contains, and
  only in Normal mode. So a release is one call plus one per assembly in it —
  the only line in the budget that isn't a flat one.
- Every call goes through one wrapper (`convex/lib/onshapeAuth.ts`) that logs
  it to `apiCalls`, and only 2xx/3xx responses count — which is what the budget
  meter shows.

**The modes are a brake, not a gauge.** Every call declares what it's for, and
`convex/lib/budget.ts` decides whether the current mode allows it. A refused
call is never sent, so it costs nothing:

|                                    | Normal | Lean (< 30% left) | Manual (< 10%, or forced, or after a 402) |
| ---------------------------------- | ------ | ----------------- | ----------------------------------------- |
| Release read (1 call, automatic)   | yes    | yes               | **queued for Reconcile**                  |
| Assembly BOM on a release (1 each) | yes    | **no**            | **no**                                    |
| Panel sync (1 call per part)       | yes    | **no**            | **no**                                    |
| Registering the webhook            | yes    | yes               | yes                                       |

Registering stays allowed in Manual on purpose: turning the integration off is
how a mentor stops it spending, and refusing that one call would trap the team
in the mode they're trying to escape.

A release that arrives in Manual isn't lost — the notification was free and
only comes once, so the package id is parked as a `queued` intake. **Reconcile**
on New from Onshape reads them when there's allowance again, oldest first,
stopping at the first one it still can't afford. A read that fails for any
other reason queues the same way.

A **429** is waited out — three retries, 1s/2s/4s — because it's a short
per-endpoint window and rate-limited responses aren't charged for. A **402**
means the year's allowance is gone, so the app forces itself into Manual
immediately and records why; that reason shows on New from Onshape rather than
leaving a mentor to wonder who changed the mode.

**The tracker works with no Onshape connection at all.** A lead can type part
numbers in by hand or upload a BOM CSV, and the same matching logic runs
against them.

### Why nothing is written back

Writing a part number into Onshape would stop students mistyping them, which
is the one real argument for it. It stays unbuilt on purpose, and the reasons
are worth keeping written down rather than rediscovering:

- **The split that makes the budget work isn't read versus write**, it's
  cheap-and-automatic versus expensive-and-discretionary. A write is one call
  per part, triggered by whoever is getting a number — the highest-frequency
  action in the app, taken by the people with least sight of the allowance.
- **The scope isn't ours to grant from here.** The app requests no `scope` at
  all; it takes whatever the Onshape OAuth application was registered with, in
  Onshape's developer portal, outside this repo. Adding one also invalidates
  the stored refresh token, so every mentor would have to reconnect.
- **Pasting costs nothing and already works.** It needs no connection, no
  scope and no allowance, which is why the whole tracker still works with
  Onshape switched off.

If it is ever built, the budget table above is where the decision lives.

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
  seasons.ts         seasons: first-run setup, adding a year, switching year
  subAssemblies.ts   sub-assemblies, their members, notes and history
  cots.ts            bought items
  intake.ts          the "New from Onshape" queue and the manual ways in
  settings.ts        app settings and the API budget meter
  onshape.ts         document to subsystem mapping, sync intake, call logging
  onshapeOAuth.ts    Onshape OAuth flow + right-panel httpActions
  onshapeWebhook.ts  release webhook: registration, receiver, release
                     intake, and Reconcile
  auth.ts            Clerk current-user query, local user sync, webhook,
                     and mentor-only Clerk roster backfill
  auth.config.ts     Convex auth provider config for Clerk JWT validation
  http.ts            registers Clerk webhook, Onshape OAuth + panel +
                     release webhook, and the GitHub webhook route
  users.ts           user roster queries
  todos.ts           the season to-do list and its tags
  dashboard.ts       aggregate dashboard/countdown stats
  competitions.ts    competition dates, per season
  inventory.ts       stocked-inventory items
  github.ts          GitHub issue/PR queries, mutations, repo mapping
src/
  main.tsx           ClerkProvider + ConvexProviderWithClerk + router
  Layout.tsx         authenticated shell
  routes/            PartsBoardPage, PartPage, ShopPage, MyPartsPage,
                     OrderingPage,
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

Outstanding work, configuration nobody has done yet, and the Onshape
assumptions still unverified are listed in [TODO.md](TODO.md).

## First run

A mentor opens **Settings** and presses _Set it up_. That lays down the
season, the usual five subsystems (DRV, INT, ELV, SHT, CLB), the machines most
teams have, and the processes that decide which stages a part skips —
all editable afterwards. Then, on the **People** tab, give the design leads the
`lead` role.

That is the first year only. Later years are added on the **Season** tab and
start with Drivetrain alone — see [A new year](#a-new-year).

The app doesn't track who is approved to run which machine; a machine marked
"a mentor has to be in the room" still shows that warning on the part, but
tool approval itself is handled outside the tracker.

## A new year

Each year the team tracks is a **season**, and everything that belongs to one
robot hangs off it: the subsystems, their part numbers, the parts, the bought
items, the to-dos and the events.

A mentor adds next year on **Settings → Season**. It starts with one subsystem,
Drivetrain, and its `{YY}-DRV-000` assembly; the rest go on the Subsystems tab.
Adding a season does not switch to it, so next year's season can be created in
November without moving the team off the robot they are still building.

Two seasons may not share a year. The year is half of every part number, so a
duplicate would mean two different things both answering to `27-DRV-000`.

**Switching is team-wide.** _Make this the current season_ moves every screen,
for everyone — there is no per-person view of an old year. It asks twice,
because a part created while an old season is current gets that old year's
number: switch back to 2027, press _Get a part number_, and you get a 2027
number. The app bar says **not the newest season** whenever the team is working
in a year it has since moved past.

Events belong to a season too, so last year's regionals stop counting down the
moment you move on. Machines, process types, to-do tags, inventory, issues and
the roster are team-wide and outlive a season — a bandsaw doesn't change in
April.

There is no way to delete a season, on purpose. Its parts, assemblies, numbers,
to-dos and bought items are the record of that robot, and looking back is the
point.

### One-off: stamping old events

Events added before they were season-scoped have no season, so they show up
nowhere. Once, after deploying that change:

```
npx convex run competitions:backfillSeason
```

It stamps them with whatever season is current, reports how many it touched,
and is safe to run twice. Until it runs, the Events tab and the countdown read
empty.

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

Each sub-assembly has **a page of its own**, reached by clicking its number or
name on the Subsystems screen and laid out like a part's: what it is, whether
it can go together yet, what it's made of, who has it, notes and history. A
lead edits it there — the name, the drawing link, how many go on the robot,
how many spares, and the parts, bought items and sub-assemblies it holds.
**Add sub-assembly** on the Subsystems screen takes the next number and drops
you on the new one's page.

Two rules keep the picture honest:

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

### Sharing, quantities and spares

A part can be in more than one sub-assembly. Two roller assemblies using the
same end cap is how robots are built, so membership is shared rather than
exclusive, and each placement says how many it uses.

A sub-assembly carries the same three numbers a part does — how many go on
the robot, how many spares, how many are built so far — set on the subsystem
page with the same counter the shop uses for parts. A sub-assembly needed
twice with one built reads as `1/2` rather than as done or untouched.

`rollUpDemand` in `convex/lib/assembly.ts` multiplies that out: two end caps
in a roller, two rollers being built, four end caps. The Subsystems page says
so out loud when a part is set to make fewer than the tree needs. That number
is the point of the whole thing — nobody works it out by eye past the second
level, and the alternative is finding out in the pit.

Because the build count is typed in rather than derived from placements, the
two can disagree. **Not building enough** catches that: an assembly placed
twice but set to build once is listed until someone fixes one side.

How many of a part one sub-assembly may take is capped by what the plan
leaves — the part's `qtyNeeded` minus what every other assembly has spoken
for, divided by how many of this assembly get built. The editor shows the
ceiling next to each box (`2/5`), and `setMembers` enforces it, because a
stale page or a second person editing alongside you would walk straight past
a client-side limit. **Select all** takes the most of everything going, since
picking twenty parts and then typing twenty quantities was the actual job.

A shared part only reaches **Assembled** once _every_ sub-assembly using it has
been built. Saying it's on the robot while another assembly still wants one
would be a lie of the kind that gets found at competition.

Sequencing between siblings — "left plate, then right plate" inside one
sub-assembly — isn't expressible. Containment orders children before their
parent and nothing else. Nest them if the order matters.

### Reading the tree

"Can we build it yet?" draws the real shape: each sub-assembly sits inside the
one that holds it, with a rule down the left rather than a bare indent, and the
count on the edge where a parent takes more than one. A sub-assembly in two
parents **appears under both** — the data says a roller is in the main assembly
and the spare, and showing it once would disagree with the thing it describes.

Two kinds of thing get called out, because neither holds anything up and so
neither would otherwise be noticed:

- **A sub-assembly nothing holds** is marked on its card. The subsystem's own
  `{YY}-{SUB}-000` is excluded — it has no parent by right.
- **A part or bought item the tree doesn't account for** is marked on its row
  in the parts list, and collected into a **Not in an assembly** list with the
  other warnings. It distinguishes "in nothing at all" from "three of five
  unassigned", since a part half spoken for is the easier one to miss.

Bought items in the parts list open the same dialog the Ordering board uses,
so an order can be placed or marked as arrived without leaving the subsystem.

### What a sync can and can't do

Syncing an assembly from the Onshape panel **recognises** which sub-assembly it
is: by element id first, then by the Part number in the assembly's own metadata.
A match has its CAD ids refreshed, which is what keeps the deep link working.
The sub-assemblies placed directly inside it come back as lines too.

Nothing lands on the board unasked — an assembly the tracker doesn't know
becomes an _unknown_ line in **New from Onshape** for a lead to confirm, and a
sync never rearranges a tree someone built by hand.

One thing genuinely isn't reachable on this path:

- **Revisions.** The panel sync doesn't read a release package, and a workspace
  sync carries no version at all, so a sub-assembly's revision only fills in
  when the panel was opened on a version — or when the release webhook below
  brings the release in.

### Who owns the connection

One OAuth token for the whole team, authorized once by a mentor from
**Settings → Onshape**. Calls are made as that account, so if they leave the
Classroom another mentor reconnects there and takes it over — the stored
connection is a single row and is simply overwritten. The page names whoever
authorized it, so that isn't something the team has to remember.

Two things used to fail silently and now don't:

- A query can't ask Onshape whether a token still works, so a connection whose
  owner had left kept reporting "Connected" while every call failed. The
  refresh path writes down what happened, and the page shows it.
- The webhook is registered under one authorization. Onshape doesn't say
  whether it survives a re-authorization, so a reconnect marks the
  registration as needing to be made again rather than leaving the page
  claiming it's live.

The **company id** is read from Onshape once when the connection is made, and
registering the release webhook uses it. The box on the Onshape page is still
there as an override, prefilled with what was read — it used to be the only
source, typed in with nothing checking it.

Starting the flow is mentor-only. `/onshape/oauth/start` is a public endpoint
with no identity of its own, so it won't redirect without a short-lived state
that `beginConnect` mints for a signed-in mentor.

### The release webhook

Turn it on in **Settings → Onshape → Release webhook** (mentors only, and
registering needs a company admin Onshape account). From then on Onshape calls
`/onshape/webhook` the moment a release package transitions, and an approved
release appears under **New from Onshape** on its own.

What actually crosses the wire is worth knowing, because it shapes the design:

1. Onshape POSTs a notification carrying an event name, `objectType: "RELEASE"`
   and the release package's `objectId`. **That's all it carries** — no part
   numbers, no revisions, not even which state the package moved to.
2. The receiver checks the secret in the callback URL (Onshape doesn't sign
   notifications the way GitHub does), answers 200 immediately, and schedules
   the read — Onshape retries anything it doesn't see acknowledged quickly.
3. `ingestRelease` reads `GET /api/releasepackages/{id}?detailed=true`: one
   call, every item with its part number, revision and source document.
   Two things about that package were learned from a real Classroom rather
   than from any documentation:
   - **It nests.** A released assembly is one entry in `items` with its parts
     in that entry's `children`. Reading only the top level meant a forty-part
     release produced one line and the parts were never seen.
   - **`elementType` is a number** — `1` assembly, `0` Part Studio — not the
     string the first version looked for. `mimeType` says the same thing more
     plainly (`onshape/assembly`), so that is believed first.
4. Anything that isn't `RELEASED` is parked as a queued intake rather than
   dropped — a submitted or rejected package isn't a fact about the robot
   yet, but a state nobody expected is what someone will want to read
   afterwards. Same for a package that can't be parsed. Each keeps the
   package **and the notification that announced it**, which is otherwise the
   only record of what Onshape sent and used to be thrown away.
5. Each released **assembly** gets one more call, reading what it contains so
   the CAD's quantities arrive without anyone opening the panel. Refused
   outside Normal mode, and a refusal doesn't cost the release: it comes in
   anyway and the line says its contents weren't read.
6. The rest is the existing path — the same `releaseIntakeLines`, the same
   screen, the same lead deciding. A release changes nothing on its own, and
   **nothing is written to an assembly's members**: a sync never rearranges a
   tree someone built by hand, so the contents arrive as lines to apply.

Because the notification is only an id, a forged call costs at most one wasted
read: everything the board acts on is read back from Onshape over the
authenticated connection. Arriving twice is normal — a retry, or a package that
transitions more than once — and a package already taken in is dropped before
any call is spent.

**Checked against a real release.** Onshape's docs still don't describe
`onshape.workflow.transition` or say what `detailed=true` adds, but a
Classroom release has now been through end to end: the notification does carry
`objectType` and `objectId`, items do carry **Part number** and **Revision** as
properties, and the workflow state really is `RELEASED`. The two things that
weren't as assumed are described above.

The lesson that outlived them: a declared TypeScript type is a guess about
someone else's JSON. `elementType` arriving as a number crashed an entire
ingest on `.toUpperCase()`, because `?? ""` guards only null and undefined.
Fields off the wire are typed `unknown` and narrowed at the boundary through
[`convex/lib/untrusted.ts`](convex/lib/untrusted.ts).

## The to-do list

Everything that isn't a part. One list for the season — no boards, no
sub-lists — built to read like the parts board:

- **A to-do is done or it isn't.** No in-progress, no blocked. Tick the box on
  the card or press the button on its page.
- **Anyone can pick one up**, and the person who did (or a lead) can put it
  back — the same claiming the parts side uses.
- **Tags** sort the list. The set of tags is team-wide and mentor-managed in
  Settings → To-dos; removing one takes it off every to-do that
  had it.
- **Priority** is low, medium or high; high shows as a chip on the card.
- **Notes** work like a part's notes — a thread anyone can add to.

Only a lead or mentor can delete a to-do; anyone can add, edit, claim and
finish one.

## Settings

One page, mentors only, at **Settings** in the sidebar. Tabs for the things
the app owns — Subsystems, Shop (processes and machines), To-dos (the tag
list), People, Season (rename this one, add next year, switch which year the
team is in) and Events (this season's calendar) — plus **Connections**, which
is only the two
outside services: Onshape and GitHub. Those two keep their own pages, reached
from there.

**Numbering** is set here too. Each subsystem row carries the number it hands
out next, so a team picking the tracker up mid-season can carry on from where
their spreadsheet stopped; it only ever moves forward, because a number is
never reused and the counter is the only record of what has gone out. The
Season tab sets how many digits the sequence is padded to, and fixes it the
moment the season issues anything — `27-INT-104` and `27-INT-0104` are the
same number to a person and two different keys to the search, so a season is
all one shape or it is not searchable.

People is the roster: everyone who has signed in, their email, and the role
picker. "Sync from Clerk" pulls the roster across.

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
