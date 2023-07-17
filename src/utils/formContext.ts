import {
  changeStep,
  FieldOptions,
  formatAllFormFields
} from './formHelperFunctions';
import { setFieldValues } from './init';
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
  setFieldValues,
  setFormCompletion: (flag: boolean) => {
    const { client, currentStep } = internalState[formUuid];
    return client.registerEvent({
      step_key: currentStep.key,
      event: 'load',
      completed: flag
    });
  },
  setFieldOptions: (newOptions: FieldOptions) => {
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
  getFormFields: () => formatAllFormFields(internalState[formUuid].steps, true),
  setFieldErrors: (
    errors: Record<string, string | { index: number; message: string }>
  ) => internalState[formUuid].setFieldErrors(errors),
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
