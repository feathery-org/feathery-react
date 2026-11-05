import React from 'react';
import { isObjectEmpty } from './primitives';
import FeatherySpinner from '../elements/components/Spinner';

export default class CallbackQueue {
  awaiting: any;
  queue: any;
  setLoaders: any;
  step: any;
  constructor(step: any, setLoaders: any) {
    this.queue = [];
    this.awaiting = false;
    this.step = step;
    this.setLoaders = setLoaders;
  }

  addCallback(promise: any) {
    if (promise) {
      this.setLoaders((loaders: any) => {
        if (isObjectEmpty(loaders)) return loaders;

        const payload = {
          showOn: 'on_button',
          loader: <FeatherySpinner />,
          type: 'default'
        };
        const newLoaders = this.step.buttons
          .filter(
            (button: any) => button.properties.show_loading_icon === 'on_button'
          )
          .reduce((loaders: any, button: any) => {
            loaders[button.id] = payload;
            return loaders;
          }, {});

        if (isObjectEmpty(newLoaders)) return loaders;

        return {
          ...loaders,
          ...newLoaders
        };
      });

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
