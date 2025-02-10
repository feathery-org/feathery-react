import { extractTextVariables } from '../elements/components/TextNodes';
import { PositionedElement, Subgrid } from '../types/Form';
import { getPositionKey } from './hideAndRepeats';

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
  step: { servar_fields: any[]; texts: any[] },
  repeatContainer: PositionedElement
) {
  const repeatKey = getPositionKey(repeatContainer);
  const servars = step.servar_fields.filter((field) => {
    const positionKey = getPositionKey(field);
    return inRepeat(positionKey, repeatKey);
  });

  // also include field keys in text elements
  const texts = new Set();
  step.texts.forEach((text) => {
    const positionKey = getPositionKey(text);
    if (inRepeat(positionKey, repeatKey)) {
      const text_value = text.properties.text;
      const text_vars = extractTextVariables(text_value);
      text_vars.forEach((text_var) => {
        texts.add(text_var);
      });
    }
  });

  return { servars, texts };
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
