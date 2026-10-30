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

- [x] **Formatting.** Six files had drifted from Prettier before this branch
      started — `convex/lib/github.ts`, `convex/lib/github.test.ts`,
      `convex/lib/tokenCrypto.ts`, `index.html`, `src/components/ui/badge.tsx`
      and `src/components/ui/table.tsx`. Reformatted; `npm run format:check`
      is clean across the repo.
- [x] **644 kB JS bundle**, past Vite's warning threshold. Fine for thirty
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
- [x] **Who owns the Onshape connection?** One team-wide OAuth token, now
      recorded and shown on Settings → Onshape. Any mentor can take it over by
      reconnecting — the row is simply overwritten — and the page warns when
      Onshape starts refusing the token, and when a reconnect has left the
      webhook registration needing to be made again.

**Onshape's to answer** (§11):

- [x] **Do the app's OAuth calls come out of the Classroom's 2,500 a year?**
      Yes. That's what the budget meter and the modes have always assumed, so
      the design stands as built.
- [x] **Can FIRST teams get a higher limit?** No, not at the moment. 2,500 is
      the number to design against.
- [ ] **What are the real BOM CSV column names?** The importer matches loosely
      and ignores what it doesn't recognise, but it has never seen a real
      export.
