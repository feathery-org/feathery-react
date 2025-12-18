/**
 * Event queue for holding events before user interaction
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
        timestamp: Date.now(), // TODO: pass UTC timestamp to BE
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
   * Apply replay function to all queued events
   * @param replayFn Function to call for each event
   */
  async replayAll(replayFn: (eventData: any) => Promise<any>): Promise<void> {
    if (this.isEmpty()) return;

    this.setReplayState(true);

    try {
      // while loop handles events added to queue while replaying
      while (!this.isEmpty()) {
        const eventsToReplay = [...this.queue];
        this.queue = [];

        for (const queuedEvent of eventsToReplay) {
          try {
            const result = await replayFn(queuedEvent.eventData);
            queuedEvent.resolve(result);
          } catch (error) {
            queuedEvent.reject(error);
          }
        }
      }
    } finally {
      this.setReplayState(false);
    }
  }
}
