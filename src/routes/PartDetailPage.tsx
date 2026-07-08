import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PartStatusBadge } from "@/components/pm/PartStatusBadge";
import { PartFormDialog } from "@/components/pm/PartFormDialog";
import { useIsMentor } from "@/lib/roles";
import { initials, useRosterMap } from "@/lib/users";
import {
  PART_STATUSES,
  formatCost,
  methodLabel,
  type PartStatus,
} from "@/lib/parts";
import { formatDateTime } from "@/lib/pm";
import {
  Cross2Icon,
  Pencil1Icon,
  TrashIcon,
  UploadIcon,
} from "@radix-ui/react-icons";

export function PartDetailPage() {
  const { partId } = useParams<{ partId: string }>();
  const id = partId as Id<"parts">;
  const part = useQuery(api.parts.get, { id });
  const updateStatus = useMutation(api.parts.updateStatus);
  const flagBlocked = useMutation(api.parts.flagBlocked);
  const removePart = useMutation(api.parts.remove);
  const clearConflict = useMutation(api.onshape.clearRevisionConflict);
  const navigate = useNavigate();
  const isMentor = useIsMentor();
  const roster = useRosterMap();

  if (part === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (part === null) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Part not found.</p>
        <Link to="/parts" className="text-sm hover:underline">
          ← Back to parts
        </Link>
      </div>
    );
  }

  async function handleDelete() {
    if (!confirm(`Delete "${part!.name}"? This can't be undone.`)) return;
    await removePart({ id });
    void navigate("/parts");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          to="/parts"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Parts
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Part · {methodLabel(part.manufacturingMethod)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="brand-title text-2xl">{part.name}</h1>
              {part.partNumber && (
                <span className="font-mono text-sm text-muted-foreground">
                  {part.partNumber}
                </span>
              )}
              <PartStatusBadge status={part.status} />
              {part.blocked && (
                <Badge variant="outline" className="text-danger">
                  Blocked
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PartFormDialog
              part={part}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil1Icon className="mr-1.5 h-4 w-4" /> Edit
                </Button>
              }
            />
            {isMentor && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete()}
              >
                <TrashIcon className="mr-1.5 h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {part.revisionConflict && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4">
          <div>
            <div className="text-sm font-medium text-warning">
              Revision conflict
            </div>
            <p className="text-sm text-muted-foreground">
              This part was edited in Onshape after its design was locked.
              Reconcile the change, then clear this flag.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void clearConflict({ partId: id })}
          >
            Resolve
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <ThumbnailSection part={part} />
          <QCSection partId={id} />
          <CommentsSection partId={id} />
        </div>

        <aside className="space-y-6">
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Status
              </label>
              <Select
                value={part.status}
                onValueChange={(v) =>
                  void updateStatus({ id, status: v as PartStatus })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PART_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <MetaRow label="Method">{methodLabel(part.manufacturingMethod)}</MetaRow>
            <MetaRow label="Quantity">{part.quantityNeeded}</MetaRow>
            <MetaRow label="Material">{part.material || "—"}</MetaRow>
            <MetaRow label="Assignee">
              {part.assigneeId ? (roster[part.assigneeId]?.name ?? "—") : "—"}
            </MetaRow>
            <MetaRow label="Cost">{formatCost(part.cost)}</MetaRow>
            {part.isCOTS && (
              <>
                <MetaRow label="Vendor">{part.vendor || "—"}</MetaRow>
                <MetaRow label="Vendor #">{part.vendorPartNumber || "—"}</MetaRow>
                <MetaRow label="Lead time">{part.leadTime || "—"}</MetaRow>
                <MetaRow label="Order">{part.orderStatus || "—"}</MetaRow>
              </>
            )}
            {part.linkedTaskId && (
              <MetaRow label="Task">
                <Link
                  to={`/tasks/${part.linkedTaskId}`}
                  className="text-sm text-primary hover:underline"
                >
                  View task →
                </Link>
              </MetaRow>
            )}
            {part.onshapeDocumentId && (
              <MetaRow label="Onshape">
                <a
                  href={`https://cad.onshape.com/documents/${part.onshapeDocumentId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Open in Onshape →
                </a>
              </MetaRow>
            )}
          </div>

          <BlockedSection part={part} onFlag={flagBlocked} />
        </aside>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function BlockedSection({
  part,
  onFlag,
}: {
  part: Doc<"parts">;
  onFlag: ReturnType<typeof useMutation>;
}) {
  const [reason, setReason] = useState("");
  if (part.blocked) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/5 p-4">
        <div className="text-sm font-medium text-danger">Blocked</div>
        {part.blockedReason && (
          <p className="mt-1 text-sm text-muted-foreground">
            {part.blockedReason}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void onFlag({ id: part._id, blocked: false })}
        >
          Unblock
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 text-sm font-medium">Flag blocked</div>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
      />
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() =>
          void onFlag({
            id: part._id,
            blocked: true,
            reason: reason.trim() || undefined,
          })
        }
      >
        Mark blocked
      </Button>
    </div>
  );
}

function ThumbnailSection({ part }: { part: Doc<"parts"> }) {
  const url = useQuery(
    api.parts.thumbnailUrl,
    part.thumbnailStorageId
      ? { storageId: part.thumbnailStorageId }
      : "skip",
  );
  const generateUploadUrl = useMutation(api.parts.generateUploadUrl);
  const setThumbnail = useMutation(api.parts.setThumbnail);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await res.json();
      await setThumbnail({ id: part._id, storageId });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Thumbnail</h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <UploadIcon className="mr-1.5 h-4 w-4" />
          {uploading ? "Uploading…" : part.thumbnailStorageId ? "Replace" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleFile(e)}
        />
      </div>
      <div className="flex h-56 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
        {url ? (
          <img
            src={url}
            alt={part.name}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-sm text-muted-foreground">No image</span>
        )}
      </div>
    </section>
  );
}

function QCSection({ partId }: { partId: Id<"parts"> }) {
  const checks = useQuery(api.parts.listQCChecks, { partId });
  const addCheck = useMutation(api.parts.addQCCheck);
  const toggleCheck = useMutation(api.parts.toggleQCCheck);
  const removeCheck = useMutation(api.parts.removeQCCheck);
  const [label, setLabel] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    await addCheck({ partId, label: label.trim() });
    setLabel("");
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        QC checklist
      </h2>
      <div className="space-y-1">
        {(checks ?? []).map((c) => (
          <div
            key={c._id}
            className="flex items-center gap-2 rounded-md border px-3 py-2"
          >
            <Checkbox
              checked={c.checked}
              onCheckedChange={() => void toggleCheck({ id: c._id })}
            />
            <span
              className={
                c.checked
                  ? "grow text-sm text-muted-foreground line-through"
                  : "grow text-sm"
              }
            >
              {c.label}
            </span>
            <button
              type="button"
              onClick={() => void removeCheck({ id: c._id })}
              className="text-muted-foreground hover:text-foreground"
            >
              <Cross2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {checks && checks.length === 0 && (
          <p className="text-xs text-muted-foreground">No checks yet.</p>
        )}
      </div>
      <form onSubmit={(e) => void add(e)} className="mt-3 flex gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add a check, e.g. dimensions verified"
        />
        <Button type="submit" variant="outline" disabled={!label.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}

function CommentsSection({ partId }: { partId: Id<"parts"> }) {
  const comments = useQuery(api.parts.listComments, { partId });
  const addComment = useMutation(api.parts.addComment);
  const roster = useRosterMap();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      await addComment({ partId, body: body.trim() });
      setBody("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        Comments
      </h2>
      <div className="space-y-4">
        {(comments ?? []).map((c) => {
          const name = roster[c.authorId]?.name ?? "Unknown";
          return (
            <div key={c._id} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {initials(name)}
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(c._creationTime)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </div>
          );
        })}
        {comments && comments.length === 0 && (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        )}
      </div>
      <Separator className="my-4" />
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving || !body.trim()}>
            {saving ? "Posting…" : "Comment"}
          </Button>
        </div>
      </form>
    </section>
  );
}
