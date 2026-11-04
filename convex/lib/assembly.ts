/**
 * "Can we build it yet?" — whether each sub-assembly can be put together.
 *
 * A sub-assembly is ready when every part in it is in the bin, every bought
 * item has arrived, and every sub-assembly inside it has actually been built.
 * That last rule is the physical one: you can't bolt in a gearbox that is
 * still a pile of parts.
 *
 * Pure, and flat in and flat out — the screens build the tree, this doesn't
 * need one — so the readout and its tests share it with the server.
 */

export type AssemblyMember =
  | { kind: "part"; label: string; stageLabel: string; ready: boolean }
  | { kind: "cots"; label: string; stageLabel: string; ready: boolean }
  /** Another sub-assembly inside this one. `ready` means it has been built. */
  | {
      kind: "child";
      label: string;
      stageLabel: string;
      ready: boolean;
      childId: string;
    };

export type AssemblyInput = {
  id: string;
  /** {YY}-{SUB}-NNN */
  number: string;
  name: string;
  order: number;
  /** Someone has said this is built and on the robot. */
  completed?: boolean;
  /** Parts and bought items. Children come from `childIds`. */
  members: AssemblyMember[];
  childIds?: string[];
};

export type AssemblyStatus = {
  id: string;
  /** Everything it needs is here (or it's already built). */
  ready: boolean;
  done: boolean;
  /** What's holding it up, parts and unbuilt children alike. */
  blocking: AssemblyMember[];
};

/** The stage a part has to reach before it counts as ready to assemble. */
export const READY_STAGE = 5;

/** The stage a part lands on once its sub-assembly is built. */
export const ASSEMBLED_STAGE = 6;

/** How deep the tree is allowed to go before we stop walking it. */
const MAX_DEPTH = 20;

/** Only http(s) links are allowed through to an `href`. */
export function isSafeDrawingUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function computeAssemblyStatuses(
  assemblies: AssemblyInput[],
): AssemblyStatus[] {
  const byId = new Map(assemblies.map((a) => [a.id, a]));
  const resolved = new Map<string, AssemblyStatus>();

  function resolve(assembly: AssemblyInput, seen: Set<string>): AssemblyStatus {
    const already = resolved.get(assembly.id);
    if (already) return already;

    // One that's already built is done with, whatever its parts say now — and
    // it stops holding up whatever it sits inside.
    if (assembly.completed) {
      const status: AssemblyStatus = {
        id: assembly.id,
        ready: true,
        done: true,
        blocking: [],
      };
      resolved.set(assembly.id, status);
      return status;
    }

    const blocking = assembly.members.filter((member) => !member.ready);

    for (const childId of assembly.childIds ?? []) {
      const child = byId.get(childId);
      // A child that has been deleted is ignored rather than fatal, and one
      // that closes a loop is skipped so the readout renders instead of
      // hanging. The write path makes loops unreachable anyway.
      if (!child || seen.has(childId)) continue;
      const childStatus = resolve(child, new Set(seen).add(assembly.id));
      if (!childStatus.done) {
        blocking.push({
          kind: "child",
          childId,
          label: `${child.number} ${child.name}`,
          stageLabel: "not built yet",
          ready: false,
        });
      }
    }

    const status: AssemblyStatus = {
      id: assembly.id,
      ready: blocking.length === 0,
      done: false,
      blocking,
    };
    resolved.set(assembly.id, status);
    return status;
  }

  return assemblies.map((a) => resolve(a, new Set([a.id])));
}

// ---- Building the readiness input from what the database holds ----

/** The member ids of one sub-assembly, however the caller came by them. */
export type MemberRefs = {
  partIds: string[];
  cotsItemIds: string[];
  childIds: string[];
};

/** A `subAssemblyMembers` row, narrowed. Exactly one of the three ids is set. */
export type MemberRow = {
  subAssemblyId: string;
  partId?: string;
  cotsItemId?: string;
  childSubAssemblyId?: string;
};

/**
 * Group member rows by the sub-assembly holding them, in one pass. Callers
 * used to filter the whole table once per assembly, which reads every row
 * once for every assembly in the season.
 */
export function groupMemberRefs(
  rows: readonly MemberRow[],
): Map<string, MemberRefs> {
  const out = new Map<string, MemberRefs>();
  for (const row of rows) {
    let refs = out.get(row.subAssemblyId);
    if (!refs) {
      refs = { partIds: [], cotsItemIds: [], childIds: [] };
      out.set(row.subAssemblyId, refs);
    }
    if (row.partId !== undefined) refs.partIds.push(row.partId);
    else if (row.cotsItemId !== undefined)
      refs.cotsItemIds.push(row.cotsItemId);
    else if (row.childSubAssemblyId !== undefined) {
      refs.childIds.push(row.childSubAssemblyId);
    }
  }
  return out;
}

/** Just enough of a part to decide whether it's in the bin. */
export type PartFacts = { partNumber: string; stage: number };
/** Just enough of a bought item to decide whether it's here. */
export type CotsFacts = { name: string; status: string };

/** Just enough of a sub-assembly to label it and know if it's built. */
export type AssemblyHeader = {
  id: string;
  number: string;
  name: string;
  order: number;
  completed: boolean;
};

/**
 * One sub-assembly as the readiness rules want it: its parts, its bought items
 * and the sub-assemblies inside it.
 *
 * The one place that decides a bought item which hasn't arrived holds a build
 * up. The dashboard used to build this itself and left bought items out
 * altogether, so an assembly waiting on a motor counted as ready to build
 * while the Done button, correctly, refused it.
 *
 * A member that isn't in the lookups — deleted, or from another season —
 * blocks, rather than quietly counting as there.
 */
export function buildAssemblyInput(
  header: AssemblyHeader,
  refs: MemberRefs | undefined,
  parts: ReadonlyMap<string, PartFacts>,
  cots: ReadonlyMap<string, CotsFacts>,
): AssemblyInput {
  return {
    id: header.id,
    number: header.number,
    name: header.name,
    order: header.order,
    completed: header.completed,
    childIds: refs?.childIds ?? [],
    members: [
      ...(refs?.partIds ?? []).map((id) => {
        const part = parts.get(id);
        return {
          kind: "part" as const,
          label: part?.partNumber ?? "a part",
          stageLabel: "not in the bin yet",
          ready: (part?.stage ?? 0) >= READY_STAGE,
        };
      }),
      ...(refs?.cotsItemIds ?? []).map((id) => {
        const item = cots.get(id);
        return {
          kind: "cots" as const,
          label: item?.name ?? "a bought item",
          stageLabel: item?.status ?? "needed",
          ready: item?.status === "arrived",
        };
      }),
    ],
  };
}

/** One line of why it can't go together yet. */
export function blockingSummary(status: AssemblyStatus, limit = 3): string {
  if (status.done) return "Built and on the robot.";
  if (status.ready) return "Everything's in the bin.";
  const items = status.blocking
    .slice(0, limit)
    .map((member) => `${member.label} ${member.stageLabel}`)
    .join(" · ");
  const more =
    status.blocking.length > limit
      ? ` · +${status.blocking.length - limit} more`
      : "";
  return `${items}${more}`;
}

/**
 * Would putting `childId` inside `parentId` make a loop? Walks down from the
 * child collecting what's already inside it; if the parent turns up there, or
 * the two are the same, the answer is yes.
 *
 * `edges` maps a sub-assembly to the ones directly inside it.
 */
export function wouldCycle(
  parentId: string,
  childId: string,
  edges: Map<string, string[]>,
): boolean {
  if (parentId === childId) return true;
  const queue = [...(edges.get(childId) ?? [])];
  const seen = new Set<string>([childId]);
  let depth = 0;
  while (queue.length > 0 && depth < MAX_DEPTH * MAX_DEPTH) {
    depth++;
    const next = queue.shift()!;
    if (next === parentId) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(edges.get(next) ?? []));
  }
  return false;
}

// ---- How many of everything the robot actually needs ----

/**
 * One thing placed inside a sub-assembly, and how many of it.
 *
 * `refId` is a part, a bought item or another sub-assembly. The same ref can
 * appear in several assemblies — two roller assemblies sharing an end cap is
 * the ordinary case, not a mistake — which is why demand has to be added up
 * rather than read off any one of them.
 */
export type Placement = {
  refId: string;
  kind: "part" | "cots" | "child";
  /** Placements in this assembly. Missing means one. */
  quantity?: number;
};

export type DemandAssembly = {
  id: string;
  /** How many go on the robot. Missing means one. */
  needed?: number;
  /** Whole extra units to build beyond that. */
  spares?: number;
  placements: Placement[];
};

export type Demand = {
  /** Whole units of each sub-assembly to build, spares included. */
  units: Map<string, number>;
  /** Parts and bought items, summed over everything that uses them. */
  perRef: Map<string, number>;
  /** The same sum, split by which assembly asked for it. */
  perRefByAssembly: Map<string, Map<string, number>>;
};

/** How many whole units of one sub-assembly get built. */
export function unitsOf(assembly: DemandAssembly): number {
  return (
    Math.max(1, Math.round(assembly.needed ?? 1)) +
    Math.max(0, Math.round(assembly.spares ?? 0))
  );
}

/**
 * Multiply the tree out.
 *
 * Two end caps in a roller, two rollers to build, and that's four end caps.
 * Nobody holds that in their head past the second level, which is the whole
 * reason for computing it.
 *
 * How many of a sub-assembly get built is stated on the assembly rather than
 * inferred from where it sits. Inferring it read well until an assembly was
 * placed somewhere its count shouldn't follow from — and a number the team
 * can't type is a number they can't correct. `findUnderbuilt` is the safety
 * net that catches the two disagreeing.
 */
export function rollUpDemand(assemblies: DemandAssembly[]): Demand {
  const units = new Map<string, number>();
  for (const assembly of assemblies) {
    units.set(assembly.id, unitsOf(assembly));
  }

  const perRef = new Map<string, number>();
  const perRefByAssembly = new Map<string, Map<string, number>>();
  for (const assembly of assemblies) {
    const made = units.get(assembly.id) ?? 1;
    for (const placement of assembly.placements) {
      if (placement.kind === "child") continue;
      const total = Math.max(1, placement.quantity ?? 1) * made;
      perRef.set(placement.refId, (perRef.get(placement.refId) ?? 0) + total);
      const byAssembly =
        perRefByAssembly.get(placement.refId) ?? new Map<string, number>();
      byAssembly.set(assembly.id, (byAssembly.get(assembly.id) ?? 0) + total);
      perRefByAssembly.set(placement.refId, byAssembly);
    }
  }
  return { units, perRef, perRefByAssembly };
}

/**
 * How many of `refId` this assembly may take, given what everything else has
 * already spoken for. The cap is per placement, not per unit — the editor
 * asks "how many does one of these use", so the allowance has to be divided
 * back down by how many of this assembly get built.
 */
export function remainingFor(
  demand: Demand,
  refId: string,
  assemblyId: string,
  planned: number,
): number {
  const byAssembly = demand.perRefByAssembly.get(refId);
  const usedElsewhere = Array.from(byAssembly ?? []).reduce(
    (sum, [id, qty]) => (id === assemblyId ? sum : sum + qty),
    0,
  );
  const units = Math.max(1, demand.units.get(assemblyId) ?? 1);
  return Math.max(0, Math.floor((planned - usedElsewhere) / units));
}

export type Underbuilt = {
  assemblyId: string;
  /** Times it is placed inside others, multiplied out. */
  placed: number;
  /** Units it is set to build. */
  building: number;
};

/**
 * Sub-assemblies that other assemblies ask for more of than are being built.
 * Since the build count is typed in rather than derived, this is what stops
 * the two quietly disagreeing.
 */
export function findUnderbuilt(assemblies: DemandAssembly[]): Underbuilt[] {
  const units = new Map(assemblies.map((a) => [a.id, unitsOf(a)]));
  const placed = new Map<string, number>();
  for (const assembly of assemblies) {
    const made = units.get(assembly.id) ?? 1;
    for (const placement of assembly.placements) {
      if (placement.kind !== "child") continue;
      placed.set(
        placement.refId,
        (placed.get(placement.refId) ?? 0) +
          Math.max(1, placement.quantity ?? 1) * made,
      );
    }
  }
  const out: Underbuilt[] = [];
  for (const [assemblyId, wanted] of placed) {
    const building = units.get(assemblyId);
    if (building === undefined || building >= wanted) continue;
    out.push({ assemblyId, placed: wanted, building });
  }
  return out.sort((a, b) => b.placed - b.building - (a.placed - a.building));
}

export type Shortfall = {
  refId: string;
  /** What the tree adds up to. */
  needed: number;
  /** What the part or bought item is set to produce. */
  planned: number;
};

/**
 * Where the plan doesn't cover the robot. This is the number worth showing a
 * lead: a part set to 4 that four assemblies each want two of is a problem
 * three weeks before anyone would otherwise notice.
 */
export function findShortfalls(
  demand: Demand,
  planned: Map<string, number>,
): Shortfall[] {
  const out: Shortfall[] = [];
  for (const [refId, needed] of demand.perRef) {
    const have = planned.get(refId);
    if (have === undefined || have >= needed) continue;
    out.push({ refId, needed, planned: have });
  }
  return out.sort((a, b) => b.needed - b.planned - (a.needed - a.planned));
}
