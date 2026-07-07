// Onshape part/assembly fetch + sync business logic, used by the
// internalAction handlers (trackedElementIds/listElementParts/buildPreview/
// syncElement) that stay in ../onshapeOAuth.ts.
import type { ActionCtx } from "../_generated/server";
import { aggregateAssemblyParts } from "./onshapeAssembly";
import { onshapeFetch } from "./onshapeAuth";

const API_BASE = process.env.ONSHAPE_BASE_URL ?? "https://cad.onshape.com";

// Onshape's standard "Part number" metadata property (matched by name so it
// works across enterprise/education schemas). Standard iso orientation is used
// for the shaded-view preview.
const PART_NUMBER_PROPERTY = "Part number";
const ISO_VIEW_MATRIX = "0.707,0.707,0,0,-0.408,0.408,0.816,0,0.577,-0.577,0.577,0";

type OnshapePart = {
  partId: string;
  name?: string;
  material?: { displayName?: string } | null;
};

export async function fetchElementParts(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
): Promise<OnshapePart[]> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/parts/d/${documentId}/${wv}/${wvid}/e/${elementId}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? " — reconnect Onshape (Admin → Onshape)."
        : "";
    throw new Error(
      `Onshape parts fetch failed: ${res.status}${body ? ` ${body.slice(0, 200)}` : ""}${hint}`,
    );
  }
  return (await res.json()) as OnshapePart[];
}

// Determine whether an element is a Part Studio or an Assembly, so the sync
// surfaces can branch. Returns the raw Onshape elementType ("PARTSTUDIO",
// "ASSEMBLY", …) or "" if it can't be resolved (treated as a Part Studio).
export async function fetchElementType(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
): Promise<string> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/documents/d/${documentId}/${wv}/${wvid}/elements?elementId=${elementId}`,
  );
  if (!res.ok) return "";
  const json = (await res.json()) as Array<{ elementType?: string }>;
  return json[0]?.elementType ?? "";
}

// The full assembly definition — its instances and flattened occurrences drive
// the per-part quantity counting in `aggregateAssemblyParts`.
async function fetchAssemblyDefinition(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
): Promise<Parameters<typeof aggregateAssemblyParts>[0]> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/assemblies/d/${documentId}/${wv}/${wvid}/e/${elementId}?excludeSuppressed=true`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? " — reconnect Onshape (Admin → Onshape)."
        : "";
    throw new Error(
      `Onshape assembly fetch failed: ${res.status}${body ? ` ${body.slice(0, 200)}` : ""}${hint}`,
    );
  }
  return (await res.json()) as Parameters<typeof aggregateAssemblyParts>[0];
}

// A part to sync, normalized across both element types. For a Part Studio the
// source is the element itself and quantity is 1; for an Assembly the source is
// the part's owning Part Studio and quantity is its placement count. `enrichable`
// is true when the source lives in the same document as the opened element, i.e.
// when we can read its metadata/thumbnail and write its part number back.
type NormalizedPart = {
  partId: string;
  name: string;
  material: string | null;
  sourceDocumentId: string;
  sourceElementId: string;
  sameDocument: boolean;
  quantity: number;
  enrichable: boolean;
};

// The stable key a part is tracked under (also its `onshapeElementId`). Composite
// so parts sharing a partId across different source Part Studios stay distinct.
export function partKey(sourceElementId: string, partId: string): string {
  return `${sourceElementId}:${partId}`;
}

// Resolve the parts to sync for an element, branching on its type. Assemblies are
// counted via `aggregateAssemblyParts`; same-document parts additionally get their
// name/material from the owning Part Studio (one `fetchElementParts` per element).
export async function resolveSyncParts(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
): Promise<{ elementType: string; parts: NormalizedPart[] }> {
  const elementType = await fetchElementType(ctx, documentId, wv, wvid, elementId);

  if (elementType === "ASSEMBLY") {
    const def = await fetchAssemblyDefinition(ctx, documentId, wv, wvid, elementId);
    const aggregated = aggregateAssemblyParts(def, documentId);

    // Enrich same-document parts with name/material from their Part Studio.
    const info = new Map<string, { name: string; material: string | null }>();
    const sameDocElements = new Set(
      aggregated.filter((p) => p.sameDocument).map((p) => p.sourceElementId),
    );
    for (const eid of sameDocElements) {
      try {
        const studioParts = await fetchElementParts(ctx, documentId, wv, wvid, eid);
        for (const sp of studioParts) {
          info.set(partKey(eid, sp.partId), {
            name: sp.name ?? "Onshape part",
            material: sp.material?.displayName ?? null,
          });
        }
      } catch (err) {
        console.error(`Assembly material fetch failed for element ${eid}:`, err);
      }
    }

    const parts = aggregated.map((p): NormalizedPart => {
      const enriched = info.get(partKey(p.sourceElementId, p.partId));
      return {
        partId: p.partId,
        name: enriched?.name ?? p.name,
        material: enriched?.material ?? null,
        sourceDocumentId: p.sourceDocumentId,
        sourceElementId: p.sourceElementId,
        sameDocument: p.sameDocument,
        quantity: p.quantity,
        enrichable: p.sameDocument,
      };
    });
    return { elementType, parts };
  }

  // Part Studio (default): each part once, sourced from the element itself.
  const studioParts = await fetchElementParts(ctx, documentId, wv, wvid, elementId);
  const parts = studioParts.map((p): NormalizedPart => ({
    partId: p.partId,
    name: p.name ?? "Onshape part",
    material: p.material?.displayName ?? null,
    sourceDocumentId: documentId,
    sourceElementId: elementId,
    sameDocument: true,
    quantity: 1,
    enrichable: true,
  }));
  return { elementType, parts };
}

// Read a part's current "Part number" metadata property, returning both its id
// (needed to write back) and current value. null if the property isn't present.
export async function fetchPartNumberProperty(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
  partId: string,
): Promise<{ propertyId: string; value: string } | null> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/metadata/d/${documentId}/${wv}/${wvid}/e/${elementId}/p/${encodeURIComponent(partId)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    properties?: Array<{ propertyId: string; name?: string; value?: unknown }>;
  };
  const prop = (json.properties ?? []).find(
    (p) => p.name === PART_NUMBER_PROPERTY,
  );
  if (!prop) return null;
  return {
    propertyId: prop.propertyId,
    value: typeof prop.value === "string" ? prop.value : "",
  };
}

// Write a part number back into Onshape metadata. Workspace-only (versions are
// immutable) and requires the OAuth app to hold write scope.
export async function writePartNumber(
  ctx: ActionCtx,
  documentId: string,
  workspaceId: string,
  elementId: string,
  partId: string,
  propertyId: string,
  value: string,
): Promise<boolean> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${encodeURIComponent(partId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonType: "metadata-part",
        partId,
        properties: [{ propertyId, value }],
      }),
    },
  );
  return res.ok;
}

// Fetch a part's shaded-view PNG as a base64 string (Onshape's native format).
export async function fetchShadedViewBase64(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
  partId: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    outputWidth: "300",
    outputHeight: "300",
    pixelSize: "0",
    viewMatrix: ISO_VIEW_MATRIX,
  });
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/parts/d/${documentId}/${wv}/${wvid}/e/${elementId}/partid/${encodeURIComponent(partId)}/shadedviews?${params.toString()}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { images?: string[] };
  return json.images?.[0] ?? null;
}

// A shaded-view PNG as a Blob, for storage as the part thumbnail.
export async function fetchPartPreview(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
  partId: string,
): Promise<Blob | null> {
  const b64 = await fetchShadedViewBase64(
    ctx,
    documentId,
    wv,
    wvid,
    elementId,
    partId,
  );
  if (!b64) return null;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}
