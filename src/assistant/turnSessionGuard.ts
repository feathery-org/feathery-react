import { useEffect } from 'react';

import { getDocxEditor } from './tools/docx/docxEditorRegistry';
import { setAssistantSessionActive } from './tools/docx/syncfusionDocumentOps';

// Clears the session flag the docx bridge raised. `turnRunning` must be the
// useTurnRunning latch: raw isLoading dips mid-turn and would drop the guard.
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
