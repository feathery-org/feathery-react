import { fieldValues, initFormsPromise, initInfo, initState } from '../init';
import { encodeGetParams } from '../primitives';
import { API_URL, STATIC_URL } from '.';
import { OfflineRequestHandler } from '../offlineRequestHandler';
import {
  AlloyEntities,
  GetDocusignEnvelopeParams,
  LoanProCustomerObject,
  SendDocusignParams,
  UpdateDocusignEnvelopeParams
} from '../internalState';
import { featheryWindow } from '../browser';
import {
  apiFetch,
  customRolloutAction as apiCustomRolloutAction,
  FormAuthenticationError,
  FormConflictError,
  generateFormDocuments as apiGenerateFormDocuments,
  generateQuikEnvelopes as apiGenerateQuikEnvelopes,
  getApiUrl,
  getQuikAccountForms as apiGetQuikAccountForms,
  getQuikFormRoles as apiGetQuikFormRoles,
  getQuikForms as apiGetQuikForms,
  IntegrationActionIds,
  IntegrationActionOptions,
  parseAPIError,
  sendEmail as apiSendEmail
} from '@feathery/client-utils';
import { handleFormAuthenticationError, handleFormConflict } from './utils';
import {
  editorContainerId,
  isDocusignSignAction,
  signsViaDocusign
} from '../document';

// A configured Generate Documents entry in the ordered `documents` array: a
// template UUID string, or the single polymorphic `{kind:'quik'}` source dict.
// The SDK forwards these verbatim (action config -> request field).
export type GenerateDocumentRef = string | { kind: string; [key: string]: any };

export const TYPE_MESSAGES_TO_IGNORE = [
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3571287943/
  'Failed to fetch',
  // e.g. https://sentry.io/organizations/feathery-forms/issues/3529742129/
  'Load failed'
];

const QUIK_DYNAMIC_ATTACHMENTS_OPTION = '__quik_dynamic_attachments__';

const getQuikAttachmentPosition = (position: any) =>
  position === 'before' ? 'before' : 'after';

const isQuikDynamicAttachmentId = (id: any) =>
  typeof id === 'string' &&
  (id === QUIK_DYNAMIC_ATTACHMENTS_OPTION ||
    id.startsWith(`${QUIK_DYNAMIC_ATTACHMENTS_OPTION}:`));

const normalizeConfiguredQuikAttachments = (
  value: any,
  getDynamicAttachmentIds: (attachment: any) => string[] = () => []
): Record<string, any>[] => {
  if (value == null || value === '') return [];

  // Builder config stores attachment rows as a list. Normalize a list or single
  // row into one flat attachment list so runtime consumers get one shape.
  if (Array.isArray(value)) {
    return value.flatMap((attachment) =>
      normalizeConfiguredQuikAttachments(attachment, getDynamicAttachmentIds)
    );
  }

  if (typeof value === 'object') {
    const id = value.id;
    if (!id && !value.field_key) return [];

    // Dynamic rows are builder-configured placeholders. The hidden field
    // supplies only doc IDs; placement comes from this row's before/after slot.
    if (isQuikDynamicAttachmentId(id) || value.field_key) {
      return getDynamicAttachmentIds(value).map((attachmentId) => ({
        id: attachmentId,
        position: getQuikAttachmentPosition(value.position)
      }));
    }

    const attachment: Record<string, any> = { id };
    if (['before', 'after'].includes(value.position)) {
      attachment.position = value.position;
    }
    return [attachment];
  }

  return [];
};

const normalizeDynamicQuikAttachmentIds = (value: any): string[] => {
  if (!Array.isArray(value)) return [];

  // Dynamic hidden fields intentionally support only string ID arrays.
  // Invalid values are ignored instead of treated as attachment config.
  return value
    .filter((id) => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean);
};

const resolveQuikAttachments = (action: Record<string, any>) => {
  const getDynamicAttachmentIds = (attachment: any = {}) => {
    return normalizeDynamicQuikAttachmentIds(fieldValues[attachment.field_key]);
  };
  return normalizeConfiguredQuikAttachments(
    action.attachments,
    getDynamicAttachmentIds
  );
};

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
    // Stop making requests if authentication error has occurred
    if (initState.authenticationError) {
      return Promise.resolve(undefined);
    }
    return apiFetch(sdkKey, url, options, parseResponse).catch((e) => {
      if (e instanceof FormConflictError) {
        handleFormConflict();
        return;
      }

      if (e instanceof FormAuthenticationError) {
        handleFormAuthenticationError(e.message);
        return;
      }

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

  async startAccountConnect(provider: string, parentOrigin: string) {
    await initFormsPromise;
    const { userId } = initInfo();
    const params = encodeGetParams({
      form_key: this.formKey,
      fuser_key: userId,
      provider,
      parent_origin: parentOrigin
    });
    const response = await this._fetch(
      `${API_URL}account-connect/start/?${params}`,
      undefined,
      false
    );
    if (!response) throw new Error('Unable to start authorization.');

    const payload = await response.json();
    if (response.status === 200) return payload;
    throw new Error(parseAPIError(payload) || 'Unable to start authorization.');
  }

  async getAccountConnectStatus(state: string) {
    await initFormsPromise;
    const { userId } = initInfo();
    const params = encodeGetParams({
      form_key: this.formKey,
      fuser_key: userId,
      state
    });
    const response = await this._fetch(
      `${API_URL}account-connect/status/?${params}`,
      undefined,
      false
    );
    if (!response) return { status: 'pending' };

    const payload = await response.json();
    if (response.status === 200) return payload;
    throw new Error(
      parseAPIError(payload) || 'Unable to check authorization status.'
    );
  }

  async browseAccountResources(
    provider: string,
    parent: string,
    { marker = '', create = '' }: { marker?: string; create?: string } = {}
  ) {
    return this._accountConnectPost('browse', {
      provider,
      parent,
      marker,
      create
    });
  }

  async saveAccountConfig(provider: string, selection: Record<string, any>) {
    return this._accountConnectPost('config', { provider, selection });
  }

  async _accountConnectPost(path: string, body: Record<string, any>) {
    await initFormsPromise;
    const { userId } = initInfo();
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        form_key: this.formKey,
        fuser_key: userId,
        ...body
      })
    };
    const response = await this._fetch(
      `${API_URL}account-connect/${path}/`,
      options,
      false
    );
    if (!response) throw new Error('Unable to reach the connected account.');

    const payload = await response.json();
    if (response.status === 200) return payload;
    throw new Error(
      parseAPIError(payload) || 'Unable to reach the connected account.'
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
  ENVELOPE_MAX_TIME = 8 * 60 * 1000;

  async generateEnvelopes(action: Record<string, any>) {
    const { userId, sdkKey } = initInfo();
    // Editor flow: the backend converts a docx envelope to PDF at generation
    // whenever a signer is present, which would make the draft uneditable in
    // the targeted document-editor container. Hold every signer back there —
    // the editor's Sign action forwards them at finalize time
    // (finalizeEnvelope), when that conversion is meant to happen.
    const isDraftView =
      !!editorContainerId(action) || !!action.view_draft_container;
    // The configured field names whoever signs inline, in the form. Nobody does
    // on a DocuSign action - every recipient is mailed by DocuSign, and the
    // per-role mappings are what name them - so the field is ignored there
    // rather than quietly routing to it on top of the roles.
    const configuredFiller = signsViaDocusign(action)
      ? undefined
      : fieldValues[action.envelope_signer_field_key];
    const fillerEmail = isDraftView ? '' : configuredFiller?.toString() ?? '';
    const envelopeAction =
      !action.envelope_action || action.envelope_action === 'sign'
        ? 'sign'
        : 'fill';
    const documentIds = action.documents ?? [];
    const repeatable = action.repeatable ?? false;
    const runAsync = action.run_async ?? true;
    // One list: the configured per-role signers, plus the shared signer field
    // for any document without a role. `filler` marks the entries the form
    // filler signs themselves, which are opened inline rather than emailed —
    // only those signing tokens come back.
    const envelopeSigners = isDraftView ? [] : action.envelope_signers ?? [];
    // Whichever entries are the filler's own are flagged, so the backend
    // opens those inline instead of emailing a link, and hands back only
    // their signing token.
    const isFiller = (email: string) =>
      !!fillerEmail && email.toLowerCase() === fillerEmail.toLowerCase();
    const roleSigners = envelopeSigners
      .map((entry: any) => {
        // The action config only ever maps a field, and names the filler by
        // matching the shared signer field; the logic-rule method supplies
        // both the email and the flag outright.
        const email =
          (entry.email ?? fieldValues[entry.field_key])?.toString() ?? '';
        return {
          document_id: entry.document_id,
          // Omitted rather than nulled: the backend's role_id rejects an
          // explicit null, and leaving it off spreads the email across
          // every role.
          ...(entry.role_id ? { role_id: entry.role_id } : {}),
          email,
          filler: entry.filler ?? isFiller(email)
        };
      })
      .filter((entry: any) => entry.email);
    // Only a document whose roles actually resolved to someone opts out of the
    // shared signer field. A mapping whose field came back empty routes to
    // nobody, so the field covers every role there instead.
    const roleDocumentIds = new Set(
      roleSigners.map((entry: any) => entry.document_id)
    );
    const signers = [
      ...roleSigners,
      ...documentIds
        .filter((documentId: any) => !roleDocumentIds.has(documentId))
        .map((documentId: any) => ({
          document_id: documentId,
          email: fillerEmail,
          filler: true
        }))
    ].filter((entry: any) => entry.email);

    const openInEditor = action.envelope_action === 'open_in_editor';

    // `@feathery/client-utils`'s generateFormDocuments only forwards a fixed
    // set of known fields, so it can't carry the review-step flag or
    // DocuSign's sign_method through to the endpoint. Call the endpoint
    // directly (reusing this client's own fetch/poll handling) whenever
    // either is requested; other sign_method values (e.g. Feathery's own
    // hosted eSign) still go through the maintained library path below.
    //
    // The draft-editor container is deliberately excluded: it consumes the
    // generate response's `envelopes` metadata, which the review payload
    // replaces, and it presents its own editing surface instead of the review
    // viewer. Targeting a container therefore keeps the plain generate flow.
    // A polymorphic entry has to take the direct call too. client-utils'
    // generateFormDocuments interpolates `documentIds` straight into its poll
    // URL, so a {kind:'quik'} entry stringifies to "[object Object]" and never
    // matches the backend's document_cache_keys ("quik" for that item). The
    // documents generate fine and then the first poll 400s "No document
    // generation". generateEnvelopesForEditor maps the keys correctly.
    const hasPolymorphicDocument = documentIds.some(
      (doc: GenerateDocumentRef) => typeof doc !== 'string'
    );

    if (
      (openInEditor ||
        isDocusignSignAction(action) ||
        hasPolymorphicDocument) &&
      !editorContainerId(action)
    ) {
      return await this.generateEnvelopesForEditor({
        documentIds,
        signers,
        repeatable,
        runAsync,
        toolbarActions: action.editor_toolbar_actions ?? [],
        mergeDocs: action.merge_docs ?? false,
        openInEditor,
        envelopeAction,
        signMethod: action.sign_method
      });
    }

    return await apiGenerateFormDocuments({
      sdkKey,
      formId: this.formKey,
      documentIds,
      userId,
      signers,
      repeatable,
      runAsync,
      envelopeAction,
      checkInterval: this.ENVELOPE_CHECK_INTERVAL,
      maxTime: this.ENVELOPE_MAX_TIME
    });
  }

  // Replace a generated envelope's file with an edited version, e.g. from the
  // in-form document editor. Returns { id, file, editor_file, updated_at }
  // with fresh signed URLs: `file` is the public copy (content controls
  // stripped server-side), `editor_file` the control-bearing editor copy.
  saveEnvelopeFile(envelopeId: string, file: Blob, fileName = 'document.docx') {
    const { userId } = initInfo();
    const formData = new FormData();
    formData.append('fuser_key', userId ?? '');
    formData.append('file', file, fileName);
    const url = `${API_URL}document/envelope/${envelopeId}/file/`;
    const options = {
      method: 'PATCH',
      body: formData,
      // apiFetch defaults PATCH to keepalive, and Chromium rejects keepalive
      // requests whose body exceeds 64kb — exported .docx files routinely do.
      keepalive: false
    };
    return this._fetch(url, options, false).then(async (response) => {
      // _fetch resolves undefined on swallowed network errors — surface that
      // as a failure so callers never treat an unsaved document as saved
      // (e.g. the sign flow must not open against a stale envelope).
      if (!response) throw Error('Document save failed');
      if (response.ok) return await response.json();
      throw Error(parseAPIError(await response.json()));
    });
  }

  // Finalize an edited docx envelope for signing: the backend converts it to
  // PDF and injects signature fields (the same pipeline generation runs when
  // a signer is known up front). One-way — the envelope stops being editable.
  // Signers are supplied here rather than at generation: they're what makes
  // the backend convert the docx, so holding them back is what kept the draft
  // editable. Same list shape generation sends, where an omitted role_id means
  // the one email covers every role.
  // `signMethod` decides who does the sending: on DocuSign the rows are still
  // built here (they become its recipients) but no Feathery invite goes out.
  finalizeEnvelope(
    envelopeId: string,
    signers: Record<string, any>[] = [],
    signMethod?: string
  ) {
    const { userId } = initInfo();
    const url = `${API_URL}document/envelope/${envelopeId}/finalize/`;
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fuser_key: userId ?? '',
        signers,
        ...(signMethod ? { sign_method: signMethod } : {})
      }),
      keepalive: false
    };
    return this._fetch(url, options, false).then(async (response) => {
      // Surface swallowed network errors — the sign page must never open
      // against an unfinalized envelope.
      if (!response) throw Error('Document finalization failed');
      if (response.ok) return await response.json();
      throw Error(parseAPIError(await response.json()));
    });
  }

  // Download the envelope as PDF bytes. Docx envelopes are converted
  // server-side on the fly WITHOUT being persisted — unlike finalize, the
  // envelope stays an editable docx.
  downloadEnvelopePdf(envelopeId: string): Promise<Blob> {
    const { userId } = initInfo();
    const url = `${API_URL}document/envelope/${envelopeId}/pdf/`;
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fuser_key: userId ?? '' }),
      keepalive: false
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (!response) throw Error('PDF export failed');
      if (response.ok) return await response.blob();
      throw Error(parseAPIError(await response.json()));
    });
  }

  // The newest envelope for this submission + document, loaded by the in-form
  // document editor container. Returns {id, file, editor_file, type, signed}
  // or {} — the editor opens editor_file (controls intact) when present.
  getCurrentEnvelope(documentId: string) {
    const { userId } = initInfo();
    const params = encodeGetParams({
      fuser_key: userId,
      document_id: documentId
    });
    const url = `${API_URL}document/current-envelope/?${params}`;
    return this._fetch(url, {}, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  private async generateEnvelopesForEditor({
    documentIds,
    signers,
    repeatable,
    runAsync,
    toolbarActions,
    mergeDocs,
    openInEditor,
    envelopeAction,
    signMethod
  }: {
    documentIds: GenerateDocumentRef[];
    signers: Record<string, any>[];
    repeatable: boolean;
    runAsync: boolean;
    toolbarActions: string[];
    mergeDocs: boolean;
    // False for a direct DocuSign sign, which also needs this call because
    // client-utils can't forward sign_method.
    openInEditor: boolean;
    envelopeAction: 'sign' | 'fill';
    signMethod?: string;
  }) {
    const { userId } = initInfo();
    const payload: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      documents: documentIds,
      run_async: runAsync,
      envelope_action: openInEditor ? 'open_in_editor' : envelopeAction,
      // Forwarded even though neither path merges at generate time: it lets the
      // backend reject an unsupported merge combination (merge_docs with a
      // DocuSign send) now, instead of after the filler has reviewed every
      // document and pressed a button that finalize would then refuse.
      merge_docs: mergeDocs
    };
    if (openInEditor) {
      // Generate reads the toolbar only to decide whether default field values
      // are baked in; the pressed action is sent to finalize separately.
      payload.editor_toolbar_actions = toolbarActions;
    }
    if (signMethod) payload.sign_method = signMethod;
    if (signers.length) payload.signers = signers;
    if (repeatable) payload.repeatable = repeatable;

    const url = `${getApiUrl()}document/form/generate/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(payload)
    };
    const response = await this._fetch(url, options, false);
    if (!response) return;
    const data = await response.json();
    if (!response.ok) return { status: 'error', message: parseAPIError(data) };
    if (!runAsync || data.documents) return data;

    // Poll `dids` must match the backend's document_cache_keys: a template's
    // UUID string, or the literal "quik" for the quik item. Interpolating the
    // raw array would stringify a {kind:'quik'} entry to "[object Object]" and
    // never match the cache.
    const dids = documentIds
      .map((doc) =>
        typeof doc === 'string'
          ? doc
          : doc.kind === 'quik'
          ? 'quik'
          : String(doc.document_id)
      )
      .join(',');
    const pollUrl = `${getApiUrl()}document/form/generate/poll/?fid=${userId}&dids=${dids}`;
    return await this.pollUntilComplete(
      pollUrl,
      this.ENVELOPE_CHECK_INTERVAL,
      this.ENVELOPE_MAX_TIME,
      'Document generation'
    );
  }

  FINALIZE_CHECK_INTERVAL = 2000;
  FINALIZE_MAX_TIME = 3 * 60 * 1000;

  async finalizeEnvelopeReview(
    action: Record<string, any>,
    {
      envelopes,
      envelopeAction,
      draft = false
    }: {
      // signerId: the filler's own signing token for that envelope, as handed
      // back by generate. Keeps finalize from emailing them an invite to a
      // document they open and sign inline.
      envelopes: { envelopeId: string; signerId?: string }[];
      envelopeAction: 'sign' | 'fill' | 'download' | 'save';
      // DocuSign sign only: create the envelope as a draft instead of sending.
      draft?: boolean;
    }
  ) {
    if (!envelopes.length) {
      return { status: 'error', message: 'No envelopes to finalize' };
    }

    const { userId } = initInfo();
    const runAsync = action.run_async ?? true;
    const payload: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      envelopes: envelopes.map((envelope) => ({
        envelope_id: envelope.envelopeId,
        // Omitted rather than nulled: the backend rejects an explicit null.
        ...(envelope.signerId ? { signer_id: envelope.signerId } : {})
      })),
      envelope_action: envelopeAction,
      merge_docs: action.merge_docs ?? false,
      draft,
      run_async: runAsync
    };
    if (action.merged_file_name)
      payload.merged_file_name = action.merged_file_name;
    if (action.sign_method) payload.sign_method = action.sign_method;

    const url = `${getApiUrl()}document/form/finalize/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(payload)
    };
    const response = await this._fetch(url, options, false);
    if (!response) return;
    const data = await response.json();
    if (!response.ok) return { status: 'error', message: parseAPIError(data) };
    // The sync response is already the final `{ files: [...] }` payload.
    // The async response is always `{}` immediately, regardless of the
    // requested envelope_action (sign/fill/download/save) — completion is
    // only ever signaled by the poll endpoint's `status: 'complete'`, never
    // by guessing at the shape of this intermediate body.
    //
    // `incomplete` is neither: a concurrent duplicate was already in flight and
    // this call did nothing, so poll for the owning call's outcome rather than
    // reporting a send that never happened.
    if (!runAsync && data?.status !== 'incomplete') return data;

    const envelopeIds = envelopes.map((envelope) => envelope.envelopeId);
    const pollUrl = `${getApiUrl()}document/form/finalize/poll/?fid=${userId}&eids=${envelopeIds}`;
    return await this.pollUntilComplete(
      pollUrl,
      this.FINALIZE_CHECK_INTERVAL,
      this.FINALIZE_MAX_TIME,
      'Document finalize'
    );
  }

  // Shared GET-poll loop for endpoints whose async path reports completion
  // via `{ status: 'complete', ... }` (mirrors the poll pattern used by
  // client-utils' generateFormDocuments / generateQuikEnvelopes, but routed
  // through this._fetch so auth/conflict handling stays consistent).
  // TODO (tyler): migrate the other polling endpoints (Quik envelope
  // generation, AI document extraction, persona) onto this helper instead of
  // each hand-rolling its own retry loop — the persona loop below still has
  // the parseResponse bug this one was just fixed for. Once it is shared,
  // move it out of the middle of the document methods.
  private pollUntilComplete(
    pollUrl: string,
    checkInterval: number,
    maxTime: number,
    operationName: string
  ): Promise<Record<string, any>> {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = maxTime / checkInterval;

      const retryOrTimeout = () => {
        if (attempts < maxAttempts) {
          setTimeout(checkCompletion, checkInterval);
        } else {
          const message = `${operationName} took too long...`;
          console.warn(message);
          resolve({ status: 'error', message });
        }
      };

      const checkCompletion = async (): Promise<void> => {
        attempts += 1;
        let response;
        try {
          // parseResponse=false is load-bearing: with the default `true`,
          // client-utils' checkResponseSuccess throws on every non-2xx poll,
          // which turns a hard 500 into a silent retry until timeout and
          // routes a 403 through handleFormAuthenticationError (poisoning
          // every later _fetch). Matches client-utils' own pollForCompletion.
          response = await this._fetch(pollUrl, { method: 'GET' }, false);
        } catch {
          // transient network error - retry on next interval
        }
        if (!response) return retryOrTimeout();

        let data;
        try {
          data = await response.json();
        } catch {
          // A non-JSON body (a gateway's HTML 502 page, a truncated
          // response) must not escape as an unhandled rejection: this runs
          // from a setTimeout inside the promise executor, so a throw here
          // would leave the outer promise permanently unsettled and the
          // caller's spinner running forever. Treat it as a bad poll and
          // retry until the timeout resolves the promise.
          return retryOrTimeout();
        }
        if (response.ok) {
          if (data.status === 'complete') return resolve(data);
          return retryOrTimeout();
        }
        return resolve({ status: 'error', message: parseAPIError(data) });
      };

      setTimeout(checkCompletion, checkInterval);
    });
  }

  sendDocusignEnvelope({
    documents,
    libraryDocuments,
    fillData,
    emailSubject,
    emailBlurb,
    signers,
    existingEnvelopeId,
    draft,
    wetSign,
    useDisclosure,
    notification,
    brandId,
    enforceSignerVisibility,
    ignoreTemplateFieldMapping
  }: SendDocusignParams) {
    const { userId } = initInfo();
    const url = `${API_URL}docusign/envelope/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        fuser_key: userId,
        form_key: this.formKey,
        // Polymorphic: plain UUID strings pass through; object entries are
        // sent with snake_case keys for multi-instance envelopes.
        documents: documents?.map((doc) =>
          typeof doc === 'string'
            ? doc
            : {
                document_id: doc.documentId,
                envelope_id: doc.envelopeId,
                fill_data: doc.fillData,
                signer_map: doc.signerMap,
                repeat_index: doc.repeatIndex
              }
        ),
        library_documents: libraryDocuments,
        fill_data: fillData,
        email_subject: emailSubject,
        email_blurb: emailBlurb,
        signers: signers?.map((signer) => ({
          email: signer.email,
          name: signer.name,
          sign_method: signer.signMethod,
          routing_order: signer.routingOrder,
          excluded_documents: signer.excludedDocuments
        })),
        docusign_envelope_id: existingEnvelopeId,
        draft,
        wet_sign: wetSign,
        use_disclosure: useDisclosure,
        notification,
        brand_id: brandId,
        enforce_signer_visibility: enforceSignerVisibility,
        ignore_template_field_mapping: ignoreTemplateFieldMapping
      })
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  getDocusignEnvelope({ envelopeId }: GetDocusignEnvelopeParams) {
    const { userId } = initInfo();
    const params = encodeGetParams({
      fuser_key: userId,
      form_key: this.formKey,
      docusign_envelope_id: envelopeId
    });
    const url = `${API_URL}docusign/envelope/?${params}`;
    return this._fetch(url, {}, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  getDocusignBrands() {
    const { userId } = initInfo();
    const params = encodeGetParams({
      fuser_key: userId,
      form_key: this.formKey
    });
    const url = `${API_URL}docusign/brands/?${params}`;
    return this._fetch(url, {}, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  updateDocusignEnvelope({
    envelopeId,
    status,
    voidedReason
  }: UpdateDocusignEnvelopeParams) {
    const { userId } = initInfo();
    const url = `${API_URL}docusign/envelope/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
      body: JSON.stringify({
        fuser_key: userId,
        form_key: this.formKey,
        docusign_envelope_id: envelopeId,
        status,
        voided_reason: voidedReason
      })
    };
    return this._fetch(url, options, false).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  QUIK_CHECK_INTERVAL = 2000;
  QUIK_MAX_TIME = 2 * 60 * 1000;

  async generateQuikEnvelopes(action: Record<string, any>) {
    const { userId, sdkKey } = initInfo();
    let tags: any[] = [];

    const fieldVal = fieldValues[action.quik_tags_field_key];

    if (action.quik_tags_field_key) {
      if (typeof fieldVal === 'string') {
        tags = (fieldVal as string).split(',').map((tag) => tag.trim());
      } else if (fieldVal instanceof Array) {
        tags = fieldVal;
      } else {
        tags = [JSON.stringify(fieldVal)];
      }
    }

    const resolvedAction = {
      ...action,
      attachments: resolveQuikAttachments(action)
    };

    return await apiGenerateQuikEnvelopes({
      sdkKey,
      formId: this.formKey,
      action: resolvedAction,
      userId,
      tags,
      checkInterval: this.QUIK_CHECK_INTERVAL,
      maxTime: this.QUIK_MAX_TIME
    });
  }

  async getQuikForms({ dealerNames }: { dealerNames: string[] }) {
    const { sdkKey } = initInfo();
    return await apiGetQuikForms({ sdkKey, formId: this.formKey, dealerNames });
  }

  async getQuikFormRoles({ formIds }: { formIds: number[] }) {
    const { sdkKey } = initInfo();
    return await apiGetQuikFormRoles({
      sdkKey,
      formId: this.formKey,
      formIdList: formIds
    });
  }

  async getQuikAccountForms({
    custodian,
    accountType,
    isTransition = false
  }: {
    custodian: string;
    accountType: string;
    isTransition?: boolean;
  }) {
    const { sdkKey } = initInfo();
    return await apiGetQuikAccountForms({
      sdkKey,
      formId: this.formKey,
      custodian,
      accountType,
      isTransition
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
