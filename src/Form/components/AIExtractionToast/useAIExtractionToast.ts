import { useCallback, useEffect, useState } from 'react';
import { ACTION_AI_EXTRACTION } from '../../../utils/elementActions';
import { DataItem } from '.';

export interface ExtractionActionOptions {
  waitForCompletion?: boolean;
  [key: string]: any;
}

const COMPLETED_TOAST_DURATION_MS = 3200;

const isFinished = (item: DataItem) =>
  item.status === 'complete' || item.status === 'error';

export const useAIExtractionToast = () => {
  const [currentActionExtractions, setCurrentActionExtractions] = useState<
    DataItem[]
  >([]);

  // automatically clear toast after all extractions are finished
  useEffect(() => {
    if (currentActionExtractions.length) {
      if (currentActionExtractions.every(isFinished)) {
        const timeoutId = setTimeout(() => {
          setCurrentActionExtractions((prev) => {
            if (prev.every(isFinished)) {
              return [];
            }
            return prev;
          });
        }, COMPLETED_TOAST_DURATION_MS);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [currentActionExtractions]);

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
    (
      extractionId: string,
      variantId: string,
      pollData: any,
      addIfMissing = false
    ) => {
      setCurrentActionExtractions((prev) => {
        const existingIndex = prev.findIndex(
          (extraction) =>
            extraction.id === extractionId && extraction.variantId === variantId
        );

        // If extraction exists, update it
        if (existingIndex !== -1) {
          const result = [...prev];
          const updatedExtraction = { ...result[existingIndex] };

          // Update status
          updatedExtraction.status =
            pollData.status === 'complete'
              ? 'complete'
              : pollData.status === 'error'
              ? 'error'
              : 'polling';

          // Update parent run data
          if (pollData.parent_runs && pollData.parent_runs[0]) {
            const parent = pollData.parent_runs[0];
            updatedExtraction.extraction_key = parent.extraction_key;
            updatedExtraction.extraction_variant_key =
              parent.extraction_variant_key;
            updatedExtraction.run_id = parent.run_id;
            updatedExtraction.created_at = parent.created_at;
            updatedExtraction.file_sources = parent.file_sources;
          }

          // Update child runs
          if (pollData.child_runs && pollData.child_runs.length > 0) {
            const children: any[] = pollData.child_runs.map((child: any) => ({
              ...child,
              status: child.error
                ? 'error'
                : child.status === 'incomplete'
                ? 'polling'
                : child.status
            }));

            updatedExtraction.children = children;
          }

          result[existingIndex] = updatedExtraction;
          return result;
        }

        // If extraction doesn't exist and addIfMissing is true, create new extraction
        if (addIfMissing) {
          const newExtraction: any = {
            id: extractionId,
            variantId: variantId,
            status:
              pollData.status === 'complete'
                ? 'complete'
                : pollData.status === 'error'
                ? 'error'
                : 'polling'
          };

          // Add parent run data if available
          if (pollData.parent_runs && pollData.parent_runs[0]) {
            const parent = pollData.parent_runs[0];
            newExtraction.extraction_key = parent.extraction_key;
            newExtraction.extraction_variant_key =
              parent.extraction_variant_key;
            newExtraction.run_id = parent.run_id;
            newExtraction.created_at = parent.created_at;
            newExtraction.file_sources = parent.file_sources;
          }

          // Add child runs if available
          if (pollData.child_runs && pollData.child_runs.length > 0) {
            const children: any[] = pollData.child_runs.map((child: any) => ({
              ...child,
              status: child.error
                ? 'error'
                : child.status === 'incomplete'
                ? 'polling'
                : child.status
            }));

            newExtraction.children = children;

            // Check if any child is still polling
            const hasPollingChild = children.some(
              (child) =>
                child.status === 'polling' || child.status === 'incomplete'
            );

            if (hasPollingChild) {
              newExtraction.status = 'polling';
            }
          }

          return [...prev, newExtraction];
        }

        // If extraction doesn't exist and addIfMissing is false, return unchanged
        return prev;
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
