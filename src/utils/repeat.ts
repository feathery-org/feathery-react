import { PositionedElement, Subgrid } from '../types/Form';
import { getPositionKey } from './hideAndRepeats';
import {
  getDefaultFieldValue,
  isRepeatedFileField
} from './fieldHelperFunctions';
import { fieldValues } from './init';
import { arrayMove } from './array';
import { ACTION_ADD_REPEATED_ROW } from './elementActions';

interface Step {
  subgrids: Subgrid[];
  servar_fields: any[];
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

/** Elements that can carry a click action, and so an add-row limit. */
const ACTION_ELEMENT_TYPES = ['buttons', 'texts', 'subgrids'];

/**
 * The row cap an author configured for a container, or null for uncapped.
 *
 * The cap lives on the add-row action rather than on the container, so a
 * container can be targeted by several actions with different limits - and any
 * action that leaves the limit blank is a path to unlimited rows, which makes
 * the whole container uncapped however tight its other actions are. Everything
 * that grows the container goes through here so one number governs them all.
 */
export function getRepeatMaxRows(
  step: any,
  containerId: string
): number | null {
  let max: number | null = null;

  for (const type of ACTION_ELEMENT_TYPES) {
    for (const element of step[type] ?? []) {
      for (const action of element.properties?.actions ?? []) {
        if (action.type !== ACTION_ADD_REPEATED_ROW) continue;
        if (action.repeat_container !== containerId) continue;

        const limit = Number(action.max_repeats);
        if (!Number.isFinite(limit) || limit < 1) return null;
        max = max === null ? limit : Math.min(max, limit);
      }
    }
  }

  return max;
}

/**
 * Rendered row count for a repeat container, clamped so a 'set_value' trigger
 * cannot offer a row past the author's cap.
 *
 * That trailing row is the one way left around a row limit: it is rendered
 * whenever the last row is filled, and typing into it grows the array through
 * `justInsert`, which runs upstream of every cap check. Withholding the row
 * withholds the input.
 *
 * Never clamps below the rows the data already holds. A cap lowered after
 * submissions must not hide answers that exist - the phantom row is the only
 * thing this is meant to take away.
 */
export function clampRepeatCountToCap(
  step: any,
  repeatContainer: Subgrid,
  count: number
) {
  const cap = getRepeatMaxRows(step, repeatContainer.id);
  if (cap === null) return count;

  const dataRows = getRepeatContainerRowCount(step, repeatContainer);
  return Math.min(count, Math.max(cap, dataRows));
}

/**
 * Number of rendered rows for a repeated field. If the trigger is 'set_value'
 * and the last row is not at default, the renderer shows an extra empty row.
 */
export function getServarRepeatNum(field: any, fieldValue: unknown): number {
  if (!Array.isArray(fieldValue)) return 0;
  const servar = field?.servar ?? {};
  const defaultValue = getDefaultFieldValue(field);
  const lastValue = fieldValue[fieldValue.length - 1];
  // updateFieldValues rewrites null entries to '', so a null-defaulting field
  // would look filled here and get a second trailing row
  const hasDefaultLastValue =
    fieldValue.length > 0 &&
    (lastValue === defaultValue || (defaultValue === null && lastValue === ''));
  return servar.repeat_trigger === 'set_value' && !hasDefaultLastValue
    ? fieldValue.length + 1
    : fieldValue.length;
}

/**
 * Rows the container's data actually has. Fields in one container can hold
 * arrays of different lengths - a file field is shorter than its siblings
 * whenever it ends in empty rows - so the container's row count is the longest
 * of them. Note this is the count the data supports, not the count rendered:
 * a 'set_value' trigger renders one more (see getServarRepeatNum).
 */
export function getRepeatContainerRowCount(
  step: { servar_fields: any[] },
  repeatContainer: PositionedElement
) {
  return Math.max(
    0,
    ...getFieldsInRepeat(step, repeatContainer).map((field: any) => {
      const vals = fieldValues[field.servar.key];
      return Array.isArray(vals) ? vals.length : 0;
    })
  );
}

const ROW_HOLE = Symbol('feathery.repeatRowHole');

/**
 * Permutes one repeated field's values for a container row move.
 *
 * A field shorter than the container is treated as ending in holes, so the same
 * physical row moves in every field instead of each short array shifting a row
 * of its own. Trailing holes are trimmed again afterwards because array length
 * drives the rendered row count. An interior hole - one that opens when a real
 * value moves past the tail - materializes as the field's neutral value: null
 * for a repeated file field so __feathery_file_indices keeps the slot, the
 * field default otherwise so stripEmptyRepeatEntries does not compact the row
 * away at submit.
 */
export function moveRepeatRowValue(
  list: any[],
  from: number,
  to: number,
  rows: number,
  field: any
) {
  const padded: any[] = Array.from({ length: rows }, (_, i) =>
    i < list.length ? list[i] : ROW_HOLE
  );

  const moved = arrayMove(padded, from, to);
  if (moved === padded) return list;

  while (moved.length && moved[moved.length - 1] === ROW_HOLE) moved.pop();

  const fill = isRepeatedFileField(field?.servar)
    ? null
    : getDefaultFieldValue(field);
  return moved.map((val) => (val === ROW_HOLE ? fill : val));
}

/**
 * Opens a new row at `at` in one repeated field's values.
 *
 * Padding to the container's row count first is what keeps a short field - a
 * file field that ends in empty rows, say - inserting at the same physical row
 * as its longer siblings instead of at its own shorter tail.
 */
export function insertRepeatRowValue(
  list: any[],
  at: number,
  rows: number,
  field: any
) {
  const fill = isRepeatedFileField(field?.servar)
    ? null
    : getDefaultFieldValue(field);
  const padded: any[] = Array.from({ length: rows }, (_, i) =>
    i < list.length ? list[i] : fill
  );

  return [
    ...padded.slice(0, at),
    getDefaultFieldValue(field),
    ...padded.slice(at)
  ];
}
