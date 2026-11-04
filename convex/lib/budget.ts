/**
 * What the budget mode actually stops.
 *
 * The team gets about 2,500 successful Onshape calls a year. A meter that
 * only reports the number is a thermometer in a burning room, so every call
 * declares what it's for and this decides whether the current mode allows it.
 *
 * The split that matters isn't read-versus-write — the app never writes to
 * Onshape — it's cheap-and-automatic versus expensive-and-discretionary:
 *
 * - `release` is the webhook path: one call, triggered by a release actually
 *   happening, and the thing the whole integration exists for.
 * - `sync` is the right-panel pull: one call per part, triggered by whoever
 *   opened the panel. On a forty-part assembly it costs forty times what a
 *   release does for the same information.
 * - `bom` is reading what a released assembly contains, one call per
 *   assembly on top of the release's own. It rides in on a release nobody
 *   asked for, so it is held to the panel's standard rather than the
 *   release's: worth it while there is room, never worth it when there isn't.
 * - `admin` is registering or removing the webhook.
 *
 * Pure so the policy can be read in one place and tested without a database.
 */

export type BudgetMode = "normal" | "lean" | "manual";
export type CallPurpose = "release" | "sync" | "bom" | "admin";

export function isCallAllowed(mode: BudgetMode, purpose: CallPurpose): boolean {
  switch (purpose) {
    case "release":
      return mode !== "manual";
    case "sync":
      return mode === "normal";
    case "bom":
      // An extra call per assembly, and the release is already in without it.
      return mode === "normal";
    case "admin":
      // Allowed even in Manual, deliberately. Turning the integration off is
      // how a mentor stops it spending; refusing the one call that does it
      // would trap the team in the mode they're trying to escape.
      return true;
  }
}

/**
 * Why a call was refused, written for the person who tried it rather than for
 * a log. Each one says what to do instead, because there is always something.
 */
export function blockedReason(
  mode: BudgetMode,
  purpose: CallPurpose,
): string | null {
  if (isCallAllowed(mode, purpose)) return null;
  if (purpose === "bom") {
    return "Onshape isn't in normal mode, so the release came in without reading what each assembly contains. Open the panel on it when there's budget again, or set the quantities by hand.";
  }
  if (purpose === "sync") {
    return mode === "manual"
      ? "Onshape is in manual mode — the tracker isn't making any calls. Type the numbers in or upload a BOM under New from Onshape; both cost nothing."
      : "Onshape is in lean mode, so syncing a whole element by hand is off — it costs a call per part. Releases still come in on their own, and typing numbers in costs nothing.";
  }
  return "Onshape is in manual mode — the release is queued and nothing was read. Press Reconcile under New from Onshape when there's budget again.";
}

/** The mode a share of remaining allowance puts the app in. */
export function modeForShare(
  share: number,
  leanThreshold: number,
  manualThreshold: number,
): BudgetMode {
  if (share < manualThreshold) return "manual";
  if (share < leanThreshold) return "lean";
  return "normal";
}

/**
 * How long to wait before each retry of a 429, in milliseconds. Three retries,
 * doubling — Onshape's per-endpoint limits are short windows, so this is about
 * riding out a burst rather than waiting out the year.
 */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

/** Onshape's "you have spent the year's allowance" status. */
export const BUDGET_EXHAUSTED_STATUS = 402;
export const RATE_LIMITED_STATUS = 429;

/**
 * When the current year's allowance began, or null to count every call ever
 * made — which is what happens until someone says when it renews.
 *
 * The allowance renews on the same date every year, so `renewalDate` is read
 * as that date and the period starts at its most recent anniversary that
 * isn't in the future. That gives the right answer whether a mentor typed in
 * the date it last renewed or the date it next will, and it rolls over on its
 * own each year with nobody having to remember to change it.
 *
 * In UTC, the time zone Convex runs in. A 29 February renewal falls on
 * 1 March in the years without one.
 */
export function allowancePeriodStart(
  renewalDate: number | null,
  now: number,
): number | null {
  if (renewalDate === null) return null;
  const renews = new Date(renewalDate);
  const at = (year: number) =>
    Date.UTC(
      year,
      renews.getUTCMonth(),
      renews.getUTCDate(),
      renews.getUTCHours(),
      renews.getUTCMinutes(),
    );
  const thisYear = new Date(now).getUTCFullYear();
  const candidate = at(thisYear);
  return candidate <= now ? candidate : at(thisYear - 1);
}
