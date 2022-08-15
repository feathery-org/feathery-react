import { installPlaid } from './plaid';
import { installFirebase, emailLogin as emailLoginFirebase } from './firebase';
import { initializeTagManager } from './googleTagManager';
import { installStytch, emailLogin as emailLoginStytch } from './stytch';
import { getStytchJwt } from '../utils/browser';

const IMPORTED_URLS = new Set();

export function dynamicImport(dependencies, parallel = true, index = 0) {
  if (typeof dependencies === 'string') dependencies = [dependencies];
  dependencies = dependencies.filter((d) => {
    const dup = IMPORTED_URLS.has(d);
    IMPORTED_URLS.add(d);
    return !dup;
  });

  if (parallel) {
    return new Promise((resolve) => {
      global.scriptjsLoadPromise.then(($script) => {
        $script.default(dependencies, resolve);
      });
    });
  } else if (index < dependencies.length) {
    return new Promise((resolve) => {
      global.scriptjsLoadPromise.then(($script) => {
        $script.default(dependencies[index], resolve);
      });
    }).then(() => dynamicImport(dependencies, false, index + 1));
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
