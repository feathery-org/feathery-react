import {
  fieldInputContainer,
  flushFieldInputChanges,
  presentedFieldInputs,
  mountFieldInput,
  registerFieldInputChange,
  subscribeFieldInput
} from './fieldInputPresentation';
import { featheryDoc, featheryWindow } from '../utils/browser';
import { isInteractionDetected } from '../utils/interactionState';

it('recognizes native input interaction outside the form DOM so saving is enabled', () => {
  const container = featheryDoc().createElement('div');
  const input = featheryDoc().createElement('input');
  container.append(input);
  expect(isInteractionDetected()).toBe(false);
  const release = mountFieldInput('chat-input', 'name', 0, container);
  // Observe the interaction signal without starting unrelated global clients.
  const signal = jest
    .spyOn(featheryWindow(), 'dispatchEvent')
    .mockReturnValue(true);
  try {
    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isInteractionDetected()).toBe(true);
    expect(signal).toHaveBeenCalled();
  } finally {
    signal.mockRestore();
    release();
  }
});

it('flushes only the mounted fields selected for a chat answer', () => {
  const first = mountFieldInput(
    'claim-a',
    'name',
    0,
    featheryDoc().createElement('div')
  );
  const second = mountFieldInput(
    'claim-a',
    'name',
    1,
    featheryDoc().createElement('div')
  );
  const flushFirst = jest.fn();
  const flushSecond = jest.fn();
  const unregisterFirst = registerFieldInputChange(
    'claim-a',
    'name',
    0,
    flushFirst
  );
  const unregisterSecond = registerFieldInputChange(
    'claim-a',
    'name',
    1,
    flushSecond
  );
  try {
    flushFieldInputChanges('claim-a', [{ key: 'name', repeatIndex: 1 }]);
    expect(flushFirst).not.toHaveBeenCalled();
    expect(flushSecond).toHaveBeenCalledTimes(1);
    unregisterSecond();
    expect(() =>
      flushFieldInputChanges('claim-a', [
        { key: 'name' },
        { key: 'name', repeatIndex: 1 }
      ])
    ).toThrow('still loading');
    expect(flushFirst).not.toHaveBeenCalled();
  } finally {
    unregisterFirst();
    unregisterSecond();
    first();
    second();
  }
});

it('keeps a later mount when an earlier cleanup repeats for the same container', () => {
  const container = featheryDoc().createElement('div');
  const releaseFirst = mountFieldInput('reused-input', 'name', 0, container);
  releaseFirst();
  const releaseNext = mountFieldInput('reused-input', 'name', 0, container);
  releaseFirst();
  expect(fieldInputContainer('reused-input', 'name')).toBe(container);
  releaseNext();
});

it('keeps mounted inputs separate by form and row and releases them on exit', () => {
  const input = featheryDoc().createElement('div');
  const listener = jest.fn();
  const unsubscribe = subscribeFieldInput('claim-a', 'signature', 0, listener);
  const release = mountFieldInput('claim-a', 'signature', 0, input);
  expect(fieldInputContainer('claim-a', 'signature')).toBe(input);
  expect(presentedFieldInputs('claim-a')).toEqual([
    { key: 'signature', repeatIndex: 0 }
  ]);
  expect(presentedFieldInputs('claim-b')).toEqual([]);
  expect(fieldInputContainer('claim-b', 'signature')).toBeNull();
  expect(fieldInputContainer('claim-a', 'signature', 1)).toBeNull();
  expect(() =>
    mountFieldInput(
      'claim-a',
      'signature',
      0,
      featheryDoc().createElement('div')
    )
  ).toThrow('already open');
  release();
  expect(fieldInputContainer('claim-a', 'signature')).toBeNull();
  expect(presentedFieldInputs('claim-a')).toEqual([]);
  expect(listener).toHaveBeenCalledTimes(2);
  release();
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});
