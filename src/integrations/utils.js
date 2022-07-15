import { installPlaid } from './plaid';
import { installFirebase, emailLogin as emailLoginFirebase } from './firebase';
import { initializeTagManager } from './googleTagManager';
import { installStytch, emailLogin as emailLoginStytch } from './stytch';

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
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (type && token) emailLoginStytch(featheryClient);
  else emailLoginFirebase(featheryClient);
}

export function transformUrlToQueryParams() {
  const { pathname, origin } = window.location;

  const queryParams = new URLSearchParams();
  if (pathname !== '/') queryParams.set('redirect', pathname);
  return `${origin}?${queryParams.toString()}`;
}

export function transformQueryParamsToUrl() {
  const { origin, search } = window.location;

  const queryParams = new URLSearchParams(search);
  const redirect = queryParams.get('redirect');
  return `${origin}${redirect ?? ''}`;
}
