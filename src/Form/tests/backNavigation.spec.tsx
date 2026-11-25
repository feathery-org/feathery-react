import { ClientMod, GridMod, StepHelperMod } from './testMocks';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { JSForm } from '..';

const step = (key: string) => ({
  key,
  id: key,
  servar_fields: [],
  buttons: [],
  next_conditions: [],
  previous_conditions: []
});

const eventsOfType = (type: string) =>
  ClientMod._spies.registerEvent.mock.calls
    .map(([event]: any[]) => event)
    .filter((event: any) => event.event === type);

describe('Back navigation', () => {
  beforeEach(() => {
    ClientMod._spies.state.steps = [step('step-1'), step('step-0')];
    StepHelperMod.getPrevStepKey.mockReturnValue('step-0');
    GridMod._spies.actions = [{ type: 'back' }];
  });

  afterEach(() => {
    jest.clearAllMocks();
    cleanup();
    ClientMod._spies.state.steps = null;
    StepHelperMod.getPrevStepKey.mockImplementation(() => '');
    ClientMod._spies.registerEvent.mockImplementation(() =>
      Promise.resolve(undefined)
    );
    GridMod._spies.actions = [];
  });

  it('sends a back event, not a complete event, for the step being left', async () => {
    render(<JSForm formId='f1' _internalId='iid-back-event' />);
    fireEvent.click(await screen.findByTestId('btn'));

    await waitFor(() =>
      expect(eventsOfType('back')).toEqual([
        { step_key: 'step-1', next_step_key: 'step-0', event: 'back' }
      ])
    );
    expect(eventsOfType('complete')).toEqual([]);
  });

  // The production backend rejects unknown event types until it supports 'back'
  it('still navigates back when the back event request fails', async () => {
    ClientMod._spies.registerEvent.mockImplementation((event: any) =>
      event.event === 'back'
        ? Promise.reject(new Error('400'))
        : Promise.resolve(undefined)
    );

    render(<JSForm formId='f1' _internalId='iid-back-failed' />);
    fireEvent.click(await screen.findByTestId('btn'));

    await waitFor(() =>
      expect(eventsOfType('load')).toContainEqual({
        step_key: 'step-0',
        event: 'load',
        previous_step_key: 'step-1'
      })
    );
  });
});
