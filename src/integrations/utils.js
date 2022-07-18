import { installPlaid } from './plaid';
import { installFirebase, emailLogin as emailLoginFirebase } from './firebase';
import { initializeTagManager } from './googleTagManager';
import { installStytch, emailLogin as emailLoginStytch } from './stytch';
import { getStytchJwt } from '../utils/browser';

export function dynamicImport(dependency, async = true, index = 0) {
  if (async) {
    return new Promise((resolve) => {
      global.scriptjsLoadPromise.then(($script) => {
        $script.default(dependency, resolve);
      });
    });
  } else if (index < dependency.length) {
    return new Promise((resolve) => {
      global.scriptjsLoadPromise.then(($script) => {
        $script.default(dependency[index], resolve);
      });
    }).then(() => dynamicImport(dependency, false, index + 1));
  }
}

export async function initializeIntegrations(integrations, clientArg) {
  const gtm = integrations['google-tag-manager'];
  const fb = integrations.firebase;
  const plaid = integrations.plaid;
  const stytch = integrations.stytch;

  await Promise.all([
    installPlaid(!!plaid),
    installFirebase(fb),
    installStytch(stytch)
  ]);

  if (gtm) initializeTagManager(gtm);
  inferEmailLoginFromURL(clientArg);
}

export function inferEmailLoginFromURL(featheryClient) {
  const queryParams = new URLSearchParams(window.location.search);
  const stytchJwt = getStytchJwt();
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (stytchJwt || (type && token)) emailLoginStytch(featheryClient);
  else emailLoginFirebase(featheryClient);
}
