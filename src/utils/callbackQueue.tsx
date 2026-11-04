export default class CallbackQueue {
  awaiting: any;
  queue: any;
  setLoaders: any;
  constructor(setLoaders: any) {
    this.queue = [];
    this.awaiting = false;
    this.setLoaders = setLoaders;
  }

  addCallback(promise: any) {
    if (promise) {
      this.queue.push(promise);
      // Drop settled promises so an old rejection can't fail every later all()
      const forget = () => {
        const idx = this.queue.indexOf(promise);
        if (idx !== -1) this.queue.splice(idx, 1);
      };
      promise.then(forget, (error: unknown) => {
        forget();
        // Rethrown outside the queue so a throwing rule still reaches the
        // console and Sentry
        setTimeout(() => {
          throw error;
        });
      });

      if (!this.awaiting) {
        this.awaiting = true;
        this._clearQueueLoader().finally(() => (this.awaiting = false));
      }
    }
  }

  // Waits until the queue is empty; addCallback reports rejections, this only
  // owns the loading indicator
  _clearQueueLoader(): Promise<void> {
    return this.all()
      .catch(() => undefined)
      .then(() => {
        if (this.queue.length > 0) return this._clearQueueLoader();
        this.setLoaders({});
      });
  }

  all() {
    return Promise.all(this.queue);
  }
}
