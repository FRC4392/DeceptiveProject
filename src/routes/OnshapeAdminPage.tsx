import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
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
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { TrashIcon } from "@radix-ui/react-icons";
import type { Id } from "../../convex/_generated/dataModel";

const NO_SUBSYSTEM = "__none__";

export function OnshapeAdminPage() {
  const isMentor = useIsMentor();
  const documents = useQuery(api.onshape.listDocuments);
  const subsystems = useQuery(api.subsystems.list, {});
  const mapDocument = useMutation(api.onshape.mapDocument);
  const removeDoc = useMutation(api.onshape.removeDocument);
  const connection = useQuery(api.onshapeOAuth.connectionStatus);
  const siteUrl = (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined)
    ?.trim()
    .replace(/\/$/, "");

  const subsystemName = (id?: Id<"subsystems">) =>
    id ? (subsystems?.find((s) => s._id === id)?.name ?? "—") : "—";

  const [documentId, setDocumentId] = useState("");
  const [name, setName] = useState("");
  const [subsystemSel, setSubsystemSel] = useState<string>(NO_SUBSYSTEM);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  if (!isMentor) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <h1 className="brand-title text-2xl">Mentors only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Onshape configuration is restricted to mentors.
        </p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!documentId.trim()) return;
    setSaving(true);
    try {
      await mapDocument({
        onshapeDocumentId: documentId.trim(),
        name: name.trim() || undefined,
        subsystemId:
          subsystemSel === NO_SUBSYSTEM
            ? null
            : (subsystemSel as Id<"subsystems">),
      });
      setNote(
        "Mapped. Parts synced from this document land in that subsystem.",
      );
      setDocumentId("");
      setName("");
      setSubsystemSel(NO_SUBSYSTEM);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/admin" className="hover:text-foreground hover:underline">
          Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">Onshape</span>
      </nav>

      <div>
        <h1 className="brand-title text-3xl">Onshape</h1>
        <p className="text-sm text-muted-foreground">
          Say which subsystem each Onshape document holds the CAD for, so synced
          parts land in the right place. Part numbers themselves come from the
          tracker: <span className="font-mono">{"{YY}-{SUB}-{NNN}"}</span>.
        </p>
      </div>

      <Panel
        title="Connection"
        bodyClass="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="text-sm">
          {connection === undefined ? (
            <span className="text-muted-foreground">Loading…</span>
          ) : connection.connected ? (
            <span className="font-medium text-success">
              ✓ Connected to Onshape
            </span>
          ) : (
            <span className="text-muted-foreground">
              Not connected. Authorize once so the “Sync to tracker” button can
              pull parts on demand.
            </span>
          )}
        </div>
        {siteUrl ? (
          <Button
            asChild
            variant={connection?.connected ? "outline" : "default"}
          >
            <a href={`${siteUrl}/onshape/oauth/start`}>
              {connection?.connected ? "Reconnect" : "Connect Onshape"}
            </a>
          </Button>
        ) : (
          <Button disabled>Connect Onshape</Button>
        )}
        {!siteUrl && (
          <p className="basis-full text-xs text-warning">
            Set VITE_CONVEX_SITE_URL in .env.local to enable OAuth and panel
            setup links.
          </p>
        )}
      </Panel>

      <ReleaseWebhookPanel siteUrl={siteUrl} />

      <Panel title="Right panel (selective sync)" bodyClass="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Register an <span className="font-medium">element right panel</span>{" "}
          extension on your Onshape OAuth app pointing at the URL below. The
          same panel works in <span className="font-medium">Part Studios</span>{" "}
          and <span className="font-medium">Assemblies</span> — open it in an
          assembly to sync its parts with the correct{" "}
          <span className="font-medium">quantities</span> (instance counts).
          Pick the parts you want and send them — they arrive under{" "}
          <span className="font-medium">New from Onshape</span> for a design
          lead to wave through. Nothing is written back into Onshape, so a sync
          only ever costs reads.
        </p>
        <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
          {siteUrl ?? "https://<your-convex-deployment>.convex.site"}
          /onshape/panel?secret=&lt;ONSHAPE_SYNC_SECRET&gt;&amp;documentId=&#123;$documentId&#125;&amp;wv=&#123;$workspaceOrVersion&#125;&amp;wvid=&#123;$workspaceOrVersionId&#125;&amp;elementId=&#123;$elementId&#125;
        </code>
        {!siteUrl && (
          <p className="text-xs text-warning">
            This URL is a template until VITE_CONVEX_SITE_URL is configured.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Replace <span className="font-mono">&lt;ONSHAPE_SYNC_SECRET&gt;</span>{" "}
          with the value set via{" "}
          <span className="font-mono">
            npx convex env set ONSHAPE_SYNC_SECRET
          </span>
          . Keep the <span className="font-mono">&#123;$…&#125;</span>{" "}
          placeholders verbatim — Onshape fills in the document and element at
          runtime.
        </p>
      </Panel>

      <Panel title="Map a document">
        <p className="mb-3 text-sm text-muted-foreground">
          Parts synced from this document land in the subsystem you pick.
          Subsystems themselves live in{" "}
          <Link to="/admin" className="underline hover:text-foreground">
            settings
          </Link>
          .
        </p>
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="grow space-y-1.5">
            <Label htmlFor="doc-id">Onshape document ID</Label>
            <Input
              id="doc-id"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              placeholder="from the Onshape document URL"
            />
          </div>
          <div className="grow space-y-1.5">
            <Label htmlFor="doc-name">Name (optional)</Label>
            <Input
              id="doc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Drivetrain assembly"
            />
          </div>
          <div className="w-44 space-y-1.5">
            <Label>Subsystem</Label>
            <Select value={subsystemSel} onValueChange={setSubsystemSel}>
              <SelectTrigger>
                <SelectValue placeholder="No subsystem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SUBSYSTEM}>No subsystem</SelectItem>
                {(subsystems ?? []).map((sub) => (
                  <SelectItem key={sub._id} value={sub._id}>
                    {sub.name}
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {sub.code}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={saving}>
            Map it
          </Button>
        </form>
        {note && <p className="mt-3 text-sm text-muted-foreground">{note}</p>}
      </Panel>

      <Panel title="Known documents">
        {documents === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents mapped yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subsystem</TableHead>
                <TableHead>Onshape document</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d._id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {subsystemName(d.subsystemId)}
                  </TableCell>
                  <TableCell>
                    <a
                      href={`https://cad.onshape.com/documents/${d.onshapeDocumentId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {d.onshapeDocumentId}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void removeDoc({ id: d._id })}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

/**
 * The release webhook: Onshape calls the tracker the moment a release package
 * is approved, instead of waiting for someone to remember to open the panel.
 */
function ReleaseWebhookPanel({ siteUrl }: { siteUrl?: string }) {
  const status = useQuery(api.onshapeWebhook.status);
  const register = useAction(api.onshapeWebhook.register);
  const unregister = useAction(api.onshapeWebhook.unregister);
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const when = (at: number | null) =>
    at === null ? "never" : new Date(at).toLocaleString();

  return (
    <Panel title="Release webhook" bodyClass="space-y-3 text-sm">
      <p className="text-muted-foreground">
        With this on, Onshape tells the tracker the moment a release package is
        approved and the release lands under{" "}
        <span className="font-medium">New from Onshape</span> on its own. The
        notification itself is free — Onshape doesn't count it — and reading the
        release costs a single call, which is far less than syncing the same
        assembly by hand part-by-part. A lead still decides what happens to each
        line; nothing moves on the board by itself.
      </p>

      {status === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {status.registered ? (
                <span className="font-medium text-success">
                  ✓ Registered with Onshape
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Not registered. Releases are only noticed when someone syncs.
                </span>
              )}
              {status.registered && (
                <p className="text-xs text-muted-foreground">
                  Last ping {when(status.lastPingAt)} · last release{" "}
                  {when(status.lastEventAt)}
                </p>
              )}
            </div>
            {status.registered ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => unregister({}))}
              >
                Turn it off
              </Button>
            ) : (
              <Button
                disabled={busy || !status.secretConfigured}
                onClick={() =>
                  void run(() =>
                    register(
                      companyId.trim() ? { companyId: companyId.trim() } : {},
                    ),
                  )
                }
              >
                Register webhook
              </Button>
            )}
          </div>

          {!status.registered && (
            <div className="w-full space-y-1.5 sm:w-72">
              <Label htmlFor="company-id">Onshape company ID (optional)</Label>
              <Input
                id="company-id"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="for an enterprise or classroom"
              />
            </div>
          )}

          {!status.secretConfigured && (
            <p className="text-xs text-warning">
              Set the shared secret first:{" "}
              <span className="font-mono">
                npx convex env set ONSHAPE_WEBHOOK_SECRET &lt;a long random
                string&gt;
              </span>
            </p>
          )}

          {status.registered && status.webhookId && (
            <p className="text-xs text-muted-foreground">
              Webhook <span className="font-mono">{status.webhookId}</span> on{" "}
              {status.events.join(", ")}.
            </p>
          )}

          <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
            {siteUrl ?? "https://<your-convex-deployment>.convex.site"}
            /onshape/webhook?secret=&lt;ONSHAPE_WEBHOOK_SECRET&gt;
          </code>
          <p className="text-xs text-muted-foreground">
            Registering needs a company admin account, and the deployment needs
            to be reachable from the internet — Onshape calls the URL above.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}
        </>
      )}
    </Panel>
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
