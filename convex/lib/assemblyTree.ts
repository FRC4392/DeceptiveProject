// Laying the sub-assembly graph out as a tree for the subsystem page.
//
// Pure, and separate from the readiness rules in ./assembly, because this is
// only about what goes where on screen. Two things make it more than a map:
// a sub-assembly can sit in several parents, and the graph can contain a loop
// that the editor refused but older data might still hold.

/** The shape `subAssemblies.list` returns, narrowed to what layout needs. */
export type TreeRow = {
  id: string;
  /** The subsystem's own {YY}-{SUB}-000. It has no parent by right. */
  isDefault?: boolean;
  childIds: string[];
  /** Per-member counts, present only where the count isn't one. */
  quantities?: { refId: string; quantity: number }[];
};

export type TreeNode = {
  id: string;
  depth: number;
  /**
   * Where it sits, not what it is. A sub-assembly in two parents appears
   * twice, so the id alone can't key a row.
   */
  path: string;
  /** How many of it this parent takes. Absent at a root. */
  quantity?: number;
  /** Nothing holds it, and it isn't the subsystem's own 000. */
  orphan: boolean;
  children: TreeNode[];
};

// Deep enough for any real robot, shallow enough to stop a pathological
// chain. Matches MAX_DEPTH in ./assembly.
const MAX_DEPTH = 20;

function quantityOf(row: TreeRow, childId: string): number | undefined {
  return row.quantities?.find((q) => q.refId === childId)?.quantity;
}

/**
 * The roots of the tree, each with its children nested beneath it.
 *
 * Shared children are repeated under every parent that holds one — the data
 * says a roller is in both the main assembly and the spare, and a readout
 * that shows it once disagrees with the thing it's describing. A loop is cut
 * where it closes: the guard is the chain of ancestors on the current branch,
 * not everything already drawn, which is what let sharing through.
 */
export function buildAssemblyTree(rows: TreeRow[]): TreeNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const held = new Set<string>();
  for (const row of rows) {
    for (const childId of row.childIds) held.add(childId);
  }

  // Which rows actually made it onto the tree, so anything stranded in a loop
  // can still be shown rather than vanishing.
  const drawn = new Set<string>();

  const walk = (
    row: TreeRow,
    depth: number,
    path: string,
    ancestors: Set<string>,
  ): TreeNode => {
    drawn.add(row.id);
    const children: TreeNode[] = [];
    if (depth < MAX_DEPTH) {
      row.childIds.forEach((childId, i) => {
        const child = byId.get(childId);
        // A deleted child, or one that would close a loop back onto this
        // branch. Other branches may still legitimately hold it.
        if (!child || ancestors.has(childId)) return;
        children.push(
          walk(
            child,
            depth + 1,
            `${path}/${i}:${childId}`,
            new Set(ancestors).add(row.id),
          ),
        );
      });
    }
    return {
      id: row.id,
      depth,
      path,
      quantity: undefined,
      orphan: !held.has(row.id) && row.isDefault !== true,
      children,
    };
  };

  const roots = rows
    .filter((row) => !held.has(row.id))
    .map((row) => walk(row, 0, row.id, new Set()));

  // Anything only reachable through a loop still belongs on screen.
  for (const row of rows) {
    if (!drawn.has(row.id)) roots.push(walk(row, 0, row.id, new Set()));
  }

  // The per-placement count belongs to the edge, so it's stamped on from the
  // parent rather than read off the child.
  const stamp = (parent: TreeRow, nodes: TreeNode[]) => {
    for (const node of nodes) {
      node.quantity = quantityOf(parent, node.id);
      const row = byId.get(node.id);
      if (row) stamp(row, node.children);
    }
  };
  for (const root of roots) {
    const row = byId.get(root.id);
    if (row) stamp(row, root.children);
  }

  return roots;
}

/** Every node, depth-first, for callers that would rather have a flat list. */
export function flattenAssemblyTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenAssemblyTree(node.children)]);
}
