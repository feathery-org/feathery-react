import { isObjectEmpty } from './primitives';
import Spinner from '../elements/components/Spinner';
import { LINK_SUBMIT } from '../elements/basic/ButtonElement';
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

  addCallback(promise: any, loaders: any) {
    if (promise) {
      if (isObjectEmpty(loaders)) {
        const payload = {
          showOn: 'on_button',
          loader: <Spinner />,
          type: 'default'
        };
        const newLoaders = this.step.buttons
          .filter((button: any) => {
            const bp = button.properties;
            return (
              bp.link === LINK_SUBMIT && bp.show_loading_icon === 'on_button'
            );
          })
          .reduce((loaders: any, button: any) => {
            loaders[button.id] = payload;
            return loaders;
          }, {});
        if (!isObjectEmpty(newLoaders)) {
          this.setLoaders((loaders: any) => ({
            ...loaders,
            ...newLoaders
          }));
        }
      }

      this.queue.push(promise);

      if (!this.awaiting) {
        this.awaiting = true;
        this._clearQueueLoader(this.queue.length).then(
          () => (this.awaiting = false)
        );
      }
    }
  }

  _clearQueueLoader(oldLen: any) {
    return this.all().then(async () => {
      const newLen = this.queue.length;
      if (newLen > oldLen) await this._clearQueueLoader(newLen);
      else this.setLoaders({});
    });
  }

  all() {
    return Promise.all(this.queue);
  }
}
