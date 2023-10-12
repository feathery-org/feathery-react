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
import Auth from '../auth/internal/AuthIntegrationInterface';
import Client from '../utils/client';
import { installArgyle } from './argyle';
import { installHeap } from './heap';
import { featheryWindow } from '../utils/browser';
import { installIntercom } from './intercom';
import { installAmplitude } from './amplitude';
import { installMixpanel } from './mixpanel';
import {
  installRudderStack,
  rudderStackInstalled,
  trackRudderEvent
} from './rudderstack';

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
        $script.default.order(dependencies, resolve);
      });
    });
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
    installGoogleAnalytics(integs['google-analytics']),
    installHeap(integs.heap),
    installAmplitude(integs.amplitude),
    installMixpanel(integs.mixpanel),
    installIntercom(integs['intercom-embedded']),
    installRudderStack(integs.rudderstack)
  ]);

  const gtm = integs['google-tag-manager'];
  if (gtm) initializeTagManager(gtm);
  if (integs.firebase || integs.stytch)
    return Auth.inferLoginOnLoad(featheryClient);
}

export interface ActionData {
  pmField?: any;
  triggerElement?: any;
  triggerElementType?: 'button' | 'container';
  client: any;
  formattedFields?: any;
  updateFieldValues: any;
  integrationData: any;
  targetElement?: any;
}

export function trackEvent(
  integrations: any,
  title: string,
  stepId: string,
  formId: string,
  fieldData?: any
) {
  const metadata: Record<string, string> = { formId };
  if (stepId) metadata.stepId = stepId;

  // Google Tag Manager
  // @ts-expect-error TS(2551): Property 'initialized' does not exist on type '{ d... Remove this comment to see the full error message
  if (TagManager.initialized) {
    let gtmData = { ...metadata };
    if (fieldData?.['google-tag-manager'])
      gtmData = { ...gtmData, ...fieldData['google-tag-manager'] };
    TagManager.dataLayer({ dataLayer: { ...gtmData, event: title } });
  }
  // RudderStack
  if (rudderStackInstalled)
    trackRudderEvent(title, metadata, integrations?.rudderstack);
  // Google Analytics
  if (gaInstalled) trackGAEvent(formId, title, stepId);
  // Segment
  const segmentData: any = { ...metadata };
  if (fieldData?.segment) segmentData.submittedData = fieldData;
  if (featheryWindow().analytics)
    featheryWindow().analytics.track(title, segmentData);

  const amplitudeData: any = { ...metadata };
  if (fieldData?.amplitude) amplitudeData.submittedData = fieldData;
  if (featheryWindow().amplitude)
    featheryWindow().amplitude.track(title, metadata);

  if (featheryWindow().mixpanel)
    featheryWindow().mixpanel.track(title, metadata);
}
