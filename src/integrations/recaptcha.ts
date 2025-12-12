import { dynamicImport } from './utils';
import { featheryWindow } from '../utils/browser';

const RECAPTCHA_SITE_KEY = '6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-';
const RECAPTCHA_URL = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;

const ERROR_THRESHOLD = 0.5;
const TIMEOUT_MS = 2000;
const INTERVAL_MS = 100;

let recaptchaReady = false;
let recaptchaLoadFailed = false;

async function waitOnRecaptcha(): Promise<{
  success: boolean;
  timedOut?: true;
}> {
  if (recaptchaLoadFailed) {
    return { success: false, timedOut: true };
  }

  if (recaptchaReady) {
    return { success: true };
  }

  return await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (recaptchaReady) {
        clearInterval(interval);
        clearTimeout(timeoutId);
        resolve({ success: true });
      }
    }, INTERVAL_MS);

    const timeoutId = setTimeout(() => {
      clearInterval(interval);
      console.warn('reCAPTCHA loading timed out after', TIMEOUT_MS, 'ms');
      recaptchaLoadFailed = true;
      resolve({ success: false, timedOut: true });
    }, TIMEOUT_MS);
  });
}

export async function installRecaptcha(steps: Record<string, any>) {
  if (recaptchaReady) return;

  const shouldInstall = Object.values(steps).some((step) =>
    step.buttons.some((button: any) => button.properties.captcha_verification)
  );
  if (shouldInstall) {
    try {
      await dynamicImport(RECAPTCHA_URL).then(() => {
        // Sometimes recaptcha fails to install, so use ?.
        // https://feathery-forms.sentry.io/issues/4378968555
        const grecaptcha = featheryWindow().grecaptcha;
        if (!grecaptcha) {
          throw new Error('Captcha load failed.');
        }
        grecaptcha.ready(() => (recaptchaReady = true));
      });
    } catch (error: any) {
      console.error('Captcha load failed:', error);
      recaptchaLoadFailed = true;
    }
  }
}

// returns true if user fails captcha verification
export async function verifyRecaptcha(client: {
  verifyRecaptchaToken: (token: string) => Promise<{ score: number }>;
}): Promise<boolean> {
  const result = await waitOnRecaptcha();
  if (!result.success) {
    // if recaptcha errors, skip verification and allow user through
    return false;
  }

  const grecaptcha = featheryWindow().grecaptcha;
  if (!grecaptcha) {
    console.error('Captcha not available during verification');
    return false;
  }
  return grecaptcha
    .execute('6Lcx9vAmAAAAAKnC1kO1nIdr125hCRfukaMb_R_-', {
      action: 'submit'
    })
    .then((token: string) => client.verifyRecaptchaToken(token))
    .then((data: { score: number }) => data.score < ERROR_THRESHOLD)
    .catch((error: any) => {
      // if recaptcha errors, skip verification and allow user through
      console.error('Captcha verification error:', error);
      return false;
    });
}
