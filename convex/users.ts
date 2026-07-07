import { query } from "./_generated/server";
import { v } from "convex/values";

const vUser = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  authId: v.string(),
  email: v.string(),
  name: v.string(),
  role: v.optional(v.union(v.literal("mentor"), v.literal("student"))),
});

// The team roster, used to render assignee pickers and resolve WorkOS
// user ids to names in comments / assignee chips. Small, bounded set.
export const list = query({
  args: {},
  returns: v.array(vUser),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const users = await ctx.db.query("users").collect();
    return users.sort((a, b) => a.name.localeCompare(b.name));
  },
});
