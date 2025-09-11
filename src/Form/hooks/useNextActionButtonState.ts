import { useRef } from 'react';
import { ClickActionElement } from '..';

const CLEAR_RUNNING_TIMER_DELAY = 2500;

interface NextActionButtonState {
  button: ClickActionElement;
  isElementActionRunning?: boolean;
  isUserLogicRunning?: boolean;
}

export function useNextActionButtonState(
  setButtonLoader: (button: any) => Promise<void>,
  clearLoaders: () => void
) {
  const runningTimerIdRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const nextActionButtonStateRef = useRef<NextActionButtonState>(null);

  // If resetting the state via updateNextButtonState, clearNextButtonState, or setUserLogicRunning(false) fails.
  // this timer is set to correct the state after a specified interval
  const setRunningTimer = () => {
    // Ensure any pending clear timer is cancelled before updating state
    clearTimeout(runningTimerIdRef.current);

    // schedule clearing the running state after a delay
    runningTimerIdRef.current = setTimeout(() => {
      // Mark element action as finished
      if (nextActionButtonStateRef.current) {
        nextActionButtonStateRef.current = {
          ...nextActionButtonStateRef.current,
          isElementActionRunning: false,
          isUserLogicRunning: false
        };
      }
    }, CLEAR_RUNNING_TIMER_DELAY);
  };

  const isNextButtonRunning = () =>
    nextActionButtonStateRef.current?.isElementActionRunning ||
    nextActionButtonStateRef.current?.isUserLogicRunning;

  const updateNextButtonState = (
    elementType: string,
    actions: any[],
    element: any
  ) => {
    // Set the state only when the element is a button and the action is 'next' or 'submit'
    const isRunning =
      elementType === 'button' &&
      (actions.some((action: any) => action.type === 'next') ||
        element?.properties?.submit);

    if (isRunning) {
      // Clear the pending timer if exists, and set running state reset timer
      setRunningTimer();

      nextActionButtonStateRef.current = {
        button: element,
        isElementActionRunning: true
      };
    } else {
      nextActionButtonStateRef.current = null;
    }
  };

  const clearNextButtonState = () => {
    if (nextActionButtonStateRef.current) {
      nextActionButtonStateRef.current = {
        ...nextActionButtonStateRef.current,
        isElementActionRunning: false
      };
    }
  };

  const _setNextButtonLoading = async (isLoading: boolean) => {
    // Loader is only valid if there is a tracked button
    if (!nextActionButtonStateRef?.current?.button) {
      return;
    }

    if (isLoading) {
      await setButtonLoader(nextActionButtonStateRef.current.button);
    } else if (!isNextButtonRunning()) {
      // Clear the loaders only when both isElementActionRunning and isUserLogicRunning are false
      clearLoaders();
    }
  };

  const setUserLogicRunning = async (isRunning: boolean) => {
    if (!nextActionButtonStateRef.current) {
      return;
    }

    nextActionButtonStateRef.current = {
      ...nextActionButtonStateRef.current,
      isUserLogicRunning: isRunning
    };

    if (isRunning) {
      // Clear the pending timer if exists, and set running state reset timer
      setRunningTimer();
    }

    _setNextButtonLoading(isRunning);
  };

  return {
    isNextButtonRunning,
    updateNextButtonState,
    clearNextButtonState,
    setUserLogicRunning
  };
}
