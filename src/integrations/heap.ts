import { featheryDoc, featheryWindow } from '../utils/browser';

export let heapInstalled = false;

export function installHeap(heapConfig: any) {
  if (heapConfig && !heapInstalled) {
    heapInstalled = true;

    featheryWindow().heap = featheryWindow().heap || [];
    featheryWindow().heap.load = function (e: string) {
      featheryWindow().heap.appid = e;
      featheryWindow().heap.config = {};
      const r = featheryDoc().createElement('script');
      r.type = 'text/javascript';
      r.async = !0;
      r.src = 'https://cdn.heapanalytics.com/js/heap-' + e + '.js';
      const a = featheryDoc().getElementsByTagName('script')[0] as any;
      a.parentNode.insertBefore(r, a);
      for (
        let n = function (e: any) {
            return function () {
              featheryWindow().heap.push(
                // eslint-disable-next-line prefer-rest-params
                [e].concat(Array.prototype.slice.call(arguments, 0))
              );
            };
          },
          p = [
            'addEventProperties',
            'addUserProperties',
            'clearEventProperties',
            'identify',
            'resetIdentity',
            'removeEventProperty',
            'setEventProperties',
            'track',
            'unsetEventProperty'
          ],
          o = 0;
        o < p.length;
        o++
      )
        featheryWindow().heap[p[o]] = n(p[o]);
    };
    featheryWindow().heap.load(heapConfig.metadata.api_key);
  }

  return Promise.resolve();
}
