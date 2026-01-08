import { fieldValues, initFormsPromise, initInfo } from '../init';
import { encodeGetParams } from '../primitives';
import { API_URL, STATIC_URL } from '.';
import { OfflineRequestHandler } from '../offlineRequestHandler';
import { AlloyEntities, LoanProCustomerObject } from '../internalState';
import { featheryWindow } from '../browser';
import {
  apiFetch,
  customRolloutAction as apiCustomRolloutAction,
  sendEmail as apiSendEmail,
  pollForCompletion,
  IntegrationActionIds,
  IntegrationActionOptions,
  parseAPIError
} from '@feathery/client-utils';

export const TYPE_MESSAGES_TO_IGNORE = [
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3571287943/
  'Failed to fetch',
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3529742129/
  'Load failed'
];

// THIRD-PARTY INTEGRATIONS
export default class IntegrationClient {
  formKey: string;
  version?: string;
  _noSave?: boolean;
  ignoreNetworkErrors: any; // this should be a ref
  draft: boolean;
  bypassCDN: boolean;
  submitQueue: Promise<any>;
  eventQueue: Promise<any>;
  offlineRequestHandler: OfflineRequestHandler;
  showNetworkErrorAlert: boolean;

  constructor(
    formKey = '',
    ignoreNetworkErrors?: any,
    draft = false,
    bypassCDN = false
  ) {
    this.formKey = formKey;
    this.ignoreNetworkErrors = ignoreNetworkErrors;
    this.draft = draft;
    this.bypassCDN = bypassCDN;
    this.submitQueue = Promise.resolve();
    this.eventQueue = Promise.resolve();
    this.showNetworkErrorAlert = true;
    this.offlineRequestHandler = new OfflineRequestHandler(formKey, () =>
      this.errorCallback()
    );
  }

  errorCallback() {
    if (!this.showNetworkErrorAlert) return;
    this.showNetworkErrorAlert = false;
    featheryWindow().alert(
      'There was a network error while submitting the form. Please refresh the page and try again.'
    );
  }

  _fetch(
    url: any,
    options?: any,
    parseResponse = true,
    propagateNetworkErrors = false
  ) {
    const { sdkKey } = initInfo();
    return apiFetch(sdkKey, url, options, parseResponse).catch((e) => {
      // Ignore TypeErrors if form has redirected because `fetch` in
      // Safari will error after redirect
      const ignore =
        this.ignoreNetworkErrors?.current ||
        TYPE_MESSAGES_TO_IGNORE.includes(e.message);
      if (ignore && !propagateNetworkErrors && e instanceof TypeError) return;
      throw e;
    });
  }

  async fetchPlaidLinkToken(kwargs: Record<string, any>) {
    await initFormsPromise;
    const { userId } = initInfo();
    const params = encodeGetParams({
      form_key: this.formKey,
      fuser_key: userId,
      ...kwargs
    });

    const res = await this._fetch(`${API_URL}plaid/link_token/?${params}`);
    if (!res) return { err: 'Ran into an error' };

    const payload = await res.json();
    if (res?.status === 200) return { token: payload.link_token };
    return { err: parseAPIError(payload) || 'Ran into an error' };
  }

  async fetchPlaidVerificationStatus(sessionId: string) {
    await initFormsPromise;
    const { userId } = initInfo();
    const params = encodeGetParams({
      session_id: sessionId,
      form_key: this.formKey,
      fuser_key: userId
    });
    const url = `${API_URL}plaid/verification_status/?${params}`;
    return this._fetch(url).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  async submitPlaidUserData(publicToken: string) {
    await initFormsPromise;
    const { userId } = initInfo();
    const url = `${API_URL}plaid/user_data/`;
    const data = {
      public_token: publicToken,
      form_key: this.formKey,
      fuser_key: userId
    };
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  async fetchArgyleUserToken() {
    await initFormsPromise;
    const { userId } = initInfo();
    const params = encodeGetParams({
      form_key: this.formKey,
      fuser_key: userId
    });
    const url = `${API_URL}argyle/user_token/?${params}`;
    return this._fetch(url).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  async triggerFlinksIframeAuthorization() {
    await initFormsPromise;
    const { userId } = initInfo();
    const params: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId
    };
    const url = `${API_URL}flinks/authorize-iframe/?${encodeGetParams(params)}`;
    return this._fetch(url);
  }

  async triggerFlinksLoginId(
    accountId: string,
    token: string,
    loginId?: string
  ) {
    await initFormsPromise;
    const { userId } = initInfo();
    const params: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      account_id: accountId
    };
    if (loginId) params.login_id = loginId;
    if (token) params.token = token;
    const url = `${API_URL}flinks/login-id/?${encodeGetParams(params)}`;
    return this._fetch(url);
  }

  addressSearchResults(searchTerm: any, country: any, city: boolean) {
    const params = encodeGetParams({
      search_term: searchTerm,
      country,
      city_search: city ? 'true' : ''
    });
    const url = `${API_URL}integration/address/search/?${params}`;
    return this._fetch(url).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  addressDetail(addressId: any) {
    const params = encodeGetParams({ address_id: addressId });
    const url = `${API_URL}integration/address/detail/?${params}`;
    return this._fetch(url).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  verifyRecaptchaToken(token: string) {
    const url = `${API_URL}google/recaptcha/verify/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({ token })
    };
    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  // Stripe
  async setupPaymentIntent(paymentMethodFieldId: any) {
    await initFormsPromise;
    const { userId } = initInfo();
    const url = `${API_URL}stripe/payment_method/`;
    const data = {
      form_key: this.formKey,
      ...(userId ? { user_id: userId } : {}),
      field_id: paymentMethodFieldId
    };
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  // Stripe
  async retrievePaymentMethodData(
    paymentMethodFieldId: any,
    stripePaymentMethodId: any
  ) {
    await initFormsPromise;
    const { userId } = initInfo();
    const params = encodeGetParams({
      field_id: paymentMethodFieldId,
      form_key: this.formKey,
      ...(userId ? { user_id: userId } : {}),
      stripe_payment_method_id: stripePaymentMethodId
    });
    const url = `${API_URL}stripe/payment_method/card/?${params}`;
    return this._fetch(url).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  // Stripe
  async _payment(method: 'POST' | 'PUT', extraParams = {}) {
    await initFormsPromise;
    const { userId } = initInfo();
    const url = `${API_URL}stripe/payment/`;
    const data = {
      form_key: this.formKey,
      user_id: userId,
      ...extraParams
    };
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method,
      body: JSON.stringify(data)
    };
    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  createPayment() {
    return this._payment('POST');
  }

  async createCheckoutSession(successUrl: string, cancelUrl?: string) {
    await initFormsPromise;
    const { userId } = initInfo();
    const url = `${API_URL}stripe/checkout/`;
    const data = {
      form_key: this.formKey,
      user_id: userId,
      success_url: successUrl,
      cancel_url: cancelUrl || ''
    };
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  async sendEmailOTP(receiverEmail: string) {
    const { userId } = initInfo();
    const url = `${API_URL}otp/send/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        email_address: receiverEmail,
        form_key: this.formKey,
        fuser_key: userId,
        type: 'email-otp'
      })
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  async sendSMSMessage(phoneNumber: string, message: any) {
    const { userId } = initInfo();
    const url = `${API_URL}otp/send/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        phone_number: phoneNumber,
        form_key: this.formKey,
        fuser_key: userId,
        message,
        type: message ? 'sms-message' : 'sms-otp'
      })
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  async verifyOTP(otp: string, type: string) {
    const { userId } = initInfo();
    const url = `${API_URL}otp/verify/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        otp,
        fuser_key: userId,
        form_key: this.formKey,
        otp_type: type
      })
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  ENVELOPE_CHECK_INTERVAL = 2000;
  ENVELOPE_MAX_TIME = 3 * 60 * 1000;

  generateEnvelopes(action: Record<string, string>) {
    const { userId, sdkKey } = initInfo();
    const signer = fieldValues[action.envelope_signer_field_key];
    const runAsync = action.run_async ?? true;
    const documents = action.documents ?? [];
    const payload: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      documents,
      signer_email: signer,
      repeatable: action.repeatable ?? false,
      run_async: runAsync
    };

    const url = `${API_URL}document/form/generate/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(payload)
    };

    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        const data = await response.json();
        if (response.ok) {
          if (!runAsync || data.files) return data;

          const pollUrl = `${API_URL}document/form/generate/poll/?fid=${userId}&dids=${documents}`;
          return await pollForCompletion(
            sdkKey,
            pollUrl,
            this.ENVELOPE_CHECK_INTERVAL,
            this.ENVELOPE_MAX_TIME,
            'Envelope generation'
          );
        } else throw Error(parseAPIError(data));
      }
    });
  }

  QUIK_CHECK_INTERVAL = 2000;
  QUIK_MAX_TIME = 2 * 60 * 1000;

  generateQuikEnvelopes(action: Record<string, string>) {
    const { userId } = initInfo();
    const payload: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      run_async: true,
      ...action
    };

    if (action.form_fill_type === 'html' && action.review_action === 'sign') {
      if (!action.auth_user_id) {
        throw new Error('No connection name provided for Quik DocuSign config');
      }
    }

    const fieldVal = fieldValues[action.quik_tags_field_key];

    if (action.quik_tags_field_key) {
      if (typeof fieldVal === 'string') {
        payload.tags = (fieldVal as string).split(',').map((tag) => tag.trim());
      } else if (fieldVal instanceof Array) {
        payload.tags = fieldVal;
      } else {
        payload.tags = [JSON.stringify(fieldVal)];
      }
    }

    const url = `${STATIC_URL}quik/document/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(payload)
    };
    this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });

    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = this.QUIK_MAX_TIME / this.QUIK_CHECK_INTERVAL;
      const pollUrl = `${STATIC_URL}quik/document/poll/?fuser_key=${userId}`;

      const checkCompletion = async () => {
        const response = await this._fetch(pollUrl);

        if (response?.status === 400) {
          return resolve({ error: parseAPIError(await response.json()) });
        } else if (response?.status === 200) {
          const data = await response.json();

          if (data.status === 'complete') {
            return resolve(data);
          } else {
            attempts += 1;

            if (attempts < maxAttempts) {
              setTimeout(checkCompletion, this.QUIK_CHECK_INTERVAL);
            } else {
              console.warn('Quik document generation took too long...');
              return resolve({});
            }
          }
        }
      };

      setTimeout(checkCompletion, this.QUIK_CHECK_INTERVAL); // Check every 2 seconds for a response
    });
  }

  getQuikForms({ dealerNames }: { dealerNames: string[] }) {
    const dealerStr = encodeURIComponent(dealerNames.join(','));
    const url = `${API_URL}quik/meta/dealer/?form_key=${this.formKey}&dealer=${dealerStr}`;
    return this._fetch(url).then(async (response) => {
      if (response?.ok) return await response.json();
      return {};
    });
  }

  getQuikFormRoles({ formIds }: { formIds: number[] }) {
    const url = `${API_URL}quik/meta/form-roles/?form_key=${
      this.formKey
    }&quik_form_ids=${formIds.join(',')}`;
    return this._fetch(url).then(async (response) => {
      if (response?.ok) return await response.json();
      return {};
    });
  }

  getQuikAccountForms({
    custodian,
    accountType,
    isTransition = false
  }: {
    custodian: string;
    accountType: string;
    isTransition?: boolean;
  }) {
    const url = `${API_URL}quik/meta/account-forms/?form_key=${this.formKey}&custodian=${custodian}&account_type=${accountType}&is_transition=${isTransition}`;
    return this._fetch(url).then(async (response) => {
      if (response?.ok) return await response.json();
      return {};
    });
  }

  PERSONA_CHECK_INTERVAL = 2000;
  PERSONA_MAX_TIME = 60 * 2000;

  pollPersonaResponse() {
    return new Promise((resolve) => {
      let attempts = 0;
      const MAX_ATTEMPTS = this.PERSONA_MAX_TIME / this.PERSONA_CHECK_INTERVAL;
      const { userId } = initInfo();
      const pollUrl = `${STATIC_URL}persona/poll/?fuser_key=${userId}`;

      const checkCompletion = async (): Promise<void> => {
        try {
          const response = await this._fetch(pollUrl);

          if (response?.status === 400) {
            const errorData = await response.json();
            return resolve({ error: parseAPIError(errorData) });
          } else if (response?.status === 200) {
            const data = await response.json();
            if (data.status === 'complete') {
              return resolve(data);
            } else {
              attempts += 1;
              if (attempts < MAX_ATTEMPTS) {
                setTimeout(checkCompletion, this.PERSONA_CHECK_INTERVAL);
              } else {
                console.warn('Persona response took too long...');
                return resolve({
                  status: 'timeout',
                  error: 'Persona response timed out'
                });
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch Persona data:', error);
          return resolve({ error: 'Failed to fetch Persona data' });
        }
      };

      setTimeout(checkCompletion, this.PERSONA_CHECK_INTERVAL);
    });
  }

  // Telesign
  async telesignSilentVerification(phoneNumber: string) {
    const { userId } = initInfo();
    const initialUrl = `${API_URL}telesign/silent/initial/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        phone_number: phoneNumber,
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    const initialResponse = await this._fetch(initialUrl, options, false);
    if (initialResponse) {
      const {
        verification,
        reference_id: referenceId,
        status
      } = await initialResponse.json();
      if (!status) return status;

      // Kick off process to establish session with carrier fron client side
      const {
        verification_url: verificationUrl,
        method,
        expected_response_code: expectedResponseCode,
        post_body: postBody,
        query_string_params: queryStringParams
      } = verification;
      // We have no control over the verificationUrl Telesign sent back, and it could be of http://
      // Enforce the url to be https:// to avoid Mixed Content error
      let sessionUrl = verificationUrl.replace(/^http:\/\//i, 'https://');
      if (queryStringParams) {
        const queryParams = new URLSearchParams(queryStringParams).toString();
        sessionUrl += `?${queryParams}`;
      }
      const sessionOptions: {
        method: string;
        body?: string;
      } = { method: method };
      if (postBody) {
        sessionOptions.body = JSON.stringify(postBody);
      }
      const carrierResponse = await fetch(sessionUrl, sessionOptions);
      if (carrierResponse.status !== expectedResponseCode) return false;

      // If carrier session is successful, proceed with finalizing verification
      const params: Record<string, any> = {
        verification: JSON.stringify(verification),
        reference_id: referenceId,
        form_key: this.formKey,
        fuser_key: userId
      };
      const finalUrl = `${API_URL}telesign/silent/final/?${encodeGetParams(
        params
      )}`;
      const finalResponse = await this._fetch(finalUrl, {});
      if (finalResponse) {
        if (finalResponse.ok) {
          const { final_status: finalStatus } = await finalResponse.json();
          return finalStatus;
        } else throw Error(parseAPIError(await finalResponse.json()));
      }
      return false;
    }
  }

  async telesignPhoneType(phoneNumber: string) {
    const { userId } = initInfo();
    const url = `${API_URL}telesign/phone_type/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        phone_number: phoneNumber,
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    const response = await this._fetch(url, options, false);
    if (response) {
      const { phone_type: phoneType } = await response.json();
      return phoneType;
    }
  }

  async telesignSendOTP(phoneNumber: string, mode: 'voice' | 'sms' = 'voice') {
    const { userId } = initInfo();
    const url = `${API_URL}telesign/otp/${mode}/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        phone_number: phoneNumber,
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    await this._fetch(url, options, false);
  }

  async telesignVerifyOTP(otp: string) {
    const { userId } = initInfo();
    const params: Record<string, any> = {
      otp,
      form_key: this.formKey,
      fuser_key: userId
    };
    const url = `${API_URL}telesign/otp/verify/?${encodeGetParams(params)}`;
    const response = await this._fetch(url);
    if (response) {
      if (response.ok) {
        const { otp_status: otpStatus } = await response.json();
        return otpStatus;
      } else throw Error(parseAPIError(await response.json()));
    }
  }

  async sendEmail(templateId: string) {
    const { userId, sdkKey } = initInfo();
    await apiSendEmail(sdkKey, userId ?? '', this.formKey, templateId);
  }

  async alloyJourneyApplication(journeyToken: string, entities: AlloyEntities) {
    const { userId } = initInfo();
    const url = `${API_URL}alloy/journey/application/`;
    const reqOptions = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        journey_token: journeyToken,
        entities,
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    const res = await this._fetch(url, reqOptions, false);
    if (res && res.status === 201)
      return { ok: true, payload: await res.json() };
    else return { ok: false, error: (await res?.text()) ?? '' };
  }

  async createLoanProCustomerWithAuthorizedEmail(
    bodyParams: LoanProCustomerObject
  ) {
    const { userId } = initInfo();
    const url = `${API_URL}loanpro/customer/create/`;
    const reqOptions = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        body_params: bodyParams,
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    const res = await this._fetch(url, reqOptions, false);
    if (res && res.status === 200) {
      return { ok: true, payload: await res.json() };
    }
    return { ok: false, error: (await res?.json()) ?? '' };
  }

  async searchLoanProCustomerByAuthorizedEmail() {
    const { userId } = initInfo();
    const url = `${API_URL}loanpro/customer/search/`;
    const reqOptions = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    const res = await this._fetch(url, reqOptions, false);
    if (res && res.status === 200) {
      return { ok: true, payload: await res.json() };
    }
    return { ok: false, error: (await res?.json()) ?? '' };
  }

  async schwabCreateContact() {
    const { userId } = initInfo();
    const url = `${API_URL}schwab/create_contact/`;
    const reqOptions = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    const res = await this._fetch(url, reqOptions, false);
    if (res && res.status === 201)
      return { ok: true, payload: await res.json() };
    else return { ok: false, error: (await res?.text()) ?? '' };
  }

  async customRolloutAction(
    automationIds: IntegrationActionIds,
    options: IntegrationActionOptions
  ) {
    const { userId, sdkKey } = initInfo();
    await this.submitQueue;
    return apiCustomRolloutAction(
      sdkKey,
      automationIds,
      this.formKey,
      fieldValues,
      options,
      userId
    );
  }

  async fetchSalesforcePicklistOptions(
    objectName: string,
    fieldName: string,
    credentialKey: string
  ) {
    const url = `${API_URL}salesforce/field/options/`;
    const params = new URLSearchParams({
      object_name: objectName,
      field_name: fieldName,
      credential_key: credentialKey
    }).toString();
    const response = await this._fetch(`${url}?${params}`);
    if (response && response.ok) {
      return await response.json();
    }
    return { options: [] };
  }
}
