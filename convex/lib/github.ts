// Pure helpers for the GitHub integration — no Convex context, so they're
// unit-testable and shared between the webhook httpAction and the REST import
// action. Keep everything here side-effect free.

export type IssuePriority = "low" | "medium" | "high";
export type IssueState = "open" | "closed";

/**
 * Derive a task priority from an issue's GitHub labels. Matches common label
 * conventions (priority:high, P0, critical, urgent → high; low/minor/P3 → low),
 * defaulting to medium. Case-insensitive, substring match.
 */
export function derivePriority(labels: string[]): IssuePriority {
  const lower = labels.map((l) => l.toLowerCase());
  const has = (kws: string[]) => lower.some((l) => kws.some((k) => l.includes(k)));
  if (has(["critical", "urgent", "blocker", "p0", "p1", "high"])) return "high";
  if (has(["low", "minor", "trivial", "p3", "p4"])) return "low";
  return "medium";
}

// --- Safe accessors for untrusted webhook / REST JSON (avoid `any`) ---

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** GitHub labels arrive as `[{ name }]` (webhook/REST) or `["name"]` (rare). */
function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((l) => (typeof l === "string" ? l : asString(asRecord(l).name)))
    .filter((s): s is string => !!s);
}

/** GitHub user lists arrive as `[{ login }]`. */
function logins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((u) => asString(asRecord(u).login))
    .filter((s): s is string => !!s);
}

// The normalized arguments for `upsertIssueFromWebhook` — one shape produced
// from either a webhook payload node or a REST list item.
export type IssueUpsertArgs = {
  repo: string;
  number: number;
  githubId?: number;
  title: string;
  body?: string;
  state: IssueState;
  htmlUrl?: string;
  labels: string[];
  assigneeLogins: string[];
  authorLogin?: string;
  isPullRequest: boolean;
};

/**
 * Normalize a GitHub issue/PR object (webhook `issue`/`pull_request` node, or a
 * REST `/issues` list item) into upsert args. `isPR` is true for the
 * `pull_request` webhook event; the REST list and the `issues` event also flag
 * PRs via the presence of a `pull_request` key on the node itself.
 */
export function normalizeIssueNode(
  repo: string,
  node: unknown,
  isPR: boolean,
): IssueUpsertArgs | null {
  const n = asRecord(node);
  const number = asNumber(n.number);
  if (number === undefined) return null;
  return {
    repo,
    number,
    githubId: asNumber(n.id),
    title: asString(n.title) ?? "(untitled)",
    body: asString(n.body),
    state: n.state === "closed" ? "closed" : "open",
    htmlUrl: asString(n.html_url),
    labels: labelNames(n.labels),
    assigneeLogins: logins(n.assignees),
    authorLogin: asString(asRecord(n.user).login),
    isPullRequest: isPR || n.pull_request !== undefined,
  };
}

/** Strip a full GitHub URL / trailing .git down to "owner/name". */
export function normalizeRepo(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
}
