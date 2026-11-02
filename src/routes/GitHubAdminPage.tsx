import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMentor } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { errorText } from "@/lib/errors";
import type { RepoRow } from "@/lib/repos";

export function GitHubAdminPage() {
  const isMentor = useIsMentor();
  const config = useQuery(api.github.config);
  const importIssues = useAction(api.github.importIssues);
  const siteUrl = (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined)
    ?.trim()
    .replace(/\/$/, "");

  const [repo, setRepo] = useState("");
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!isMentor) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <h1 className="brand-title text-2xl">Mentors only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          GitHub configuration is restricted to mentors.
        </p>
      </div>
    );
  }

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    if (!repo.trim()) return;
    setImporting(true);
    setNote(null);
    try {
      const res = await importIssues({ repo: repo.trim() });
      setNote(
        `Imported ${res.imported} issue${res.imported === 1 ? "" : "s"}/PR${
          res.imported === 1 ? "" : "s"
        }.`,
      );
      setRepo("");
    } catch (err) {
      setNote(errorText(err, "Import failed."));
    } finally {
      setImporting(false);
    }
  }

  const webhookUrl = siteUrl ? `${siteUrl}/github/webhook` : "…/github/webhook";

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/admin" className="hover:text-foreground hover:underline">
          Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">GitHub</span>
      </nav>

      <div>
        <h1 className="brand-title text-3xl">GitHub</h1>
        <p className="text-sm text-muted-foreground">
          Sync software issues and pull requests. Each mirrors into a task on
          the Software board.
        </p>
      </div>

      <Panel title="Configuration" bodyClass="space-y-3 text-sm">
        <ConfigRow
          ok={config?.webhookConfigured}
          label="Webhook secret"
          hint="GITHUB_WEBHOOK_SECRET"
        />
        <ConfigRow
          ok={config?.tokenConfigured}
          label="API token"
          hint="GITHUB_TOKEN (import + write-back)"
        />
        <p className="text-xs text-muted-foreground">
          Set both once, on the Convex deployment:
        </p>
        <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
          npx convex env set GITHUB_WEBHOOK_SECRET &lt;random-string&gt;
          <br />
          npx convex env set GITHUB_TOKEN &lt;github-PAT&gt;
        </code>
      </Panel>

      <Panel title="Webhook" bodyClass="space-y-2 text-sm">
        <p className="text-muted-foreground">
          In GitHub → Settings → Webhooks → Add webhook, use this payload URL
          (content type <span className="font-mono">application/json</span>),
          the same secret as{" "}
          <span className="font-mono">GITHUB_WEBHOOK_SECRET</span>, and
          subscribe to <span className="font-medium">Issues</span>,{" "}
          <span className="font-medium">Issue comments</span>, and{" "}
          <span className="font-medium">Pull requests</span>.
        </p>
        <p className="text-muted-foreground">
          One webhook on the organisation covers every repo, including next
          year's, and is the setup to prefer — which repos anybody looks at is
          decided below rather than in GitHub.
        </p>
        <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
          {webhookUrl}
        </code>
        {!siteUrl && (
          <p className="text-xs text-warning">
            Set VITE_CONVEX_SITE_URL in .env.local to show the exact webhook
            URL.
          </p>
        )}
      </Panel>

      <ReposPanel />

      <Panel title="Import a repository" bodyClass="space-y-3">
        <p className="text-sm text-muted-foreground">
          Pull a repo's existing issues and PRs in now (needs{" "}
          <span className="font-mono">GITHUB_TOKEN</span>). New activity flows
          in on its own once the webhook is set; this is for the ones that were
          already there. The repo is added to the list above as this season's,
          so change it there if it isn't.
        </p>
        <form
          onSubmit={(e) => void runImport(e)}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="grow space-y-1.5">
            <Label htmlFor="repo">Repository</Label>
            <Input
              id="repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name (e.g. deceivers/robot-2026)"
            />
          </div>
          <Button
            type="submit"
            disabled={importing || !config?.tokenConfigured}
          >
            {importing ? "Importing…" : "Import"}
          </Button>
        </form>
        {!config?.tokenConfigured && (
          <p className="text-xs text-warning">
            Set GITHUB_TOKEN first to enable import.
          </p>
        )}
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </Panel>
    </div>
  );
}

/**
 * What the team wants from each repo. One organisation webhook delivers
 * everything, so this is the only place that decides what anybody sees — and
 * the reason the Issues page needs no per-year setup when the season turns.
 */
function ReposPanel() {
  const registry = useQuery(api.github.repos, {});
  const seasons = useQuery(api.seasons.list, {});
  const setRepo = useMutation(api.github.setRepo);
  const forget = useMutation(api.github.forgetRepoIssues);
  const remove = useMutation(api.github.removeRepo);
  const [adding, setAdding] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    setNote(null);
    try {
      await setRepo({ fullName: adding.trim(), kind: "season" });
      setAdding("");
    } catch (err) {
      setNote(errorText(err, "Couldn't add that repo."));
    }
  }

  async function forgetIssues(row: RepoRow) {
    if (
      !confirm(
        `Delete the ${row.total} issue${row.total === 1 ? "" : "s"} already imported from ${row.fullName}? This can't be undone.`,
      )
    ) {
      return;
    }
    setNote(null);
    try {
      const res = await forget({ fullName: row.fullName });
      setNote(`Removed ${res.removed} issue${res.removed === 1 ? "" : "s"}.`);
    } catch (err) {
      setNote(errorText(err, "Couldn't remove those issues."));
    }
  }

  const rows = registry?.repos ?? [];

  return (
    <Panel
      title="Repositories"
      description="Which repos the Issues page is about. This season's show by default; the ones you keep year after year are their own filter."
      bodyClass="space-y-3"
    >
      {registry === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has synced yet. A repo registers itself the first time the
          webhook delivers from it, or add one below.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <RepoRowEditor
              key={row._id}
              row={row}
              seasons={seasons ?? []}
              onSet={(args) =>
                setRepo({ fullName: row.fullName, ...args }).then(
                  () => undefined,
                )
              }
              onForget={() => void forgetIssues(row)}
              onRemove={() => void remove({ id: row._id })}
            />
          ))}
        </ul>
      )}

      {(registry?.local.total ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Plus {registry?.local.total} reported in the app, which belong to no
          repo and show with this season's.
        </p>
      )}

      <form onSubmit={(e) => void add(e)} className="flex items-end gap-2 pt-1">
        <div className="grow space-y-1.5">
          <Label htmlFor="add-repo">Add a repo</Label>
          <Input
            id="add-repo"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="owner/name"
          />
        </div>
        <Button type="submit" variant="outline" disabled={!adding.trim()}>
          Add
        </Button>
      </form>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </Panel>
  );
}

const KINDS: { value: RepoRow["kind"]; label: string; hint: string }[] = [
  { value: "season", label: "This season", hint: "shown by default" },
  { value: "ongoing", label: "Every season", hint: "its own filter" },
  { value: "ignored", label: "Ignored", hint: "nothing new is stored" },
];

function RepoRowEditor({
  row,
  seasons,
  onSet,
  onForget,
  onRemove,
}: {
  row: RepoRow;
  seasons: { _id: Id<"seasons">; year: string; name: string }[];
  onSet: (args: {
    kind: RepoRow["kind"];
    seasonId?: Id<"seasons">;
    label?: string | null;
  }) => Promise<void>;
  onForget: () => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(row.label ?? "");
  const kind = KINDS.find((k) => k.value === row.kind) ?? KINDS[0];

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 grow">
        <p className="truncate font-mono text-sm">{row.fullName}</p>
        <p className="text-xs text-muted-foreground">
          {row.open} open · {row.total} in all · {kind.hint}
          {row.reviewedAt === undefined && " · not sorted yet"}
        </p>
      </div>

      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if ((row.label ?? "") !== label) {
            void onSet({ kind: row.kind, seasonId: row.seasonId, label });
          }
        }}
        placeholder="What you call it"
        className="w-40"
      />

      <Select
        value={row.kind}
        onValueChange={(v) =>
          void onSet({
            kind: v as RepoRow["kind"],
            seasonId: row.seasonId,
            label: row.label ?? null,
          })
        }
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((k) => (
            <SelectItem key={k.value} value={k.value}>
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {row.kind === "season" && (
        <Select
          value={row.seasonId ?? ""}
          onValueChange={(v) =>
            void onSet({
              kind: "season",
              seasonId: v as Id<"seasons">,
              label: row.label ?? null,
            })
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Season" />
          </SelectTrigger>
          <SelectContent>
            {seasons.map((s) => (
              <SelectItem key={s._id} value={s._id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {row.total > 0 ? (
        <Button variant="ghost" size="sm" onClick={onForget}>
          Forget its issues
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      )}
    </li>
  );
}

function ConfigRow({
  ok,
  label,
  hint,
}: {
  ok: boolean | undefined;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <span className="font-medium">{label}</span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          {hint}
        </span>
      </div>
      {ok === undefined ? (
        <span className="text-xs text-muted-foreground">…</span>
      ) : ok ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
          <CheckCircledIcon className="h-4 w-4" /> Set
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <CrossCircledIcon className="h-4 w-4" /> Not set
        </span>
      )}
    </div>
  );
}

/** Same bordered block the settings page uses, so these read as part of it. */
function Panel({
  title,
  description,
  bodyClass,
  children,
}: {
  title: string;
  description?: string;
  /** Layout for the body, the way the old card content carried its own. */
  bodyClass?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className={cn("mt-4", bodyClass)}>{children}</div>
    </section>
  );
}
