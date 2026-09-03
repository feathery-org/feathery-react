import { featheryDoc } from '../utils/browser';
import { fieldValues } from '../utils/init';
import { isTrustedFormDebugEnabled } from './trustedformDebug';

const configMap: Record<string, any> = {};

// TrustedForm scans the page when it starts and will not see a form that is
// rendered afterwards. Integrations initialize during the session fetch, which
// is before React has rendered anything, so wait for the form to exist first.
const FORM_WAIT_TIMEOUT_MS = 10000;

export function awaitFormElement(): Promise<void> {
  return new Promise((resolve) => {
    const doc = featheryDoc();
    if (!doc.querySelector || doc.querySelector('form.feathery'))
      return resolve();

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };

    const observer = new MutationObserver(() => {
      if (doc.querySelector('form.feathery')) finish();
    });
    observer.observe(doc.body ?? doc.documentElement, {
      childList: true,
      subtree: true
    });

    // Never block certification indefinitely if the form never renders
    const timer = setTimeout(() => {
      console.warn(
        '[feathery] TrustedForm: form did not render within the wait window, injecting anyway'
      );
      finish();
    }, FORM_WAIT_TIMEOUT_MS);
  });
}

function injectTrustedFormScript(trustedformConfig: any) {
  const tf = featheryDoc().createElement('script');
  tf.type = 'text/javascript';
  tf.async = true;

  const protocol =
    featheryDoc().location.protocol === 'https:' ? 'https' : 'http';
  const certField = trustedformConfig.metadata.certificate_field_key;
  const pingField = trustedformConfig.metadata.ping_field_key;
  const rand = new Date().getTime() + Math.random();
  tf.src = `${protocol}://api.trustedform.com/trustedform.js?field=${certField}&ping_field=${pingField}&l=${rand}`;

  const s = featheryDoc().getElementsByTagName('script')[0];
  s.parentNode.insertBefore(tf, s);
}

export async function installTrustedForm(
  trustedformConfig: any,
  formKey: string
) {
  if (!trustedformConfig) return;

  configMap[formKey] = trustedformConfig;

  // Deliberately not awaited: integration setup blocks the session fetch, and
  // the form we are waiting for cannot render until that fetch resolves.
  awaitFormElement()
    .then(() => injectTrustedFormScript(trustedformConfig))
    .catch((err) =>
      console.warn('[feathery] TrustedForm script failed to install', err)
    );
}

/**
 * Opt-in console logger for what a certificate would record per interaction.
 * Independent of the integration config so a form without TrustedForm
 * configured can still be audited; loaded lazily so nobody else pays for it.
 */
export function installTrustedFormDebugIfRequested() {
  if (!isTrustedFormDebugEnabled()) return;
  import('./trustedformDebug')
    .then(({ installTrustedFormDebug, whenDomSettles }) => {
      const debug = installTrustedFormDebug();
      // Audit once the form has rendered so the unnamed list is the first
      // thing seen; the form element appears before its fields do
      awaitFormElement()
        .then(() => whenDomSettles())
        .then(() => debug.audit());
    })
    .catch((err) =>
      console.warn('[feathery] TrustedForm debug failed to load', err)
    );
}

export function gatherTrustedFormFields(existingFields: any, formKey: string) {
  const config = configMap[formKey];
  if (!config) return;

  ['certificate_field_key', 'ping_field_key'].forEach((attr) => {
    const fieldKey = config.metadata[attr];
    if (!(fieldKey in fieldValues)) {
      // Not stored yet
      const el = featheryDoc().getElementsByName(fieldKey)[0];
      if (el) {
        const fieldVal = el.value;
        fieldValues[fieldKey] = fieldVal;
        existingFields[fieldKey] = fieldVal;
      }
    }
  });
}
