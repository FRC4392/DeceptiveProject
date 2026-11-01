# What's left

Written 1 November 2026, on the `new-tracker` branch, which is pushed. Build,
lint and all 459 tests pass; the working tree is clean. Everything below is either
configuration nobody has done yet, a rough edge worth knowing about, or a
question whose answer would change the code.

## Blocking: nothing, now

The webhook is registered and a real Classroom release has been through end
to end. What that turned up — numeric `elementType`, nested `children`, and
the confirmation that the state really is `RELEASED` — is written up in the
README under the release webhook.

## Housekeeping on the deployment

- [ ] **Set `GITHUB_TOKEN`** if you want issue commenting and bulk import.
      Issue sync reads fine without it. A classic PAT with `repo` scope, or a
      fine-grained one with Issues: read and write on the repos you sync:
      `npx convex env set GITHUB_TOKEN <token>`.
- [ ] **Open a PR for `new-tracker`.** The branch is pushed; nothing has been
      merged to `main` yet.
- [ ] **Deploy to production**, which is still on the old schema. It needs
      the same two steps dev had: push, then
      `npx convex run competitions:backfillSeason` — the backfill is
      per-deployment, and running it on dev did nothing for prod.

## Rough edges

- [ ] **682 kB JS bundle**, past Vite's 500 kB warning, and untouched by the
      asset work. Essentially `convex` + `@clerk/react` + `react-dom` +
      Radix, with no chunking config at all. The two obvious moves are
      `manualChunks` for the vendors and lazy-loading the routes most people
      never open — `LoginPage` is the strongest candidate, being the only
      consumer of Clerk's `SignIn` and sitting outside `RequireAuth`, so
      every signed-in user downloads a sign-in screen they never render.
      Note `src/e2e/app-smoke.test.tsx` mounts routes synchronously, so
      `Suspense` boundaries would need those cases reworked.

## The BOM CSV, now that we've seen one

The team's export heads `Item, Quantity, Name, Vendor, Part Number`. Three of
those map (quantity, name, partNumber); `Item` and `Vendor` are ignored
harmlessly, since unknown columns are skipped by position. So it imports. Two
things that follow:

- [ ] **No Revision column, so no rework detection.** Every imported line
      arrives with no revision, which means the tracker can't tell a
      re-release from a first one — a part already made never reads as
      _changed_, and the Fix them / Remake all / They're fine as-is decision
      never appears. Adding a `Revision` or `Rev` column to the export is
      enough; both already map, no code change.
- [ ] **A CSV can't create a bought item.** The `Vendor` column implies the
      export mixes made and bought, but `parseBomCsv` only ever produces part
      lines — there is no route from a CSV to the Ordering board, and the
      vendor name is dropped. A bought row imports as an unknown part and,
      once accepted, becomes a `parts` row with a tracker number rather than
      a `cotsItems` row. Worth deciding whether the importer should learn
      about bought items or whether those rows should be filtered out of the
      export.
