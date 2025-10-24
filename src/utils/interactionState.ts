/*
 * Global state tracking if the user has interacted with the form.
 * We use this to block submitting fields so as to not create unnecessary
 * fusers.
 * Interaction state is global so that current and future feathery client
 * instances can use it.
 *
 * A custom hook on the Form component handles setting the state after
 * first interaction.
 */

let interactionDetected = false;

export const isInteractionDetected = () => interactionDetected;
export const setInteractionDetected = () => {
  interactionDetected = true;
};

export const FEATHERY_INTERACTION_EVENT = 'feathery:interaction';
export const INTERACTION_EVENT_TYPES = [
  'keydown',
  'pointerdown',
  // redundant events for greater browser support
  'mousedown',
  'touchstart'
];
