import { installPlaid } from './plaid';
import {
  installFirebase,
  emailLogin as emailLoginFirebase,
  sendLoginCode,
  verifySMSCode
} from './firebase';
import { initializeTagManager } from './googleTagManager';
import { installSegment } from './segment';
import {
  installStytch,
  emailLogin as emailLoginStytch,
  sendMagicLink
} from './stytch';
import { installStripe, setupPaymentMethod } from './stripe';
import { getStytchJwt } from '../utils/browser';
import TagManager from 'react-gtm-module';
import {
  gaInstalled,
  installGoogleAnalytics,
  trackGAEvent
} from './googleAnalytics';

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

export async function initializeIntegrations(integs: any, clientArg: any) {
  await Promise.all([
    installPlaid(!!integs.plaid),
    installFirebase(integs.fb),
    installStytch(integs.stytch),
    installStripe(integs.stripe),
    installSegment(integs.segment),
    installGoogleAnalytics(integs.google_analytics)
  ]);

  const gtm = integs['google-tag-manager'];
  if (gtm) initializeTagManager(gtm);
  if (integs.fb || integs.stytch) inferEmailLoginFromURL(clientArg);
}

export function inferEmailLoginFromURL(featheryClient: any) {
  const queryParams = new URLSearchParams(window.location.search);
  const stytchJwt = getStytchJwt();
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (stytchJwt || (type && token)) emailLoginStytch(featheryClient);
  else emailLoginFirebase(featheryClient);
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
      actionFn: setupPaymentMethod,
      targetElementFn: getCardElement,
      continue: true
    },
    {
      servarType: 'login',
      integrationKey: 'stytch',
      actionFn: sendMagicLink,
      continue: false
    },
    {
      servarType: 'login',
      integrationKey: 'firebase',
      actionFn: sendLoginCode,
      continue: false
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

export function trackEvent(title: string, metadata: Record<string, any>) {
  // Google Tag Manager
  // @ts-expect-error TS(2551): Property 'initialized' does not exist on type '{ d... Remove this comment to see the full error message
  if (TagManager.initialized) {
    TagManager.dataLayer({ dataLayer: { ...metadata, event: title } });
  }
  // Google Analytics
  if (gaInstalled) trackGAEvent(title, metadata);
  // Segment
  if (window.analytics) window.analytics.track(title, metadata);
}
