# What's left

Written 1 November 2026. Production is deployed and running on `main`; build,
lint and all 493 tests pass. Everything below is either a decision taken
deliberately, something waiting on kickoff, or a rough edge worth knowing
about. Nothing here blocks the team using the tracker.

## One real code item

- [ ] **A new season will recreate the `Bought (COTS)` process type.**
      `DEFAULT_PROCESSES` in `convex/seasons.ts` still seeds it, so the
      process deleted from production comes back the next time
      `seedDefaults` runs for a new year. Nothing breaks if it does — the
      intake filters bought processes out of _Made on_, so it can no longer
      create a part at _Ready to assemble_ that nobody ordered — but it's a
      dead option in every other process picker. One line to remove, and
      worth doing before kickoff rather than explaining it afterwards.

## Waiting on kickoff, on purpose

- [ ] **Map the Onshape documents to subsystems**, in Admin → Onshape.
      Without it a release still arrives on New from Onshape; its lines just
      come in with no subsystem filled in, so a lead picks one per line.
      There is one subsystem (Drivetrain) and no CAD yet, so there is
      nothing to map until the season starts.

## Known, and left alone

- [ ] **The Clerk session token carries no `email`, `name` or `role`
      claims**, so a first sign-in writes a row with an empty email and a
      name equal to the Clerk user id. Being handled as people log in rather
      than fixed up front. The cost is on the record: it is what produced
      two rows for one person on production and locked everyone out of
      Settings for an afternoon. `DEPLOY-PROD.md` §7a has the symptoms and
      the way out. Setting the claims stops it arising at all.
- [ ] **682 kB JS bundle**, past Vite's 500 kB warning. Accepted: it gzips to
      197 kB, it's `convex` + `@clerk/react` + `react-dom` + Radix rather
      than anything of ours, and the pit crew loads the app once on a field
      laptop. If it ever needs to come down, the two moves are `manualChunks`
      for the vendors and lazy-loading `LoginPage` — the only consumer of
      Clerk's `SignIn`, sitting outside `RequireAuth`, so every signed-in
      user downloads a sign-in screen they never render. Note
      `src/e2e/app-smoke.test.tsx` mounts routes synchronously, so
      `Suspense` boundaries would need those cases reworked.

## Watch on the first real assembly sync

- [ ] **Standard content now arrives.** The panel sync used to drop Onshape's
      library fasteners; it now brings them in as lines to buy, one row per
      distinct fastener with its placement count rather than one per bolt. A
      release package never contains them, so this is the panel path only.
      Worth seeing whether that is a useful Ordering list or more rows than a
      lead wants to clear. If it's too much, the lines are tagged
      `standardContent`, so filtering them back out is a one-line change.

## Done

Production is on the new schema and verified against the live deployment: all
ten environment variables set, the four `WORKOS_*` leftovers and the eight
orphaned tables from the old schema removed, Onshape connected, the release
webhook registered and pinged back, GitHub issue sync running, the roster
synced, and the 2027 season created with Drivetrain and its `27-DRV-000`
default sub-assembly. Two of 2,500 Onshape calls used.

The BOM export heads `Item, Quantity, Name, Vendor, Part Number, Revision`.
Quantity, name, part number, revision and vendor all map; `Item` is ignored
harmlessly. A row with a vendor and no part number — what hardware looks like
in an export — is kept rather than dropped, and answers _We buy it_ first.
