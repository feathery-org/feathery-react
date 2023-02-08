import { installPlaid } from './plaid';
import { installFirebase } from './firebase';
import { initializeTagManager } from './googleTagManager';
import { installSegment } from './segment';
import { installStytch } from './stytch';
import { installStripe } from './stripe';
import TagManager from 'react-gtm-module';
import {
  gaInstalled,
  installGoogleAnalytics,
  trackGAEvent
} from './googleAnalytics';
import { inferEmailLoginFromURL } from '../auth/utils';
import Client from '../utils/client';
import { installArgyle } from './argyle';

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
