import { PositionedElement, Subgrid } from '../types/Form';
import { getPositionKey } from './hideAndRepeats';
import {
  getDefaultFieldValue,
  isRepeatedFileField
} from './fieldHelperFunctions';
import { fieldValues } from './init';
import { arrayMove } from './array';
import { ACTION_ADD_REPEATED_ROW } from './elementActions';
import { TEXT_VARIABLE_PATTERN } from '../elements/components/TextNodes';

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
 * Ids/keys of every element inside a repeat container that can own a per-row
 * inline error: servar fields (by servar key) plus buttons and nested
 * containers (by element id, how submit/action failures are keyed). Used to
 * reindex errors when a row is removed.
 *
 * The repeat container's OWN id is deliberately included (it matches itself
 * via inRepeat's comma-suffixed prefix check): the container is clickable once
 * per row, so its action errors are per-row and must shift with the rows.
 */
export function getRepeatErrorOwnerIds(
  step: { servar_fields?: any[]; buttons?: any[]; subgrids?: any[] },
  repeatContainer: PositionedElement | undefined
): string[] {
  if (!repeatContainer) return [];
  const repeatKey = getPositionKey(repeatContainer);
  if (!repeatKey) return [];
  const isInside = (el: any) => {
    const key = getPositionKey(el);
    return !!key && inRepeat(key, repeatKey, true);
  };
  return [
    ...(step.servar_fields ?? [])
      .filter(isInside)
      .map((f: any) => f?.servar?.key),
    ...(step.buttons ?? []).filter(isInside).map((b: any) => b?.id),
    ...(step.subgrids ?? []).filter(isInside).map((s: any) => s?.id)
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
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
 * The highest row count reachable through any add-row action, or null for
 * uncapped. Each action still enforces its own `max_repeats`; this is the
 * ceiling for everything else that has to agree with them.
 *
 * The loosest limit wins, because a filler will use whichever button still
 * adds: with actions capped at 5 and 2, five rows are reachable. Taking the
 * tightest instead made the insert seam refuse at 2 while the other button
 * kept adding. A blank limit is a path to unlimited rows, and is the same rule
 * carried to its end.
 */
export function resolveAddRowActions(
  step: any,
  containerId: string
): { exists: boolean; cap: number | null } {
  let ceiling: number | null = null;
  let exists = false;

  for (const type of ACTION_ELEMENT_TYPES) {
    for (const element of step[type] ?? []) {
      for (const action of element.properties?.actions ?? []) {
        if (action.type !== ACTION_ADD_REPEATED_ROW) continue;
        if (action.repeat_container !== containerId) continue;

        exists = true;
        const limit = Number(action.max_repeats);
        // A blank limit is a path to unlimited rows, so the scan can stop -
        // nothing later can tighten it.
        if (!Number.isFinite(limit) || limit < 1) return { exists, cap: null };
        ceiling = ceiling === null ? limit : Math.max(ceiling, limit);
      }
    }
  }

  return { exists, cap: ceiling };
}

export function getRepeatMaxRows(
  step: any,
  containerId: string
): number | null {
  return resolveAddRowActions(step, containerId).cap;
}

/**
 * Whether any add-row action targets the container at all.
 *
 * The insert seam borrows its ceiling from those actions, so a container none
 * of them names has no ceiling to borrow and `getRepeatMaxRows` reports it as
 * uncapped. That let a seam add rows without limit to a container the author
 * had deliberately given no way to grow. Nothing to borrow from means no seam.
 */
export function hasAddRowAction(step: any, containerId: string): boolean {
  return resolveAddRowActions(step, containerId).exists;
}

/**
 * Rendered row count, clamped so a 'set_value' trigger cannot offer a row past
 * the cap: typing into that trailing row grows the array upstream of every cap
 * check. Never clamps below the rows the data holds, so a cap lowered after
 * submissions hides no existing answers.
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
 * The `{{key}}` references inside a repeated container.
 *
 * A container does not need an input field to repeat: a text or button that
 * references an array-valued key renders once per entry, which is how a list
 * fetched from an API is displayed. Those keys are as much the container's
 * row data as a field's own array, so anything that reasons about rows has to
 * see them - see getRepeatRowKeys.
 */
export function getRepeatTextVariableKeys(
  step: { texts?: any[]; buttons?: any[] },
  repeatContainer: PositionedElement
): string[] {
  const repeatKey = getPositionKey(repeatContainer);
  if (typeof repeatKey !== 'string') return [];
  const keys = new Set<string>();

  [...(step.texts ?? []), ...(step.buttons ?? [])]
    // An element with no position cannot be placed in the container. Buttons
    // reached through an action carry none, and getPositionKey returns null
    // for them.
    .filter((el: any) => {
      const key = getPositionKey(el);
      return typeof key === 'string' && inRepeat(key, repeatKey);
    })
    .forEach((el: any) => {
      const text = el?.properties?.text;
      if (typeof text !== 'string') return;
      const matches = text.match(TEXT_VARIABLE_PATTERN);
      matches?.forEach((match: string) => keys.add(match.slice(2, -2)));
    });

  // Only a key holding an array contributes rows. A scalar reference renders
  // the same value in every row and must not be permuted with them.
  return [...keys].filter((key) => Array.isArray(fieldValues[key]));
}

/**
 * Every key whose array the container's rows are made of: its own repeated
 * fields, plus the text variables its copy references. A row move permutes all
 * of them together, so a list built from either source stays aligned.
 */
export function getRepeatRowKeys(
  step: { servar_fields: any[]; texts?: any[]; buttons?: any[] },
  repeatContainer: PositionedElement
): string[] {
  const fieldKeys = getFieldsInRepeat(step, repeatContainer).map(
    (field: any) => field.servar.key
  );
  const textKeys = getRepeatTextVariableKeys(step, repeatContainer).filter(
    (key) => !fieldKeys.includes(key)
  );
  return [...fieldKeys, ...textKeys];
}

/**
 * Rows the container's data actually has. Fields in one container can hold
 * arrays of different lengths - a file field is shorter than its siblings
 * whenever it ends in empty rows - so the container's row count is the longest
 * of them. Text variables count too: a container can repeat on nothing but a
 * `{{key}}` in its copy, and the renderer takes the longest of both sources
 * (see repeatCountByTextVariables), so this has to agree with it or a row the
 * user can see is a row the reorder controls refuse to move.
 *
 * Note this is the count the data supports, not the count rendered: a
 * 'set_value' trigger renders one more (see getServarRepeatNum).
 */
export function getRepeatContainerRowCount(
  step: { servar_fields: any[]; texts?: any[]; buttons?: any[] },
  repeatContainer: PositionedElement
) {
  return Math.max(
    0,
    ...getRepeatRowKeys(step, repeatContainer).map((key) => {
      const vals = fieldValues[key];
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
