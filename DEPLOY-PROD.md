# Moving this to production

Written 1 November 2026. **This deployment is done** — production is on the
new schema and in use. The file stays as the record of what was set and why,
and as the runbook for the next deployment.

Everything below was checked against the live production deployment rather
than assumed, and the checks are named so you can re-run them yourself.

Production is the Convex deployment **`neat-alligator-295`**:

|                |                                           |
| -------------- | ----------------------------------------- |
| Client URL     | `https://neat-alligator-295.convex.cloud` |
| HTTP endpoints | `https://neat-alligator-295.convex.site`  |

Every URL below is spelled out against it, so the Clerk, Onshape and GitHub
fields can be filled in by copying rather than by assembling.

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

**Deployed 1 November 2026.** Steps 1 through 8 are done, bar two things
deferred on purpose: the Onshape document mapping in step 7, which waits on
there being CAD to map at kickoff, and the Clerk session token claims in
step 4, which are being handled as people sign in. §7a is what the second one
costs when it isn't done first.

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

**Reported set as of 1 November 2026.** I could not verify them myself — the
CLI token in this checkout is expired, so `npx vercel env ls` fails. Kept as
the record of what has to be there:

| Variable                     | Value                                                                     | Why                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`          | Production deploy key, from the Convex dashboard → Settings → Deploy keys | Without it the build's `convex deploy` has no credentials and the whole deploy fails                                                                       |
| `VITE_CLERK_PUBLISHABLE_KEY` | The **production** Clerk key, `pk_live_…`                                 | A `pk_test_…` here points the live site at your Clerk development instance                                                                                 |
| `VITE_CONVEX_SITE_URL`       | `https://neat-alligator-295.convex.site`                                  | Only used to render the setup URLs on the admin pages. Wrong or missing, and Admin → Onshape shows you a template instead of the URL to paste into Onshape |

Do **not** set `VITE_CONVEX_URL` by hand. The build command injects it, and a
hand-set value will fight it.

## 3. Convex production environment variables

**Done — all ten are set as of 1 November 2026.** Verify any time with:

```bash
npx convex env list --prod --names-only
```

(`--names-only` keeps the values off your screen; plain `env list` prints
every secret in full.)

The Clerk issuer is a real production instance, not a `*.clerk.accounts.dev`
one, so that part was already right. The four `WORKOS_*` leftovers described
in step 8 have been removed. What follows is kept as the record of what was
set and why, since two of these have consequences that outlive the setup.

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

The four generated ones can go in as one block — written this way the values
are made and consumed inside the shell, so they never appear on screen or in
your terminal history:

```bash
npx convex env set --prod ONSHAPE_TOKEN_ENC_KEY "$(openssl rand -base64 32)" && npx convex env set --prod ONSHAPE_SYNC_SECRET "$(openssl rand -hex 32)" && npx convex env set --prod ONSHAPE_WEBHOOK_SECRET "$(openssl rand -hex 32)" && npx convex env set --prod GITHUB_WEBHOOK_SECRET "$(openssl rand -hex 32)"
```

Two of those you will need to read back later, when you paste them into
Onshape and GitHub:

```bash
npx convex env get ONSHAPE_SYNC_SECRET --prod
```

```bash
npx convex env get GITHUB_WEBHOOK_SECRET --prod
```

The other two are only ever read by the server — the app builds the webhook
callback URL itself, and the encryption key is never shown to anyone — so
there is no reason to look at them.

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
  pointing at `https://neat-alligator-295.convex.site/clerk/webhook`. Put its signing
  secret in `CLERK_WEBHOOK_SECRET` (already set — confirm it belongs to the
  _production_ instance's webhook, not dev's).

- Mentor access comes from `public_metadata.role` on the Clerk user. The
  tracker's own roles (`lead`, `admin`) are set in Settings → People and win
  over Clerk.

## 5. The Onshape OAuth app

Every URL Onshape calls is deployment-specific, so the app registration in
the Onshape dev portal needs production's alongside dev's.

- **Redirect URI**: add `https://neat-alligator-295.convex.site/onshape/oauth/callback`.
  OAuth will fail at the callback without it.
- **Right-panel extension**: point an _element right panel_ extension at

  ```
  https://neat-alligator-295.convex.site/onshape/panel?secret=<ONSHAPE_SYNC_SECRET>&documentId={$documentId}&wv={$workspaceOrVersion}&wvid={$workspaceOrVersionId}&elementId={$elementId}
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

**Do this after the deploy, not before it.** An earlier version of this file
said the opposite, on the grounds that `main` already served `/github/webhook`
with the same signature check and the same `ping` → `pong` reply — which is
true, and beside the point. The ping is safe. The _first real delivery_ is
not: it is handled by whatever code is live, and the old code wrote an
`issues` row carrying `linkedTaskId`, a field the new schema has no validator
for. That one row then failed schema validation and aborted the production
deploy.

It is worth stating as a rule, because it is not specific to GitHub: **while
the old code is still live, any webhook that writes data can block the new
schema.** Point webhooks at production only once production is running the
code whose schema they will be writing against.

The Onshape release webhook has the same ordering for a different reason:
`/onshape/webhook` does not exist on `main` at all, so registering it early
points Onshape at a 404. It is registered from inside the app in step 7.

**Put it on the organisation, not the repo.** The receiver takes the repo from
`repository.full_name` on whatever arrives, so one organisation-level webhook
covers every repo the team owns, including next year's — which is the point,
since a new repo a year from now then needs no deployment step at all. Which
repos anybody looks at is decided in the app, in Admin → GitHub →
Repositories, not here; a repo nobody has sorted shows as this season's until a
mentor says otherwise. A per-repo webhook still works and is the fallback if
the organisation's settings aren't yours to change.

| Field            | Value                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- |
| Payload URL      | `https://neat-alligator-295.convex.site/github/webhook`                               |
| Content type     | `application/json` — **not** form-encoded                                             |
| Secret           | `npx convex env get GITHUB_WEBHOOK_SECRET --prod`                                     |
| SSL verification | Enabled                                                                               |
| Events           | _Let me select individual events_ → **Issues**, **Issue comments**, **Pull requests** |

Content type matters more than it looks. The signature is computed over the
raw body either way, so a form-encoded payload passes the signature check and
then dies in `JSON.parse` — a 400 that looks like a secret problem but isn't.

The three failure modes are distinguishable, which makes this quick to debug
from GitHub's own delivery log:

| Response                     | Cause                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| `503 Webhook not configured` | `GITHUB_WEBHOOK_SECRET` not set on the deployment                     |
| `401 Invalid signature`      | Secret in GitHub doesn't match the one in Convex                      |
| `400 Bad JSON`               | Content type is form-encoded instead of JSON                          |
| `200 pong`                   | Working. GitHub signs the ping too, so this proves the secret matches |

Issues carry no `seasonId`, so this doesn't wait on a season existing — their
season comes from the repo they arrived from, which is why the turn of the
season needs no migration. It does wait on the deploy, for the reason above.

## 7. First run, in this order

The order matters — two of these depend on earlier ones.

1. **Sign in** at the production site. That creates your `users` row.
2. **Create the season.** Settings shows a **Set up this season** panel while
   there isn't one; after that it's the **Seasons** panel on the same page. This has to happen
   in the app, not from the CLI: it requires a signed-in mentor, and
   `convex run` has no identity. It also seeds the subsystems, machines and
   process types, including `Bought (COTS)`.
3. **Pull the Clerk roster in**: Settings → **People** → sync. This reads the Clerk
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

## 7a. If nobody can reach Settings

This happened, and it cost an afternoon, so it is written down.

**The symptom:** you sign in, the app loads, and Settings isn't there. The
console is clean, the Clerk token is valid, and `grantRole` reports success.

**The cause:** the session token claims in step 4. Before they are configured,
a token carries no `email`, `name` or `role`, so `storeCurrentUser`
(`convex/auth.ts`) inserts a row with an empty email, a name equal to the
Clerk user id, and the role `student`. Sign in from a second context and you
can end up with **two rows for the same person**, neither of them obviously
yours, because neither carries an email.

`grantRole` matches on email, and those rows have none — so granting by email
silently lands on whichever row does have it, which may be an old one that no
longer matches the id you are actually signing in with. Everything reports
success and nothing changes.

**How to tell:** list the users and look for rows whose `name` equals their
`authId` and whose `email` is empty. Those are claimless sign-ins.

```bash
npx convex data --prod users --limit 50
```

**The fix:** grant the role by `authId` rather than email, targeting the row
whose id matches the `sub` in your own token —

```js
window.Clerk.session
  .getToken()
  .then((t) => console.log(JSON.parse(atob(t.split(".")[1]))));
```

— then run the roster sync from Settings → People, which reads the Clerk API
directly and is authoritative, so it fills in every empty email and name.
Delete the leftover duplicate afterwards.

**The real fix is step 4.** Configure the session token claims and none of
this arises: people land with their name, email and role the first time.

## 8. Cleanup on production — done

**Four dead environment variables — removed.** Production carried
`WORKOS_API_KEY`,
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

**Eight orphaned tables — removed.** These existed on production and were no
longer in the schema. `boards` holds one row — a "Software" board the old GitHub sync
created during the webhook mishap above; the `issues` and `tasks` rows from
that same delivery have been deleted. The rest are
empty: `githubRepos`, `partComments`, `projects`, `qcChecks`,
`taskAttachments`, `taskComments`, `tasks`. None of them block anything —
Convex validates the tables the schema declares, and these aren't among them —
and the app ignores them. Delete them from the Convex dashboard when you want
the table list to match the code.

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
