import { useRef } from 'react';
import { ClickActionElement } from '..';

interface ActionButtonState {
  button: ClickActionElement;
  isElementActionRunning?: boolean;
  isUserLogicRunning?: boolean;
}

export function useCheckButtonAction(
  setButtonLoader: (button: any) => Promise<void>,
  clearLoaders: () => void
) {
  const buttonActionStateRef = useRef<ActionButtonState>(null);

  const isButtonActionRunning = () =>
    buttonActionStateRef.current?.isElementActionRunning ||
    buttonActionStateRef.current?.isUserLogicRunning;

  const updateButtonActionState = (elementType: string, element: any) => {
    // Set the state only when the element is a button and block_other_button_clicks_while_actions_runs is true
    const isRunning =
      elementType === 'button' &&
      element?.properties?.block_other_button_clicks_while_actions_runs;

    if (isRunning) {
      buttonActionStateRef.current = {
        button: element,
        isElementActionRunning: true
      };
    } else {
      buttonActionStateRef.current = null;
    }
  };

  const clearButtonActionState = () => {
    if (buttonActionStateRef.current) {
      buttonActionStateRef.current = {
        ...buttonActionStateRef.current,
        isElementActionRunning: false
      };
    }
  };

  const _setButtonLoading = async (isLoading: boolean) => {
    // Loader is only valid if there is a tracked button
    if (!buttonActionStateRef?.current?.button) {
      return;
    }

    if (isLoading) {
      await setButtonLoader(buttonActionStateRef.current.button);
    } else if (!isButtonActionRunning()) {
      // Clear the loaders only when both isElementActionRunning and isUserLogicRunning are false
      clearLoaders();
    }
  };

  const setUserLogicRunning = async (isRunning: boolean) => {
    if (!buttonActionStateRef.current) {
      return;
    }

    buttonActionStateRef.current = {
      ...buttonActionStateRef.current,
      isUserLogicRunning: isRunning
    };

    _setButtonLoading(isRunning);
  };

  return {
    isButtonActionRunning,
    updateButtonActionState,
    clearButtonActionState,
    setUserLogicRunning
  };
}
