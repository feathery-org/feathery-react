import { installPlaid } from './plaid';
import { emailLogin, installFirebase } from './firebase';
import { initializeTagManager } from './googleTagManager';

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

export async function initializeIntegrations(integrations, clientArg, init) {
  const gtm = integrations['google-tag-manager'];
  const fb = integrations.firebase;
  const plaid = integrations.plaid;

  const [, firebase] = await Promise.all([
    installPlaid(!!plaid),
    installFirebase(fb)
  ]);

  if (gtm) initializeTagManager(gtm);
  if (fb && !init) emailLogin(fb, firebase, clientArg);
}
