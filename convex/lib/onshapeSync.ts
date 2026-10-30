// Onshape part/assembly fetch + sync business logic, used by the
// internalAction handlers (trackedElementIds/listElementParts/buildPreview/
// syncElement) that stay in ../onshapeOAuth.ts.
import type { ActionCtx } from "../_generated/server";
import {
  aggregateAssemblyParts,
  rootSubAssemblies,
  type AssemblyChild,
} from "./onshapeAssembly";
import { onshapeFetch } from "./onshapeAuth";
import type { ReleasePackage } from "./onshapeRelease";

const API_BASE = process.env.ONSHAPE_BASE_URL ?? "https://cad.onshape.com";

// Onshape's standard "Part number" metadata property, matched by name so it
// works across enterprise and education schemas.
const PART_NUMBER_PROPERTY = "Part number";

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
export async function fetchElementInfo(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
): Promise<{ elementType: string; name: string }> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/documents/d/${documentId}/${wv}/${wvid}/elements?elementId=${elementId}`,
  );
  if (!res.ok) return { elementType: "", name: "" };
  const json = (await res.json()) as Array<{
    elementType?: string;
    name?: string;
  }>;
  return {
    elementType: json[0]?.elementType ?? "",
    name: json[0]?.name ?? "",
  };
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
): Promise<{
  elementType: string;
  elementName: string;
  children: AssemblyChild[];
  parts: NormalizedPart[];
}> {
  const { elementType, name: elementName } = await fetchElementInfo(
    ctx,
    documentId,
    wv,
    wvid,
    elementId,
  );

  if (elementType === "ASSEMBLY") {
    const def = await fetchAssemblyDefinition(
      ctx,
      documentId,
      wv,
      wvid,
      elementId,
    );
    const aggregated = aggregateAssemblyParts(def, documentId);
    // The sub-assemblies placed directly in here, so the tracker can mirror
    // the CAD's shape rather than one flat list.
    const children = rootSubAssemblies(def, documentId);

    // Enrich same-document parts with name/material from their Part Studio.
    const info = new Map<string, { name: string; material: string | null }>();
    const sameDocElements = new Set(
      aggregated.filter((p) => p.sameDocument).map((p) => p.sourceElementId),
    );
    for (const eid of sameDocElements) {
      try {
        const studioParts = await fetchElementParts(
          ctx,
          documentId,
          wv,
          wvid,
          eid,
        );
        for (const sp of studioParts) {
          info.set(partKey(eid, sp.partId), {
            name: sp.name ?? "Onshape part",
            material: sp.material?.displayName ?? null,
          });
        }
      } catch (err) {
        console.error(
          `Assembly material fetch failed for element ${eid}:`,
          err,
        );
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
    return { elementType, elementName, children, parts };
  }

  // Part Studio (default): each part once, sourced from the element itself.
  const studioParts = await fetchElementParts(
    ctx,
    documentId,
    wv,
    wvid,
    elementId,
  );
  const parts = studioParts.map(
    (p): NormalizedPart => ({
      partId: p.partId,
      name: p.name ?? "Onshape part",
      material: p.material?.displayName ?? null,
      sourceDocumentId: documentId,
      sourceElementId: elementId,
      sameDocument: true,
      quantity: 1,
      enrichable: true,
    }),
  );
  return { elementType, elementName, children: [], parts };
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

/**
 * The "Part number" an assembly element carries in its own metadata — the same
 * property a part has, one level up. This is how a released assembly is matched
 * to the sub-assembly the tracker issued the number to.
 */
export async function fetchElementPartNumberProperty(
  ctx: ActionCtx,
  documentId: string,
  wv: string,
  wvid: string,
  elementId: string,
): Promise<string | null> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/metadata/d/${documentId}/${wv}/${wvid}/e/${elementId}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    properties?: Array<{ name?: string; value?: unknown }>;
  };
  const prop = (json.properties ?? []).find(
    (p) => p.name === PART_NUMBER_PROPERTY,
  );
  return typeof prop?.value === "string" && prop.value.length > 0
    ? prop.value
    : null;
}

/**
 * The whole release package in one call: every released item with its part
 * number, revision and the document/element/version it came from.
 *
 * This is the one read a release webhook needs, and it replaces the per-part
 * metadata walk the panel sync does — one call instead of one per part.
 */
export async function fetchReleasePackage(
  ctx: ActionCtx,
  releasePackageId: string,
  detailed = true,
): Promise<ReleasePackage> {
  const res = await onshapeFetch(
    ctx,
    `${API_BASE}/api/releasepackages/${encodeURIComponent(releasePackageId)}?detailed=${detailed}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? " — reconnect Onshape (Admin → Onshape)."
        : "";
    throw new Error(
      `Onshape release package fetch failed: ${res.status}${body ? ` ${body.slice(0, 200)}` : ""}${hint}`,
    );
  }
  return (await res.json()) as ReleasePackage;
}
