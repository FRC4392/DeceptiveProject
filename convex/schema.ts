import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Mirrors WorkOS user data, kept in sync via the AuthKit component's
  // user.created/updated/deleted event handlers in convex/auth.ts. `role`
  // is populated asynchronously by the scheduled `syncRoleFromWorkOS`
  // action (WorkOS is the source of truth for roles); treat a missing
  // role as "student".
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    role: v.optional(v.union(v.literal("mentor"), v.literal("student"))),
  }).index("authId", ["authId"]),

  // A project groups one or more Onshape documents (and their parts/tasks) into
  // one effort — the competition robot, an off-season module, etc. `tag` fills
  // the middle segment of a part number (replacing the auto year): "26",
  // "SWERVE", … `numberingMode` picks whether the app auto-generates numbers or
  // leaves them to Onshape/manual entry. Mentor-managed.
  projects: defineTable({
    name: v.string(),
    tag: v.string(),
    numberingMode: v.union(v.literal("auto"), v.literal("manual")),
    archived: v.optional(v.boolean()),
  }).index("by_tag", ["tag"]),

  // A board is a subsystem-scoped bucket of tasks (drivetrain, intake,
  // electrical, software, etc.). Mentor-managed set. A board may belong to a
  // project (its manual tasks inherit that project) or be cross-project.
  boards: defineTable({
    name: v.string(),
    subsystem: v.string(),
    order: v.number(),
    projectId: v.optional(v.id("projects")),
  }),

  // The single canonical to-do list for the whole suite. Parts (Phase 2/3)
  // and issues (Phase 4) mirror their lifecycle here via source/sourceId.
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    boardId: v.id("boards"),
    assigneeIds: v.array(v.string()), // WorkOS user IDs
    dueDate: v.optional(v.number()),
    completedAt: v.optional(v.number()), // set when status -> done
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("blocked"),
      v.literal("done"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    ),
    labels: v.array(v.string()),
    parentTaskId: v.optional(v.id("tasks")), // subtasks
    dependsOn: v.array(v.id("tasks")),
    source: v.union(
      v.literal("manual"),
      v.literal("part"),
      v.literal("issue"),
    ),
    sourceId: v.optional(v.string()), // parts._id or issues._id, for the deep link back
    // Which project this task belongs to (for project-scoped views). Part-sourced
    // tasks inherit the part's project; manual tasks inherit their board's.
    projectId: v.optional(v.id("projects")),
  })
    .index("by_board", ["boardId"])
    .index("by_status", ["status"])
    .index("by_parent", ["parentTaskId"])
    .index("by_source", ["source", "sourceId"]),

  taskComments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.string(),
    body: v.string(),
  }).index("by_task", ["taskId"]),

  taskAttachments: defineTable({
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    filename: v.string(),
  }).index("by_task", ["taskId"]),

  // Competition dates power the dashboard countdown. Mentor-managed.
  competitions: defineTable({
    name: v.string(),
    date: v.number(),
  }),

  // ---- Phase 2: Part tracker ----
  // Written with Phase-3 (Onshape) fields present so Phase 3 needs no migration.
  parts: defineTable({
    partNumber: v.optional(v.string()), // null until Phase 3 auto-generates; manual meanwhile
    name: v.string(),
    material: v.optional(v.string()),
    quantityNeeded: v.number(),
    manufacturingMethod: v.union(
      v.literal("mill"),
      v.literal("lathe"),
      v.literal("3d_print"),
      v.literal("waterjet"),
      v.literal("laser_cut"),
      v.literal("cots"),
    ),
    status: v.union(
      v.literal("needs_design"),
      v.literal("in_design"),
      v.literal("designed"),
      v.literal("queued"),
      v.literal("in_progress"),
      v.literal("manufactured"),
      v.literal("qc"),
      v.literal("installed"),
      v.literal("scrapped"),
    ),
    assigneeId: v.optional(v.string()),
    thumbnailStorageId: v.optional(v.id("_storage")),
    isCOTS: v.boolean(),
    vendor: v.optional(v.string()),
    vendorPartNumber: v.optional(v.string()),
    cost: v.optional(v.number()),
    orderStatus: v.optional(v.string()),
    leadTime: v.optional(v.string()),
    linkedTaskId: v.optional(v.id("tasks")), // back-reference to the auto-created task
    // A blocked flag drives the linked task to "blocked" regardless of stage.
    blocked: v.boolean(),
    blockedReason: v.optional(v.string()),
    // Phase 3 fields, present now to avoid a later migration:
    onshapeDocumentId: v.optional(v.string()),
    onshapeElementId: v.optional(v.string()),
    documentNumber: v.optional(v.string()),
    lastModifiedInOnshape: v.optional(v.number()),
    designerId: v.optional(v.string()),
    revisionConflict: v.boolean(),
    // The project this part belongs to (from its Onshape document, or chosen on
    // manual creation). Denormalized for direct project-scoped filtering.
    projectId: v.optional(v.id("projects")),
  })
    .index("by_status", ["status"])
    .index("by_isCOTS", ["isCOTS"])
    .index("by_onshapeElementId", ["onshapeElementId"])
    .index("by_project", ["projectId"]),

  partComments: defineTable({
    partId: v.id("parts"),
    authorId: v.string(),
    body: v.string(),
  }).index("by_part", ["partId"]),

  qcChecks: defineTable({
    partId: v.id("parts"),
    label: v.string(),
    checked: v.boolean(),
  }).index("by_part", ["partId"]),

  inventoryItems: defineTable({
    name: v.string(),
    onHandQty: v.number(),
    unitCost: v.optional(v.number()),
    linkedPartId: v.optional(v.id("parts")),
  }),

  // ---- Phase 3: Onshape integration ----
  // Monotonic per-(project tag, document) sequence for generating
  // 4392-<tag>-DDSSSS part numbers. Keyed by tag as well as document so two
  // projects can reuse a 2-digit document number without colliding.
  partNumberCounters: defineTable({
    tag: v.string(), // project tag, e.g. "26"
    documentNumber: v.string(), // 2-digit, e.g. "02"
    lastSequence: v.number(),
  }).index("by_tag_and_document", ["tag", "documentNumber"]),

  // Known Onshape documents and their mentor-assigned 2-digit numbers. Each maps
  // to a project (assigned in the admin UI); synced parts inherit it.
  onshapeDocuments: defineTable({
    documentNumber: v.string(),
    onshapeDocumentId: v.string(),
    name: v.string(),
    projectId: v.optional(v.id("projects")),
  }).index("by_onshapeDocumentId", ["onshapeDocumentId"]),

  // Single-row team-level Onshape OAuth token store (one connection for the
  // whole team, refreshed as needed).
  onshapeAuth: defineTable({
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    connectedBy: v.optional(v.string()),
  }),

  // Short-lived CSRF state values for the OAuth authorize round-trip.
  onshapeOAuthState: defineTable({
    state: v.string(),
  }).index("by_state", ["state"]),

  // Short-lived, single-use tokens for the Onshape right-panel app. The panel
  // (served to an Onshape iframe) mints one after validating the shared secret;
  // the browser's "Sync selected" POST redeems it, so the long-lived
  // ONSHAPE_SYNC_SECRET never has to be carried in client-side JS. The token
  // also captures the document/element context server-side so the client can't
  // tamper with which element gets synced.
  onshapePanelTokens: defineTable({
    token: v.string(),
    documentId: v.string(),
    wv: v.string(), // "w" (workspace) or "v" (version)
    wvid: v.string(),
    elementId: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // ---- Phase 4: GitHub issue/PR sync ----
  // Software issues/PRs mirror their lifecycle into the single `tasks` list via
  // source: "issue" / sourceId (see convex/lib/taskSync.ts::syncTaskForIssue).
  // `source: "github"` rows are owned by the GitHub webhook (repo + number
  // identify them); `source: "manual"` rows are bug reports created in-app that
  // never leave the tracker. `priority` is derived from labels on GitHub rows
  // and set directly on manual ones.
  issues: defineTable({
    source: v.union(v.literal("github"), v.literal("manual")),
    repo: v.optional(v.string()), // "owner/name" (GitHub rows)
    number: v.optional(v.number()), // issue/PR number within the repo
    githubId: v.optional(v.number()), // GitHub's stable numeric id
    title: v.string(),
    body: v.optional(v.string()),
    state: v.union(v.literal("open"), v.literal("closed")),
    htmlUrl: v.optional(v.string()),
    labels: v.array(v.string()),
    assigneeLogins: v.array(v.string()), // GitHub logins (not WorkOS ids)
    authorLogin: v.optional(v.string()),
    isPullRequest: v.boolean(),
    // The effective priority (displayed + mirrored to the task). On GitHub rows
    // it tracks the labels via derivePriority unless overridden below.
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    ),
    // An in-app override that survives GitHub re-syncs. When set on a GitHub
    // row it wins over the label-derived priority; clearing it reverts to the
    // labels. (Manual rows set `priority` directly and ignore this.)
    priorityOverride: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    linkedTaskId: v.optional(v.id("tasks")), // back-reference to the mirror task
    projectId: v.optional(v.id("projects")),
    lastSyncedAt: v.optional(v.number()),
  })
    .index("by_repo_and_number", ["repo", "number"])
    .index("by_state", ["state"])
    .index("by_project", ["projectId"]),

  // Comments on an issue. GitHub-mirrored comments carry `githubCommentId` +
  // `authorLogin`; locally-authored team notes carry `authorId` (WorkOS id) and
  // stay in the tracker only.
  issueComments: defineTable({
    issueId: v.id("issues"),
    githubCommentId: v.optional(v.number()),
    authorLogin: v.optional(v.string()),
    authorId: v.optional(v.string()),
    body: v.string(),
  })
    .index("by_issue", ["issueId"])
    .index("by_githubCommentId", ["githubCommentId"]),

  // Mentor-managed mapping from a GitHub repo ("owner/name") to a project, so
  // synced/imported issues auto-inherit a project (the GitHub twin of
  // onshapeDocuments→project). Manual per-issue triage still wins and is never
  // overwritten. Mirrors Onshape's document mapping.
  githubRepos: defineTable({
    repo: v.string(), // canonical GitHub full_name, e.g. "deceivers/robot-2026"
    projectId: v.id("projects"),
  }).index("by_repo", ["repo"]),
});
