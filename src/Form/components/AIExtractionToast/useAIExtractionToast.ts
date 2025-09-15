import { useCallback, useState } from 'react';
import { ACTION_AI_EXTRACTION } from '../../../utils/elementActions';
import { DataItem } from '.';

export interface ExtractionActionOptions {
  waitForCompletion?: boolean;
  [key: string]: any;
}

export const useAIExtractionToast = () => {
  const [currentActionExtractions, setCurrentActionExtractions] = useState<
    DataItem[]
  >([]);

  // take a set of actions and create toast data
  const initializeActionExtractions = useCallback((actions: any[]) => {
    const extractions: DataItem[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.type === ACTION_AI_EXTRACTION && !action.run_async) {
        extractions.push({
          id: action.extraction_id,
          variantId: action.variant_id || '',
          status: 'queued',
          isSequential: action.run_sequential && extractions.length > 0,
          children: []
        });
      }
    }

    setCurrentActionExtractions(extractions);
  }, []);

  // update extraction directly
  const updateExtractionInAction = useCallback(
    (extractionId: string, variantId: string, updates: Partial<DataItem>) => {
      setCurrentActionExtractions((prev) => {
        return prev.map((extraction) => {
          if (
            extraction.id === extractionId &&
            extraction.variantId === variantId
          ) {
            return { ...extraction, ...updates };
          }
          return extraction;
        });
      });
    },
    []
  );

  const clearActionExtractions = useCallback(() => {
    setCurrentActionExtractions([]);
  }, []);

  // update extraction data using polling result
  const handleExtractionStatusUpdate = useCallback(
    (extractionId: string, variantId: string, pollData: any) => {
      setCurrentActionExtractions((prev) => {
        const result = prev.map((extraction) => {
          if (
            extraction.id === extractionId &&
            extraction.variantId === variantId
          ) {
            const updatedExtraction = { ...extraction };

            updatedExtraction.status =
              pollData.status === 'complete'
                ? 'complete'
                : pollData.status === 'error'
                ? 'error'
                : 'polling';

            if (pollData.parent_runs && pollData.parent_runs[0]) {
              const parent = pollData.parent_runs[0];
              (updatedExtraction as any).extraction_key = parent.extraction_key;
              (updatedExtraction as any).extraction_variant_key =
                parent.extraction_variant_key;
              (updatedExtraction as any).run_id = parent.run_id;
              (updatedExtraction as any).created_at = parent.created_at;
              (updatedExtraction as any).file_sources = parent.file_sources;
            }

            if (pollData.child_runs && pollData.child_runs.length > 0) {
              const children: any[] = [];
              // Add child runs
              pollData.child_runs.forEach((child: any) => {
                children.push({
                  ...child,
                  status: child.error
                    ? 'error'
                    : child.status === 'incomplete'
                    ? 'polling'
                    : child.status
                });
              });

              updatedExtraction.children = children;

              const hasPollingChild = children.some(
                (child) =>
                  child.status === 'polling' || child.status === 'incomplete'
              );
              if (hasPollingChild) {
                updatedExtraction.status = 'polling';
              }
            }

            return updatedExtraction;
          }
          return extraction;
        });

        return result;
      });
    },
    []
  );

  return {
    currentActionExtractions,
    initializeActionExtractions,
    updateExtractionInAction,
    clearActionExtractions,
    handleExtractionStatusUpdate
  };
};
