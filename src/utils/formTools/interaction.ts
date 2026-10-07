import { featheryWindow } from '../browser';
import {
  FEATHERY_INTERACTION_EVENT,
  isInteractionDetected,
  setInteractionDetected
} from '../interactionState';

// A tool acting on the form counts as user interaction, same as the first
// keydown/pointerdown useTrackUserInteraction listens for - otherwise
// registerEvent and hidden-field flushes stay queued forever.
export const gateToolInteraction = (): void => {
  if (isInteractionDetected()) return;
  setInteractionDetected();
  featheryWindow().dispatchEvent(new CustomEvent(FEATHERY_INTERACTION_EVENT));
};
