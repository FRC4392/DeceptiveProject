import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// A part's flag chips — the small coloured labels on a board card. Problems
// get their own table; these are the lightweight "look at this" markers.
export const flagValidator = v.object({
  kind: v.union(
    v.literal("changed_after_made"), // released again after someone made it
    v.literal("drawing_out_of_date"), // CAD moved on, the DXF didn't
    v.literal("remake"), // one broke / was scrapped, make another
    v.literal("waiting"), // off at a sponsor, waiting on stock, …
  ),
  note: v.optional(v.string()),
  qty: v.optional(v.number()),
  at: v.number(),
  byUserId: v.optional(v.string()),
});

export default defineSchema({
  // Mirrors Clerk user data, kept in sync from sign-in storage, Clerk webhooks,
  // and the mentor-triggered Clerk backfill action in convex/auth.ts.
  // Clerk user ids are the app-facing identity key.
  //
  // `role` is the Clerk-sourced mentor/student flag and is overwritten on every
  // sync. `appRole` is the tracker's own role, set in Settings by a mentor, and
  // wins when present — that's what makes someone a lead without touching Clerk.
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    role: v.optional(v.union(v.literal("mentor"), v.literal("student"))),
    appRole: v.optional(
      v.union(
        v.literal("student"),
        v.literal("lead"),
        v.literal("mentor"),
        v.literal("admin"),
      ),
    ),
  }).index("authId", ["authId"]),

  // The season's to-do list: one list, no boards. A to-do is a title, some
  // tags, who picked it up, and done or not done — deliberately the same
  // shape as a part, so the two screens read alike.
  todos: defineTable({
    seasonId: v.id("seasons"),
    title: v.string(),
    description: v.optional(v.string()),
    tagIds: v.array(v.id("todoTags")),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    claimedByUserId: v.optional(v.string()),
    doneAt: v.optional(v.number()),
    doneByUserId: v.optional(v.string()),
  })
    .index("by_season", ["seasonId"])
    .index("by_claimedBy", ["claimedByUserId"]),

  // The tags a to-do can carry. Team-wide and mentor-managed, like machines
  // and process types — they outlive a season.
  todoTags: defineTable({
    name: v.string(),
    order: v.number(),
  }),

  todoNotes: defineTable({
    todoId: v.id("todos"),
    userId: v.string(),
    body: v.string(),
  }).index("by_todo", ["todoId"]),

  // Competition dates power the dashboard countdown and the "next event" card
  // in the tracker's sidebar. Mentor-managed.
  competitions: defineTable({
    name: v.string(),
    date: v.number(),
  }).index("by_date", ["date"]),

  // ---- Part tracker ----

  // A season owns a set of subsystems, its parts and their numbering. `year` is
  // the two digits that open every part number: 27-INT-104.
  seasons: defineTable({
    year: v.string(),
    name: v.string(),
    active: v.boolean(),
  }),

  // The subsystems the robot is split into. `code` is the middle segment of a
  // part number (DRV, INT, ELV, …) and is unique within a season.
  subsystems: defineTable({
    seasonId: v.id("seasons"),
    code: v.string(),
    name: v.string(),
    leadUserId: v.optional(v.string()),
    order: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_season_and_code", ["seasonId", "code"]),

  // Per (season, subsystem) sequence for {YY}-{SUB}-{NNN}. Incremented inside a
  // mutation, which Convex runs as a transaction, so concurrent "get a number"
  // requests serialize and a number is never handed out twice.
  partNumberCounters: defineTable({
    seasonId: v.id("seasons"),
    subsystemId: v.id("subsystems"),
    next: v.number(),
  }).index("by_season_and_subsystem", ["seasonId", "subsystemId"]),

  // A machine in the shop. `requiresMentorPresent` surfaces as a
  // safety warning on the shop screen.
  machines: defineTable({
    name: v.string(),
    requiresMentorPresent: v.boolean(),
    order: v.number(),
  }),

  // How a part gets made. The two flags decide which stages the part skips:
  // a 3D print needs no drawing, a part with no finishing skips stage 4.
  processTypes: defineTable({
    name: v.string(),
    machineId: v.optional(v.id("machines")),
    needsDrawing: v.boolean(),
    needsFinishing: v.boolean(),
    // Bought items never get made — they go straight to "Ready to assemble".
    isBought: v.optional(v.boolean()),
    order: v.number(),
  }),

  parts: defineTable({
    seasonId: v.id("seasons"),
    subsystemId: v.id("subsystems"),
    partNumber: v.string(),
    // normalizePartNumber(partNumber) — "27INT104" — so "int-104" and "104"
    // both find it without scanning every spelling.
    partNumberKey: v.string(),
    name: v.string(),
    processTypeId: v.id("processTypes"),
    material: v.optional(v.string()),
    qtyNeeded: v.number(),
    qtySpares: v.number(),
    qtyMade: v.number(),
    stage: v.number(), // 1-6, see convex/lib/stages.ts
    claimedByUserId: v.optional(v.string()),
    designerUserId: v.optional(v.string()),
    drawingCheckedByUserId: v.optional(v.string()),
    makerUserId: v.optional(v.string()),
    assemblerUserId: v.optional(v.string()),
    // When it entered the stage it's in — drives the "waiting too long" list.
    stageSince: v.number(),
    isArchived: v.boolean(),
    binLabel: v.optional(v.string()),
    notesForMaker: v.optional(v.string()),
    thumbnailStorageId: v.optional(v.id("_storage")),
    // Onshape, all optional: the tracker works with no CAD link at all.
    onshapeDocumentId: v.optional(v.string()),
    onshapeElementId: v.optional(v.string()),
    onshapePartId: v.optional(v.string()),
    onshapeVersionId: v.optional(v.string()),
    revision: v.optional(v.string()),
    lastReleasePackageId: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    flags: v.array(flagValidator),
  })
    .index("by_partNumberKey", ["partNumberKey"])
    .index("by_season", ["seasonId"])
    .index("by_subsystem", ["subsystemId"])
    .index("by_season_and_stage", ["seasonId", "stage"])
    .index("by_claimedBy", ["claimedByUserId"])
    .index("by_onshapeElementId", ["onshapeElementId"]),

  // Every stage move, forward or back, with who and when. The part page's
  // History panel reads this straight through.
  stageEvents: defineTable({
    partId: v.id("parts"),
    fromStage: v.number(),
    toStage: v.number(),
    userId: v.string(),
    note: v.optional(v.string()),
  }).index("by_part", ["partId"]),

  partNotes: defineTable({
    partId: v.id("parts"),
    userId: v.string(),
    body: v.string(),
  }).index("by_part", ["partId"]),

  // "Something went wrong": broke, scrapped, ran out of material, unsure.
  problems: defineTable({
    partId: v.id("parts"),
    reason: v.union(
      v.literal("broke"),
      v.literal("scrapped"),
      v.literal("out_of_material"),
      v.literal("wrong_size"),
      v.literal("unsure"),
      v.literal("other"),
    ),
    qtyAffected: v.number(),
    note: v.optional(v.string()),
    openedByUserId: v.string(),
    resolvedByUserId: v.optional(v.string()),
    resolution: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_part", ["partId"])
    .index("by_resolved", ["resolvedAt"]),

  // Bought items get no part number. Tracked by name per subsystem, and
  // "arrived" counts as ready to assemble.
  cotsItems: defineTable({
    seasonId: v.id("seasons"),
    subsystemId: v.id("subsystems"),
    name: v.string(),
    qtyNeeded: v.number(),
    unit: v.optional(v.string()),
    status: v.union(
      v.literal("needed"),
      v.literal("ordered"),
      v.literal("arrived"),
    ),
    vendor: v.optional(v.string()),
    vendorPartNumber: v.optional(v.string()),
    eta: v.optional(v.number()),
    cost: v.optional(v.number()),
  })
    .index("by_subsystem", ["subsystemId"])
    .index("by_season", ["seasonId"]),

  // A sub-assembly: a named, numbered thing that goes together, mirroring the
  // CAD. It holds parts, bought items and *other sub-assemblies*, so an intake
  // can be a frame assembly plus a roller assembly rather than one flat list.
  //
  // Every subsystem has exactly one with `isDefault`, numbered {YY}-{SUB}-000.
  // Marking that one built is what "the subsystem is on the robot" means.
  //
  // The Onshape field names deliberately match `parts`, so release matching is
  // written once over { partNumberKey, onshapeElementId } and used for both.
  subAssemblies: defineTable({
    seasonId: v.id("seasons"),
    subsystemId: v.id("subsystems"),
    partNumber: v.string(),
    partNumberKey: v.string(),
    name: v.string(),
    order: v.number(),
    isDefault: v.optional(v.boolean()),
    onshapeDocumentId: v.optional(v.string()),
    onshapeElementId: v.optional(v.string()),
    onshapeVersionId: v.optional(v.string()),
    revision: v.optional(v.string()),
    lastReleasePackageId: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    // A drawing that isn't in Onshape — a PDF on the shop drive, say. Rendered
    // as a link, so http(s) only (see lib/assembly.ts::isSafeDrawingUrl). The
    // CAD link is derived from the ids above and never stored.
    drawingUrl: v.optional(v.string()),
    claimedByUserId: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    completedByUserId: v.optional(v.string()),
  })
    .index("by_subsystem", ["subsystemId"])
    .index("by_season", ["seasonId"])
    .index("by_partNumberKey", ["partNumberKey"])
    .index("by_onshapeElementId", ["onshapeElementId"])
    .index("by_subsystem_and_default", ["subsystemId", "isDefault"]),

  // What a sub-assembly is made of. Exactly one of the three ids is set on any
  // row — that invariant is enforced in subAssemblies.setMembers, which is the
  // only thing allowed to write this table.
  subAssemblyMembers: defineTable({
    subAssemblyId: v.id("subAssemblies"),
    partId: v.optional(v.id("parts")),
    cotsItemId: v.optional(v.id("cotsItems")),
    childSubAssemblyId: v.optional(v.id("subAssemblies")),
    // Placement count, when the row came from a CAD sync.
    quantity: v.optional(v.number()),
  })
    .index("by_parent", ["subAssemblyId"])
    .index("by_part", ["partId"])
    .index("by_child", ["childSubAssemblyId"]),

  // ---- Onshape intake ----
  // A release (or a manually entered / CSV-imported stand-in) waiting to be
  // turned into board changes. Received for free; reading it costs 1 API call.
  releaseIntakes: defineTable({
    source: v.union(
      v.literal("onshape"),
      v.literal("manual"),
      v.literal("csv"),
    ),
    onshapeReleasePackageId: v.optional(v.string()),
    label: v.string(),
    receivedAt: v.number(),
    status: v.union(
      v.literal("queued"), // held: no reads allowed, or not looked at yet
      v.literal("read"), // lines built, waiting on a lead
      v.literal("processed"),
      v.literal("dismissed"),
    ),
    payload: v.optional(v.any()),
    processedByUserId: v.optional(v.string()),
  })
    .index("by_package", ["onshapeReleasePackageId"])
    .index("by_status", ["status"]),

  releaseIntakeLines: defineTable({
    intakeId: v.id("releaseIntakes"),
    partNumber: v.optional(v.string()),
    revision: v.optional(v.string()),
    name: v.string(),
    quantity: v.optional(v.number()),
    kind: v.union(
      v.literal("matched"), // number is known, stage moved
      v.literal("changed"), // new revision of something already made
      v.literal("unknown"), // a number the app never issued
      v.literal("removed"), // gone from the subsystem assembly
    ),
    decision: v.optional(
      v.union(
        v.literal("rework"),
        v.literal("remake_all"),
        v.literal("keep"),
        v.literal("linked"),
        v.literal("created"),
        v.literal("archived"),
        v.literal("ignored"),
      ),
    ),
    partId: v.optional(v.id("parts")),
    // Absent means the line is about a part, which is the common case.
    target: v.optional(v.union(v.literal("part"), v.literal("subAssembly"))),
    subAssemblyId: v.optional(v.id("subAssemblies")),
    subsystemId: v.optional(v.id("subsystems")),
    note: v.optional(v.string()),
  }).index("by_intake", ["intakeId"]),

  // Every Onshape call, so the budget meter is measured rather than guessed.
  // Only 2xx/3xx responses count against the plan's allowance.
  apiCalls: defineTable({
    method: v.string(),
    endpoint: v.string(),
    status: v.number(),
    counted: v.boolean(),
    reason: v.optional(v.string()),
  }).index("by_counted", ["counted"]),

  // Budget limit, renewal date, thresholds, forced mode, webhook id, …
  appSettings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  // Known Onshape documents, mapped to the subsystem they hold the CAD for.
  onshapeDocuments: defineTable({
    onshapeDocumentId: v.string(),
    name: v.string(),
    subsystemId: v.optional(v.id("subsystems")),
  })
    .index("by_onshapeDocumentId", ["onshapeDocumentId"])
    .index("by_subsystem", ["subsystemId"]),

  // Single-row team-level Onshape OAuth token store (one connection for the
  // whole team, refreshed as needed).
  onshapeAuth: defineTable({
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    /** The `users.authId` of whoever authorized this connection. */
    connectedBy: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    // A query can't ask Onshape whether the token still works, so the fetch
    // path writes down what happened last. Without this the admin page says
    // "Connected" forever, including after the owner leaves the Classroom.
    lastError: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
  }),

  // Short-lived CSRF state for the OAuth authorize round-trip. It doubles as
  // proof that a mentor started the flow — /onshape/oauth/start is a public
  // endpoint, and without this anyone who knew the URL could repoint the
  // team's connection at their own Onshape account.
  onshapeOAuthState: defineTable({
    state: v.string(),
    userId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  }).index("by_state", ["state"]),

  // The release webhook Onshape calls when a release package transitions.
  // One registration for the whole team; this row is also what the admin page
  // shows as its status, which is why the lifecycle timestamps live on it.
  onshapeWebhooks: defineTable({
    webhookId: v.string(),
    companyId: v.optional(v.string()),
    events: v.array(v.string()),
    registeredAt: v.number(),
    registeredBy: v.optional(v.string()),
    /** Onshape's own register/ping traffic — proof the callback is reachable. */
    lastPingAt: v.optional(v.number()),
    /** The last real transition we were told about. */
    lastEventAt: v.optional(v.number()),
    // Set when the Onshape connection is re-authorized: the registration was
    // made under the old authorization and may no longer be live, but Onshape
    // doesn't tell us that — so say "re-register" rather than "✓ Registered".
    staleSince: v.optional(v.number()),
  }).index("by_webhookId", ["webhookId"]),

  // Short-lived, single-use tokens for the Onshape right-panel app.
  onshapePanelTokens: defineTable({
    token: v.string(),
    documentId: v.string(),
    wv: v.string(),
    wvid: v.string(),
    elementId: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // ---- GitHub issue/PR sync ----
  issues: defineTable({
    source: v.union(v.literal("github"), v.literal("manual")),
    repo: v.optional(v.string()),
    number: v.optional(v.number()),
    githubId: v.optional(v.number()),
    title: v.string(),
    body: v.optional(v.string()),
    state: v.union(v.literal("open"), v.literal("closed")),
    htmlUrl: v.optional(v.string()),
    labels: v.array(v.string()),
    assigneeLogins: v.array(v.string()),
    authorLogin: v.optional(v.string()),
    isPullRequest: v.boolean(),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    priorityOverride: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    lastSyncedAt: v.optional(v.number()),
  })
    .index("by_repo_and_number", ["repo", "number"])
    .index("by_state", ["state"]),

  issueComments: defineTable({
    issueId: v.id("issues"),
    githubCommentId: v.optional(v.number()),
    authorLogin: v.optional(v.string()),
    authorId: v.optional(v.string()),
    body: v.string(),
  })
    .index("by_issue", ["issueId"])
    .index("by_githubCommentId", ["githubCommentId"]),

  // Stocked consumables and spares, optionally tied to a tracked part.
  inventoryItems: defineTable({
    name: v.string(),
    onHandQty: v.number(),
    unitCost: v.optional(v.number()),
    linkedPartId: v.optional(v.id("parts")),
  }),
});
