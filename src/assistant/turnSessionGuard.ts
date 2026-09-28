import { useEffect } from 'react';

import { getDocxEditor } from './tools/docx/docxEditorRegistry';
import { setAssistantSessionActive } from './tools/docx/syncfusionDocumentOps';

// The docx bridge raises the session flag on a turn's first document write;
// this owns the CLEAR, at turn end and unmount.
//
// `turnRunning` must be the latched turn signal (useTurnRunning), never raw
// isLoading: status dips through 'ready' mid-turn and would drop the guard.
export const useAssistantSessionClear = (
  turnRunning: boolean,
  instanceId?: string
): void => {
  useEffect(() => {
    // Resolving the editor fresh (not captured) so a mid-turn editor
    // recreation still gets cleared.
    if (!turnRunning)
      setAssistantSessionActive(getDocxEditor(instanceId), false);
    return () => setAssistantSessionActive(getDocxEditor(instanceId), false);
  }, [turnRunning, instanceId]);
};
