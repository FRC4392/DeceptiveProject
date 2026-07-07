export type FabMethod =
  | "mill"
  | "lathe"
  | "3d_print"
  | "waterjet"
  | "laser_cut"
  | "cots";

// Substrings that reliably indicate a 3D-printed part in an Onshape material.
const PRINT_HINTS = [
  "3d print",
  "3d-print",
  "printed",
  "onyx",
  "markforged",
  "pla",
  "abs",
  "petg",
  "tpu",
  "fdm",
  "sla",
  "resin",
  "nylon",
];

/**
 * Best-effort fab-method guess from an Onshape material name. Onshape reports a
 * material but not a manufacturing method, and 3D-print materials are the one
 * reliable signal — other materials (aluminum, steel) don't map to a single
 * method, so those return undefined and the caller falls back to the default.
 */
export function inferMethodFromMaterial(
  material?: string,
): FabMethod | undefined {
  if (!material) return undefined;
  const m = material.toLowerCase();
  if (PRINT_HINTS.some((hint) => m.includes(hint))) return "3d_print";
  return undefined;
}
