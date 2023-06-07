import { featheryDoc, featheryWindow } from '../utils/browser';

export let mixpanelInstalled = false;

export function installMixpanel(mixpanelConfig: any) {
  if (mixpanelConfig && !mixpanelInstalled) {
    mixpanelInstalled = true;

    (function (f, b) {
      if (!b.__SV) {
        let i, h;
        featheryWindow().mixpanel = b;
        b._i = [];
        b.init = function (e: any, f: any, c: any) {
          function g(a: any, d: any) {
            const b = d.split('.');
            // eslint-disable-next-line eqeqeq,no-unused-expressions
            b.length == 2 && ((a = a[b[0]]), (d = b[1]));
            a[d] = function () {
              // eslint-disable-next-line prefer-rest-params
              a.push([d].concat(Array.prototype.slice.call(arguments, 0)));
            };
          }
          let a = b;
          typeof c !== 'undefined' ? (a = b[c] = []) : (c = 'mixpanel');
          a.people = a.people || [];
          a.toString = function (a: any) {
            let d = 'mixpanel';
            c !== 'mixpanel' && (d += '.' + c);
            a || (d += ' (stub)');
            return d;
          };
          a.people.toString = function () {
            return a.toString(1) + '.people (stub)';
          };
          i =
            'disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove'.split(
              ' '
            );
          for (h = 0; h < i.length; h++) g(a, i[h]);
          const j = 'set set_once union unset remove delete'.split(' ');
          a.get_group = function () {
            function b(c: any) {
              d[c] = function () {
                const call2 = [c].concat(
                  // eslint-disable-next-line prefer-rest-params
                  Array.prototype.slice.call(arguments, 0)
                );
                a.push([e, call2]);
              };
            }
            let d;
            for (
              d = {},
                e = ['get_group'].concat(
                  // eslint-disable-next-line prefer-rest-params
                  Array.prototype.slice.call(arguments, 0)
                ),
                c = 0;
              c < j.length;
              c++
            )
              b(j[c]);
            return d;
          };
          b._i.push([e, f, c]);
        };
        b.__SV = 1.2;
        const e = f.createElement('script');
        e.type = 'text/javascript';
        e.async = !0;
        e.src =
          f.location.protocol === 'file:' &&
          '//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js'.match(/^\/\//)
            ? 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js'
            : '//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
        const g = f.getElementsByTagName('script')[0];
        g.parentNode.insertBefore(e, g);
      }
    })(featheryDoc(), featheryWindow().mixpanel || []);

    featheryWindow().mixpanel.init(mixpanelConfig.metadata.api_key);
  }

  return Promise.resolve();
}
