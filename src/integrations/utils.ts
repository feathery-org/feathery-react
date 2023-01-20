import { installPlaid } from './plaid';
import { installFirebase, emailLogin as emailLoginFirebase } from './firebase';
import { initializeTagManager } from './googleTagManager';
import { installSegment } from './segment';
import { installStytch, emailLogin as emailLoginStytch } from './stytch';
import { installStripe } from './stripe';
import TagManager from 'react-gtm-module';
import {
  gaInstalled,
  installGoogleAnalytics,
  trackGAEvent
} from './googleAnalytics';
import { getAuthClient, initState } from '../utils/init';
import Client from '../utils/client';
import { rerenderAllForms } from '../utils/formHelperFunctions';
import { installArgyle } from './argyle';
import { authState } from '../elements/components/FeatheryAuthGate';

const IMPORTED_URLS = new Set();

export function dynamicImport(
  dependencies: any,
  parallel = true,
  index = 0
): any {
  if (typeof dependencies === 'string') dependencies = [dependencies];
  dependencies = dependencies.filter((d: any) => {
    const dup = IMPORTED_URLS.has(d);
    IMPORTED_URLS.add(d);
    return !dup;
  });
  if (dependencies.length === 0) return Promise.resolve();

  if (parallel) {
    return new Promise((resolve) => {
      global.scriptjsLoadPromise.then(($script: any) => {
        $script.default(dependencies, resolve);
      });
    });
  } else if (index < dependencies.length) {
    return new Promise((resolve) => {
      global.scriptjsLoadPromise.then(($script: any) => {
        $script.default(dependencies[index], resolve);
      });
    }).then(() => dynamicImport(dependencies, false, index + 1));
  }
}

export async function initializeIntegrations(
  integs: Record<string, any>,
  featheryClient: Client
) {
  await Promise.all([
    installArgyle(!!integs.argyle),
    installPlaid(!!integs.plaid),
    installFirebase(integs.firebase),
    installStytch(integs.stytch),
    installStripe(integs.stripe),
    installSegment(integs.segment),
    installGoogleAnalytics(integs['google-analytics'])
  ]);

  const gtm = integs['google-tag-manager'];
  if (gtm) initializeTagManager(gtm);
  if (integs.firebase || integs.stytch)
    return inferEmailLoginFromURL(featheryClient);
}

export function inferEmailLoginFromURL(featheryClient: Client) {
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (isAuthStytch() || (type && token))
    return emailLoginStytch(featheryClient);
  else return emailLoginFirebase(featheryClient);
}

export function inferAuthLogout() {
  let logout;
  if (isAuthStytch()) {
    logout = () => getAuthClient().session.revoke();
  } else if (global.firebase) {
    logout = () => global.firebase.auth().signOut();
  }

  // logout may not have a value in certain cases, i.e. stytch is already logged out so there is no jwt
  if (!logout) return;

  logout().then(() => {
    authState.onLogout();
    initState.authId = undefined;
    rerenderAllForms();
  });
}

export function isAuthStytch() {
  const authClient = getAuthClient();
  if (!authClient) return;
  const isAuthClientStytch = Object.getOwnPropertySymbols(authClient)
    .map((symbol) => symbol.toString())
    .includes('Symbol(stytch__internal)');
  // Still check global.Stytch for back compat, if customer is using old package.
  // TODO: remove the global.Stytch part of this || once the new package has been out for longer
  return global.Stytch || isAuthClientStytch;
}

export function getAuthIntegrationMetadata(
  integrations: null | Record<string, any>
): undefined | any {
  return integrations?.stytch?.metadata ?? integrations?.firebase?.metadata;
}

export interface ActionData {
  servar?: any;
  triggerElement?: any;
  triggerElementType?: 'button' | 'container';
  client: any;
  formattedFields: any;
  updateFieldValues: any;
  integrationData: any;
  targetElement?: any;
}

export function trackEvent(title: string, stepId: string, formId: string) {
  const metadata = { stepId, formId };

  // Google Tag Manager
  // @ts-expect-error TS(2551): Property 'initialized' does not exist on type '{ d... Remove this comment to see the full error message
  if (TagManager.initialized) {
    TagManager.dataLayer({ dataLayer: { ...metadata, event: title } });
  }
  // Google Analytics
  if (gaInstalled) trackGAEvent(formId, title, stepId);
  // Segment
  if (window.analytics) window.analytics.track(title, metadata);
}
