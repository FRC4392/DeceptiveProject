/**
 * The sentence a mutation meant to show you.
 *
 * Convex wraps every server error before it reaches the client:
 *
 *   [CONVEX M(subsystems:setNextNumber)] [Request ID: 0dfc…] Server Error
 *   Uncaught Error: This subsystem is already up to 15… at handler
 *   |../convex/subsystems.ts:275:8| Called by client
 *
 * The part worth reading is in the middle, and it was written for whoever
 * hit it. Throwing `ConvexError` server-side doesn't help on its own — the
 * client builds that wrapper and passes it to the constructor either way —
 * but it does put the clean string on `.data`, so that is tried first and
 * the unwrapping is the fallback.
 */
export function errorText(err: unknown, fallback: string): string {
  if (typeof err !== "object" || err === null) return fallback;

  // ConvexError carries the payload the server threw, unwrapped.
  const data = (err as { data?: unknown }).data;
  if (typeof data === "string" && data.trim().length > 0) return data.trim();

  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string" || message.length === 0) return fallback;
  return unwrap(message) || fallback;
}

function unwrap(message: string): string {
  let out = message;

  // "[CONVEX M(path)] " and any "[Request ID: …] " that follows.
  out = out.replace(/^\s*\[CONVEX [^\]]*\]\s*/, "");
  out = out.replace(/^\s*\[Request ID:[^\]]*\]\s*/, "");
  // Convex's own framing around the thrown message.
  out = out.replace(/^\s*Server Error\s*/i, "");
  out = out.replace(/^\s*Uncaught (?:\w*Error):\s*/, "");

  // Everything from the first stack frame or trailer onwards.
  for (const marker of [
    "\n    at ",
    "\n  at ",
    " at handler",
    "Called by client",
  ]) {
    const cut = out.indexOf(marker);
    if (cut !== -1) out = out.slice(0, cut);
  }
  return out.trim();
}
