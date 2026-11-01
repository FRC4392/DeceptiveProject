# What's left

Written 1 November 2026, on the `new-tracker` branch. Build, lint and all 459
tests pass; the working tree is clean. Everything below is either
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
- [ ] **Push `new-tracker`.** Thirty-two commits ahead of `main`, no remote
      branch, no PR.
- [ ] **Deploy to production**, which is still on the old schema. It needs
      the same two steps dev had: push, then
      `npx convex run competitions:backfillSeason` — the backfill is
      per-deployment, and running it on dev did nothing for prod.
- [ ] **Delete the `rp_verify_2` intake** from dev. A synthetic row left over
      from verification; it is the one whose payload looks wrong, because it
      never had a real package attached.

## Watch on the next release

- [ ] **The assembly BOM read has still never run against Onshape.** Until
      now the misclassification meant it was never reached, so the extra
      `/api/assemblies` call has only ever met a stubbed fetch. The next
      assembly release exercises it for the first time — watch the budget
      meter, which should show one call plus one per assembly.

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

## Questions whose answers would change the code

**Onshape's to answer:**

- [ ] **What are the real BOM CSV column names?** The importer matches
      loosely and ignores what it doesn't recognise, but it has never seen a
      real export.
