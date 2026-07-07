import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
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
import { TrashIcon } from "@radix-ui/react-icons";

type Mode = "auto" | "manual";

export function ProjectsAdmin() {
  const projects = useQuery(api.projects.list, { includeArchived: true });
  const create = useMutation(api.projects.create);
  const update = useMutation(api.projects.update);
  const remove = useMutation(api.projects.remove);

  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !tag.trim()) return;
    setSaving(true);
    setError("");
    try {
      await create({ name: name.trim(), tag: tag.trim(), numberingMode: mode });
      setName("");
      setTag("");
      setMode("auto");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Projects</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A project’s <span className="font-mono">tag</span> fills the middle of
          its part numbers (<span className="font-mono">4392-&lt;tag&gt;-DD####</span>
          ). <span className="font-medium">Auto</span> generates numbers;{" "}
          <span className="font-medium">Manual</span> leaves them to Onshape /
          hand entry.
        </p>

        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="grow space-y-1.5">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2026 Competition Robot"
            />
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="proj-tag">Tag</Label>
            <Input
              id="proj-tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="e.g. 26"
            />
          </div>
          <div className="w-36 space-y-1.5">
            <Label>Numbering</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={saving || !name.trim() || !tag.trim()}>
            Add project
          </Button>
        </form>
        {error && <p className="text-sm text-danger">{error}</p>}

        {projects === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Numbering</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p._id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="font-mono">{p.tag}</TableCell>
                  <TableCell className="capitalize">{p.numberingMode}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        void update({ id: p._id, archived: !p.archived })
                      }
                    >
                      {p.archived ? "Archived" : "Active"}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void remove({ id: p._id })}
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
  );
}
