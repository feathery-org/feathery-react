import { featheryDoc, featheryWindow } from '../utils/browser';
import { initInfo } from '../utils/init';

export function installAmplitude(amplitudeConfig: any) {
  // Guard against an existing Amplitude installation
  if (amplitudeConfig && !featheryWindow().amplitude?.invoked) {
    (function (e, t) {
      const r = e.amplitude || { _q: [], _iq: {} };
      if (r.invoked)
        e.console &&
          console.error &&
          console.error('Amplitude snippet has been loaded.');
      else {
        const n = function (e: any, t: any) {
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
        const s = function (e: any, t: any, r: any) {
          return function (n: any) {
            e._q.push({
              name: t,
              args: Array.prototype.slice.call(r, 0),
              resolve: n
            });
          };
        };
        const o = function (e: any, t: any, r: any) {
          e._q.push({ name: t, args: Array.prototype.slice.call(r, 0) });
        };
        const i = function (e: any, t: any, r: any) {
          e[t] = function () {
            if (r)
              return {
                promise: new Promise(
                  // eslint-disable-next-line prefer-rest-params
                  s(e, t, Array.prototype.slice.call(arguments))
                )
              };
            // eslint-disable-next-line prefer-rest-params
            o(e, t, Array.prototype.slice.call(arguments));
          };
        };
        const a = function (e: any) {
          for (let t = 0; t < m.length; t++) i(e, m[t], !1);
          for (let r = 0; r < g.length; r++) i(e, g[r], !0);
        };
        r.invoked = !0;
        const c = t.createElement('script');
        // eslint-disable-next-line no-sequences,no-unused-expressions
        (c.type = 'text/javascript'),
          (c.integrity =
            'sha384-Chi7fRnlI3Vmej27YiXRbwAkES7Aor2707Qn/cpfhyw4lYue9vH/SOdlrPSFGPL/'),
          (c.crossOrigin = 'anonymous'),
          (c.async = !0),
          (c.src =
            'https://cdn.amplitude.com/libs/analytics-browser-2.3.2-min.js.gz'),
          (c.onload = function () {
            e.amplitude.runQueuedFunctions ||
              console.log('[Amplitude] Error: could not load SDK');
          });
        const u = t.getElementsByTagName('script')[0];
        u.parentNode.insertBefore(c, u);
        let l;
        for (
          let l = function () {
              // @ts-ignore
              // eslint-disable-next-line no-sequences
              return (this._q = []), this;
            },
            p = [
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
            d = 0;
          d < p.length;
          d++
        )
          n(l, p[d]);
        r.Identify = l;
        let f;
        for (
          let f = function () {
              // @ts-ignore
              // eslint-disable-next-line no-sequences
              return (this._q = []), this;
            },
            v = [
              'getEventProperties',
              'setProductId',
              'setQuantity',
              'setPrice',
              'setRevenue',
              'setRevenueType',
              'setEventProperties'
            ],
            y = 0;
          y < v.length;
          y++
        )
          n(f, v[y]);
        r.Revenue = f;
        const m = [
          'getDeviceId',
          'setDeviceId',
          'getSessionId',
          'setSessionId',
          'getUserId',
          'setUserId',
          'setOptOut',
          'setTransport',
          'reset',
          'extendSession'
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
        a(r),
          (r.createInstance = function (e: any) {
            // eslint-disable-next-line no-sequences
            return (r._iq[e] = { _q: [] }), a(r._iq[e]), r._iq[e];
          }),
          (e.amplitude = r);
      }
    })(featheryWindow(), featheryDoc());

    featheryWindow().amplitude.init(amplitudeConfig.metadata.api_key, {
      defaultTracking: true,
      minIdLength: 1
    });
  }

  if (amplitudeConfig.metadata.identify_user)
    featheryWindow().amplitude.setUserId(initInfo().userId);

  return Promise.resolve();
}
