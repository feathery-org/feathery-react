import { NextActionButtonHooksMod } from './testMocks';
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

  // Reset useNextActionButtonState refs
  // Comments in English by request
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NextActionButtonHooksMod } = require('./testMocks');
  NextActionButtonHooksMod._spies.nextActionButtonStateRef.current = null;
  NextActionButtonHooksMod._spies.setButtonLoaderRef.current = jest.fn();

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

describe('useNextActionButtonState behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocked hook internal state
    NextActionButtonHooksMod._spies.nextActionButtonStateRef.current = null;
    NextActionButtonHooksMod._spies.setButtonLoaderRef.current = jest.fn();
    NextActionButtonHooksMod._spies.clearLoadersRef.current = jest.fn();
  });

  it('calls setButtonLoader when _setNextButtonLoading(true) with a tracked submit button', async () => {
    // Arrange: inject a custom setButtonLoader
    const setButtonLoader = jest.fn(async () => {});
    const api =
      NextActionButtonHooksMod.useNextActionButtonState(setButtonLoader);

    // No tracked button yet - should not call loader
    await api._setNextButtonLoading(true);
    expect(setButtonLoader).not.toHaveBeenCalled();

    // Create tracked state via updateNextButtonState
    const el = { id: 'b-load', properties: { submit: true, actions: [] } };
    api.updateNextButtonState('button', [], el);

    // Act
    await api._setNextButtonLoading(true);

    // Assert
    expect(setButtonLoader).toHaveBeenCalledTimes(1);
    expect(setButtonLoader).toHaveBeenCalledWith(el);
  });

  it('calls clearLoaders when _setNextButtonLoading(false) and there is no running state', async () => {
    const setButtonLoader = jest.fn();
    const clearLoaders = jest.fn();
    const api = NextActionButtonHooksMod.useNextActionButtonState(
      setButtonLoader,
      clearLoaders
    );

    // Create tracked button state, then end element action
    const el = { id: 'b-clear', properties: { submit: true, actions: [] } };
    api.updateNextButtonState('button', [], el);
    api.clearNextButtonState();

    // Ensure not running
    expect(api.isNextButtonRunning()).toBe(false);

    // Act
    await api._setNextButtonLoading(false);

    // Assert
    expect(clearLoaders).toHaveBeenCalledTimes(1);
  });

  it('JSForm flow: keeps state cleared when not next and not submit', async () => {
    render(<JSForm formId='f1' _internalId='iid-btn-1' />);

    const btn = await screen.findByTestId('btn');
    fireEvent.click(btn);

    // GridMock uses actions: [] and submit: false, so state must remain null
    expect(
      NextActionButtonHooksMod._spies.nextActionButtonStateRef.current
    ).toBeNull();

    // Running state should be false
    expect(NextActionButtonHooksMod._spies.isNextButtonRunning()).toBe(false);
  });

  it('sets running when submit=true and triggers setButtonLoader while user logic running', async () => {
    // Initialize mocked hook with an injectable setButtonLoader
    const setButtonLoader = jest.fn(async () => {});
    const api =
      NextActionButtonHooksMod.useNextActionButtonState(setButtonLoader);

    const element = {
      id: 'b-submit',
      properties: { submit: true, actions: [] }
    };

    // submit=true should set the internal state
    api.updateNextButtonState('button', [], element);

    expect(
      NextActionButtonHooksMod._spies.nextActionButtonStateRef.current
    ).toEqual({
      button: element,
      isElementActionRunning: true
    });

    // Starting user logic
    await api.setUserLogicRunning(true);

    // Still running due to element action
    expect(api.isNextButtonRunning()).toBe(true);

    // Stopping user logic keeps running because element action is still true
    await api.setUserLogicRunning(false);
    expect(api.isNextButtonRunning()).toBe(true);

    // Stopping element action ends running state
    api.clearNextButtonState();
    expect(api.isNextButtonRunning()).toBe(false);
  });

  it('sets running when actions contain type="next"', async () => {
    const api = NextActionButtonHooksMod.useNextActionButtonState(jest.fn());

    const element = {
      id: 'b-next',
      properties: { submit: false, actions: [{ type: 'next' }] }
    };

    api.updateNextButtonState('button', element.properties.actions, element);

    expect(
      NextActionButtonHooksMod._spies.nextActionButtonStateRef.current
    ).toEqual({
      button: element,
      isElementActionRunning: true
    });

    expect(api.isNextButtonRunning()).toBe(true);

    // Ending element action should clear running state
    api.clearNextButtonState();
    expect(api.isNextButtonRunning()).toBe(false);
  });

  it('does not call setButtonLoader when user logic running is set to false', async () => {
    const setButtonLoader = jest.fn(async () => {});
    const api =
      NextActionButtonHooksMod.useNextActionButtonState(setButtonLoader);

    // No state yet: setting false should not call loader
    await api.setUserLogicRunning(false);
    expect(setButtonLoader).not.toHaveBeenCalled();

    // Create state then set false again: still should not call loader
    const el = { id: 'b-x', properties: { submit: true, actions: [] } };
    api.updateNextButtonState('button', [], el);
    await api.setUserLogicRunning(false);
    expect(setButtonLoader).not.toHaveBeenCalled();
  });

  it('ignores non-button element types in updateNextButtonState', () => {
    const api = NextActionButtonHooksMod.useNextActionButtonState(jest.fn());

    // container element should not be tracked as "next" button state
    api.updateNextButtonState('container', [{ type: 'next' }], {
      id: 'c1',
      properties: {}
    });

    expect(
      NextActionButtonHooksMod._spies.nextActionButtonStateRef.current
    ).toBeNull();
    expect(api.isNextButtonRunning()).toBe(false);
  });
});

describe('useNextActionButtonState - setRunningTimer', () => {
  beforeAll(() => {
    // Use fake timers to deterministically control the timeout
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    // Keep existing cleanup/reset logic in the file-wide afterEach
  });

  it('clears running state after the specified delay', () => {
    const setButtonLoader = jest.fn();
    const clearLoaders = jest.fn();

    const api = NextActionButtonHooksMod.useNextActionButtonState(
      setButtonLoader,
      clearLoaders
    );

    // Start tracking a button run
    const el = { id: 'b-timer-1', properties: { submit: true, actions: [] } };
    api.updateNextButtonState('button', [], el);
    expect(api.isNextButtonRunning()).toBe(true);

    // Schedule auto-clear
    api.setRunningTimer(500);

    // Advance time and assert it cleared
    jest.advanceTimersByTime(499);
    expect(api.isNextButtonRunning()).toBe(true);

    jest.advanceTimersByTime(1);
    expect(api.isNextButtonRunning()).toBe(false);
    expect(
      NextActionButtonHooksMod._spies.nextActionButtonStateRef.current
    ).toMatchObject({ button: el, isElementActionRunning: false });
  });

  it('does nothing if there is no tracked button when scheduling', () => {
    const setButtonLoader = jest.fn();
    const clearLoaders = jest.fn();
    const api = NextActionButtonHooksMod.useNextActionButtonState(
      setButtonLoader,
      clearLoaders
    );

    // No updateNextButtonState call here
    api.setRunningTimer(300);

    // No timers should effectively change state
    jest.advanceTimersByTime(1000);
    expect(api.isNextButtonRunning()).toBe(false);
    expect(clearLoaders).not.toHaveBeenCalled();
  });

  it('cancels a pending timer when a new run starts before timeout', () => {
    const api = NextActionButtonHooksMod.useNextActionButtonState(
      jest.fn(),
      jest.fn()
    );

    // 1) Begin run and schedule clear
    const el1 = { id: 'b-timer-2', properties: { submit: true, actions: [] } };
    api.updateNextButtonState('button', [], el1);
    api.setRunningTimer(500);

    // 2) Before 500ms, another "run" starts (e.g., user clicked another next)
    jest.advanceTimersByTime(300);

    const el2 = { id: 'b-timer-3', properties: { submit: true, actions: [] } };
    api.updateNextButtonState('button', [{ type: 'next' }], el2);

    // The previous timer should be canceled; advancing time to previous deadline
    // must NOT clear the new running state
    jest.advanceTimersByTime(200); // reaches 500ms from the first schedule
    expect(api.isNextButtonRunning()).toBe(true);

    // 3) Now schedule a new clear and let it expire
    api.setRunningTimer(400);
    jest.advanceTimersByTime(399);
    expect(api.isNextButtonRunning()).toBe(true);

    jest.advanceTimersByTime(1);
    expect(api.isNextButtonRunning()).toBe(false);
  });

  it('clearNextButtonState cancels a pending timer', () => {
    const clearLoaders = jest.fn();
    const api = NextActionButtonHooksMod.useNextActionButtonState(
      jest.fn(),
      clearLoaders
    );

    const el = { id: 'b-timer-4', properties: { submit: true, actions: [] } };
    api.updateNextButtonState('button', [], el);
    api.setRunningTimer(500);

    // Manually clear before timer fires
    api.clearNextButtonState();
    expect(api.isNextButtonRunning()).toBe(false);

    // Even if timers advance, state should remain cleared and
    // not double-trigger any cleanup
    jest.advanceTimersByTime(1000);
    expect(api.isNextButtonRunning()).toBe(false);
  });

  it('clears running state after timeout for both element-action and user-logic scenarios', () => {
    const api = NextActionButtonHooksMod.useNextActionButtonState(jest.fn());
    const el = { id: 'b-timer-5', properties: { submit: true, actions: [] } };

    api.updateNextButtonState('button', [], el);

    // Schedule an auto-clear and advance time past the delay
    api.setRunningTimer(500);
    jest.advanceTimersByTime(1000);

    // The element-action running flag should be cleared
    expect(api.isNextButtonRunning()).toBe(false);

    // Now simulate user logic entering a running state
    api.setUserLogicRunning(true);

    // Schedule another auto-clear and advance time
    api.setRunningTimer(500);
    jest.advanceTimersByTime(1000);

    // After the timer fires, overall running should be cleared again
    expect(api.isNextButtonRunning()).toBe(false);
  });
});
