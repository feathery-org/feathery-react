import { isObjectEmpty } from './primitives';
import FeatherySpinner from '../elements/components/Spinner';
import React from 'react';

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
      // A promise that settles - rejected or not - would otherwise sit in
      // this.queue forever, since nothing here ever removed one. A rejected
      // one left behind re-rejects every later Promise.all(this.queue) on the
      // SAME old failure, even once nothing is actually still failing. Drop
      // it once it settles so only promises still in flight can fail a later
      // all().
      const forget = () => {
        const idx = this.queue.indexOf(promise);
        if (idx !== -1) this.queue.splice(idx, 1);
      };
      promise.then(forget, forget);

      if (!this.awaiting) {
        this.awaiting = true;
        this._clearQueueLoader().finally(() => (this.awaiting = false));
      }
    }
  }

  // Removing a settled promise above means this.queue no longer only grows,
  // so this can't compare lengths before/after to detect a late addition the
  // way it used to. Instead it just waits until the queue is actually empty,
  // tolerating a rejection along the way (addCallback still reports it to
  // the caller; this loop only owns the loading indicator).
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
