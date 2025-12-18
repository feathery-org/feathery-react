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

interface QueuedEvent {
  eventData: any;
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

let eventQueue: QueuedEvent[] = [];
let isReplayingEvents = false;

export const isInteractionDetected = () => interactionDetected;
export const setInteractionDetected = () => {
  interactionDetected = true;
};

export const queueEvent = (eventData: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    eventQueue.push({
      eventData,
      timestamp: Date.now(),
      resolve,
      reject
    });
  });
};

export const getQueuedEvents = (): QueuedEvent[] => {
  return eventQueue;
};

export const clearEventQueue = () => {
  eventQueue = [];
};

export const isReplayingQueuedEvents = () => isReplayingEvents;

export const setReplayingEvents = (replaying: boolean) => {
  isReplayingEvents = replaying;
};

export const FEATHERY_INTERACTION_EVENT = 'feathery:interaction';
export const INTERACTION_EVENT_TYPES = [
  'keydown',
  'pointerdown',
  // redundant events for greater browser support
  'mousedown',
  'touchstart'
];
