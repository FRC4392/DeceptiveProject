# Moving this to production

Written 1 November 2026, against the `new-tracker` branch at `3e01d87`.

Everything below was checked against the live production deployment rather
than assumed, and the checks are named so you can re-run them yourself.

## The good news first

**Production is empty.** Every table is empty except `users`, which holds
three mentors. So there is no data migration, nothing to backfill, and nothing
that can fail schema validation on the way in:

```bash
npx convex data --prod
npx convex data --prod parts --limit 1
```

**Those three users already validate** against the new schema, which wants
`authId`, `email`, `name` and an optional `role` — exactly the four columns
they have. And because all three have `role: "mentor"`, they are mentors in
the new app the moment it deploys. **Nobody needs `grantRole` run for them.**

**The two backfills have nothing to do.** `competitions:backfillSeason` stamps
unstamped events, and `competitions` is empty; `subAssemblies:backfillDefaults`
only matters for subsystems created outside the season seeder. Run them if you
like — both are safe to re-run — but neither is a blocker.

So this is a configuration job, not a migration.

## 1. Merge the PR

[FRC4392/DeceptiveProject#4](https://github.com/FRC4392/DeceptiveProject/pull/4).

**Do the Vercel and Convex environment variables first** (steps 2 and 3).
`vercel.json` makes the production build run

```
npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL
```

so merging is what pushes the schema and functions to production. A merge
before the keys are set gives you a deployed app that can't talk to Onshape or
GitHub.

## 2. Vercel environment variables (Production scope)

I could not read these — the CLI token in this checkout is expired, so
`npx vercel env ls` fails. **You need to check these by hand** in the Vercel
dashboard, under Settings → Environment Variables, Production:

| Variable                     | Value                                                                     | Why                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`          | Production deploy key, from the Convex dashboard → Settings → Deploy keys | Without it the build's `convex deploy` has no credentials and the whole deploy fails                                                                       |
| `VITE_CLERK_PUBLISHABLE_KEY` | The **production** Clerk key, `pk_live_…`                                 | A `pk_test_…` here points the live site at your Clerk development instance                                                                                 |
| `VITE_CONVEX_SITE_URL`       | Production's `https://<name>.convex.site`                                 | Only used to render the setup URLs on the admin pages. Wrong or missing, and Admin → Onshape shows you a template instead of the URL to paste into Onshape |

Do **not** set `VITE_CONVEX_URL` by hand. The build command injects it, and a
hand-set value will fight it.

## 3. Convex production environment variables

Production currently has three, all Clerk:

```bash
npx convex env list --prod --names-only
```

`CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`. The
issuer is a real production Clerk instance, not a `*.clerk.accounts.dev` one,
so that part is already right. (`--names-only` keeps the values off your
screen; plain `env list` prints every secret in full.)

**All seven Onshape and GitHub variables are missing.** Nothing Onshape or
GitHub does will work until these are set:

```bash
# Onshape OAuth — the same dev-portal app as dev is fine (see step 5)
npx convex env set --prod ONSHAPE_OAUTH_CLIENT_ID <client id>
npx convex env set --prod ONSHAPE_OAUTH_CLIENT_SECRET <client secret>

# Generate these fresh for production — do not copy dev's
npx convex env set --prod ONSHAPE_TOKEN_ENC_KEY "$(openssl rand -base64 32)"
npx convex env set --prod ONSHAPE_SYNC_SECRET "$(openssl rand -hex 32)"
npx convex env set --prod ONSHAPE_WEBHOOK_SECRET "$(openssl rand -hex 32)"

# GitHub issue sync
npx convex env set --prod GITHUB_TOKEN <PAT>
npx convex env set --prod GITHUB_WEBHOOK_SECRET "$(openssl rand -hex 32)"
```

Three of those deserve a note:

- **`ONSHAPE_TOKEN_ENC_KEY`** encrypts the stored Onshape access and refresh
  tokens at rest. Set it **before** connecting Onshape in step 7, and don't
  change it afterwards — the stored tokens become undecryptable, and the only
  cure is reconnecting. Generate a separate one for production; sharing dev's
  means one leaked key exposes both.
- **`ONSHAPE_SYNC_SECRET`** and **`ONSHAPE_WEBHOOK_SECRET`** both travel in a
  URL. Onshape doesn't sign its notifications the way GitHub does, so the
  webhook secret in the callback query string is the only thing standing
  between that endpoint and anyone who guesses at it. Use something long, and
  never reuse dev's — the dev URL is already pasted into an Onshape app
  registration.
- **`GITHUB_TOKEN`** is optional. Issue sync reads fine without it; it buys
  issue commenting and bulk import. A classic PAT with `repo`, or a
  fine-grained one with Issues: read and write.

Leave `ONSHAPE_BASE_URL` unset. It defaults to `https://cad.onshape.com`, and
is only there for an alternate Onshape host.

## 4. Clerk, on the production instance

- **The session token template is the one that bites.** Configure → Sessions →
  Customize session token must include:

  ```json
  {
    "email": "{{user.primary_email_address}}",
    "name": "{{user.full_name}}",
    "role": "{{user.public_metadata.role}}"
  }
  ```

  Without these the token carries no claims and **everyone signs in as a
  nameless student**. Your three existing mentors are safe either way — a
  token with no role claim leaves a stored role alone, deliberately — but
  anyone signing in for the first time lands as a student.

- **Add the webhook**: `user.created`, `user.updated`, `user.deleted`,
  pointing at `https://<prod>.convex.site/clerk/webhook`. Put its signing
  secret in `CLERK_WEBHOOK_SECRET` (already set — confirm it belongs to the
  _production_ instance's webhook, not dev's).

- Mentor access comes from `public_metadata.role` on the Clerk user. The
  tracker's own roles (`lead`, `admin`) are set in Settings → People and win
  over Clerk.

## 5. The Onshape OAuth app

Every URL Onshape calls is deployment-specific, so the app registration in
the Onshape dev portal needs production's alongside dev's.

- **Redirect URI**: add `https://<prod>.convex.site/onshape/oauth/callback`.
  OAuth will fail at the callback without it.
- **Right-panel extension**: point an _element right panel_ extension at

  ```
  https://<prod>.convex.site/onshape/panel?secret=<ONSHAPE_SYNC_SECRET>&documentId={$documentId}&wv={$workspaceOrVersion}&wvid={$workspaceOrVersionId}&elementId={$elementId}
  ```

  with production's sync secret, keeping the `{$…}` placeholders verbatim.
  Admin → Onshape shows this URL filled in once `VITE_CONVEX_SITE_URL` is set.

- **Scopes** come from the app registration, not from the authorize request —
  the code deliberately sends no `scope` parameter. Registering the release
  webhook on a Classroom needs company scope.
- You can use one app for both deployments, or register a second for
  production. One app is simpler; two means a dev mistake can't touch the
  team's live connection.

The release webhook itself is **not** configured in Onshape. It is registered
from inside the app, in step 7.

## 6. The GitHub webhook

Add a repository webhook with payload URL
`https://<prod>.convex.site/github/webhook`, content type JSON, events
**Issues**, **Issue comments** and **Pull requests**, and the secret you set
as `GITHUB_WEBHOOK_SECRET`. Admin → GitHub in the app shows the exact URL.

## 7. First run, in this order

The order matters — two of these depend on earlier ones.

1. **Sign in** at the production site. That creates your `users` row.
2. **Create the season.** Settings → Seasons, add the year. This has to happen
   in the app, not from the CLI: it requires a signed-in mentor, and
   `convex run` has no identity. It also seeds the subsystems, machines and
   process types, including `Bought (COTS)`.
3. **Pull the Clerk roster in**: Admin → People → sync. This reads the Clerk
   API directly, so it fills in names and emails for people who haven't signed
   in yet.
4. **Connect Onshape**: Admin → Onshape → Connect. Must be after
   `ONSHAPE_TOKEN_ENC_KEY` is set in step 3, or the token can't be stored. This
   also reads and stores the company id the webhook registration needs.
5. **Register the release webhook**: Admin → Onshape → Release webhook →
   Register. Check that `lastPingAt` appears — Onshape pings the callback on
   registration, which is your proof the URL is reachable and the secret
   matches.
6. **Map the Onshape documents to subsystems**: Admin → Onshape. A release
   that arrives from an unmapped document still lands, it just can't guess
   which subsystem it belongs to.
7. Optionally, the two no-op backfills, for tidiness:

   ```bash
   npx convex run --prod competitions:backfillSeason
   npx convex run --prod subAssemblies:backfillDefaults
   ```

Then release something small in Onshape and watch it arrive under **New from
Onshape**, and watch the budget meter on that page move by one. That is the
end-to-end check.

## 8. Cleanup on production

**Four dead environment variables.** Production carries `WORKOS_API_KEY`,
`WORKOS_CLIENT_ID`, `WORKOS_WEBHOOK_SECRET` and `WORKOS_ACTION_SECRET`, left
over from a previous auth provider. Nothing in this codebase reads them — a
case-insensitive search for `workos` across the repo returns nothing:

```bash
npx convex env remove --prod WORKOS_API_KEY
npx convex env remove --prod WORKOS_CLIENT_ID
npx convex env remove --prod WORKOS_WEBHOOK_SECRET
npx convex env remove --prod WORKOS_ACTION_SECRET
```

If WorkOS is still wired up anywhere outside this repo, leave them; otherwise
they are credentials sitting in an environment for no reason.

**Eight orphaned tables.** These exist on production, are all empty, and are
no longer in the schema: `boards`, `githubRepos`, `partComments`, `projects`,
`qcChecks`, `taskAttachments`, `taskComments`, `tasks`. Being empty, they
won't block the deploy and the app will ignore them. Delete them from the
Convex dashboard when you want the table list to match the code.

**Never run the sample-data seeder on production.** `seed:sampleParts` and
`seed:wipeParts` are internal mutations with no production guard beyond not
being called. `wipeParts` deletes parts.

**Check the Clerk webhook secret belongs to production.** It is already set,
but it predates this work, so it is worth confirming it is the production
instance's signing secret rather than a copy of dev's.

## What to watch after the first real release

- **Standard content now arrives.** The panel sync used to drop Onshape's
  library fasteners; it now brings them in as lines to buy, one row per
  distinct fastener with its placement count. If the first assembly sync fills
  the page with hardware, the lines carry a `standardContent` flag, so
  filtering them back out is a one-line change.
- **The budget.** 2,500 calls a year. A release is one call plus one per
  assembly in it; a panel sync is one call per part. The meter on New from
  Onshape is measured, not estimated.
