import * as errors from '../error';
import { fieldValues, initFormsPromise, initInfo, initState } from '../init';
import { encodeGetParams } from '../primitives';
import { parseError } from '../error';
import { API_URL } from '.';
import { OfflineRequestHandler } from '../offlineRequestHandler';

export const TYPE_MESSAGES_TO_IGNORE = [
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3571287943/
  'Failed to fetch',
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3529742129/
  'Load failed'
];

export async function checkResponseSuccess(response: any) {
  let payload;
  switch (response.status) {
    case 200:
    case 201:
      return;
    case 400:
      payload = JSON.stringify(await response.clone().text());
      console.error(payload.toString());
      return;
    case 401:
      throw new errors.SDKKeyError();
    case 404:
      throw new errors.FetchError("Can't find object");
    case 409:
      location.reload();
      return;
    case 500:
      throw new errors.FetchError('Internal server error');
    default:
      throw new errors.FetchError('Unknown error');
  }
}

// THIRD-PARTY INTEGRATIONS
export default class IntegrationClient {
  formKey: string;
  version?: string;
  _noSave?: boolean;
  ignoreNetworkErrors: any; // this should be a ref
  draft: boolean;
  bypassCDN: boolean;
  submitQueue: Promise<any>;
  offlineRequestHandler: OfflineRequestHandler;
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
    this.offlineRequestHandler = new OfflineRequestHandler(formKey);
  }

  _fetch(
    url: any,
    options: any,
    parseResponse = true,
    propagateNetworkErrors = false
  ) {
    const { sdkKey } = initInfo();
    const { headers, ...otherOptions } = options;
    options = {
      cache: 'no-store',
      // Write requests must succeed so data is tracked
      keepalive: ['POST', 'PATCH', 'PUT'].includes(options.method),
      headers: {
        Authorization: 'Token ' + sdkKey,
        ...headers
      },
      ...otherOptions
    };
    return fetch(url, options)
      .then(async (response) => {
        if (parseResponse) await checkResponseSuccess(response);
        return response;
      })
      .catch((e) => {
        // Ignore TypeErrors if form has redirected because `fetch` in
        // Safari will error after redirect
        const ignore =
          this.ignoreNetworkErrors?.current ||
          TYPE_MESSAGES_TO_IGNORE.includes(e.message);
        if (ignore && !propagateNetworkErrors && e instanceof TypeError) return;
        throw e;
      });
  }

  async fetchPlaidLinkToken(includeLiabilities: boolean) {
    await initFormsPromise;
    const { userId } = initInfo();
    const params = encodeGetParams({
      form_key: this.formKey,
      fuser_key: userId,
      liabilities: includeLiabilities ? 'true' : 'false'
    });
    const url = `${API_URL}plaid/link_token/?${params}`;
    return this._fetch(url, {}).then((response) =>
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
    const options = { headers: { 'Content-Type': 'application/json' } };
    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  addressSearchResults(searchTerm: any, country: any) {
    const params = encodeGetParams({ search_term: searchTerm, country });
    const url = `${API_URL}integration/address/search/?${params}`;
    const options = { headers: { 'Content-Type': 'application/json' } };
    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  addressDetail(addressId: any) {
    const params = encodeGetParams({ address_id: addressId });
    const url = `${API_URL}integration/address/detail/?${params}`;
    const options = { headers: { 'Content-Type': 'application/json' } };
    return this._fetch(url, options).then((response) =>
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
    const options = { headers: { 'Content-Type': 'application/json' } };
    return this._fetch(url, options).then((response) =>
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
        else throw Error(parseError(await response.json()));
      }
    });
  }

  async verifySMSOTP(otp: string) {
    const { userId } = initInfo();
    const url = `${API_URL}otp/verify/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({ otp, fuser_key: userId, form_key: this.formKey })
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseError(await response.json()));
      }
    });
  }

  generateEnvelopes(action: Record<string, string>) {
    const { userId } = initInfo();
    const signer = fieldValues[action.envelope_signer_field_key];
    const payload: Record<string, any> = {
      fuser_key: userId,
      documents: action.documents ?? [],
      signer_email: signer
    };
    if (action.quik_documents)
      payload.quik = fieldValues[action.quik_json_field_key];
    const url = `${API_URL}document/form/generate/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(payload)
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseError(await response.json()));
      }
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
        } else throw Error(parseError(await finalResponse.json()));
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

  async telesignVoiceOTP(phoneNumber: string) {
    const { userId } = initInfo();
    const url = `${API_URL}telesign/otp/voice/`;
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
    const response = await this._fetch(url, {});
    if (response) {
      if (response.ok) {
        const { otp_status: otpStatus } = await response.json();
        return otpStatus;
      } else throw Error(parseError(await response.json()));
    }
  }

  async sendEmail(templateId: string) {
    const { userId } = initInfo();
    const url = `${API_URL}email/logic-rule/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        template_id: templateId,
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    await this._fetch(url, options, false);
  }

  async customRolloutAction(automationId: string, sync: boolean) {
    const { userId } = initInfo();
    const url = `${API_URL}rollout/custom-trigger/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        automation_id: automationId,
        sync,
        payload: fieldValues,
        form_key: this.formKey,
        fuser_key: userId
      })
    };
    const res = await this._fetch(url, options, false);
    if (res && res.status === 201) return { ok: true, payload: res.json() };
    else return { ok: false, error: res?.text() ?? '' };
  }
}
