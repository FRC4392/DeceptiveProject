# What's left

Written 31 October 2026, on the `new-tracker` branch. Build, lint and all 442
tests pass; the working tree is clean. Everything below is either
configuration nobody has done yet, a rough edge worth knowing about, or a
question whose answer would change the code.

## Blocking: the release webhook still isn't live

The secret is set on the dev deployment and the code is written and tested.
Two things stand between that and a release actually arriving.

- [ ] **Register the webhook** in Settings → Onshape → Release webhook. This
      needs a **company admin** Onshape account; the button says so if the
      connected account isn't one. The company id is read from Onshape at
      connect now, so the box below it only matters if that lookup came back
      empty — which it will for any connection made before 31 October, since
      it only runs when a mentor connects.
- [ ] **Check a real release against what the code assumes.** Onshape's
      published docs don't describe `onshape.workflow.transition` and don't
      say what `detailed=true` returns — the field names come from Onshape's
      own sample client. Release one real part, then read
      `releaseIntakes.payload.raw` in the Convex dashboard and confirm:
  - `objectType` and `objectId` are really on the notification
  - released items carry **Part number** and **Revision** properties
  - assembly items carry `elementType: "ASSEMBLY"` — if they don't, assemblies
    come through as parts and nothing says so
  - the **assembly BOM read** works against a real release. It is new, and
    every test of it so far has run against a stubbed fetch — the parsing is
    covered, the `/api/assemblies` call itself has never met Onshape on this
    path. Watch the budget meter: a release with assemblies in it now costs
    one call plus one per assembly.

## Housekeeping on the deployment

- [ ] **Set `GITHUB_TOKEN`** if you want issue commenting and bulk import.
      Issue sync reads fine without it.
- [ ] **Push `new-tracker`.** Thirty-one commits ahead of `main`, no remote
      branch, no PR.
- [ ] **Deploy to production**, which is still on the old schema. It needs the
      same two steps dev had: push, then
      `npx convex run competitions:backfillSeason` — the backfill is
      per-deployment, and running it on dev did nothing for prod. Events added
      before they were season-scoped show up nowhere until it runs.

## Rough edges

- [ ] **Error messages show raw Convex noise.** A failed mutation renders the
      whole `[CONVEX M(…)] [Request ID: …] Server Error Uncaught Error:`
      wrapper, and then `at handler …` after it, around a sentence written
      for the person who hit it. Seeding a counter backwards, for instance,
      answers with a clear "pick 15 or higher" that nobody will read. All 36
      sites do `err instanceof Error ? err.message : "No luck."` with no
      shared helper; one that strips the wrapper would fix it everywhere.
- [ ] **682 kB JS bundle**, past Vite's 500 kB warning. It was 644 kB when
      this file was first written, so it is growing, not shrinking. Fine for
      thirty people on school wifi, not fine forever — the warning itself
      suggests `manualChunks` or dynamic imports.
- [ ] **The logo is a 1,035 kB PNG**, larger than the whole JS bundle and
      loaded on every page. Resizing or converting it is the cheapest
      performance win available.
- [ ] **`parts.lastReleasePackageId` is declared and never written.** Its
      sub-assembly twin is written now, when one is created from a release
      line; the parts side is still a field nothing fills in. Either write it
      where a release moves a part on, or drop it.

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
  who is using it. The release-triggered BOM read is gated the same way, so
  whatever is decided here should apply to both.

**Onshape's to answer:**

- [ ] **What are the real BOM CSV column names?** The importer matches loosely
      and ignores what it doesn't recognise, but it has never seen a real
      export.
