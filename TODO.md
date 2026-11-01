# What's left

Written 1 November 2026, on the `new-tracker` branch, which is pushed. Build,
lint and all 493 tests pass; the working tree is clean. Everything below is
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

## Decided and done

- [x] **Bought items import from every path.** A line the tracker has no
      number for now asks **We make it** or **We buy it**, once, on the one
      queue all three paths already shared. Buy it goes to the Ordering board
      at _Needed_ with its vendor, takes no tracker number, and is recognised
      on the next release by the vendor's own number — including the items the
      team had already entered by hand, since the key comes off the number a
      human types.

      It also closed a bug nobody had noticed: accepting a line with the
      `Bought (COTS)` process made a part at stage 5, **Ready to assemble** —
      in the bin, as far as "Can we build it yet?" was concerned, before
      anyone had ordered it. That process is no longer offered on the intake
      screen. It still exists everywhere else, so nothing needed migrating.

## Watch on the next release

- [ ] **Standard content now arrives.** The panel sync used to drop Onshape's
      library fasteners; it now brings them in as lines to buy, one row per
      distinct fastener with its placement count. Worth watching the first
      real assembly sync to see whether that is a useful Ordering list or more
      rows than a lead wants to clear. If it's too much, the tag is already on
      the line — `standardContent` — so filtering is a one-line change.
- [ ] **Prod needs the schema push**, but no backfill for this. `cotsItems`
      gained the CAD-link fields and `releaseIntakeLines` gained
      `target: "cotsItem"`, `cotsItemId`, `vendor`, `standardContent` and
      `onshapePartId` — all optional. A bought item is matched on the vendor
      number itself, normalized at match time, so the items the team typed in
      by hand are recognised as they stand.
