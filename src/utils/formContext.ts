import {
  changeStep,
  FieldOptions,
  formatAllFormFields
} from './formHelperFunctions';
import { setFieldValues, getFieldValues, initInfo, FieldValues } from './init';
import internalState from './internalState';
import { validateElements } from './validation';

/**
 * Used by contextRef in <Form />, renderAt for vanillajs, and the lifecycle
 * methods
 *
 * @param formUuid
 * @returns Form context object
 */
export const getFormContext = (formUuid: string) => ({
  userId: initInfo().userId,
  // deprecated
  setFieldValues: (userVals: FieldValues): void => {
    console.warn(
      'setFieldValues is deprecated.  Please use the fields object and set the value directly in individual fields instead.'
    );
    return setFieldValues(userVals);
  },
  // deprecated
  getFieldValues: () => {
    console.warn(
      'getFieldValues is deprecated.  Please use the fields object instead.'
    );
    return getFieldValues();
  },
  fields: { ...internalState[formUuid].fields },
  setFormCompletion: (flag: boolean) => {
    const { client, currentStep } = internalState[formUuid];
    return client.registerEvent({
      step_key: currentStep.key,
      event: 'load',
      completed: flag
    });
  },
  // @deprecated
  // TODO: remove when support setFieldOptions is dropped
  setFieldOptions: (newOptions: FieldOptions) => {
    console.warn(
      'setFieldOptions is deprecated.  Please use the fields object instead and set the options directly on individual fields.'
    );
    const { steps, updateFieldOptions, currentStep } = internalState[formUuid];
    return updateFieldOptions(steps, currentStep)(newOptions);
  },
  setProgress: (val: any) => {
    return internalState[formUuid].setUserProgress(val);
  },
  goToStep: (stepKey: any) => {
    const { currentStep, history, steps } = internalState[formUuid];
    changeStep(stepKey, currentStep.key, steps, history);
  },
  isLastStep: () => {
    const step = internalState[formUuid].currentStep;
    return step.next_conditions.length === 0;
  },
  getStepProperties: () => {
    const state = internalState[formUuid];
    const step = state?.currentStep ?? {};
    const rootStyles = step
      ? step.subgrids.find((grid: any) => grid.position.length === 0).styles
      : {};
    return {
      totalSteps: Object.keys(state.steps).length,
      stepName: step.key ?? '',
      previousStepName: state.previousStepName,
      backgroundColor: rootStyles?.background_color ?? 'FFFFFF'
    };
  },
  // @deprecated
  // TODO: remove when support setFieldOptions is dropped
  getFormFields: () => {
    console.warn(
      'getFormFields is deprecated.  Please use the fields object instead.'
    );
    return formatAllFormFields(internalState[formUuid].steps, true);
  },
  // @deprecated
  // TODO: remove when support setFieldOptions is dropped
  setFieldErrors: (
    errors: Record<string, string | { index: number; message: string }>
  ) => {
    console.warn(
      'setFieldErrors is deprecated.  Please use the fields object instead and set the error directly on a field.'
    );
    return internalState[formUuid].setFieldErrors(errors);
  },
  validateStep: (showErrors = true) => {
    const {
      currentStep,
      visiblePositions,
      formRef,
      formSettings,
      getErrorCallback,
      setInlineErrors
    } = internalState[formUuid];

    const { errors } = validateElements({
      step: currentStep,
      visiblePositions,
      triggerErrors: showErrors,
      errorType: formSettings.errorType,
      formRef,
      errorCallback: getErrorCallback(),
      setInlineErrors
    });
    return errors;
  }
});
