import { installPlaid } from './plaid';
import {
  installFirebase,
  emailLogin as emailLoginFirebase,
  verifySMSCode
} from './firebase';
import { initializeTagManager } from './googleTagManager';
import { installSegment } from './segment';
import { installStytch, emailLogin as emailLoginStytch } from './stytch';
import { installStripe, setupPaymentMethodAndPay } from './stripe';
import TagManager from 'react-gtm-module';
import {
  gaInstalled,
  installGoogleAnalytics,
  trackGAEvent
} from './googleAnalytics';
import { getAuthClient, initState } from '../utils/init';
import Client from '../utils/client';

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
  integs: any,
  featheryClient: Client
) {
  await Promise.all([
    installPlaid(!!integs.plaid),
    installFirebase(integs.fb),
    installStytch(integs.stytch),
    installStripe(integs.stripe),
    installSegment(integs.segment),
    installGoogleAnalytics(integs['google-analytics'])
  ]);

  const gtm = integs['google-tag-manager'];
  if (gtm) initializeTagManager(gtm);
  if (integs.fb || integs.stytch) inferEmailLoginFromURL(featheryClient);
}

export function inferEmailLoginFromURL(featheryClient: Client) {
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (isAuthStytch() || (type && token)) emailLoginStytch(featheryClient);
  else emailLoginFirebase(featheryClient);
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
    initState.authId = undefined;
    initState.authPhoneNumber = undefined;
    initState.authEmail = undefined;
    Object.values(initState.renderCallbacks).forEach((renderCb: any) =>
      renderCb()
    );
  });
}

export function isAuthStytch() {
  return Boolean(global.Stytch);
}

export interface ActionData {
  fieldVal: any;
  servar: any;
  client: any;
  formattedFields: any;
  updateFieldValues: any;
  step: any;
  integrationData: any;
  targetElement: any;
}

// Action config that groups actions by servar type, orders them, configures behavior, etc.
export function getIntegrationActionConfiguration(getCardElement: any) {
  return [
    {
      servarType: 'payment_method',
      integrationKey: 'stripe',
      actionFn: setupPaymentMethodAndPay,
      targetElementFn: getCardElement,
      continue: true
    },
    {
      servarType: 'pin_input',
      integrationKey: 'firebase',
      isMatch: ({ servar }: ActionData) => servar.metadata.verify_sms_code,
      actionFn: verifySMSCode,
      continue: false
    }
  ];
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
