import { featheryDoc, featheryWindow } from '../utils/browser';

export let intercomInstalled = false;

export function installIntercom(intercomConfig: any) {
  if (intercomConfig && !intercomInstalled) {
    intercomInstalled = true;

    const workspaceId = intercomConfig.api_key;
    featheryWindow().intercomSettings = {
      api_base: 'https://api-iam.intercom.io',
      app_id: workspaceId
    };

    const w = featheryWindow();
    const ic = w.Intercom;
    if (typeof ic === 'function') {
      ic('reattach_activator');
      ic('update', w.intercomSettings);
    } else {
      const d = featheryDoc();
      const i = function () {
        // eslint-disable-next-line prefer-rest-params
        i.c(arguments);
      };
      i.q = [] as any;
      i.c = function (args: any) {
        i.q.push(args);
      };
      w.Intercom = i;
      const l = function () {
        const s = d.createElement('script');
        s.type = 'text/javascript';
        s.async = true;
        s.src = `https://widget.intercom.io/widget/${workspaceId}`;
        const x = d.getElementsByTagName('script')[0];
        x.parentNode.insertBefore(s, x);
      };
      if (featheryDoc().readyState === 'complete') {
        l();
      } else if (w.attachEvent) {
        w.attachEvent('onload', l);
      } else {
        w.addEventListener('load', l, false);
      }
    }
  }

  return Promise.resolve();
}
