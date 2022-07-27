import { installPlaid } from './plaid';
import {
  installFirebase,
  emailLogin as emailLoginFirebase,
  sendLoginCode,
  verifySMSCode
} from './firebase';
import { initializeTagManager } from './googleTagManager';
import {
  installStytch,
  emailLogin as emailLoginStytch,
  sendMagicLink
} from './stytch';
import { installStripe, setupPaymentMethod } from './stripe';
import { getStytchJwt } from '../utils/browser';

import React from 'react';

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
  integrations: any,
  clientArg: any
) {
  const gtm = integrations['google-tag-manager'];
  const fb = integrations.firebase;
  const plaid = integrations.plaid;
  const stytch = integrations.stytch;
  const stripe = integrations.stripe;

  await Promise.all([
    installPlaid(!!plaid),
    installFirebase(fb),
    installStytch(stytch),
    installStripe(stripe)
  ]);

  if (gtm) initializeTagManager(gtm);
  inferEmailLoginFromURL(clientArg);
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
