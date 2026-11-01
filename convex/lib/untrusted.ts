// Reading JSON somebody else sent.
//
// TypeScript will happily describe an Onshape response as `{ elementType:
// string }` and be wrong about it: the declaration is a guess, and the value
// arrives at runtime however the other end felt like sending it. A real
// release package sent `elementType` as a number, and `(x ?? "").toUpperCase()`
// — which only guards null and undefined — took the whole ingest down.
//
// So: narrow at the boundary, every time, and let the declared type be
// `unknown` so the compiler makes you.

/** The value when it's a non-empty string, else undefined. */
export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The value when it's a string, else "" — for comparisons and `.replace`. */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
