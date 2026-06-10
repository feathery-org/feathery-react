import { fieldValues } from './init';
import { getVisibleElements } from './hideAndRepeats';
import { isFieldValueEmpty } from './validation';
import { ACTION_STORE_FIELD, NAVIGATION_ACTIONS } from './elementActions';
import { isFieldActuallyRequired } from '../Form/grid/Element/utils/utils';

export function isButtonDisabled(
  button: any,
  activeStep: any,
  visiblePositions: any,
  readOnly: boolean
): boolean {
  let disabled = false;
  if (button?.properties?.disable_if_fields_incomplete) {
    const fieldsMissingValue = getVisibleElements(
      activeStep,
      visiblePositions,
      ['servar_fields'],
      true
    ).some(({ element, repeat }: any) => {
      if (isFieldActuallyRequired(element, activeStep)) {
        const servar = element.servar;
        let fieldVal: any = fieldValues[servar.key];
        if (servar.repeated) fieldVal = fieldVal[repeat];
        return isFieldValueEmpty(fieldVal, servar);
      }
      return false;
    });
    const storeElements = getVisibleElements(
      activeStep,
      visiblePositions,
      ['buttons', 'subgrids'],
      true
    )
      .map(({ element }: any) => element)
      .filter(
        ({ id, properties }: any) =>
          id !== button.id &&
          (properties.actions ?? []).some(
            (action: any) =>
              action.type === ACTION_STORE_FIELD &&
              action.custom_store_field_key
          )
      );
    const elementsHaveValues =
      storeElements.length === 0 ||
      storeElements.some(({ properties }: any) =>
        (properties.actions ?? []).some(
          (action: any) =>
            action.type === ACTION_STORE_FIELD &&
            fieldValues[action.custom_store_field_key]
        )
      );
    disabled = fieldsMissingValue || !elementsHaveValues;
  }
  if (!disabled && readOnly) {
    const actions = button?.properties?.actions ?? [];
    const hasNav = actions.some((action: any) =>
      NAVIGATION_ACTIONS.includes(action.type)
    );
    disabled = !hasNav;
  }
  return disabled;
}
