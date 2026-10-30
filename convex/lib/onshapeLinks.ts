/**
 * Deep links into Onshape, built from ids the tracker already holds.
 *
 * Derived rather than stored on purpose: a link costs nothing to build, never
 * goes stale when a sync writes newer ids, and needs no safety check because
 * the app constructs the origin itself. (A drawing link someone pastes in is a
 * different matter — see `isSafeDrawingUrl`.)
 */
const ONSHAPE = "https://cad.onshape.com";

export type OnshapeIds = {
  onshapeDocumentId?: string;
  onshapeVersionId?: string;
  onshapeElementId?: string;
};

export function onshapeElementUrl(ids: OnshapeIds): string | null {
  if (!ids.onshapeDocumentId) return null;
  const base = `${ONSHAPE}/documents/${ids.onshapeDocumentId}`;
  if (ids.onshapeVersionId && ids.onshapeElementId) {
    return `${base}/v/${ids.onshapeVersionId}/e/${ids.onshapeElementId}`;
  }
  return base;
}
