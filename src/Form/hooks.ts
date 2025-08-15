import { useRef } from 'react';
import { ClickActionElement } from '.';
import { ACTION_NEXT } from '../utils/elementActions';

const TIMER_CLEAR_FLAG_GET_NEW_STEP = 300;
const TIMER_CLEAR_FLAG_NEXT_ACTION = 300;

interface NextActionStateRef {
  latestClickedButton: ClickActionElement | null;
  isGettingNewStep: boolean;
  timerIdGettingNewStep: NodeJS.Timeout | undefined;
  isNextButtonAction: boolean;
  timerIdNextActionFlag: NodeJS.Timeout | undefined;
}

interface SetNextButtonActionFlag {
  (flag: true, button: ClickActionElement): void;
  (flag: false, button?: undefined): void;
}

export function useNextActionState(
  activeStep: any,
  setButtonLoader: (button: any) => Promise<void>,
  clearLoaders: () => void
) {
  // Reference for handling the button state after navigating to the next step
  const nextActionStateRef = useRef<NextActionStateRef>({
    // This is for the most recently clicked Next Step button.
    latestClickedButton: null,

    // This is for the getNewStep state.
    // isGettingNewStep = true
    // await getNewStep()
    // isGettingNewStep = false
    isGettingNewStep: false,
    timerIdGettingNewStep: undefined,

    // This is for the buttonOnClick state.
    // Since buttonOnClick is invoked externally by other components,
    // we cannot use await for state handling like getNewStep() in this component scope.
    // Instead, inside buttonOnClick, set isNextButtonAction to TRUE at the initial entry point
    // and set it to FALSE just before the function returns to manage the buttonOnClick state.
    isNextButtonAction: false,
    timerIdNextActionFlag: undefined
  });

  const setNextButtonActionFlag: SetNextButtonActionFlag = (flag, button) => {
    // After the Next button action finishes, there may still be other async work before the new step fully takes effect.
    // To compensate for the timing gap between these two operations, use setTimeout to set the flag to false.
    clearTimeout(nextActionStateRef.current.timerIdNextActionFlag);

    if (flag) {
      if (!button) {
        throw new Error('button is required if flag is true');
      }

      nextActionStateRef.current.isNextButtonAction =
        button?.properties.actions.some(
          (action: any) => action.type === ACTION_NEXT
        );

      return;
    }

    nextActionStateRef.current.timerIdNextActionFlag = setTimeout(() => {
      nextActionStateRef.current.isNextButtonAction = false;
    }, TIMER_CLEAR_FLAG_NEXT_ACTION);
  };

  const clearNextActionTimer = () => {
    clearTimeout(nextActionStateRef.current.timerIdNextActionFlag);

    nextActionStateRef.current.isNextButtonAction = false;
  };

  const setGettingNewStepFlag = (flag: boolean) => {
    // After the getNewStep finishes, there may still be other async work before the new step fully takes effect.
    // To compensate for the timing gap between these two operations, use setTimeout to set the flag to false.
    clearTimeout(nextActionStateRef.current.timerIdGettingNewStep);

    if (flag) {
      nextActionStateRef.current.isGettingNewStep = true;

      return;
    }

    nextActionStateRef.current.timerIdGettingNewStep = setTimeout(() => {
      nextActionStateRef.current.isGettingNewStep = false;
    }, TIMER_CLEAR_FLAG_GET_NEW_STEP);
  };

  const clearGettingNewStepTimer = () => {
    clearTimeout(nextActionStateRef.current.timerIdGettingNewStep);

    nextActionStateRef.current.isGettingNewStep = false;
  };

  const setNextButtonLoading = (loading: boolean) => {
    if (!loading) {
      clearLoaders();

      return;
    }

    if (Array.isArray(activeStep?.buttons)) {
      const clickedButton = activeStep.buttons.find(
        (button: any) =>
          button.id === nextActionStateRef.current.latestClickedButton?.id
      );

      if (clickedButton) {
        setButtonLoader(clickedButton);
      }
    }
  };

  return {
    nextActionStateRef,
    setNextButtonActionFlag,
    clearNextActionTimer,
    setGettingNewStepFlag,
    clearGettingNewStepTimer,
    setNextButtonLoading
  };
}
