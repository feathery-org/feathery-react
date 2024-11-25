import { PositionedElement, Subgrid } from '../types/Form';

interface Step {
  subgrids: Subgrid[];
  servar_fields: any[];
}

/**
 * Gets the repeating container ancestor of an element
 * @param step
 * @param element
 * @returns
 */
export function getRepeatedContainer(step: Step, element: PositionedElement) {
  return getRepeatedContainers(step).find((subgrid) =>
    element.position.join(',').startsWith(subgrid.position.join(','))
  );
}

/**
 * Gets all of the repeated container for a step
 * @param step
 * @returns
 */
export function getRepeatedContainers(step: Step) {
  return step.subgrids.filter((subgrid) => subgrid.repeated);
}

function isParentPosition(parentPos: number[], childPos: number[]) {
  // children position must be longer
  if (parentPos.length >= childPos.length) return false;

  // the child position must contain every element of the parent
  return parentPos.every((value, index) => childPos[index] === value);
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
    return isParentPosition(repeatContainer.position, field.position);
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
