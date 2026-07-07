import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useIsMentor } from "@/lib/roles";
import { useActiveProject } from "@/lib/project";
import { TrashIcon } from "@radix-ui/react-icons";

function NewBoardDialog() {
  const createBoard = useMutation(api.boards.create);
  const { activeProjectId, projects } = useActiveProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subsystem, setSubsystem] = useState("");
  const [saving, setSaving] = useState(false);

  const activeProject = projects?.find((p) => p._id === activeProjectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !subsystem.trim()) return;
    setSaving(true);
    try {
      await createBoard({
        name: name.trim(),
        subsystem: subsystem.trim(),
        projectId: activeProjectId ?? undefined,
      });
      setName("");
      setSubsystem("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New board</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="board-name">Name</Label>
            <Input
              id="board-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Drivetrain"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="board-subsystem">Subsystem</Label>
            <Input
              id="board-subsystem"
              value={subsystem}
              onChange={(e) => setSubsystem(e.target.value)}
              placeholder="e.g. drivetrain, intake, electrical, software"
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {activeProject
              ? `Added to project “${activeProject.name}”.`
              : "No project selected — this board won’t belong to a project. Pick a project in the header to scope it."}
          </p>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create board"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BoardsPage() {
  const { activeProjectId, projects } = useActiveProject();
  const boards = useQuery(api.boards.list, {
    projectId: activeProjectId ?? undefined,
  });
  const removeBoard = useMutation(api.boards.remove);
  const isMentor = useIsMentor();
  const projectName = (id?: string) =>
    projects?.find((p) => p._id === id)?.name;

  async function handleDelete(id: Id<"boards">, name: string) {
    if (!confirm(`Delete board "${name}"? Its tasks must be moved first.`)) {
      return;
    }
    try {
      await removeBoard({ id });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete board.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="brand-title text-3xl">Boards</h1>
          <p className="text-sm text-muted-foreground">
            {activeProjectId
              ? "Boards for the selected project. Click a board to open its Kanban."
              : "All boards across projects. Pick a project in the header to focus."}
          </p>
        </div>
        {isMentor && <NewBoardDialog />}
      </div>

      {boards === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No boards yet.{" "}
          {isMentor
            ? "Create one to get started."
            : "Ask a mentor to create the first board."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <div
              key={board._id}
              className="group relative rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/50"
            >
              <Link to={`/boards/${board._id}`} className="block">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{board.name}</span>
                  <Badge variant="secondary" className="capitalize">
                    {board.subsystem}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {!activeProjectId && projectName(board.projectId)
                    ? projectName(board.projectId)
                    : "Open board →"}
                </p>
              </Link>
              {isMentor && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => void handleDelete(board._id, board.name)}
                >
                  <TrashIcon className="h-4 w-4" />
                  <span className="sr-only">Delete board</span>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
