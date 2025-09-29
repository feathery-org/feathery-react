import { useCallback, useEffect, useState } from 'react';
import { ACTION_AI_EXTRACTION } from '../../../utils/elementActions';

export interface AIExtractionAction {
  type: typeof ACTION_AI_EXTRACTION;
  extraction_id: string;
  variant_id?: string;
  run_async?: boolean;
  run_sequential?: boolean;
  meeting_url_field_key?: string;
}

export interface OtherAction {
  type: string;
  [key: string]: any;
}

// Type guard function
function isAIExtractionAction(
  action: AIExtractionAction | OtherAction
): action is AIExtractionAction {
  return action.type === ACTION_AI_EXTRACTION;
}

interface FileSource {
  id: string;
  url: string;
  path: string;
}

export type DataItem = {
  status: 'complete' | 'incomplete' | 'error' | 'queued';
  extractionKey?: string;
  extractionVariantKey?: string | null;
  children?: DataItem[];
  id: string;
  variantId: string;
  runId?: string;
  createdAt?: string;
  fileSources?: FileSource[];
  runs?: string[];
};

interface ParentRun {
  extraction_key: string;
  extraction_variant_key: string | null;
  run_id: string;
  created_at: string;
  file_sources: FileSource[];
}

type ChildRun = {
  extraction_key: string;
  extraction_variant_key: string | null;
  run_id: string;
  created_at: string;
  file_sources: FileSource[];
  status: 'complete' | 'incomplete';
  error: string | null;
};

interface PollDataSuccess {
  status: 'complete' | 'incomplete';
  data: Record<string, any>;
  runs: string[];
  parent_runs: ParentRun[];
  child_runs: ChildRun[];
}

type PollData =
  | PollDataSuccess
  | {
      error: string;
    };

const COMPLETED_TOAST_DURATION_MS = 3200;

const isFinished = (item: DataItem) =>
  !(item.status === 'queued' || item.status === 'incomplete');

const emptyItems = (item: DataItem) => {
  if (item.status !== 'complete') return true;

  // Remove completed items with empty runs array (nothing was processed)
  return item.runs && item.runs.length > 0;
};

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
  const initializeActionExtractions = useCallback(
    (actions: Array<AIExtractionAction | OtherAction>) => {
      const extractions: DataItem[] = [];

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (isAIExtractionAction(action) && !action.run_async) {
          extractions.push({
            id: action.extraction_id,
            variantId: action.variant_id || '',
            status: 'queued',
            children: []
          });
        }
      }
      setCurrentActionExtractions(extractions);
    },
    []
  );

  // update extraction directly
  const updateExtractionInAction = useCallback(
    (extractionId: string, variantId: string, updates: Partial<DataItem>) => {
      setCurrentActionExtractions((prev) => {
        return prev
          .map((extraction) => {
            if (
              extraction.id === extractionId &&
              extraction.variantId === variantId
            ) {
              return { ...extraction, ...updates };
            }
            return extraction;
          })
          .filter(emptyItems);
      });
    },
    []
  );

  // update extraction data using polling result
  const handleExtractionStatusUpdate = useCallback(
    (
      extractionId: string,
      variantId: string,
      pollData: PollData,
      addIfMissing = false
    ) => {
      setCurrentActionExtractions((prev) => {
        const existingIndex = prev.findIndex(
          (extraction) =>
            extraction.id === extractionId && extraction.variantId === variantId
        );

        if (existingIndex !== -1) {
          const result = [...prev];
          const updatedExtraction = { ...result[existingIndex] };

          if ('error' in pollData) {
            updatedExtraction.status = 'error';
            result[existingIndex] = updatedExtraction;
            return result;
          }

          updatedExtraction.status = pollData.status;
          updatedExtraction.runs = pollData.runs;

          if (pollData.parent_runs && pollData.parent_runs[0]) {
            const parent = pollData.parent_runs[0];
            updatedExtraction.extractionKey = parent.extraction_key;
            updatedExtraction.extractionVariantKey =
              parent.extraction_variant_key;
            updatedExtraction.runId = parent.run_id;
            updatedExtraction.createdAt = parent.created_at;
            updatedExtraction.fileSources = parent.file_sources;
          }

          if (pollData.child_runs && pollData.child_runs.length > 0) {
            const children = pollData.child_runs
              .filter((child) => child.error === null)
              .map((child) => ({
                id: child.run_id,
                variantId: '',
                status: child.status,
                extractionKey: child.extraction_key,
                extractionVariantKey: child.extraction_variant_key,
                runId: child.run_id,
                createdAt: child.created_at,
                fileSources: child.file_sources
              }));

            const errorChildren = pollData.child_runs
              .filter((child) => child.error !== null)
              .map((_, index) => ({
                id: `error-${extractionId}-${index}`,
                variantId: '',
                status: 'error' as const
              }));

            updatedExtraction.children = [...children, ...errorChildren];
          }

          result[existingIndex] = updatedExtraction;
          return result.filter(emptyItems);
        }

        // If extraction doesn't exist and addIfMissing is true, create new extraction
        if (addIfMissing) {
          if ('error' in pollData) {
            const newExtraction = {
              id: extractionId,
              variantId: variantId,
              status: 'error' as const
            };
            return [...prev, newExtraction];
          }

          const newExtraction: DataItem = {
            id: extractionId,
            variantId: variantId,
            status: pollData.status,
            runs: pollData.runs
          };

          // Add parent run data if available
          if (pollData.parent_runs && pollData.parent_runs[0]) {
            const parent = pollData.parent_runs[0];
            newExtraction.extractionKey = parent.extraction_key;
            newExtraction.extractionVariantKey = parent.extraction_variant_key;
            newExtraction.runId = parent.run_id;
            newExtraction.createdAt = parent.created_at;
            newExtraction.fileSources = parent.file_sources;
          }

          // Add child runs if available
          if (pollData.child_runs && pollData.child_runs.length > 0) {
            const children: DataItem[] = pollData.child_runs
              .filter((child) => child.error === null)
              .map((child) => ({
                id: child.run_id,
                variantId: '',
                status: child.status,
                extractionKey: child.extraction_key,
                extractionVariantKey: child.extraction_variant_key,
                runId: child.run_id,
                createdAt: child.created_at,
                fileSources: child.file_sources
              }));

            const errorChildren: DataItem[] = pollData.child_runs
              .filter((child) => child.error !== null)
              .map((_, index) => ({
                id: `error-${extractionId}-${index}`,
                variantId: '',
                status: 'error'
              }));

            const allChildren = [...children, ...errorChildren];
            newExtraction.children = allChildren;

            // Check if any child is still polling
            const hasIncompleteChild = allChildren.some(
              (child) => child.status === 'incomplete'
            );

            if (hasIncompleteChild) {
              newExtraction.status = 'incomplete';
            }
          }

          return [...prev, newExtraction].filter(emptyItems);
        }

        // If extraction doesn't exist and addIfMissing is false, return unchanged
        return prev;
      });
    },
    []
  );

  const clearActionExtractions = useCallback(() => {
    setCurrentActionExtractions([]);
  }, []);

  return {
    currentActionExtractions,
    initializeActionExtractions,
    updateExtractionInAction,
    clearActionExtractions,
    handleExtractionStatusUpdate
  };
};
