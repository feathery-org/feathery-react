/**
 * Event queue types and utilities for managing events before user interaction
 */

export interface QueuedEvent {
  eventData: any;
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class EventQueue {
  private queue: QueuedEvent[] = [];
  private isReplaying = false;

  enqueue(eventData: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        eventData,
        timestamp: Date.now(),
        resolve,
        reject
      });
    });
  }

  getAll(): QueuedEvent[] {
    return this.queue;
  }

  clear(): void {
    this.queue = [];
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }

  isReplayingEvents(): boolean {
    return this.isReplaying;
  }

  setReplayState(replaying: boolean): void {
    this.isReplaying = replaying;
  }

  /**
   * Replay all queued events using the provided replay function
   * @param replayFn Function to call for each event
   */
  async replayAll(replayFn: (eventData: any) => Promise<any>): Promise<void> {
    if (this.isEmpty()) return;

    this.setReplayState(true);

    try {
      const sortedEvents = this.getAll();

      for (const queuedEvent of sortedEvents) {
        try {
          const result = await replayFn(queuedEvent.eventData);
          queuedEvent.resolve(result);
        } catch (error) {
          queuedEvent.reject(error);
        }
      }
    } finally {
      this.clear();
      this.setReplayState(false);
    }
  }
}
