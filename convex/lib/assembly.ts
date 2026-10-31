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
  /** Whole extra units to build beyond what the robot needs. */
  spares?: number;
  placements: Placement[];
};

export type Demand = {
  /** Whole units of each sub-assembly to build, spares included. */
  units: Map<string, number>;
  /** Parts and bought items, summed over everything that uses them. */
  perRef: Map<string, number>;
};

/**
 * Multiply the tree out.
 *
 * Two end caps in a roller assembly, two roller assemblies on the robot, and
 * the robot needs four end caps. Nobody can hold that in their head past the
 * second level, which is the whole reason for computing it.
 *
 * A sub-assembly's unit count comes from where it is placed, not from a
 * number typed on it — the CAD already says how many, and a second place to
 * state it is a second place to be wrong. Spares are the one hand-entered
 * part, because no model knows you want a roller on the shelf.
 */
export function rollUpDemand(assemblies: DemandAssembly[]): Demand {
  const byId = new Map(assemblies.map((a) => [a.id, a]));

  // Who places each sub-assembly, and how many times.
  const parents = new Map<string, { parentId: string; quantity: number }[]>();
  for (const assembly of assemblies) {
    for (const placement of assembly.placements) {
      if (placement.kind !== "child") continue;
      const list = parents.get(placement.refId) ?? [];
      list.push({
        parentId: assembly.id,
        quantity: Math.max(1, placement.quantity ?? 1),
      });
      parents.set(placement.refId, list);
    }
  }

  const units = new Map<string, number>();
  function unitsOf(id: string, seen: Set<string>): number {
    const already = units.get(id);
    if (already !== undefined) return already;
    // The write path makes loops unreachable; this keeps a bad row from
    // hanging the readout rather than trusting that forever.
    if (seen.has(id)) return 0;
    const assembly = byId.get(id);
    if (!assembly) return 0;

    const placedIn = parents.get(id) ?? [];
    const fromParents = placedIn.reduce(
      (sum, p) => sum + p.quantity * unitsOf(p.parentId, new Set(seen).add(id)),
      0,
    );
    // Nothing places it, so it is a top-level assembly: the robot needs one.
    const total =
      (placedIn.length === 0 ? 1 : fromParents) +
      Math.max(0, assembly.spares ?? 0);
    units.set(id, total);
    return total;
  }
  for (const assembly of assemblies) unitsOf(assembly.id, new Set());

  const perRef = new Map<string, number>();
  for (const assembly of assemblies) {
    const made = units.get(assembly.id) ?? 0;
    for (const placement of assembly.placements) {
      if (placement.kind === "child") continue;
      const each = Math.max(1, placement.quantity ?? 1);
      perRef.set(
        placement.refId,
        (perRef.get(placement.refId) ?? 0) + each * made,
      );
    }
  }
  return { units, perRef };
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
