import { featheryDoc, featheryWindow } from '../utils/browser';

export let amplitudeInstalled = false;

export function installAmplitude(amplitudeConfig: any) {
  if (amplitudeConfig && !amplitudeInstalled) {
    amplitudeInstalled = true;

    (function (e, t) {
      const n = e.amplitude || { _q: [], _iq: {} };
      if (n.invoked)
        e.console &&
          console.error &&
          console.error('Amplitude snippet has been loaded.');
      else {
        const r = function (e: any, t: any) {
          e.prototype[t] = function () {
            return (
              this._q.push({
                name: t,
                // eslint-disable-next-line prefer-rest-params
                args: Array.prototype.slice.call(arguments, 0)
              }),
              this
            );
          };
        };
        const s = function (e: any, t: any, n: any) {
          return function (r: any) {
            e._q.push({
              name: t,
              args: Array.prototype.slice.call(n, 0),
              resolve: r
            });
          };
        };
        const o = function (e: any, t: any, n: any) {
          e[t] = function () {
            if (n)
              return {
                promise: new Promise(
                  // eslint-disable-next-line prefer-rest-params
                  s(e, t, Array.prototype.slice.call(arguments))
                )
              };
          };
        };
        const i = function (e: any) {
          for (let t = 0; t < y.length; t++) o(e, y[t], !1);
          for (let n = 0; n < g.length; n++) o(e, g[n], !0);
        };
        n.invoked = !0;
        const a = t.createElement('script');
        a.type = 'text/javascript';
        a.integrity =
          'sha384-TPZhteUkZj8CAyBx+GZZytBdkuKnhKsSKcCoVCq0QSteWf/Kw5Kb9oVFUROLE1l3';
        a.crossOrigin = 'anonymous';
        a.async = !0;
        a.src =
          'https://cdn.amplitude.com/libs/analytics-browser-1.9.1-min.js.gz';
        a.onload = function () {
          e.amplitude.runQueuedFunctions ||
            console.log('[Amplitude] Error: could not load SDK');
        };
        const c = t.getElementsByTagName('script')[0];
        c.parentNode.insertBefore(a, c);
        let u;
        for (
          let u = function () {
              // @ts-ignore
              // eslint-disable-next-line no-sequences
              return (this._q = []), this;
            },
            l = [
              'add',
              'append',
              'clearAll',
              'prepend',
              'set',
              'setOnce',
              'unset',
              'preInsert',
              'postInsert',
              'remove',
              'getUserProperties'
            ],
            p = 0;
          p < l.length;
          p++
        )
          r(u, l[p]);
        n.Identify = u;
        let d;
        for (
          let d = function () {
              // @ts-ignore
              // eslint-disable-next-line no-sequences
              return (this._q = []), this;
            },
            f = [
              'getEventProperties',
              'setProductId',
              'setQuantity',
              'setPrice',
              'setRevenue',
              'setRevenueType',
              'setEventProperties'
            ],
            v = 0;
          v < f.length;
          v++
        )
          r(d, f[v]);
        n.Revenue = d;
        const y = [
          'getDeviceId',
          'setDeviceId',
          'getSessionId',
          'setSessionId',
          'getUserId',
          'setUserId',
          'setOptOut',
          'setTransport',
          'reset'
        ];
        const g = [
          'init',
          'add',
          'remove',
          'track',
          'logEvent',
          'identify',
          'groupIdentify',
          'setGroup',
          'revenue',
          'flush'
        ];
        // eslint-disable-next-line no-unused-expressions,no-sequences
        i(n),
          (n.createInstance = function (e: any) {
            // eslint-disable-next-line no-sequences
            return (n._iq[e] = { _q: [] }), i(n._iq[e]), n._iq[e];
          }),
          (e.amplitude = n);
      }
    })(featheryWindow(), featheryDoc());

    featheryWindow().amplitude.init(amplitudeConfig.metadata.api_key);
  }

  return Promise.resolve();
}
