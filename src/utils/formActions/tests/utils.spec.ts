import {
  diffInlineErrorSnapshots,
  snapshotInlineErrors
} from '../utils';

describe('snapshotInlineErrors / diffInlineErrorSnapshots', () => {
  it('detects a new error on a different repeat row', () => {
    const before = snapshotInlineErrors({
      inlineErrors: { f: { byIndex: { 0: { message: 'A' } } } }
    });
    const after = snapshotInlineErrors({
      inlineErrors: {
        f: { byIndex: { 0: { message: 'A' }, 1: { message: 'B' } } }
      }
    });

    expect(diffInlineErrorSnapshots(before, after)).toEqual([
      { key: 'f', repeatIndex: 1, message: 'B' }
    ]);
  });

  it('keeps (key, repeatIndex) as separate fields so literal keys cannot collide', () => {
    // Row 0 of a repeated field `f` next to a literal field named `f[0]`
    const after = snapshotInlineErrors({
      inlineErrors: {
        f: { byIndex: { 0: { message: 'repeat row 0' } } },
        'f[0]': { message: 'literal field' }
      }
    });
    const reports = diffInlineErrorSnapshots(new Map(), after);

    expect(reports).toHaveLength(2);
    expect(reports).toEqual(
      expect.arrayContaining([
        { key: 'f', repeatIndex: 0, message: 'repeat row 0' },
        { key: 'f[0]', message: 'literal field' }
      ])
    );
  });

  it('reports field-wide errors without a repeatIndex and skips empty messages', () => {
    const after = snapshotInlineErrors({
      inlineErrors: {
        name: { message: 'required' },
        rep: { byIndex: { 0: { message: '' }, 2: { message: 'bad' } } }
      }
    });

    expect(diffInlineErrorSnapshots(new Map(), after)).toEqual(
      expect.arrayContaining([
        { key: 'name', message: 'required' },
        { key: 'rep', repeatIndex: 2, message: 'bad' }
      ])
    );
  });

  it('reports nothing when the snapshots match', () => {
    const errors = {
      inlineErrors: { f: { byIndex: { 1: { message: 'same' } } } }
    };
    const before = snapshotInlineErrors(errors);
    const after = snapshotInlineErrors(errors);
    expect(diffInlineErrorSnapshots(before, after)).toEqual([]);
  });
});

describe('markInteraction', () => {
  it('releases what the form held for a first interaction exactly once', () => {
    jest.isolateModules(() => {
      const { markInteraction } = require('../utils');
      const {
        FEATHERY_INTERACTION_EVENT,
        isInteractionDetected
      } = require('../../interactionState');
      // Keeps the event from the module-load client, which would flush over the network
      const dispatch = jest
        .spyOn(window, 'dispatchEvent')
        .mockImplementation(() => true);

      markInteraction();
      markInteraction();

      expect(isInteractionDetected()).toBe(true);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][0].type).toBe(FEATHERY_INTERACTION_EVENT);
      dispatch.mockRestore();
    });
  });
});
