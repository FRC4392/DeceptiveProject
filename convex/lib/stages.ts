/**
 * The stage model: the one place that knows what the six stages mean, which
 * one comes next, and who is allowed to move a part there.
 *
 * Deliberately free of Convex imports so both sides read the same rules — the
 * server functions import it for enforcement, the React screens for labels and
 * for disabling buttons before the user presses them.
 */

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type Role = "student" | "lead" | "mentor" | "admin";

/** Processes decide which stages a part skips. */
export type ProcessShape = {
  needsDrawing: boolean;
  needsFinishing: boolean;
  machineId?: string | null;
};

export const STAGES: {
  stage: Stage;
  label: string;
  /** The column blurb: what this stage means. */
  blurb: string;
  /** The column hint: what moves a part out of it. */
  movesOn: string;
}[] = [
  {
    stage: 1,
    label: "In design",
    blurb: "CAD in progress.",
    movesOn: "Moves on when the designer releases it in Onshape.",
  },
  {
    stage: 2,
    label: "Needs drawing",
    blurb: "Make the drawing, DXF or toolpath.",
    movesOn: "Moves on when a lead checks it.",
  },
  {
    stage: 3,
    label: "Ready to make",
    blurb: "Up for grabs on a machine.",
    movesOn: "Anyone trained on the machine can claim it.",
  },
  {
    stage: 4,
    label: "Ready to finish",
    blurb: "Deburr, tap, countersink, powder coat.",
    movesOn: "Moves on when the finishing is done.",
  },
  {
    stage: 5,
    label: "Ready to assemble",
    blurb: "Bagged and in the subsystem bin.",
    movesOn: "Moves on when it goes on the robot.",
  },
  {
    stage: 6,
    label: "Assembled",
    blurb: "On the robot.",
    movesOn: "",
  },
];

export const STAGE_COUNT = 6;

/** Stages are stored as plain numbers; this is the one place that narrows them. */
export function asStage(stage: number): Stage {
  return Math.min(6, Math.max(1, Math.round(stage))) as Stage;
}

export function stageMeta(stage: Stage) {
  return STAGES[stage - 1];
}

export function stageLabel(stage: Stage): string {
  return stageMeta(stage).label;
}

/** "3. Ready to make" — the numbered form used on cards and chips. */
export function stageNumberedLabel(stage: Stage): string {
  return `${stage}. ${stageLabel(stage)}`;
}

/**
 * Whether a process skips a stage entirely. A 3D print has no drawing to
 * check; a part with no finishing goes from the machine straight to the bin.
 */
export function isStageSkipped(stage: Stage, process: ProcessShape): boolean {
  if (stage === 2) return !process.needsDrawing;
  if (stage === 4) return !process.needsFinishing;
  return false;
}

/** The stages this part actually passes through, in order. */
export function stagePath(process: ProcessShape): Stage[] {
  return STAGES.map((s) => s.stage).filter((s) => !isStageSkipped(s, process));
}

/** The next stage a part moves to, skipping whatever its process skips. */
export function nextStage(stage: Stage, process: ProcessShape): Stage | null {
  for (let s = stage + 1; s <= STAGE_COUNT; s++) {
    if (!isStageSkipped(s as Stage, process)) return s as Stage;
  }
  return null;
}

export function previousStage(
  stage: Stage,
  process: ProcessShape,
): Stage | null {
  for (let s = stage - 1; s >= 1; s--) {
    if (!isStageSkipped(s as Stage, process)) return s as Stage;
  }
  return null;
}

/** The wording on the one big button, e.g. "Done making → Ready to finish". */
const ADVANCE_VERB: Record<Stage, string> = {
  1: "Released in CAD",
  2: "Drawing checked",
  3: "Done making",
  4: "Finishing done",
  5: "Installed on robot",
  6: "",
};

export function advanceLabel(
  stage: Stage,
  process: ProcessShape,
): string | null {
  const next = nextStage(stage, process);
  if (next === null) return null;
  return `${ADVANCE_VERB[stage]} → ${stageLabel(next)}`;
}

/** What the person at this stage is actually meant to do. */
const STAGE_TASK: Record<Stage, string> = {
  1: "Design it in Onshape and release it",
  2: "Make the drawing, DXF or toolpath",
  3: "Make it",
  4: "Deburr, tap and finish it",
  5: "Put it on the robot",
  6: "Done — it's on the robot",
};

export function stageTask(stage: Stage, machineName?: string | null): string {
  if (stage === 3 && machineName) return `Make it on the ${machineName}`;
  return STAGE_TASK[stage];
}

// ---- Who may do what ----

export type Actor = {
  role: Role;
  /** Machine ids this person has a mentor sign-off on. */
  trainedMachineIds: string[];
  /** Subsystem ids this person is the lead for. */
  ledSubsystemIds: string[];
};

export function isLeadOrAbove(role: Role): boolean {
  return role === "lead" || role === "mentor" || role === "admin";
}

export function isMentorOrAbove(role: Role): boolean {
  return role === "mentor" || role === "admin";
}

export type Permission = { allowed: true } | { allowed: false; reason: string };

const OK: Permission = { allowed: true };

function deny(reason: string): Permission {
  return { allowed: false, reason };
}

/**
 * May this person move the part forward out of `stage`? The reason is shown
 * to the user on the disabled button, so it says what to do about it.
 */
export function canAdvance(
  stage: Stage,
  process: ProcessShape,
  part: { subsystemId: string; qtyMade: number; qtyNeeded: number },
  actor: Actor,
): Permission {
  if (nextStage(stage, process) === null) {
    return deny("This part is already on the robot.");
  }
  switch (stage) {
    case 1:
    case 2:
      return isLeadOrAbove(actor.role)
        ? OK
        : deny("A design lead or mentor checks the drawing.");
    case 3: {
      if (isLeadOrAbove(actor.role)) return OK;
      if (
        process.machineId &&
        !actor.trainedMachineIds.includes(process.machineId)
      ) {
        return deny("You aren't signed off on this machine yet. Ask a mentor.");
      }
      if (part.qtyMade < part.qtyNeeded) {
        return deny(`Record all ${part.qtyNeeded} made first.`);
      }
      return OK;
    }
    case 4:
      return OK; // Finishing: anyone can say it's done.
    case 5:
      return isMentorOrAbove(actor.role) ||
        actor.ledSubsystemIds.includes(part.subsystemId)
        ? OK
        : deny("The subsystem lead or a mentor marks it installed.");
    default:
      return deny("This part is already on the robot.");
  }
}

/** Moving backward, or jumping stages, is always a lead/mentor call. */
export function canMoveTo(
  from: Stage,
  to: Stage,
  process: ProcessShape,
  part: { subsystemId: string; qtyMade: number; qtyNeeded: number },
  actor: Actor,
): Permission {
  if (to === nextStage(from, process)) {
    return canAdvance(from, process, part, actor);
  }
  return isLeadOrAbove(actor.role)
    ? OK
    : deny("Only a lead or mentor can move a part back or skip ahead.");
}

/** Claiming: stage 3 and 4 only, and stage 3 needs the machine sign-off. */
export function canClaim(
  stage: Stage,
  process: ProcessShape,
  actor: Actor,
): Permission {
  if (stage !== 3 && stage !== 4) {
    return deny("Parts are claimed when they're ready to make or finish.");
  }
  if (
    stage === 3 &&
    !isLeadOrAbove(actor.role) &&
    process.machineId &&
    !actor.trainedMachineIds.includes(process.machineId)
  ) {
    return deny("You aren't signed off on this machine yet. Ask a mentor.");
  }
  return OK;
}

/** Everyone can say something went wrong. */
export function canReportProblem(): Permission {
  return OK;
}

// ---- Part numbers ----

/**
 * Forgiving search: "27-INT-104", "int-104", "INT104" and "104" all have to
 * find the same part, so everything collapses to upper-case alphanumerics and
 * a query matches any tail of the number.
 */
export function normalizePartNumber(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function partNumberMatches(query: string, partNumber: string): boolean {
  const q = normalizePartNumber(query);
  if (q.length === 0) return false;
  const n = normalizePartNumber(partNumber);
  return n === q || n.endsWith(q) || n.includes(q);
}

/** `{YY}-{SUB}-{NNN}`, e.g. 27-INT-104. */
export function formatPartNumber(
  year: string,
  code: string,
  sequence: number,
  pad = 3,
): string {
  return `${year}-${code}-${String(sequence).padStart(pad, "0")}`;
}
