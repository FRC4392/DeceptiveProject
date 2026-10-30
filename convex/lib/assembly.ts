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
