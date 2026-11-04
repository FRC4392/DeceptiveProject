/**
 * The count a change asks for: either a new value, typed in, or a step from a
 * counter's − and + buttons.
 *
 * A counter used to send the number it wanted, worked out from the count the
 * screen last showed. Two people pressing + on the same count both sent the
 * same number, and one press was lost — along with its line in the history.
 * A step is applied to the count as it stands inside the mutation instead,
 * and Convex runs mutations one after another, so every press lands.
 *
 * A typed number still sends the value it means. Pure, so the three counters
 * that use it share one rule.
 */
export function requestedCount(
  current: number,
  change: { value?: number; delta?: number },
): number {
  if ((change.value === undefined) === (change.delta === undefined)) {
    throw new Error("Send either a new count or a step, not both or neither.");
  }
  return change.delta !== undefined ? current + change.delta : change.value!;
}
