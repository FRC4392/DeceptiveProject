/** Where to go after signing in when there's nowhere better. */
export const HOME = "/";

/**
 * The page someone was trying to reach before being sent to sign in, if it's
 * safe to send them back there.
 *
 * It arrives in the URL, so anyone can write it: only a path inside this app
 * is honoured. "//evil.example" and "/\evil.example" are read by browsers as
 * another site, and a full URL obviously is one, so all of those fall back to
 * home rather than turning the sign-in page into a way to bounce people
 * somewhere else. So does the sign-in page itself, which would loop.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return HOME;
  if (!raw.startsWith("/")) return HOME;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return HOME;
  if (
    raw === "/login" ||
    raw.startsWith("/login?") ||
    raw.startsWith("/login#")
  ) {
    return HOME;
  }
  return raw;
}

/** The sign-in URL that brings someone back to `path` afterwards. */
export function loginPathFor(path: string): string {
  const next = safeNext(path);
  return next === HOME ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
