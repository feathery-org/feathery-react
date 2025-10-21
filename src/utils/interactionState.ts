let interactionDetected = false;

export const isInteractionDetected = () => interactionDetected;
export const setInteractionDetected = () => {
  interactionDetected = true;
};

export const FEATHERY_INTERACTION_EVENT = 'feathery:interaction';
export const INTERACTION_EVENT_TYPES = [
  'keydown',
  'pointerdown',
  // redundant, fallback events
  'mousedown',
  'touchstart'
];
