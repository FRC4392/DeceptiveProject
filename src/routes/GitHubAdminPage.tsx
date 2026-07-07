import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMentor } from "@/lib/roles";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";

const NO_PROJECT = "__none__";

export function GitHubAdminPage() {
  const isMentor = useIsMentor();
  const config = useQuery(api.github.config);
  const projects = useQuery(api.projects.list, { includeArchived: true });
  const importIssues = useAction(api.github.importIssues);
  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;

  const [repo, setRepo] = useState("");
  const [importProject, setImportProject] = useState<string>(NO_PROJECT);
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
      const res = await importIssues({
        repo: repo.trim(),
        projectId:
          importProject === NO_PROJECT
            ? undefined
            : (importProject as Id<"projects">),
      });
      setNote(
        `Imported ${res.imported} issue${res.imported === 1 ? "" : "s"}/PR${
          res.imported === 1 ? "" : "s"
        }.`,
      );
      setRepo("");
      setImportProject(NO_PROJECT);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const webhookUrl = siteUrl ? `${siteUrl}/github/webhook` : "…/github/webhook";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="brand-title text-3xl">GitHub</h1>
        <p className="text-sm text-muted-foreground">
          Sync software issues and pull requests. Each mirrors into a task on the
          Software board.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            In your GitHub repo → Settings → Webhooks → Add webhook, use this
            payload URL (content type <span className="font-mono">application/json</span>),
            the same secret as <span className="font-mono">GITHUB_WEBHOOK_SECRET</span>,
            and subscribe to <span className="font-medium">Issues</span>,{" "}
            <span className="font-medium">Issue comments</span>, and{" "}
            <span className="font-medium">Pull requests</span>.
          </p>
          <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
            {webhookUrl}
          </code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import a repository</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pull a repo's existing issues and PRs in now (needs{" "}
            <span className="font-mono">GITHUB_TOKEN</span>). Assign them to a
            project as they come in — that also sets the repo→project mapping so
            future synced issues inherit it. New activity flows in automatically
            once the webhook is set.
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
            <div className="w-44 space-y-1.5">
              <Label>Project</Label>
              <Select value={importProject} onValueChange={setImportProject}>
                <SelectTrigger>
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>No project</SelectItem>
                  {(projects ?? []).map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                        {p.tag}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        </CardContent>
      </Card>

      <LinkedReposCard repos={config?.repos ?? []} />
    </div>
  );
}

function LinkedReposCard({ repos }: { repos: string[] }) {
  const projects = useQuery(api.projects.list, { includeArchived: true });
  const mappings = useQuery(api.github.listRepoMappings);
  const setRepoProject = useMutation(api.github.setRepoProject);
  const removeMapping = useMutation(api.github.removeRepoMapping);

  // Union of repos known from synced issues and repos with an explicit project
  // mapping, so the list is a complete picture — mirroring Onshape's "Known
  // documents" table.
  const mappingByRepo = new Map(mappings?.map((m) => [m.repo, m]) ?? []);
  const linked = [
    ...new Set([...repos, ...(mappings?.map((m) => m.repo) ?? [])]),
  ].sort((a, b) => a.localeCompare(b));

  async function onProject(repo: string, value: string) {
    const mapping = mappingByRepo.get(repo);
    if (value === NO_PROJECT) {
      if (mapping) await removeMapping({ id: mapping._id });
    } else {
      await setRepoProject({ repo, projectId: value as Id<"projects"> });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Linked repositories</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Repositories syncing into the tracker and the project each maps to.
          Assigning a project backfills that repo's unassigned issues and is
          inherited by new synced issues; a per-issue choice always wins.
        </p>
        {mappings === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories linked yet. Import one above to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead>Project</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linked.map((repo) => {
                const mapping = mappingByRepo.get(repo);
                return (
                  <TableRow key={repo}>
                    <TableCell>
                      <a
                        href={`https://github.com/${repo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {repo}
                      </a>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mapping?.projectId ?? NO_PROJECT}
                        onValueChange={(v) => void onProject(repo, v)}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue placeholder="No project" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_PROJECT}>No project</SelectItem>
                          {(projects ?? []).map((p) => (
                            <SelectItem key={p._id} value={p._id}>
                              {p.name}
                              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                                {p.tag}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
