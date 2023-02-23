export let heapInstalled = false;

export function installHeap(heapConfig: any) {
  if (heapConfig && !heapInstalled) {
    heapInstalled = true;

    window.heap = window.heap || [];
    window.heap.load = function (e: string) {
      window.heap.appid = e;
      window.heap.config = {};
      const r = document.createElement('script');
      r.type = 'text/javascript';
      r.async = !0;
      r.src = 'https://cdn.heapanalytics.com/js/heap-' + e + '.js';
      const a = document.getElementsByTagName('script')[0] as any;
      a.parentNode.insertBefore(r, a);
      for (
        let n = function (e: any) {
            return function () {
              window.heap.push(
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
        window.heap[p[o]] = n(p[o]);
    };
    window.heap.load(heapConfig.metadata.api_key);
  }

  return Promise.resolve();
}
