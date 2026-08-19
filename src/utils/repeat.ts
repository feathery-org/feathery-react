import { PositionedElement, Subgrid } from '../types/Form';
import { getPositionKey } from './hideAndRepeats';
import { getDefaultFieldValue } from './fieldHelperFunctions';
import { fieldValues } from './init';
import { ACTION_ADD_REPEATED_ROW } from './elementActions';

interface Step {
  subgrids: Subgrid[];
  servar_fields: any[];
}

// Hard ceiling on how many repeats a dynamic (field-referenced) max can request.
// Guards against a referenced field holding a huge/garbage number that would
// render thousands of rows and hang the browser.
export const MAX_DYNAMIC_REPEATS = 500;

/**
 * Coerce a raw max-repeats value (from a static setting or a referenced field)
 * into a usable positive integer cap.
 *
 * Returns `null` ("no limit") for anything that isn't a positive number:
 * null/undefined/empty, non-numeric, zero, or negative. This matches the
 * existing static behavior where an empty "Max Repeats" input means unlimited,
 * and keeps a transient empty/invalid field value from collapsing a container.
 * Any valid value is clamped to MAX_DYNAMIC_REPEATS.
 */
export function sanitizeRepeatLimit(raw: unknown): number | null {
  // A repeated hidden field stores its value as an array - use the first entry.
  if (Array.isArray(raw)) raw = raw[0];
  if (raw === null || raw === undefined || raw === '') return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return null;
  const floored = Math.floor(num);
  if (floored <= 0) return null;
  return Math.min(floored, MAX_DYNAMIC_REPEATS);
}

/**
 * Resolve the effective max-repeats cap configured on an `add_repeated_row`
 * action. Supports either a static number (`action.max_repeats`) or a dynamic
 * reference to a hidden/number field (`action.max_repeats_type === 'field'`,
 * with the field's key resolved server-side into `action.max_repeats_field_key`).
 * Returns a positive integer cap, or `null` when there is no valid limit.
 */
export function resolveMaxRepeats(action: any): number | null {
  if (!action) return null;
  if (action.max_repeats_type === 'field') {
    const key = action.max_repeats_field_key;
    if (!key) return null;
    return sanitizeRepeatLimit(fieldValues[key]);
  }
  // Backwards compatible: legacy actions have no `max_repeats_type` and store a
  // plain number (or nothing) in `max_repeats`.
  return sanitizeRepeatLimit(action.max_repeats);
}

const ACTION_HOLDING_ELEMENT_TYPES = ['buttons', 'subgrids', 'texts', 'images'];

/**
 * Iterate every `add_repeated_row` action on the step, regardless of which
 * element type carries it.
 */
function forEachAddRepeatAction(step: any, cb: (action: any) => void): void {
  ACTION_HOLDING_ELEMENT_TYPES.forEach((type) => {
    step[type]?.forEach((el: any) => {
      (el?.properties?.actions ?? []).forEach((action: any) => {
        if (action?.type === ACTION_ADD_REPEATED_ROW) cb(action);
      });
    });
  });
}

/**
 * The render-time repeat cap for a container, derived only from *dynamic*
 * (field-referenced) max-repeats actions targeting it. Returns the largest such
 * cap (least-restrictive add path wins), or `null` when there is no dynamic cap
 * or any dynamic add path currently resolves to unlimited.
 *
 * Static max-repeats intentionally never clamps rendering: legacy behavior is
 * that a static max only caps the add button, so restricting it here would
 * change how existing static forms render.
 */
export function getDynamicContainerRepeatCap(
  step: any,
  container: { id: string }
): number | null {
  let cap: number | null = null;
  let unlimited = false;
  forEachAddRepeatAction(step, (action) => {
    if (action.repeat_container !== container.id) return;
    if (action.max_repeats_type !== 'field') return;
    const resolved = resolveMaxRepeats(action);
    // An empty/invalid referenced field means this add path is uncapped.
    if (resolved === null) unlimited = true;
    else cap = cap === null ? resolved : Math.max(cap, resolved);
  });
  return unlimited ? null : cap;
}

/**
 * Field keys referenced by any dynamic max-repeats action on the step. Used to
 * trigger a re-render (and re-clamp) when one of those field values changes.
 */
export function getMaxRepeatsFieldReferences(step: any): Set<string> {
  const refs = new Set<string>();
  forEachAddRepeatAction(step, (action) => {
    if (action.max_repeats_type === 'field' && action.max_repeats_field_key)
      refs.add(action.max_repeats_field_key);
  });
  return refs;
}

export function inRepeat(
  elementKey: string,
  parentKey: string,
  addCommaToElement = false
) {
  if (addCommaToElement) {
    elementKey += ',';
  }
  parentKey += ',';

  return elementKey.startsWith(parentKey);
}
/**
 * Gets the repeating container ancestor of an element
 * @param step
 * @param element
 * @returns
 */
export function getRepeatedContainer(step: Step, element: PositionedElement) {
  return getRepeatedContainers(step).find((subgrid) => {
    const elKey = getPositionKey(element);
    const subgridKey = getPositionKey(subgrid);
    return inRepeat(elKey, subgridKey);
  });
}

/**
 * Gets all of the repeated container for a step
 * @param step
 * @returns
 */
export function getRepeatedContainers(step: Step) {
  return step.subgrids.filter((subgrid) => subgrid.repeated);
}

/**
 * Gets all of the server field descendants of a repeating container
 * @param step
 * @param repeatContainer
 * @returns
 */
export function getFieldsInRepeat(
  step: { servar_fields: any[] },
  repeatContainer: PositionedElement
) {
  return step.servar_fields.filter((field) => {
    const positionKey = getPositionKey(field);
    const repeatKey = getPositionKey(repeatContainer);
    return inRepeat(positionKey, repeatKey);
  });
}

/**
 * Gets the container with the given id on the step
 * @param step
 * @param id
 * @returns
 */
export function getContainerById(
  step: { subgrids: Subgrid[] },
  id: string
): Subgrid | undefined {
  return step.subgrids.find((subgrid) => subgrid.id === id);
}

/**
 * Number of rendered rows for a repeated field. If the trigger is 'set_value'
 * and the last row is not at default, the renderer shows an extra empty row.
 */
export function getServarRepeatNum(field: any, fieldValue: unknown): number {
  if (!Array.isArray(fieldValue)) return 0;
  const servar = field?.servar ?? {};
  const hasDefaultLastValue =
    fieldValue.length > 0 &&
    fieldValue[fieldValue.length - 1] === getDefaultFieldValue(field);
  return servar.repeat_trigger === 'set_value' && !hasDefaultLastValue
    ? fieldValue.length + 1
    : fieldValue.length;
}
