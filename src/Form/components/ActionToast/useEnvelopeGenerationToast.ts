import { useCallback, useEffect, useState } from 'react';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { DataItem } from './useAIExtractionToast';

export interface EnvelopeGenerationAction {
  type: typeof ACTION_GENERATE_ENVELOPES;
  documents?: string[];
  run_async?: boolean;
  [key: string]: any;
}

export interface OtherAction {
  type: string;
  [key: string]: any;
}

// Type guard function
function isEnvelopeGenerationAction(
  action: EnvelopeGenerationAction | OtherAction
): action is EnvelopeGenerationAction {
  return action.type === ACTION_GENERATE_ENVELOPES;
}

// Use DataItem type for consistency
export type EnvelopeDataItem = DataItem;

// Labels for envelope generation
const ENVELOPE_LABELS = {
  queued: 'Queued Document',
  incomplete: 'Generating Document',
  complete: 'Completed',
  error: 'Failed'
};

const COMPLETED_TOAST_DURATION_MS = 3200;

const isFinished = (item: EnvelopeDataItem) =>
  !(item.status === 'queued' || item.status === 'incomplete');

export const useEnvelopeGenerationToast = () => {
  const [currentEnvelopeGeneration, setCurrentEnvelopeGeneration] = useState<
    EnvelopeDataItem[]
  >([]);

  // automatically clear toast after all envelope generations are finished
  useEffect(() => {
    if (currentEnvelopeGeneration.length) {
      const allFinished = currentEnvelopeGeneration.every(isFinished);
      if (allFinished) {
        const timeoutId = setTimeout(() => {
          setCurrentEnvelopeGeneration((prev) => {
            if (prev.every(isFinished)) {
              return [];
            }
            return prev;
          });
        }, COMPLETED_TOAST_DURATION_MS);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [currentEnvelopeGeneration]);

  // take a set of actions and create toast data
  const initializeEnvelopeGeneration = useCallback(
    (actions: Array<EnvelopeGenerationAction | OtherAction>) => {
      const envelopes: EnvelopeDataItem[] = [];

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (isEnvelopeGenerationAction(action)) {
          envelopes.push({
            id: `envelope-${i}`,
            variantId: '',
            documents: action.documents,
            status: 'queued',
            labels: ENVELOPE_LABELS
          });
        }
      }
      setCurrentEnvelopeGeneration(envelopes);
    },
    []
  );

  // update envelope generation status
  const updateEnvelopeGeneration = useCallback(
    (id: string, updates: Partial<EnvelopeDataItem>) => {
      setCurrentEnvelopeGeneration((prev) => {
        const updated = prev.map((envelope) => {
          if (envelope.id === id) {
            return { ...envelope, ...updates };
          }
          return envelope;
        });
        return updated;
      });
    },
    []
  );

  const clearEnvelopeGeneration = useCallback(() => {
    setCurrentEnvelopeGeneration([]);
  }, []);

  return {
    currentEnvelopeGeneration,
    initializeEnvelopeGeneration,
    updateEnvelopeGeneration,
    clearEnvelopeGeneration
  };
};
