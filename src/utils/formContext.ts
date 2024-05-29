import { featheryWindow } from './browser';
import {
  changeStep,
  FieldOptions,
  formatAllFormFields
} from './formHelperFunctions';
import {
  setFieldValues,
  getFieldValues,
  FieldValues,
  updateUserId,
  initState
} from './init';
import internalState, { setFormInternalState } from './internalState';
import { validateElements } from './validation';

/**
 * Used by contextRef in <Form />, renderAt for vanillajs, and the lifecycle
 * methods
 *
 * @param formUuid
 * @returns Form context object
 */
export const getFormContext = (formUuid: string) => {
  // If internal state for the formUuid doesn't exist, initialize it so that
  // there will be object stability for the for state object props.  Important for
  // use of certain props in the callback functions.
  let formState = internalState[formUuid];
  if (!formState) {
    formState = { fields: {} } as any;
    setFormInternalState(formUuid, formState);
  }

  return {
    userId: initState.userId,
    _getInternalUserId: () => initState._internalUserId,
    fields: formState.fields,
    products: formState.products,
    cart: formState.cart,
    collaborator: formState.collaborator,
    setFormCompletion: () => {
      const { client, currentStep } = formState;
      return client.registerEvent({
        step_key: currentStep.key,
        next_step_key: '',
        event: 'skip',
        completed: true
      });
    },
    runIntegrationAction: (actionIds: string[], waitForCompletion = true) =>
      formState.runIntegrationAction(actionIds, waitForCompletion),
    setProgress: (val: any) => formState.setUserProgress(val),
    updateUserId,
    goToStep: (stepKey: any) => {
      const { currentStep, history, steps, setStepKey } = formState;
      changeStep(stepKey, currentStep.key, steps, setStepKey, history);
    },
    isTestForm: () => initState.isTestEnv,
    isLastStep: () => {
      const step = formState.currentStep;
      return step.next_conditions.length === 0;
    },
    getStepProperties: () => {
      const state = formState;
      const step = state?.currentStep ?? {};
      const rootStyles = step
        ? step.subgrids.find((grid: any) => grid.position.length === 0).styles
        : {};
      return {
        totalSteps: Object.keys(state.steps).length,
        stepName: step.key ?? '',
        previousStepName: state.previousStepName,
        backgroundColor: rootStyles?.background_color ?? 'FFFFFF',
        language: state.language
      };
    },
    validateStep: (showErrors = true) => {
      const {
        currentStep,
        visiblePositions,
        formRef,
        formSettings,
        getErrorCallback,
        setInlineErrors
      } = formState;

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
    },
    openUrl: (url: string, target = '_blank') => {
      featheryWindow()?.open(url, target, 'noopener');
    },
    setCalendlyUrl: (url: string) => formState.setCalendlyUrl(url),
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
    // @deprecated
    // TODO: remove when support for setFieldOptions is dropped
    setFieldOptions: (newOptions: FieldOptions) => {
      console.warn(
        'setFieldOptions is deprecated.  Please use the fields object instead and set the options directly on individual fields.'
      );
      return formState.updateFieldOptions(newOptions);
    },
    // @deprecated
    // TODO: remove when support for getFormFields is dropped
    getFormFields: () => {
      console.warn(
        'getFormFields is deprecated.  Please use the fields object instead.'
      );
      return formatAllFormFields(formState.steps, true);
    },
    // @deprecated
    // TODO: remove when support for setFieldErrors is dropped
    setFieldErrors: (
      errors: Record<string, string | { index: number; message: string }>
    ) => {
      console.warn(
        'setFieldErrors is deprecated.  Please use the fields object instead and set the error directly on a field.'
      );
      return formState.setFieldErrors(errors);
    }
  };
};
