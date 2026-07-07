// Signature verification + payload parsing for ../github.ts's `githubWebhook`
// httpAction.

// Constant-time-ish string compare to blunt signature timing oracles.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify GitHub's HMAC-SHA256 signature (X-Hub-Signature-256) over the raw
// body, using the Web Crypto API available in the default Convex runtime.
export async function verifySignature(
  secret: string,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return safeEqual(`sha256=${hex}`, header);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
