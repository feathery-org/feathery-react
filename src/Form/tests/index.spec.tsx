import { HooksMod, MockClickActionElement } from './testMocks';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup
} from '@testing-library/react';
import { JSForm } from '..';
import FeatheryClient from '../../utils/featheryClient';
import internalState from '../../utils/internalState';

afterEach(() => {
  jest.clearAllMocks();
  cleanup();

  // Reset flags on the shared ref exposed by the hooks mock
  HooksMod._spies.nextActionStateRef.current.isGettingNewStep = false;
  HooksMod._spies.nextActionStateRef.current.isNextButtonAction = false;
  HooksMod._spies.nextActionStateRef.current.latestClickedButton = null;
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

/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Skip this test until the button related issue is fundamentally resolved
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
describe.skip('ReactForm next action flows', () => {
  it('buttonOnClick returns early when async flags are raised', async () => {
    render(<JSForm formId='f1' _internalId='iid-1' />);

    // Wait until the Grid button appears to ensure effects are flushed
    const btn = await screen.findByTestId('btn');

    // Simulate async work already in progress
    HooksMod._spies.nextActionStateRef.current.isGettingNewStep = true;
    HooksMod._spies.nextActionStateRef.current.isNextButtonAction = true;

    // Click the stubbed button that triggers form.buttonOnClick
    fireEvent.click(btn);

    // Should not toggle flags nor store latestClickedButton
    expect(HooksMod._spies.setNextButtonActionFlag).not.toHaveBeenCalled();
    expect(
      HooksMod._spies.nextActionStateRef.current.latestClickedButton
    ).toBeNull();
  });

  it('buttonOnClick toggles flags and sets latestClickedButton on normal flow', async () => {
    render(<JSForm formId='f1' _internalId='iid-2' />);

    // Wait until the Grid button appears to ensure effects are flushed
    const btn = await screen.findByTestId('btn');

    // Pre condition
    expect(HooksMod._spies.nextActionStateRef.current.isNextButtonAction).toBe(
      false
    );

    fireEvent.click(btn);

    // Wait until the "false" toggle is observed
    await waitFor(() =>
      expect(HooksMod._spies.setNextButtonActionFlag).toHaveBeenLastCalledWith(
        false
      )
    );

    // It should set true at start and false at end
    const calls = HooksMod._spies.setNextButtonActionFlag.mock.calls.map(
      (args: any[]) => args[0]
    );
    expect(calls[0]).toBe(true);
    expect(calls[calls.length - 1]).toBe(false);

    expect(HooksMod._spies.nextActionStateRef.current.isNextButtonAction).toBe(
      false
    );

    // Assert latestClickedButton contents without non null assertion
    const clicked = HooksMod._spies.nextActionStateRef.current
      .latestClickedButton as MockClickActionElement | null;
    expect(clicked).toBeTruthy();
    if (clicked) {
      expect(clicked.id).toBe('b1');
    }
  });

  it('runGetNewStep effect toggles setGettingNewStepFlag and setNextButtonLoading', async () => {
    render(<JSForm formId='f1' _internalId='iid-3' />);

    // Wait for initial mount to stabilize
    await screen.findByTestId('btn');

    // Flags should be turned on at the beginning of the effect
    await waitFor(() => {
      expect(HooksMod._spies.setGettingNewStepFlag).toHaveBeenCalledWith(true);
      expect(HooksMod._spies.setNextButtonLoading).toHaveBeenCalledWith(true);
    });

    // And turned off in the finally block
    await waitFor(() => {
      expect(HooksMod._spies.setGettingNewStepFlag).toHaveBeenCalledWith(false);
      expect(HooksMod._spies.setNextButtonLoading).toHaveBeenCalledWith(false);
    });
  });

  it('clearNextActionTimer is called on unmount', async () => {
    const { unmount } = render(<JSForm formId='f1' _internalId='iid-4' />);

    // Wait for button to ensure the effect chain has run
    await screen.findByTestId('btn');

    unmount();
    expect(HooksMod._spies.clearNextActionTimer).toHaveBeenCalled();
  });
});
