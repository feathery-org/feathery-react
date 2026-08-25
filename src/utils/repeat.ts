import { PositionedElement, Subgrid } from '../types/Form';
import { getPositionKey } from './hideAndRepeats';
import { getDefaultFieldValue } from './fieldHelperFunctions';

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
