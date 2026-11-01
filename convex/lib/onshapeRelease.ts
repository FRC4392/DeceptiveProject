import { str } from "./untrusted";
/**
 * Onshape release webhooks, on the pure side of the line.
 *
 * A notification carries almost nothing: an event name, an object type and an
 * object id. Everything the board cares about — part numbers, revisions, which
 * document each item came from — has to be read back from
 * `GET /api/releasepackages/{id}`. These two halves are the parsing for each,
 * with no network and no database, so a recorded payload can be replayed
 * against them in a test.
 *
 * Onshape's published webhook docs don't describe `onshape.workflow.transition`
 * at all; `objectType`/`objectId` come from Onshape's own sample client. So
 * every field here is read defensively and the raw package is kept on the
 * intake, which is how the first real release gets verified against reality
 * rather than against this file.
 */

export const RELEASE_TRANSITION_EVENT = "onshape.workflow.transition";

/** Sent by Onshape itself, with no registration — acknowledge and move on. */
const LIFECYCLE_EVENTS = new Set([
  "webhook.register",
  "webhook.unregister",
  "webhook.ping",
]);

export type WebhookEvent = {
  event: string;
  messageId?: string;
  webhookId?: string;
  /** "RELEASE" for a release package transition. */
  objectType?: string;
  /** The release package id, for a release transition. */
  objectId?: string;
  documentId?: string;
  workspaceId?: string;
  versionId?: string;
  elementId?: string;
};

/** Normalize a notification body. null when it isn't one. */
export function parseWebhookEvent(body: unknown): WebhookEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  const event = str(raw.event);
  if (!event) return null;
  return {
    event,
    messageId: str(raw.messageId),
    webhookId: str(raw.webhookId),
    objectType: str(raw.objectType),
    objectId: str(raw.objectId),
    documentId: str(raw.documentId),
    workspaceId: str(raw.workspaceId),
    versionId: str(raw.versionId),
    elementId: str(raw.elementId),
  };
}

export function isLifecycleEvent(event: string): boolean {
  return LIFECYCLE_EVENTS.has(event);
}

/**
 * The release package this event is about, or null if it isn't about one.
 * A workflow transition fires for other object types too, and those are not
 * ours to act on.
 */
export function releasePackageId(event: WebhookEvent): string | null {
  if (event.event !== RELEASE_TRANSITION_EVENT) return null;
  if ((str(event.objectType) ?? "").toUpperCase() !== "RELEASE") return null;
  return event.objectId ?? null;
}

/**
 * Constant-time secret comparison. The secret rides in the callback URL —
 * Onshape doesn't sign notifications the way GitHub does — so this is the
 * only thing standing between the endpoint and anyone who guesses at it.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  if (expected.length === 0) return false;
  // Compare over the longer of the two so a length difference doesn't short
  // out the loop and leak the length through timing.
  const length = Math.max(provided.length, expected.length);
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < length; i++) {
    diff |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ---- The release package ----

type ReleaseProperty = {
  propertyId?: unknown;
  name?: unknown;
  value?: unknown;
};

// Every field here is read back off JSON Onshape sent, so each one is
// `unknown` rather than `string`: the shapes are guesses from Onshape's own
// sample client, and a field arriving as something else should narrow to
// "absent", not throw halfway through an ingest. Read them through `str`.
export type ReleaseItem = {
  id?: unknown;
  documentId?: unknown;
  elementId?: unknown;
  versionId?: unknown;
  partId?: unknown;
  /** A number in a real package: 1 assembly, 0 Part Studio. */
  elementType?: unknown;
  /** "onshape/assembly" or "onshape/partstudio" — the clearest signal. */
  mimeType?: unknown;
  name?: unknown;
  partNumber?: unknown;
  revision?: unknown;
  properties?: ReleaseProperty[];
  /** A released assembly carries its parts here, not as siblings. */
  children?: ReleaseItem[];
};

export type ReleasePackage = {
  id?: unknown;
  name?: unknown;
  workflow?: { state?: { name?: unknown } };
  items?: ReleaseItem[];
  properties?: ReleaseProperty[];
};

/** One released item, flattened to what the intake queue needs. */
export type ReleaseLine = {
  partNumber?: string;
  revision?: string;
  name: string;
  documentId?: string;
  elementId?: string;
  versionId?: string;
  partId?: string;
  isAssembly: boolean;
};

/** The workflow state, upper-cased. "" when the package doesn't say. */
export function releaseState(pkg: ReleasePackage): string {
  return (str(pkg.workflow?.state?.name) ?? "").trim().toUpperCase();
}

/**
 * Whether this transition is the one worth spending a board change on.
 *
 * A package transitions several times on its way through — submitted, pending
 * approval, rejected — and only the last step means the parts are real. Teams
 * on a custom workflow can rename the state, so an unknown state is treated as
 * not-yet-released and logged rather than guessed at.
 */
export function isReleasedState(state: string): boolean {
  return state === "RELEASED";
}

function propertyValue(
  properties: ReleaseProperty[] | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  const prop = (properties ?? []).find(
    (p) => (str(p.name) ?? "").toLowerCase() === wanted,
  );
  return typeof prop?.value === "string" && prop.value.length > 0
    ? prop.value
    : undefined;
}

/**
 * Items come back with their part number and revision as named metadata
 * properties, but some responses also carry them flattened on the item. Take
 * whichever is there, property first — that's the one the release itself
 * stamped.
 */
function itemField(item: ReleaseItem, property: string): string | undefined {
  return propertyValue(item.properties, property);
}

/**
 * Whether a released item is an assembly.
 *
 * A real Classroom package answers this three ways and none of them is the
 * string the first version of this code looked for. In order of how much
 * they can be trusted:
 *
 * - `mimeType` — "onshape/assembly" or "onshape/partstudio". Self-describing,
 *   so prefer it.
 * - `elementType` — 1 and 0 respectively. Undocumented, hence the fallback.
 * - `partId` — only a part has one.
 *
 * Nothing recognisable means "part", because that is the safe way to be
 * wrong: a part on the board is visible and fixable, where a silently
 * mis-filed assembly is neither. It says so out loud rather than guessing
 * quietly — that warning is how the numeric form was found.
 */
export function isAssemblyItem(item: ReleaseItem): boolean {
  const mime = str(item.mimeType)?.toLowerCase();
  if (mime === "onshape/assembly") return true;
  if (mime === "onshape/partstudio") return false;

  if (typeof item.elementType === "number") return item.elementType === 1;
  const named = str(item.elementType)?.toUpperCase();
  if (named) return named === "ASSEMBLY";

  if (str(item.partId)) return false;
  if (item.elementType !== undefined && item.elementType !== null) {
    console.warn(
      `Onshape sent elementType as ${typeof item.elementType}: ${JSON.stringify(item.elementType)?.slice(0, 120)}`,
    );
  }
  return false;
}

// Deep enough for any real release, shallow enough to stop a cycle. The
// package is someone else's JSON and nothing promises it is a tree.
const MAX_ITEM_DEPTH = 12;

function lineFor(item: ReleaseItem): ReleaseLine {
  const partNumber = itemField(item, "Part number") ?? str(item.partNumber);
  const revision = itemField(item, "Revision") ?? str(item.revision);
  const name =
    itemField(item, "Name") ?? str(item.name) ?? partNumber ?? "Released item";
  return {
    partNumber,
    revision,
    name,
    documentId: str(item.documentId),
    elementId: str(item.elementId),
    versionId: str(item.versionId),
    partId: str(item.partId),
    isAssembly: isAssemblyItem(item),
  };
}

/**
 * Every released item, flattened.
 *
 * A release of an assembly puts the assembly in `items` and its parts in
 * that item's `children`, so reading only the top level meant a forty-part
 * release produced one line and the parts were never seen.
 */
export function releaseLines(pkg: ReleasePackage): ReleaseLine[] {
  const out: ReleaseLine[] = [];
  const walk = (items: ReleaseItem[], depth: number, seen: Set<string>) => {
    if (depth > MAX_ITEM_DEPTH) {
      console.warn(
        `Onshape release items nest deeper than ${MAX_ITEM_DEPTH} — stopping here.`,
      );
      return;
    }
    for (const item of items) {
      // `id` is per-item within a package, so it is also the loop guard.
      const id = str(item.id);
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(lineFor(item));
      if (item.children?.length) walk(item.children, depth + 1, seen);
    }
  };
  walk(pkg.items ?? [], 0, new Set());
  return out;
}

/** What the intake queue calls this release. */
export function releaseLabel(pkg: ReleasePackage): string {
  const name = str(pkg.name);
  if (name) return name;
  const id = str(pkg.id);
  return id ? `Release ${id}` : "Onshape release";
}

/**
 * Convex documents cap at 1MB and the raw package is kept only so a human can
 * check it against the docs later. A package big enough to threaten the write
 * is worth less than the intake it would take down with it.
 */
const MAX_RAW_PAYLOAD = 200_000;

export function trimRawPackage(pkg: ReleasePackage): unknown {
  try {
    const encoded = JSON.stringify(pkg);
    if (encoded.length <= MAX_RAW_PAYLOAD) return pkg;
    return {
      omitted: `Raw package was ${encoded.length} bytes — too large to keep.`,
      id: pkg.id,
      itemCount: (pkg.items ?? []).length,
    };
  } catch {
    return { omitted: "Raw package could not be serialized." };
  }
}
