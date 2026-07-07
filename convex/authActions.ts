"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { WorkOS } from "@workos-inc/node";

/**
 * Fetches a user's role from WorkOS and stores it on the local `users`
 * row. Scheduled (fire-and-forget) from the user.created/updated webhook
 * handlers in convex/auth.ts, which run in a mutation context and cannot
 * call external APIs directly.
 *
 * WorkOS Roles are the source of truth. The environment defines a
 * `mentor` and a `student` role (student is the environment default), and
 * each user's role is read from their organization membership. A
 * membership whose role slug is `mentor` grants the mentor role;
 * everything else — including the default `student` role — resolves to
 * "student".
 */
export const syncRoleFromWorkOS = internalAction({
  args: { authId: v.string() },
  returns: v.null(),
  handler: async (ctx, { authId }) => {
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) {
      console.warn("WORKOS_API_KEY not set; skipping role sync");
      return null;
    }
    const workos = new WorkOS(apiKey);
    const role = await deriveRole(workos, authId);
    await ctx.runMutation(internal.auth.setRole, { authId, role });
    return null;
  },
});

async function deriveRole(
  workos: WorkOS,
  authId: string,
): Promise<"mentor" | "student"> {
  try {
    // Read the WorkOS Role assigned to the user's organization membership.
    // Multiple-roles is disabled, so each membership carries a single role;
    // a user could belong to more than one organization, so we treat the
    // presence of a `mentor` role in any membership as mentor. Every other
    // role slug — including the default `student` — maps to "student".
    const memberships = await workos.userManagement.listOrganizationMemberships(
      { userId: authId },
    );
    const isMentor = memberships.data.some(
      (m) => m.role?.slug?.toLowerCase() === "mentor",
    );
    return isMentor ? "mentor" : "student";
  } catch (err) {
    console.error(`Failed to fetch WorkOS role for ${authId}:`, err);
    return "student";
  }
}
