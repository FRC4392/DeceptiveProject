import { text } from "./untrusted";
// Pure helpers for turning an Onshape assembly definition into a de-duplicated
// list of parts with their true quantities (how many times each part is placed).
// Kept free of Convex/`ctx` so it can be unit-tested against sample JSON.
//
// Shape reference: GET /api/assemblies/d/{did}/{wvm}/{wvmid}/e/{eid} returns a
// `rootAssembly` with `instances` (each a Part or Assembly reference) and
// `occurrences` (every flattened placement, identified by a `path` of instance
// ids), plus `subAssemblies` carrying the instances of nested assemblies.

export type AssemblyInstance = {
  id?: string;
  type?: string; // "Part" | "Assembly"
  name?: string;
  partId?: string;
  documentId?: string;
  elementId?: string;
  isStandardContent?: boolean;
  suppressed?: boolean;
};

export type AssemblyOccurrence = {
  path?: string[];
  hidden?: boolean;
};

export type AssemblyDefinition = {
  rootAssembly?: {
    instances?: AssemblyInstance[];
    occurrences?: AssemblyOccurrence[];
  };
  subAssemblies?: Array<{ instances?: AssemblyInstance[] }>;
};

export type AggregatedAssemblyPart = {
  partId: string;
  sourceElementId: string; // the Part Studio element the part is defined in
  sourceDocumentId: string; // the document that Part Studio lives in
  name: string;
  quantity: number; // number of placements in the assembly
  // Whether the part's source lives in the same document as the assembly, i.e.
  // whether we can enrich it (material/thumbnail) and write its number back.
  sameDocument: boolean;
};

// Drop Onshape's per-instance " <n>" suffix (e.g. "Bracket <3>" → "Bracket").
function stripInstanceSuffix(name?: unknown): string {
  return text(name)
    .replace(/\s*<\d+>\s*$/, "")
    .trim();
}

/**
 * Count each part's placements in an assembly. Instance ids are unique per
 * definition, so a flat id→instance map resolves every occurrence's leaf. Only
 * leaf `Part` occurrences count; standard content (fasteners) and suppressed
 * instances are skipped. Parts are keyed by `elementId:partId` — the same key
 * the Part Studio sync path uses — so both converge on the same tracker rows.
 */
export function aggregateAssemblyParts(
  def: AssemblyDefinition,
  assemblyDocumentId: string,
): AggregatedAssemblyPart[] {
  const root = def.rootAssembly;
  if (!root) return [];

  const byId = new Map<string, AssemblyInstance>();
  for (const inst of root.instances ?? []) {
    if (inst?.id) byId.set(inst.id, inst);
  }
  for (const sub of def.subAssemblies ?? []) {
    for (const inst of sub.instances ?? []) {
      if (inst?.id) byId.set(inst.id, inst);
    }
  }

  const agg = new Map<string, AggregatedAssemblyPart>();
  for (const occ of root.occurrences ?? []) {
    const path = occ.path;
    if (!path || path.length === 0) continue;
    const leaf = byId.get(path[path.length - 1]);
    if (!leaf) continue;
    if (text(leaf.type).toLowerCase() !== "part") continue;
    if (leaf.isStandardContent || leaf.suppressed) continue;
    if (!leaf.partId || !leaf.elementId || !leaf.documentId) continue;

    const key = `${leaf.elementId}:${leaf.partId}`;
    const existing = agg.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      agg.set(key, {
        partId: leaf.partId,
        sourceElementId: leaf.elementId,
        sourceDocumentId: leaf.documentId,
        name: stripInstanceSuffix(leaf.name) || "Onshape part",
        quantity: 1,
        sameDocument: leaf.documentId === assemblyDocumentId,
      });
    }
  }

  return Array.from(agg.values());
}

/** A sub-assembly placed directly inside the assembly that was synced. */
export type AssemblyChild = {
  elementId: string;
  documentId: string;
  name: string;
  /** How many times it's placed at the root. */
  quantity: number;
};

/**
 * The sub-assemblies placed directly in this assembly — one level, not the
 * whole tree. `aggregateAssemblyParts` deliberately flattens sub-assemblies
 * away to count leaf parts; this is the other half, and the two are kept
 * separate so neither has to compromise.
 *
 * Direct instances are the right source here rather than occurrences: a part
 * nested inside a child belongs to that child, and walking occurrences would
 * list it under every ancestor.
 */
export function rootSubAssemblies(
  def: AssemblyDefinition,
  assemblyDocumentId: string,
): AssemblyChild[] {
  const byKey = new Map<string, AssemblyChild>();
  for (const instance of def.rootAssembly?.instances ?? []) {
    if (text(instance.type).toLowerCase() !== "assembly") continue;
    if (instance.suppressed) continue;
    const { elementId, documentId } = instance;
    if (!elementId) continue;
    const key = `${documentId ?? assemblyDocumentId}:${elementId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    byKey.set(key, {
      elementId,
      documentId: documentId ?? assemblyDocumentId,
      name: stripInstanceSuffix(instance.name ?? "Sub-assembly"),
      quantity: 1,
    });
  }
  return Array.from(byKey.values());
}
