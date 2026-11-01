# What's left

Written 1 November 2026, on the `new-tracker` branch, which is pushed. Build,
lint and all 459 tests pass; the working tree is clean. Everything below is
either configuration nobody has done yet, a rough edge we've decided to live
with, or a decision worth taking deliberately.

## Blocking: nothing, now

The webhook is registered and a real Classroom release has been through end
to end. What that turned up — numeric `elementType`, nested `children`, and
the confirmation that the state really is `RELEASED` — is written up in the
README under the release webhook.

## Housekeeping on the deployment

- [x] **`GITHUB_TOKEN` is set**, so issue commenting and bulk import work.
- [ ] **Open a PR for `new-tracker`.** The branch is pushed; nothing has been
      merged to `main` yet.
- [ ] **Deploy to production**, which is still on the old schema. It needs
      the same two steps dev had: push, then
      `npx convex run competitions:backfillSeason` — the backfill is
      per-deployment, and running it on dev did nothing for prod.

## Decided to live with

- [x] **682 kB JS bundle**, past Vite's 500 kB warning. Accepted as-is: it
      gzips to 197 kB, it's `convex` + `@clerk/react` + `react-dom` + Radix
      rather than anything of ours, and the pit crew loads the app once on a
      field laptop. If it ever does need to come down, the two moves are
      `manualChunks` for the vendors and lazy-loading `LoginPage` — the only
      consumer of Clerk's `SignIn`, sitting outside `RequireAuth`, so every
      signed-in user downloads a sign-in screen they never render. Note
      `src/e2e/app-smoke.test.tsx` mounts routes synchronously, so `Suspense`
      boundaries would need those cases reworked.

## The BOM CSV

The export heads `Item, Quantity, Name, Vendor, Part Number, Revision`.
Quantity, name, part number and revision all map; `Item` and `Vendor` are
ignored harmlessly, since unknown columns are skipped by position.

- [x] **Revision is in the export**, so rework detection works: a
      re-released part now reads as _changed_ and the Fix them / Remake all /
      They're fine as-is decision appears. `revision` and `rev` both map, so
      this needed no code change.

## The one real decision left

- [ ] **Nothing can import a bought item** — not the CSV, not the panel sync,
      not the release webhook. `cotsItems` rows are only ever inserted by
      `convex/cots.ts`, from the Ordering board, by hand. Every import path
      ends in a `parts` row with a tracker number, because the release path
      classifies each item as assembly-or-part and has no third branch, and
      the CSV's `Vendor` column is dropped on the floor.

      In practice this mostly doesn't bite, for a reason worth knowing: a
      fastener inserted from Onshape's standard content library isn't an
      element in the document, so it has nothing to release and never reaches
      a release package at all. What does come through as a part is a vendor
      component someone imported into their own Part Studio — a gearbox, a
      bearing block — if they put it in the release.

      So the choice is whether bought items should stay hand-entered on the
      Ordering board (fine, and what happens today), or whether the importers
      should learn to route a vendor row to `cotsItems`. Worth deciding
      before the team builds a habit around the wrong one.
