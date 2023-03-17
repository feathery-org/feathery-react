import { changeStep, FieldOptions } from './formHelperFunctions';
import { setValues } from './init';
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
  setValues,
  setFormCompletion: (flag: boolean) => {
    const { client, currentStep } = internalState[formUuid];
    return client.registerEvent({
      step_key: currentStep.key,
      event: 'load',
      completed: flag
    });
  },
  setOptions: (newOptions: FieldOptions) => {
    const { steps, updateFieldOptions, currentStep } = internalState[formUuid];
    return updateFieldOptions(steps, currentStep)(newOptions);
  },
  setProgress: (val: any) => {
    return internalState[formUuid].setUserProgress(val);
  },
  setStep: (stepKey: any) => {
    const { currentStep, history, steps } = internalState[formUuid];
    changeStep(stepKey, currentStep.key, steps, history);
  },
  stepProperties: () => {
    const step = internalState[formUuid]?.currentStep ?? {};
    const rootStyles = step
      ? step.subgrids.find((grid: any) => grid.position.length === 0).styles
      : {};
    return {
      name: step.key ?? '',
      backgroundColor: rootStyles?.background_color ?? 'FFFFFF'
    };
  },
  validateStep: (showErrors = true) => {
    const {
      currentStep,
      formRef,
      formSettings,
      getErrorCallback,
      setInlineErrors
    } = internalState[formUuid];
    const { errors } = validateElements({
      elements: [...currentStep.servar_fields, ...currentStep.buttons],
      triggerErrors: showErrors,
      errorType: formSettings.errorType,
      formRef: formRef,
      errorCallback: getErrorCallback(),
      setInlineErrors: setInlineErrors
    });
    return errors;
  },
  // TODO: deprecate the following
  stepName: internalState[formUuid]?.currentStep?.key ?? ''
});
