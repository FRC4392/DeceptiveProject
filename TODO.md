# What's left

Written 30 October 2026, on the `new-tracker` branch. Build, lint and all 260
tests pass; the working tree is clean. Everything below is either configuration
nobody has done yet, a thing the handoff asked for that isn't built, or a
question whose answer would change the code.

## Blocking: the release webhook doesn't work yet

The code is written and tested. None of it runs until these three happen.

- [ ] **Set the shared secret**, with
      `npx convex env set ONSHAPE_WEBHOOK_SECRET "$(openssl rand -base64 32)"`.
      Without it `/onshape/webhook` answers 503 to everything, which is the
      deliberate closed-by-default behaviour.
- [ ] **Register the webhook** in Settings → Onshape → Release webhook. This
      needs a **company admin** Onshape account; the button says so if the
      connected account isn't one.
- [ ] **Check a real release against what the code assumes.** Onshape's
      published docs don't describe `onshape.workflow.transition` and don't say
      what `detailed=true` returns — the field names come from Onshape's own
      sample client. Release one real part, then read
      `releaseIntakes.payload.raw` in the Convex dashboard and confirm:
  - `objectType` and `objectId` are really on the notification
  - released items carry **Part number** and **Revision** properties
  - assembly items carry `elementType: "ASSEMBLY"` — if they don't, assemblies
    come through as parts and nothing says so

## Housekeeping on the deployment

- [ ] **Delete eleven dead tables and one leftover row.** `projects` still
      holds "Swerve Drive" from the old app. `boards`, `tasks`, `taskComments`,
      `taskAttachments`, `githubRepos`, `assemblySteps`, `assemblyStepParts`,
      `training`, `partComments`, `qcChecks` and `messages` are empty. All are
      gone from the schema, so the app can't see them — this is tidying, not a
      bug. Do it from `npx convex dashboard`; the CLI refuses mass deletes.
- [ ] **Remove four unused env vars:** `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
      `WORKOS_WEBHOOK_SECRET`, `WORKOS_ACTION_SECRET`. Nothing in the code
      mentions them; they're left over from the previous auth system.
- [ ] **Set `GITHUB_TOKEN`** if you want issue commenting and bulk import.
      Issue sync reads fine without it.
- [ ] **Push `new-tracker`.** Thirteen commits, no remote branch, no PR.

## From the handoff, not built

Section numbers are from `FRC_PART_TRACKER_HANDOFF.md`.

- [ ] **Release-triggered assembly BOM read** (§8.2). Quantities only update
      when someone opens the Onshape panel on an assembly.
- [ ] **Part-number format and starting numbers in Settings** (§5). Only
      subsystem codes are editable. Changing the `{YY}-{SUB}-{NNN}` shape, or
      seeding a counter mid-season, currently means a code change.
- [ ] **Company-ID lookup** (§8.2) — typed in by hand instead of read once.
- [ ] **"Write it into Onshape for me"** (§5, Phase 3). Deliberately skipped:
      the app never writes to Onshape. Worth a decision rather than a drift —
      it's the one feature that would stop students mistyping their numbers.

## Smaller

- [ ] **Six files fail `npm run format:check`:** `convex/lib/github.ts`,
      `convex/lib/github.test.ts`, `convex/lib/tokenCrypto.ts`, `index.html`,
      `src/components/ui/badge.tsx`, `src/components/ui/table.tsx`. All were
      already unformatted before this branch. One `npm run format` fixes them,
      at the cost of touching unrelated files.
- [ ] **644 kB JS bundle**, past Vite's warning threshold. Fine for thirty
      people on school wifi, not fine forever.
- [ ] **An intake holding sub-assembly lines can't finish itself.**
      `applyMatched` skips them and they only accept "ignore", so a lead has to
      press "Done with this". The real fix is letting a lead create a
      sub-assembly straight from an unknown assembly line.

## Questions whose answers would change the code

**Ours to decide:**

- **Is `RELEASED` the right state name?** `isReleasedState` matches that exact
  string. A Classroom on a custom release workflow can rename it, and every
  release would then be logged and quietly dropped. Check Classroom settings →
  Release management before trusting this.
- **Should lean mode really block the panel sync?** That's the handoff's "BOM
  reads only on a lead's click" applied to what this app actually spends money
  on. It means that under 30% budget, nobody can sync from the Onshape panel —
  releases still arrive on their own. Making it lead-only instead needs a
  different gate: the panel authenticates with a shared secret and has no idea
  who is using it.
- **Who owns the Onshape connection?** One team-wide OAuth token. If that
  account leaves the team, the integration stops until someone reconnects.

**Onshape's to answer** (§11, still open):

- Do OAuth calls from a private app count against the Classroom's 2,500 a year,
  or against the app owner's account? The whole budget design assumes the
  Classroom's.
- Can FIRST teams get a higher limit?
- What are the real BOM CSV column names? The importer matches loosely and
  ignores what it doesn't recognise, but it has never seen a real export.
