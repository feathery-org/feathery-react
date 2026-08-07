import { act, renderHook } from '@testing-library/react';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { useEnvelopeGenerationToast } from './useEnvelopeGenerationToast';

const action = {
  type: ACTION_GENERATE_ENVELOPES,
  documents: ['doc-1']
};

describe('useEnvelopeGenerationToast', () => {
  it('announces an outcome whether or not the generation item is still there', () => {
    const { result } = renderHook(() => useEnvelopeGenerationToast());

    act(() => result.current.initializeEnvelopeGeneration([action]));
    act(() => result.current.showEnvelopeOutcome('envelope-0', 'Sent'));
    expect(result.current.currentEnvelopeGeneration).toEqual([
      expect.objectContaining({
        id: 'envelope-0',
        status: 'complete',
        // Kept from the generation item, so the count suffix survives.
        documents: ['doc-1'],
        labels: expect.objectContaining({ complete: 'Sent' })
      })
    ]);

    // What the editor flows hit: the outcome lands after the generation toast
    // has already been cleared.
    act(() => result.current.clearEnvelopeGeneration());
    act(() =>
      result.current.showEnvelopeOutcome('envelope-0', 'Saved as Draft', [
        'doc-1'
      ])
    );
    expect(result.current.currentEnvelopeGeneration).toEqual([
      expect.objectContaining({
        id: 'envelope-0',
        status: 'complete',
        documents: ['doc-1'],
        labels: expect.objectContaining({ complete: 'Saved as Draft' })
      })
    ]);

    // An update for a cleared item stays a no-op - only outcomes re-add.
    act(() => result.current.clearEnvelopeGeneration());
    act(() =>
      result.current.updateEnvelopeGeneration('envelope-0', {
        status: 'incomplete'
      })
    );
    expect(result.current.currentEnvelopeGeneration).toEqual([]);
  });
});
