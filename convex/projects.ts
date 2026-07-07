import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMentor } from "./lib/auth";

// A project's numbering mode: auto-generate 4392-<tag>-DDSSSS, or leave part
// numbers to Onshape / manual entry.
export const numberingModeValidator = v.union(
  v.literal("auto"),
  v.literal("manual"),
);

const vProject = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  name: v.string(),
  tag: v.string(),
  numberingMode: numberingModeValidator,
  archived: v.optional(v.boolean()),
});

export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  returns: v.array(vProject),
  handler: async (ctx, { includeArchived }) => {
    const projects = await ctx.db.query("projects").collect();
    const visible = includeArchived
      ? projects
      : projects.filter((p) => !p.archived);
    return visible.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// A project tag must be unique — two projects sharing a tag would produce
// colliding part numbers.
async function tagTaken(
  ctx: MutationCtx,
  tag: string,
  exceptId?: Id<"projects">,
): Promise<boolean> {
  const matches = await ctx.db
    .query("projects")
    .withIndex("by_tag", (q) => q.eq("tag", tag))
    .collect();
  return matches.some((p) => p._id !== exceptId);
}

export const create = mutation({
  args: {
    name: v.string(),
    tag: v.string(),
    numberingMode: numberingModeValidator,
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    await requireMentor(ctx);
    const tag = args.tag.trim();
    if (!tag) throw new Error("Project tag is required.");
    if (await tagTaken(ctx, tag)) {
      throw new Error(`Tag "${tag}" is already used by another project.`);
    }
    return ctx.db.insert("projects", {
      name: args.name.trim(),
      tag,
      numberingMode: args.numberingMode,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    tag: v.optional(v.string()),
    numberingMode: v.optional(numberingModeValidator),
    archived: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMentor(ctx);
    const patch: Partial<Doc<"projects">> = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.tag !== undefined) {
      const tag = args.tag.trim();
      if (!tag) throw new Error("Project tag is required.");
      if (await tagTaken(ctx, tag, args.id)) {
        throw new Error(`Tag "${tag}" is already used by another project.`);
      }
      patch.tag = tag;
    }
    if (args.numberingMode !== undefined) patch.numberingMode = args.numberingMode;
    if (args.archived !== undefined) patch.archived = args.archived;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireMentor(ctx);
    // Don't orphan parts — require them reassigned/removed first.
    const part = await ctx.db
      .query("parts")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .take(1);
    if (part.length > 0) {
      throw new Error("Reassign or delete this project's parts before deleting it.");
    }
    // Detach any documents that pointed at it.
    const docs = await ctx.db.query("onshapeDocuments").collect();
    for (const d of docs) {
      if (d.projectId === id) await ctx.db.patch(d._id, { projectId: undefined });
    }
    await ctx.db.delete(id);
    return null;
  },
});
