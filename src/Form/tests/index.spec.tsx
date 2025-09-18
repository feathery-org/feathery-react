import { CheckButtonActionMod } from './testMocks';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { JSForm } from '..';
import FeatheryClient from '../../utils/featheryClient';
import internalState from '../../utils/internalState';

let originalFetchForm: any;

beforeAll(() => {
  originalFetchForm = FeatheryClient.prototype.fetchForm;
});

afterEach(() => {
  jest.clearAllMocks();
  cleanup();

  // Reset useCheckButtonAction refs
  CheckButtonActionMod._spies.buttonActionStateRef.current = null;
  CheckButtonActionMod._spies.setButtonLoaderRef.current = jest.fn();

  // Restore FeatheryClient prototype if a test overrode it
  FeatheryClient.prototype.fetchForm = originalFetchForm;
});

describe('ReactForm sharedCodes initialization', () => {
  it('sets sharedCodes to empty array when shared_codes is null', async () => {
    // Arrange: override FeatheryClient mock to return null shared_codes
    const MockClient = FeatheryClient;
    MockClient.prototype.fetchForm = async () => ({
      steps: [
        {
          key: 'step-1',
          id: 's1',
          servar_fields: [],
          buttons: [],
          next_conditions: []
        }
      ],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      shared_codes: null, // explicitly null
      track_hashes: false
    });

    render(<JSForm formId='f1' _internalId='iid-sc1' />);
    const btn = await screen.findByTestId('btn'); // wait for Grid render

    // Assert: sharedCodes should be initialized to empty array safely
    expect(btn).toBeInTheDocument();

    // Accessing internalState mock to confirm
    const sharedCodes: any = internalState.sharedCodes;
    expect(Array.isArray(internalState.sharedCodes)).toBe(true);
    expect(sharedCodes?.length).toBe(0);
  });

  it('sets sharedCodes to empty array when shared_codes is undefined', async () => {
    // Arrange: override FeatheryClient mock to return undefined shared_codes
    const MockClient = FeatheryClient;
    MockClient.prototype.fetchForm = async () => ({
      steps: [
        {
          key: 'step-1',
          id: 's1',
          servar_fields: [],
          buttons: [],
          next_conditions: []
        }
      ],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      // shared_codes is intentionally omitted to be undefined
      track_hashes: false
    });

    render(<JSForm formId='f1' _internalId='iid-sc2' />);
    const btn = await screen.findByTestId('btn');

    // Assert
    const sharedCodes: any = internalState.sharedCodes;
    expect(btn).toBeInTheDocument();
    expect(Array.isArray(sharedCodes)).toBe(true);
    expect(sharedCodes?.length).toBe(0);
  });
});

describe('useCheckButtonAction behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocked hook internal state
    CheckButtonActionMod._spies.buttonActionStateRef.current = null;
    CheckButtonActionMod._spies.setButtonLoaderRef.current = jest.fn();
    CheckButtonActionMod._spies.clearLoadersRef.current = jest.fn();
  });

  it('calls setButtonLoader when _setButtonLoading(true) with a tracked block_other_button_clicks_while_actions_runs', async () => {
    // Arrange: inject a custom setButtonLoader
    const setButtonLoader = jest.fn(async () => {});
    const api = CheckButtonActionMod.useCheckButtonAction(setButtonLoader);

    // No tracked button yet - should not call loader
    await api._setButtonLoading(true);
    expect(setButtonLoader).not.toHaveBeenCalled();

    // Create tracked state via updateButtonActionState
    const el = {
      id: 'b-load',
      properties: {
        block_other_button_clicks_while_actions_runs: true,
        actions: []
      }
    };
    api.updateButtonActionState('button', el);

    // Act
    await api._setButtonLoading(true);

    // Assert
    expect(setButtonLoader).toHaveBeenCalledTimes(1);
    expect(setButtonLoader).toHaveBeenCalledWith(el);
  });

  it('calls clearLoaders when _setButtonLoading(false) and there is no running state', async () => {
    const setButtonLoader = jest.fn();
    const clearLoaders = jest.fn();
    const api = CheckButtonActionMod.useCheckButtonAction(
      setButtonLoader,
      clearLoaders
    );

    // Create tracked button state, then end element action
    const el = {
      id: 'b-clear',
      properties: {
        block_other_button_clicks_while_actions_runs: true,
        actions: []
      }
    };
    api.updateButtonActionState('button', el);
    api.clearButtonActionState();

    // Ensure not running
    expect(api.isButtonActionRunning()).toBe(false);

    // Act
    await api._setButtonLoading(false);

    // Assert
    expect(clearLoaders).toHaveBeenCalledTimes(1);
  });

  it('JSForm flow: keeps state cleared when block_other_button_clicks_while_actions_runs is not set', async () => {
    render(<JSForm formId='f1' _internalId='iid-btn-1' />);

    const btn = await screen.findByTestId('btn');
    fireEvent.click(btn);

    // GridMock uses actions: [] and block_other_button_clicks_while_actions_runs is not set, so state must remain null
    expect(CheckButtonActionMod._spies.buttonActionStateRef.current).toBeNull();

    // Running state should be false
    expect(CheckButtonActionMod._spies.isButtonActionRunning()).toBe(false);
  });

  it('sets running when block_other_button_clicks_while_actions_runs=true and triggers setButtonLoader while user logic running', async () => {
    // Initialize mocked hook with an injectable setButtonLoader
    const setButtonLoader = jest.fn(async () => {});
    const api = CheckButtonActionMod.useCheckButtonAction(setButtonLoader);

    const element = {
      id: 'b-button',
      properties: {
        block_other_button_clicks_while_actions_runs: true,
        actions: []
      }
    };

    // block_other_button_clicks_while_actions_runs=true should set the internal state
    api.updateButtonActionState('button', element);

    expect(CheckButtonActionMod._spies.buttonActionStateRef.current).toEqual({
      button: element,
      isElementActionRunning: true
    });

    // Starting user logic
    await api.setUserLogicRunning(true);

    // Still running due to element action
    expect(api.isButtonActionRunning()).toBe(true);

    // Stopping user logic keeps running because element action is still true
    await api.setUserLogicRunning(false);
    expect(api.isButtonActionRunning()).toBe(true);

    // Stopping element action ends running state
    api.clearButtonActionState();
    expect(api.isButtonActionRunning()).toBe(false);
  });

  it('does not call setButtonLoader when user logic running is set to false', async () => {
    const setButtonLoader = jest.fn(async () => {});
    const api = CheckButtonActionMod.useCheckButtonAction(setButtonLoader);

    // No state yet: setting false should not call loader
    await api.setUserLogicRunning(false);
    expect(setButtonLoader).not.toHaveBeenCalled();

    // Create state then set false again: still should not call loader
    const el = {
      id: 'b-x',
      properties: {
        block_other_button_clicks_while_actions_runs: true,
        actions: []
      }
    };
    api.updateButtonActionState('button', el);
    await api.setUserLogicRunning(false);
    expect(setButtonLoader).not.toHaveBeenCalled();
  });

  it('ignores non-button element types in updateButtonActionState', () => {
    const api = CheckButtonActionMod.useCheckButtonAction(jest.fn());

    // container element should not be tracked
    api.updateButtonActionState('container', {
      id: 'c1',
      properties: { block_other_button_clicks_while_actions_runs: true }
    });

    expect(CheckButtonActionMod._spies.buttonActionStateRef.current).toBeNull();
    expect(api.isButtonActionRunning()).toBe(false);
  });
});
