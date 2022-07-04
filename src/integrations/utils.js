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
  // Unless we want to do something more complex here we need to make a
  // choice and can't just return both. Prioritize stytch
  if (stytch) return await emailLoginStytch(clientArg);
  if (fb) return await emailLoginFirebase(clientArg);
}
