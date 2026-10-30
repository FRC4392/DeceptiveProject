/**
 * Turning a release (or a manually typed / CSV-imported stand-in) into board
 * changes. Pure functions so the four cases in the handoff — matched, changed
 * after made, unknown number, removed — can be tested without a database or a
 * single Onshape call.
 */
import { normalizePartNumber } from "./stages";

export type IntakeLineInput = {
  partNumber?: string;
  revision?: string;
  name: string;
  quantity?: number;
};

export type KnownPart = {
  partNumber: string;
  stage: number;
  qtyMade: number;
  revision?: string;
};

export type LineKind = "matched" | "changed" | "unknown" | "removed";

export type ClassifiedLine = IntakeLineInput & {
  kind: LineKind;
  /** Why it landed in this bucket, shown to the lead verbatim. */
  explanation: string;
};

function isNewRevision(line: IntakeLineInput, part: KnownPart): boolean {
  if (!line.revision) return false;
  return line.revision !== part.revision;
}

/**
 * Classify one released item against what the tracker already knows.
 *
 *  - a number we issued, still in design      → matched, it moves along
 *  - a number we issued, re-released, nothing made yet → matched, the drawing
 *    is simply out of date
 *  - a number we issued, re-released, some already made → changed: a lead has
 *    to decide between reworking, remaking and leaving them
 *  - a number we never issued                 → unknown, link it or create it
 */
export function classifyLine(
  line: IntakeLineInput,
  part: KnownPart | undefined,
): ClassifiedLine {
  if (!part) {
    return {
      ...line,
      kind: "unknown",
      explanation: line.partNumber
        ? `${line.partNumber} isn't a number this tracker issued.`
        : "Released without a part number.",
    };
  }
  if (isNewRevision(line, part) && part.qtyMade > 0) {
    return {
      ...line,
      kind: "changed",
      explanation: `${part.qtyMade} were already made from the old version.`,
    };
  }
  if (isNewRevision(line, part) && part.stage === 2) {
    return {
      ...line,
      kind: "matched",
      explanation:
        "Re-released before anyone made it — the drawing is out of date.",
    };
  }
  if (part.stage === 1) {
    return {
      ...line,
      kind: "matched",
      explanation: "Released in Onshape, so it moves out of design.",
    };
  }
  return {
    ...line,
    kind: "matched",
    explanation: "Already on the board; revision and CAD links updated.",
  };
}

/**
 * Everything the tracker holds for a subsystem that the release didn't
 * mention has been deleted from the assembly.
 */
export function findRemoved(
  lines: IntakeLineInput[],
  known: KnownPart[],
): ClassifiedLine[] {
  const released = new Set(
    lines
      .map((l) => (l.partNumber ? normalizePartNumber(l.partNumber) : ""))
      .filter(Boolean),
  );
  return known
    .filter((p) => !released.has(normalizePartNumber(p.partNumber)))
    .map((p) => ({
      partNumber: p.partNumber,
      name: p.partNumber,
      kind: "removed" as const,
      explanation:
        p.stage === 1 && p.qtyMade === 0
          ? "No longer in the assembly and nobody started it."
          : "No longer in the assembly, but work has already gone into it.",
    }));
}

export function classifyRelease(
  lines: IntakeLineInput[],
  known: KnownPart[],
  options: { detectRemoved?: boolean } = {},
): ClassifiedLine[] {
  const byNumber = new Map<string, KnownPart>();
  for (const part of known) {
    byNumber.set(normalizePartNumber(part.partNumber), part);
  }
  const classified = lines.map((line) =>
    classifyLine(
      line,
      line.partNumber
        ? byNumber.get(normalizePartNumber(line.partNumber))
        : undefined,
    ),
  );
  if (options.detectRemoved) {
    classified.push(...findRemoved(lines, known));
  }
  return classified;
}

// ---- CSV ----

const HEADER_ALIASES: Record<string, keyof IntakeLineInput> = {
  "part number": "partNumber",
  partnumber: "partNumber",
  "part #": "partNumber",
  number: "partNumber",
  pn: "partNumber",
  name: "name",
  "part name": "name",
  description: "name",
  title: "name",
  revision: "revision",
  rev: "revision",
  quantity: "quantity",
  qty: "quantity",
  "quantity per": "quantity",
};

/** Split one CSV line, honouring quoted fields with commas inside them. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * Onshape's BOM export column names vary by configuration, so match the header
 * row loosely and ignore everything we don't recognise.
 */
export function parseBomCsv(text: string): IntakeLineInput[] {
  const rows = text
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (rows.length < 2) return [];

  const headers = splitCsvLine(rows[0]).map((h) => h.toLowerCase());
  const columns = headers.map((h) => HEADER_ALIASES[h]);
  if (!columns.includes("partNumber")) return [];

  const lines: IntakeLineInput[] = [];
  for (const row of rows.slice(1)) {
    const cells = splitCsvLine(row);
    const line: IntakeLineInput = { name: "" };
    cells.forEach((cell, i) => {
      const key = columns[i];
      if (!key || cell === "") return;
      if (key === "quantity") {
        const n = Number(cell);
        if (Number.isFinite(n)) line.quantity = n;
      } else {
        line[key] = cell;
      }
    });
    if (!line.partNumber) continue;
    if (!line.name) line.name = line.partNumber;
    lines.push(line);
  }
  return lines;
}

/** "27-INT-104 A" / "27-INT-104, rev A" / one number per line. */
export function parseManualNumbers(text: string): IntakeLineInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [first, ...rest] = line.split(/[,\s]+/);
      const revision = rest
        .join(" ")
        .replace(/^rev\.?\s*/i, "")
        .trim();
      return {
        partNumber: first,
        name: first,
        revision: revision || undefined,
      };
    });
}

// ---- Assemblies ----

/** What the tracker already knows about a sub-assembly it may be looking at. */
export type KnownAssembly = {
  partNumber: string;
  revision?: string;
  /** Someone has already built it. */
  built: boolean;
};

/**
 * Classify a released assembly. Deliberately separate from `classifyLine`:
 * that one branches on a part's stage and how many were made, neither of which
 * an assembly has. The cases that do apply are known, unknown, and changed —
 * re-released after it was already built, which is the assembly's version of
 * "some were already made".
 */
export function classifyAssemblyLine(
  line: IntakeLineInput,
  assembly: KnownAssembly | undefined,
): ClassifiedLine {
  if (!assembly) {
    return {
      ...line,
      kind: "unknown",
      explanation: line.partNumber
        ? `${line.partNumber} isn't a sub-assembly this tracker issued.`
        : "Released without a part number.",
    };
  }
  const movedOn =
    line.revision !== undefined && line.revision !== assembly.revision;
  if (movedOn && assembly.built) {
    return {
      ...line,
      kind: "changed",
      explanation: "It was already built from the old version.",
    };
  }
  return {
    ...line,
    kind: "matched",
    explanation: "Already on the board; revision and CAD links updated.",
  };
}
