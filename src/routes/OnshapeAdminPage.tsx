import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
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
import { Link } from "react-router-dom";
import { TrashIcon } from "@radix-ui/react-icons";
import type { Id } from "../../convex/_generated/dataModel";

const NO_PROJECT = "__none__";

export function OnshapeAdminPage() {
  const isMentor = useIsMentor();
  const documents = useQuery(api.onshape.listDocuments);
  const projects = useQuery(api.projects.list, { includeArchived: true });
  const assign = useMutation(api.onshape.assignDocumentNumber);
  const removeDoc = useMutation(api.onshape.removeDocument);
  const connection = useQuery(api.onshapeOAuth.connectionStatus);
  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string;

  const projectName = (id?: Id<"projects">) =>
    id ? (projects?.find((p) => p._id === id)?.name ?? "—") : "—";

  const [documentId, setDocumentId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [name, setName] = useState("");
  const [projectSel, setProjectSel] = useState<string>(NO_PROJECT);
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
    if (!documentId.trim() || !documentNumber.trim()) return;
    setSaving(true);
    try {
      const res = await assign({
        onshapeDocumentId: documentId.trim(),
        documentNumber: documentNumber.trim(),
        name: name.trim() || undefined,
        projectId:
          projectSel === NO_PROJECT
            ? undefined
            : (projectSel as Id<"projects">),
      });
      setNote(
        res.backfilled > 0
          ? `Assigned. Numbered ${res.backfilled} existing part${res.backfilled === 1 ? "" : "s"}.`
          : "Assigned.",
      );
      setDocumentId("");
      setDocumentNumber("");
      setName("");
      setProjectSel(NO_PROJECT);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="brand-title text-3xl">Onshape</h1>
        <p className="text-sm text-muted-foreground">
          Map Onshape documents to 2-digit numbers. Part numbers are generated as{" "}
          <span className="font-mono">4392-YY-DDSSSS</span> (DD = document,
          SSSS = sequence).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
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
          <Button asChild variant={connection?.connected ? "outline" : "default"}>
            <a href={`${siteUrl}/onshape/oauth/start`}>
              {connection?.connected ? "Reconnect" : "Connect Onshape"}
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Right panel (selective sync)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Register an <span className="font-medium">element right panel</span>{" "}
            extension on your Onshape OAuth app pointing at the URL below. The same
            panel works in <span className="font-medium">Part Studios</span> and{" "}
            <span className="font-medium">Assemblies</span> — open it in an assembly
            to sync its parts with the correct{" "}
            <span className="font-medium">quantities</span> (instance counts). Pick
            the parts you want, review a preview (rendered image + the part number
            each will get), then sync — it adopts existing Onshape part numbers and
            writes generated ones back (needs the app’s{" "}
            <span className="font-mono">OAuth2Write</span> scope).
          </p>
          <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
            {siteUrl}/onshape/panel?secret=&lt;ONSHAPE_SYNC_SECRET&gt;&amp;documentId=&#123;$documentId&#125;&amp;wv=&#123;$workspaceOrVersion&#125;&amp;wvid=&#123;$workspaceOrVersionId&#125;&amp;elementId=&#123;$elementId&#125;
          </code>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assign a document number</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Map an Onshape document to a project. Manage the projects themselves
            (tags, numbering) in{" "}
            <Link to="/admin" className="underline hover:text-foreground">
              Admin → Projects
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
            <div className="w-28 space-y-1.5">
              <Label htmlFor="doc-num">Number</Label>
              <Input
                id="doc-num"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="e.g. 02"
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
              <Label>Project</Label>
              <Select value={projectSel} onValueChange={setProjectSel}>
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
            <Button type="submit" disabled={saving}>
              Assign
            </Button>
          </form>
          {note && (
            <p className="mt-3 text-sm text-muted-foreground">{note}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Known documents</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableHead>Number</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Onshape document</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => (
                  <TableRow key={d._id}>
                    <TableCell className="font-mono">{d.documentNumber}</TableCell>
                    <TableCell>{d.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {projectName(d.projectId)}
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
        </CardContent>
      </Card>
    </div>
  );
}
